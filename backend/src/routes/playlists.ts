import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Playlist, PlaylistTrack as PlaylistTrackRow, Prisma } from '@prisma/client';
import { isUniqueViolation, lockRow, prisma, transaction } from '../db';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../errors';
import { canEditPlaylist, canSee, visibleWhere } from '../domain/policies';
import { insertionIndex, moveAfter } from '../domain/ordering';
import { Id, IdParams, ListQuery, Nullable, PlaylistDetail, PlaylistLicense, PlaylistSummary, UserSummary, Visibility, errors } from '../schemas';
import { fromStoredTrack, toStoredTrack } from '../services/catalog';
import { ensureUser, invitees, userSummarySelect } from '../services/users';

const EntryParams = Type.Object({ id: Id, entryId: Id });
const InviteParams = Type.Object({ id: Id, userId: Id });

type PlaylistWithOwner = Playlist & { owner: { id: string; displayName: string; avatarUrl: string | null } };

function common(p: PlaylistWithOwner) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    owner: p.owner,
    visibility: p.visibility,
    license: p.license,
    version: p.version,
    updatedAt: p.updatedAt,
  };
}

function toEntry(t: PlaylistTrackRow) {
  return {
    id: t.id,
    position: t.position,
    ...fromStoredTrack(t),
  };
}

async function loadState(playlistId: string) {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: { owner: { select: userSummarySelect }, tracks: { orderBy: { position: 'asc' } } },
  });
  if (!playlist) throw notFound('playlist');
  return { playlist, state: { ...common(playlist), tracks: playlist.tracks.map(toEntry) } };
}

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  async function isInvited(playlistId: string, userId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
    return !!(await db.playlistInvite.findUnique({ where: { playlistId_userId: { playlistId, userId } } }));
  }

  async function detail(playlistId: string, userId: string) {
    const { playlist, state } = await loadState(playlistId);
    const membership = { userId, invited: await isInvited(playlistId, userId) };
    if (!canSee(playlist, membership)) throw notFound('playlist');
    return {
      ...state,
      isOwner: playlist.ownerId === userId,
      isInvited: membership.invited,
      canEdit: canEditPlaylist(playlist, membership),
    };
  }

  function broadcast(playlistId: string) {
    app.realtime.schedule(`playlist:${playlistId}`, 'playlist:state', async () => (await loadState(playlistId)).state);
  }
  app.realtime.onSubscribe('playlist', 'playlist:state', async (id) => (await loadState(id)).state);

  type Need = 'edit' | 'owner';

  /** Locked, versioned write followed by a broadcast of the new state. */
  async function write(
    playlistId: string,
    userId: string,
    need: Need,
    mutate: (tx: Prisma.TransactionClient, playlist: Playlist) => Promise<void>,
  ) {
    await transaction(async (tx) => {
      await lockRow(tx, 'Playlist', playlistId);
      const playlist = await tx.playlist.findUniqueOrThrow({ where: { id: playlistId } });
      const membership = { userId, invited: await isInvited(playlistId, userId, tx) };
      if (!canSee(playlist, membership)) throw notFound('playlist');
      if (need === 'owner' && playlist.ownerId !== userId) throw forbidden('NOT_OWNER', 'Only the owner can do this');
      if (need === 'edit' && !canEditPlaylist(playlist, membership)) {
        throw forbidden('NOT_EDITOR', 'Only invited users can edit this playlist');
      }
      await mutate(tx, playlist);
      await tx.playlist.update({ where: { id: playlistId }, data: { version: { increment: 1 } } });
    });
    broadcast(playlistId);
    return detail(playlistId, userId);
  }

  /** Rewrites, in one statement, the positions of the entries whose index changed. */
  async function renumber(tx: Prisma.TransactionClient, ordered: { id: string; position: number }[]) {
    const changed = ordered.map((e, index) => ({ id: e.id, index, old: e.position })).filter((e) => e.index !== e.old);
    if (changed.length === 0) return;
    await tx.$executeRaw`
      UPDATE "PlaylistTrack" AS p SET "position" = v.position
      FROM unnest(${changed.map((c) => c.id)}::text[], ${changed.map((c) => c.index)}::int[]) AS v(id, position)
      WHERE p.id = v.id`;
  }

  /** The client reloads the playlist (or already got it by websocket) and retries. */
  function staleAnchor(): never {
    throw conflict('ANCHOR_NOT_FOUND', 'The playlist changed: the reference track was removed');
  }

  app.get(
    '/',
    {
      schema: {
        tags: ['playlists'],
        summary: 'Playlists I can see',
        querystring: ListQuery,
        response: { 200: Type.Array(PlaylistSummary) },
      },
    },
    async (req) => {
      const me = req.userId;
      const playlists = await prisma.playlist.findMany({
        where: visibleWhere(me, req.query.filter ?? 'all', req.query.q),
        include: {
          owner: { select: userSummarySelect },
          invites: { where: { userId: me }, select: { userId: true } },
          _count: { select: { tracks: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      return playlists.map((p) => ({
        ...common(p),
        trackCount: p._count.tracks,
        isOwner: p.ownerId === me,
        isInvited: p.invites.length > 0,
      }));
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['playlists'],
        summary: 'Create a playlist (public and editable by everyone by default)',
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 100 }),
          description: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
          visibility: Type.Optional(Visibility),
          license: Type.Optional(PlaylistLicense),
        }),
        response: { 201: PlaylistDetail, ...errors(400) },
      },
    },
    async (req, reply) => {
      const playlist = await prisma.playlist.create({
        data: {
          name: req.body.name.trim(),
          description: req.body.description ?? null,
          visibility: req.body.visibility ?? 'PUBLIC',
          license: req.body.license ?? 'EVERYONE',
          ownerId: req.userId,
        },
      });
      return reply.code(201).send(await detail(playlist.id, req.userId));
    },
  );

  app.get(
    '/:id',
    {
      schema: { tags: ['playlists'], summary: 'Playlist with its tracks', params: IdParams, response: { 200: PlaylistDetail, ...errors(404) } },
    },
    async (req) => detail(req.params.id, req.userId),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['playlists'],
        summary: 'Update a playlist settings (owner)',
        params: IdParams,
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          description: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
          visibility: Type.Optional(Visibility),
          license: Type.Optional(PlaylistLicense),
        }),
        response: { 200: PlaylistDetail, ...errors(403, 404) },
      },
    },
    async (req) => {
      const result = await write(req.params.id, req.userId, 'owner', async (tx) => {
        await tx.playlist.update({
          where: { id: req.params.id },
          data: { ...req.body, ...(req.body.name ? { name: req.body.name.trim() } : {}) },
        });
      });
      if (req.body.visibility === 'PRIVATE') await app.realtime.revalidate(`playlist:${req.params.id}`);
      return result;
    },
  );

  app.delete(
    '/:id',
    {
      schema: { tags: ['playlists'], summary: 'Delete a playlist (owner)', params: IdParams, response: { 204: Type.Null(), ...errors(403, 404) } },
    },
    async (req, reply) => {
      const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id } });
      if (!playlist) throw notFound('playlist');
      if (playlist.ownerId !== req.userId) {
        const visible = canSee(playlist, { userId: req.userId, invited: await isInvited(playlist.id, req.userId) });
        throw visible ? forbidden('NOT_OWNER', 'Only the owner can do this') : notFound('playlist');
      }
      await prisma.playlist.delete({ where: { id: playlist.id } });
      app.realtime.close(`playlist:${playlist.id}`, 'playlist:deleted', { id: playlist.id });
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/:id/invites',
    { schema: { tags: ['playlists'], summary: 'Invited users (owner)', params: IdParams, response: { 200: Type.Array(UserSummary), ...errors(403, 404) } } },
    async (req) => {
      const { isOwner } = await detail(req.params.id, req.userId); // 404 when the playlist is not visible
      if (!isOwner) throw forbidden('NOT_OWNER', 'Only the owner can do this');
      const invites = await prisma.playlistInvite.findMany({ where: { playlistId: req.params.id }, ...invitees });
      return invites.map((i) => i.user);
    },
  );

  app.post(
    '/:id/invites',
    {
      schema: {
        tags: ['playlists'],
        summary: 'Invite a user (owner)',
        params: IdParams,
        body: Type.Object({ userId: Id }),
        response: { 200: PlaylistDetail, ...errors(403, 404) },
      },
    },
    async (req) =>
      write(req.params.id, req.userId, 'owner', async (tx) => {
        await ensureUser(req.body.userId, tx);
        await tx.playlistInvite.upsert({
          where: { playlistId_userId: { playlistId: req.params.id, userId: req.body.userId } },
          create: { playlistId: req.params.id, userId: req.body.userId },
          update: {},
        });
      }),
  );

  app.delete(
    '/:id/invites/:userId',
    {
      schema: { tags: ['playlists'], summary: 'Cancel an invitation (owner)', params: InviteParams, response: { 200: PlaylistDetail, ...errors(403, 404) } },
    },
    async (req) => {
      const result = await write(req.params.id, req.userId, 'owner', async (tx) => {
        await tx.playlistInvite.deleteMany({ where: { playlistId: req.params.id, userId: req.params.userId } });
      });
      await app.realtime.revalidate(`playlist:${req.params.id}`);
      return result;
    },
  );

  app.post(
    '/:id/tracks',
    {
      schema: {
        tags: ['playlists'],
        summary: 'Add a track',
        description: 'afterEntryId: omitted = append at the end, null = insert at the top, an entry id = insert after it.',
        params: IdParams,
        body: Type.Object({
          trackId: Type.String({ minLength: 1, maxLength: 64 }),
          afterEntryId: Type.Optional(Nullable(Id)),
        }),
        response: { 200: PlaylistDetail, ...errors(400, 403, 404, 409) },
      },
    },
    async (req) => {
      const track = await app.catalog.get(req.body.trackId);
      if (!track) throw badRequest('UNKNOWN_TRACK', 'This track does not exist in the catalog');
      try {
        return await write(req.params.id, req.userId, 'edit', async (tx, playlist) => {
          const entries = await tx.playlistTrack.findMany({ where: { playlistId: playlist.id }, orderBy: { position: 'asc' } });
          if (entries.some((e) => e.trackId === track.id)) {
            throw conflict('TRACK_ALREADY_IN_PLAYLIST', 'This track is already in the playlist');
          }
          const index = insertionIndex(entries, req.body.afterEntryId);
          if (index === -1) staleAnchor();
          await tx.playlistTrack.updateMany({
            where: { playlistId: playlist.id, position: { gte: index } },
            data: { position: { increment: 1 } },
          });
          await tx.playlistTrack.create({
            data: { playlistId: playlist.id, position: index, ...toStoredTrack(track), addedById: req.userId },
          });
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('TRACK_ALREADY_IN_PLAYLIST', 'This track is already in the playlist');
        throw err;
      }
    },
  );

  app.post(
    '/:id/tracks/:entryId/move',
    {
      schema: {
        tags: ['playlists'],
        summary: 'Move a track after another one (null = to the top)',
        params: EntryParams,
        body: Type.Object({ afterEntryId: Nullable(Id) }),
        response: { 200: PlaylistDetail, ...errors(403, 404, 409) },
      },
    },
    async (req) =>
      write(req.params.id, req.userId, 'edit', async (tx, playlist) => {
        const entries = await tx.playlistTrack.findMany({ where: { playlistId: playlist.id }, orderBy: { position: 'asc' } });
        if (!entries.some((e) => e.id === req.params.entryId)) {
          throw new ApiError(404, 'TRACK_NOT_FOUND', 'This track was removed from the playlist');
        }
        const ordered = moveAfter(entries, req.params.entryId, req.body.afterEntryId);
        if (!ordered) staleAnchor();
        await renumber(tx, ordered);
      }),
  );

  app.delete(
    '/:id/tracks/:entryId',
    {
      schema: {
        tags: ['playlists'],
        summary: 'Remove a track (idempotent)',
        params: EntryParams,
        response: { 200: PlaylistDetail, ...errors(403, 404) },
      },
    },
    async (req) =>
      write(req.params.id, req.userId, 'edit', async (tx, playlist) => {
        const entry = await tx.playlistTrack.findFirst({ where: { id: req.params.entryId, playlistId: playlist.id } });
        if (!entry) return;
        await tx.playlistTrack.delete({ where: { id: entry.id } });
        await tx.playlistTrack.updateMany({
          where: { playlistId: playlist.id, position: { gt: entry.position } },
          data: { position: { decrement: 1 } },
        });
      }),
  );
};

export default routes;
