import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Prisma, type Event, type EventTrack as EventTrackRow } from '@prisma/client';
import { lockRow, prisma, transaction } from '../db';
import { ApiError, badRequest, forbidden, notFound } from '../errors';
import { canSeeEvent, voteDecision, type GeoPoint } from '../domain/policies';
import {
  DateTimeInput,
  EventDetail,
  EventLicense,
  EventSummary,
  Id,
  IdParams,
  Nullable,
  UserSummary,
  Visibility,
  errors,
} from '../schemas';
import { userSummarySelect } from '../services/users';

// Music Track Vote. Concurrency strategy:
//  - a vote is a row with primary key (entry, user): voting twice is a no-op, never a double count;
//  - every write (vote, suggestion, next, settings) runs in a transaction that first locks the
//    event row, so the queue is changed by one writer at a time, a track cannot be queued twice
//    and "next" sees a stable queue. Locks are always taken in the same order (event, then
//    tracks), which rules out deadlocks;
//  - permission checks run before the transaction, and a vote is a single SQL statement, so the
//    lock is held for two short statements only (the vote is the hot path);
//  - after the commit the new state is broadcast to every subscriber with its version (coalesced
//    during bursts), so that clients can ignore messages older than what they already display.

const LocationBody = Type.Object({
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
  radiusMeters: Type.Integer({ minimum: 10, maximum: 50_000 }),
});
const WindowBody = Type.Object({ startsAt: DateTimeInput, endsAt: DateTimeInput });

const EventBody = {
  name: Type.String({ minLength: 1, maxLength: 100 }),
  description: Nullable(Type.String({ maxLength: 500 })),
  visibility: Visibility,
  license: EventLicense,
  location: Nullable(LocationBody),
  voteWindow: Nullable(WindowBody),
};

const VoteBody = Type.Object({
  latitude: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
  longitude: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
});

const EntryParams = Type.Object({ id: Id, entryId: Id });
const InviteParams = Type.Object({ id: Id, userId: Id });

type EventWithOwner = Event & { owner: { id: string; displayName: string; avatarUrl: string | null; musicPreferences: string[] } };

function common(e: EventWithOwner) {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    owner: e.owner,
    visibility: e.visibility,
    license: e.license,
    location:
      e.latitude !== null && e.longitude !== null && e.radiusMeters !== null
        ? { latitude: e.latitude, longitude: e.longitude, radiusMeters: e.radiusMeters }
        : null,
    voteWindow: e.voteStartsAt && e.voteEndsAt ? { startsAt: e.voteStartsAt, endsAt: e.voteEndsAt } : null,
    createdAt: e.createdAt,
  };
}

function toTrack(t: EventTrackRow) {
  return {
    id: t.id,
    trackId: t.trackId,
    title: t.title,
    artist: t.artist,
    album: t.album,
    coverUrl: t.coverUrl,
    previewUrl: t.previewUrl,
    durationSec: t.durationSec,
    score: t.score,
    status: t.status,
    suggestedById: t.suggestedById,
    createdAt: t.createdAt,
  };
}

/** The shared state of an event, identical for every viewer (this is what is broadcast). */
async function loadState(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      owner: { select: userSummarySelect },
      tracks: {
        where: { status: { in: ['QUEUED', 'PLAYING'] } },
        orderBy: [{ score: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
  if (!event) throw notFound('event');
  const playing = event.tracks.find((t) => t.status === 'PLAYING');
  return {
    event,
    state: {
      ...common(event),
      version: event.version,
      nowPlaying: playing ? toTrack(playing) : null,
      queue: event.tracks.filter((t) => t.status === 'QUEUED').map(toTrack),
    },
  };
}

function validateRules(rules: {
  license: string;
  location: { latitude: number; longitude: number; radiusMeters: number } | null;
  voteWindow: { startsAt: string; endsAt: string } | null;
}) {
  if (rules.voteWindow && new Date(rules.voteWindow.endsAt) <= new Date(rules.voteWindow.startsAt)) {
    throw badRequest('INVALID_VOTE_WINDOW', 'voteWindow.endsAt must be after voteWindow.startsAt');
  }
  if (rules.license === 'LOCATION_TIME' && (!rules.location || !rules.voteWindow)) {
    throw badRequest('LOCATION_TIME_INCOMPLETE', 'The LOCATION_TIME license requires a location and a vote window');
  }
}

function rulesColumns(body: {
  location?: { latitude: number; longitude: number; radiusMeters: number } | null;
  voteWindow?: { startsAt: string; endsAt: string } | null;
}): Prisma.EventUncheckedUpdateInput {
  const data: Prisma.EventUncheckedUpdateInput = {};
  if (body.location !== undefined) {
    data.latitude = body.location?.latitude ?? null;
    data.longitude = body.location?.longitude ?? null;
    data.radiusMeters = body.location?.radiusMeters ?? null;
  }
  if (body.voteWindow !== undefined) {
    data.voteStartsAt = body.voteWindow ? new Date(body.voteWindow.startsAt) : null;
    data.voteEndsAt = body.voteWindow ? new Date(body.voteWindow.endsAt) : null;
  }
  return data;
}

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  async function isInvited(eventId: string, userId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
    return !!(await db.eventInvite.findUnique({ where: { eventId_userId: { eventId, userId } } }));
  }

  /** Loads the state for one viewer, adding the fields that depend on who is asking. */
  async function detail(eventId: string, userId: string) {
    const { event, state } = await loadState(eventId);
    const invited = await isInvited(eventId, userId);
    const membership = { userId, invited };
    if (!canSeeEvent(event, membership)) throw notFound('event');
    const decision = voteDecision(event, membership, new Date());
    const ids = [...state.queue.map((t) => t.id), ...(state.nowPlaying ? [state.nowPlaying.id] : [])];
    const votes = ids.length
      ? await prisma.vote.findMany({ where: { userId, eventTrackId: { in: ids } }, select: { eventTrackId: true } })
      : [];
    return {
      ...state,
      isOwner: event.ownerId === userId,
      isInvited: invited,
      myVotes: votes.map((v) => v.eventTrackId),
      canVote: decision.allowed,
      voteDeniedReason: decision.allowed ? null : decision.reason,
      requiresLocation: event.license === 'LOCATION_TIME' && event.latitude !== null && event.ownerId !== userId,
    };
  }

  function broadcast(eventId: string) {
    app.realtime.schedule(`event:${eventId}`, 'event:state', async () => (await loadState(eventId)).state);
  }

  /**
   * Runs a voter's write on the event queue, then broadcasts and returns the caller's view.
   * The permission check is done before the transaction, so that the event lock is held as
   * briefly as possible. Inside the transaction the very first statement bumps the version,
   * which locks the event row: every writer locks the event first, then the tracks, so two
   * transactions can never wait on each other in a cycle (no deadlock).
   */
  async function voteWrite(
    eventId: string,
    userId: string,
    check: { license: true; location: GeoPoint | null } | { license: false },
    mutate: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const membership = { userId, invited: event ? await isInvited(eventId, userId) : false };
    if (!event || !canSeeEvent(event, membership)) throw notFound('event');
    if (check.license) {
      const decision = voteDecision(event, membership, new Date(), check.location);
      if (!decision.allowed) throw forbidden(decision.reason, 'You are not allowed to vote in this event');
    }
    await transaction(async (tx) => {
      const bumped = await tx.event.updateMany({ where: { id: eventId }, data: { version: { increment: 1 } } });
      if (bumped.count === 0) throw notFound('event');
      await mutate(tx);
    });
    broadcast(eventId);
    return detail(eventId, userId);
  }

  /**
   * Adds (+1) or removes (-1) the user's vote in one statement. The vote row primary key makes
   * it idempotent, and the score moves only when a row was really inserted / deleted.
   * Returns false when the entry is not in the queue anymore.
   */
  async function applyVote(tx: Prisma.TransactionClient, eventId: string, entryId: string, userId: string, delta: 1 | -1) {
    const change =
      delta === 1
        ? Prisma.sql`INSERT INTO "Vote" ("eventTrackId", "userId") SELECT id, ${userId} FROM t
                     ON CONFLICT DO NOTHING RETURNING "eventTrackId"`
        : Prisma.sql`DELETE FROM "Vote" WHERE "userId" = ${userId} AND "eventTrackId" IN (SELECT id FROM t)
                     RETURNING "eventTrackId"`;
    const [row] = await tx.$queryRaw<{ queued: number }[]>`
      WITH t AS (SELECT id FROM "EventTrack" WHERE id = ${entryId} AND "eventId" = ${eventId} AND status = 'QUEUED'),
           changed AS (${change}),
           scored AS (UPDATE "EventTrack" SET score = score + ${delta} WHERE id IN (SELECT "eventTrackId" FROM changed) RETURNING id)
      SELECT (SELECT count(*) FROM t)::int AS queued, (SELECT count(*) FROM scored)::int AS scored`;
    return row.queued === 1;
  }

  async function ownerWrite(eventId: string, userId: string, mutate: (tx: Prisma.TransactionClient, event: Event) => Promise<void>) {
    await transaction(async (tx) => {
      await lockRow(tx, 'Event', eventId);
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
      if (event.ownerId !== userId) {
        const visible = canSeeEvent(event, { userId, invited: await isInvited(eventId, userId, tx) });
        throw visible ? forbidden('NOT_OWNER', 'Only the owner can do this') : notFound('event');
      }
      await mutate(tx, event);
      await tx.event.update({ where: { id: eventId }, data: { version: { increment: 1 } } });
    });
    broadcast(eventId);
    return detail(eventId, userId);
  }

  const locationOf = (b: { latitude?: number; longitude?: number } | undefined): GeoPoint | null =>
    b && b.latitude !== undefined && b.longitude !== undefined ? { latitude: b.latitude, longitude: b.longitude } : null;

  // ---------- CRUD ----------

  app.get(
    '/',
    {
      schema: {
        tags: ['events'],
        summary: 'Events I can see',
        querystring: Type.Object({
          filter: Type.Optional(
            Type.Union([Type.Literal('all'), Type.Literal('mine'), Type.Literal('invited')], { default: 'all' }),
          ),
          q: Type.Optional(Type.String({ maxLength: 100 })),
        }),
        response: { 200: Type.Array(EventSummary) },
      },
    },
    async (req) => {
      const me = req.userId;
      const { filter = 'all', q } = req.query;
      const where: Prisma.EventWhereInput = {
        ...(filter === 'mine'
          ? { ownerId: me }
          : filter === 'invited'
            ? { invites: { some: { userId: me } } }
            : { OR: [{ visibility: 'PUBLIC' }, { ownerId: me }, { invites: { some: { userId: me } } }] }),
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      };
      const events = await prisma.event.findMany({
        where,
        include: { owner: { select: userSummarySelect }, invites: { where: { userId: me }, select: { userId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return events.map((e) => ({ ...common(e), isOwner: e.ownerId === me, isInvited: e.invites.length > 0 }));
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['events'],
        summary: 'Create an event (public and open to every voter by default)',
        body: Type.Object({
          name: EventBody.name,
          description: Type.Optional(EventBody.description),
          visibility: Type.Optional(Visibility),
          license: Type.Optional(EventLicense),
          location: Type.Optional(EventBody.location),
          voteWindow: Type.Optional(EventBody.voteWindow),
        }),
        response: { 201: EventDetail, ...errors(400) },
      },
    },
    async (req, reply) => {
      const b = req.body;
      const license = b.license ?? 'EVERYONE';
      validateRules({ license, location: b.location ?? null, voteWindow: b.voteWindow ?? null });
      const event = await prisma.event.create({
        data: {
          ...(rulesColumns(b) as Pick<Prisma.EventUncheckedCreateInput, 'latitude' | 'longitude' | 'radiusMeters'>),
          name: b.name.trim(),
          description: b.description ?? null,
          visibility: b.visibility ?? 'PUBLIC',
          license,
          ownerId: req.userId,
        },
      });
      return reply.code(201).send(await detail(event.id, req.userId));
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['events'],
        summary: 'Event with its live queue',
        description: 'Private events I am not invited to answer 404, so that their existence is not revealed.',
        params: IdParams,
        response: { 200: EventDetail, ...errors(404) },
      },
    },
    async (req) => detail(req.params.id, req.userId),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['events'],
        summary: 'Update an event (owner)',
        params: IdParams,
        body: Type.Partial(Type.Object(EventBody)),
        response: { 200: EventDetail, ...errors(400, 403, 404) },
      },
    },
    async (req) => {
      const b = req.body;
      const result = await ownerWrite(req.params.id, req.userId, async (tx, event) => {
        const merged = {
          license: b.license ?? event.license,
          location:
            b.location !== undefined
              ? b.location
              : event.latitude !== null
                ? { latitude: event.latitude, longitude: event.longitude!, radiusMeters: event.radiusMeters! }
                : null,
          voteWindow:
            b.voteWindow !== undefined
              ? b.voteWindow
              : event.voteStartsAt
                ? { startsAt: event.voteStartsAt.toISOString(), endsAt: event.voteEndsAt!.toISOString() }
                : null,
        };
        validateRules(merged);
        await tx.event.update({
          where: { id: event.id },
          data: {
            ...(b.name !== undefined ? { name: b.name.trim() } : {}),
            ...(b.description !== undefined ? { description: b.description } : {}),
            ...(b.visibility ? { visibility: b.visibility } : {}),
            ...(b.license ? { license: b.license } : {}),
            ...rulesColumns(b),
          },
        });
      });
      if (b.visibility === 'PRIVATE') await app.realtime.revalidate(`event:${req.params.id}`);
      return result;
    },
  );

  app.delete(
    '/:id',
    {
      schema: { tags: ['events'], summary: 'Delete an event (owner)', params: IdParams, response: { 204: Type.Null(), ...errors(403, 404) } },
    },
    async (req, reply) => {
      const event = await prisma.event.findUnique({ where: { id: req.params.id } });
      if (!event) throw notFound('event');
      if (event.ownerId !== req.userId) {
        const visible = canSeeEvent(event, { userId: req.userId, invited: await isInvited(event.id, req.userId) });
        throw visible ? forbidden('NOT_OWNER', 'Only the owner can do this') : notFound('event');
      }
      await prisma.event.delete({ where: { id: event.id } });
      app.realtime.close(`event:${event.id}`, 'event:deleted', { id: event.id });
      return reply.code(204).send(null);
    },
  );

  // ---------- invitations ----------

  app.get(
    '/:id/invites',
    { schema: { tags: ['events'], summary: 'Invited users', params: IdParams, response: { 200: Type.Array(UserSummary), ...errors(404) } } },
    async (req) => {
      await detail(req.params.id, req.userId);
      const invites = await prisma.eventInvite.findMany({
        where: { eventId: req.params.id },
        include: { user: { select: userSummarySelect } },
        orderBy: { createdAt: 'asc' },
      });
      return invites.map((i) => i.user);
    },
  );

  app.post(
    '/:id/invites',
    {
      schema: {
        tags: ['events'],
        summary: 'Invite a user (owner)',
        params: IdParams,
        body: Type.Object({ userId: Id }),
        response: { 200: EventDetail, ...errors(403, 404) },
      },
    },
    async (req) =>
      ownerWrite(req.params.id, req.userId, async (tx) => {
        if (!(await tx.user.findUnique({ where: { id: req.body.userId }, select: { id: true } }))) throw notFound('user');
        await tx.eventInvite.upsert({
          where: { eventId_userId: { eventId: req.params.id, userId: req.body.userId } },
          create: { eventId: req.params.id, userId: req.body.userId },
          update: {},
        });
      }),
  );

  app.delete(
    '/:id/invites/:userId',
    {
      schema: { tags: ['events'], summary: 'Cancel an invitation (owner)', params: InviteParams, response: { 200: EventDetail, ...errors(403, 404) } },
    },
    async (req) => {
      const result = await ownerWrite(req.params.id, req.userId, async (tx) => {
        await tx.eventInvite.deleteMany({ where: { eventId: req.params.id, userId: req.params.userId } });
      });
      await app.realtime.revalidate(`event:${req.params.id}`);
      return result;
    },
  );

  // ---------- queue ----------

  app.post(
    '/:id/tracks',
    {
      schema: {
        tags: ['events'],
        summary: 'Suggest a track (counts as a vote)',
        description:
          'If the track is already queued, the suggestion becomes a vote for it: two people suggesting the same ' +
          'track at the same time produce one entry with two votes.',
        params: IdParams,
        body: Type.Object({ trackId: Type.String({ minLength: 1, maxLength: 64 }), ...VoteBody.properties }),
        response: { 200: EventDetail, ...errors(400, 403, 404) },
      },
    },
    async (req) => {
      const track = await app.catalog.get(req.body.trackId);
      if (!track) throw badRequest('UNKNOWN_TRACK', 'This track does not exist in the catalog');
      const userId = req.userId;
      return voteWrite(req.params.id, userId, { license: true, location: locationOf(req.body) }, async (tx) => {
        // the event row is locked here: no other suggestion can create the same entry meanwhile
        let entry = await tx.eventTrack.findFirst({ where: { eventId: req.params.id, trackId: track.id, status: 'QUEUED' } });
        if (!entry) {
          entry = await tx.eventTrack.create({
            data: {
              eventId: req.params.id,
              trackId: track.id,
              title: track.title,
              artist: track.artist,
              album: track.album,
              coverUrl: track.coverUrl,
              previewUrl: track.previewUrl,
              durationSec: track.durationSec,
              suggestedById: userId,
            },
          });
        }
        await applyVote(tx, req.params.id, entry.id, userId, 1);
      });
    },
  );

  async function voteOrThrow(tx: Prisma.TransactionClient, eventId: string, entryId: string, userId: string, delta: 1 | -1) {
    if (await applyVote(tx, eventId, entryId, userId, delta)) return;
    const exists = await tx.eventTrack.findFirst({ where: { id: entryId, eventId }, select: { id: true } });
    throw exists ? new ApiError(409, 'TRACK_NOT_QUEUED', 'This track is not in the queue anymore') : notFound('track');
  }

  app.post(
    '/:id/tracks/:entryId/vote',
    {
      schema: {
        tags: ['events'],
        summary: 'Vote for a queued track (idempotent)',
        description: 'Send your position when the event uses the LOCATION_TIME license.',
        params: EntryParams,
        body: VoteBody,
        response: { 200: EventDetail, ...errors(403, 404, 409) },
      },
    },
    async (req) =>
      voteWrite(req.params.id, req.userId, { license: true, location: locationOf(req.body) }, (tx) =>
        voteOrThrow(tx, req.params.id, req.params.entryId, req.userId, 1),
      ),
  );

  app.delete(
    '/:id/tracks/:entryId/vote',
    {
      schema: {
        tags: ['events'],
        summary: 'Remove my vote (idempotent)',
        description: 'Always allowed on a visible event, even outside the vote area or window.',
        params: EntryParams,
        response: { 200: EventDetail, ...errors(404, 409) },
      },
    },
    async (req) =>
      voteWrite(req.params.id, req.userId, { license: false }, (tx) =>
        voteOrThrow(tx, req.params.id, req.params.entryId, req.userId, -1),
      ),
  );

  app.post(
    '/:id/next',
    {
      schema: {
        tags: ['events'],
        summary: 'Play the next track: the most voted one (owner)',
        description: 'The current track becomes PLAYED, the top of the queue becomes PLAYING.',
        params: IdParams,
        response: { 200: EventDetail, ...errors(403, 404) },
      },
    },
    async (req) =>
      ownerWrite(req.params.id, req.userId, async (tx, event) => {
        await tx.eventTrack.updateMany({
          where: { eventId: event.id, status: 'PLAYING' },
          data: { status: 'PLAYED', playedAt: new Date() },
        });
        const next = await tx.eventTrack.findFirst({
          where: { eventId: event.id, status: 'QUEUED' },
          orderBy: [{ score: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        if (next) await tx.eventTrack.update({ where: { id: next.id }, data: { status: 'PLAYING' } });
      }),
  );
};

export default routes;
