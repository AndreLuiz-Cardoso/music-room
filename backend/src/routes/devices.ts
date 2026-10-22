import { Type, type FastifyPluginAsyncTypebox, type Static } from '@fastify/type-provider-typebox';
import type { Device, Prisma } from '@prisma/client';
import { lockRow, prisma, transaction } from '../db';
import { badRequest, forbidden, notFound } from '../errors';
import { canControlDevice, canSee } from '../domain/policies';
import { applyCommand, initialPlayback, parsePlayback, type PlaybackCommand, type PlaybackTrack } from '../domain/playback';
import { DateTimeInput, DeviceDetail, DeviceState, Id, IdParams, Nullable, errors } from '../schemas';
import { previewAddress, type Track } from '../services/catalog';
import { areFriends, userSummarySelect } from '../services/users';

const DelegationParams = Type.Object({ id: Id, userId: Id });

const CommandBody = Type.Object({
  action: Type.Union([
    Type.Literal('PLAY'),
    Type.Literal('PAUSE'),
    Type.Literal('NEXT'),
    Type.Literal('PREVIOUS'),
    Type.Literal('SET_VOLUME'),
    Type.Literal('PLAY_TRACK'),
    Type.Literal('PLAY_PLAYLIST'),
  ]),
  volume: Type.Optional(Type.Integer({ minimum: 0, maximum: 100, description: 'SET_VOLUME' })),
  trackId: Type.Optional(Type.String({ maxLength: 64, description: 'PLAY_TRACK' })),
  playlistId: Type.Optional(Type.String({ maxLength: 64, description: 'PLAY_PLAYLIST' })),
  index: Type.Optional(Type.Integer({ minimum: 0, description: 'PLAY_PLAYLIST: starting position' })),
});

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 120) ?? null;

const toPlaybackTrack = (t: Pick<Track, 'title' | 'artist' | 'coverUrl' | 'previewUrl' | 'durationSec'> & { id: string }): PlaybackTrack => ({
  id: t.id,
  title: t.title,
  artist: t.artist,
  coverUrl: t.coverUrl,
  previewUrl: t.previewUrl,
  durationSec: t.durationSec,
});

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  const include = { owner: { select: userSummarySelect } } as const;
  type DeviceWithOwner = Device & { owner: { id: string; displayName: string; avatarUrl: string | null } };

  function toState(d: DeviceWithOwner) {
    const playback = parsePlayback(d.playback);
    return {
      id: d.id,
      name: d.name,
      owner: d.owner,
      playback: { ...playback, queue: playback.queue.map((t) => ({ ...t, previewUrl: previewAddress(t.id, t.previewUrl) })) },
      version: d.version,
    };
  }

  async function grantOf(deviceId: string, userId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
    return db.deviceDelegation.findUnique({ where: { deviceId_delegateId: { deviceId, delegateId: userId } } });
  }

  async function detail(deviceId: string, userId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId }, include });
    if (!device || !canControlDevice(device, userId, await grantOf(deviceId, userId), new Date())) throw notFound('device');
    const isOwner = device.ownerId === userId;
    const delegations = isOwner
      ? await prisma.deviceDelegation.findMany({
          where: { deviceId },
          include: { delegate: { select: userSummarySelect } },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    return {
      ...toState(device),
      isOwner,
      delegations: delegations.map((d) => ({ user: d.delegate, expiresAt: d.expiresAt, createdAt: d.createdAt })),
    };
  }

  async function ownedDevice(deviceId: string, userId: string) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw notFound('device');
    if (device.ownerId !== userId) {
      const delegate = canControlDevice(device, userId, await grantOf(deviceId, userId), new Date());
      throw delegate ? forbidden('NOT_OWNER', 'Only the owner can do this') : notFound('device');
    }
    return device;
  }

  const loadState = async (deviceId: string) => toState(await prisma.device.findUniqueOrThrow({ where: { id: deviceId }, include }));

  function broadcast(deviceId: string) {
    const room = `device:${deviceId}`;
    app.realtime.schedule(
      room,
      'device:state',
      async () => {
        // Delegations also end without a request (expiry, unfriending): re-check before each push.
        await app.realtime.revalidate(room);
        return loadState(deviceId);
      },
      50,
    );
  }
  app.realtime.onSubscribe('device', 'device:state', loadState);

  app.get(
    '/',
    {
      schema: {
        tags: ['devices'],
        summary: 'My devices and the devices my friends let me control',
        response: { 200: Type.Object({ owned: Type.Array(DeviceState), delegated: Type.Array(DeviceState) }) },
      },
    },
    async (req) => {
      const now = new Date();
      const [owned, delegated] = await Promise.all([
        prisma.device.findMany({ where: { ownerId: req.userId }, include, orderBy: { createdAt: 'asc' } }),
        prisma.device.findMany({
          where: {
            delegations: { some: { delegateId: req.userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
          include,
          orderBy: { name: 'asc' },
        }),
      ]);
      return { owned: owned.map(toState), delegated: delegated.map(toState) };
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['devices'],
        summary: 'Register the calling device (idempotent)',
        description:
          'installationId is a random id generated once by the app installation. Platform, model and app version ' +
          'are taken from the X-Client-* headers.',
        body: Type.Object({
          installationId: Type.String({ minLength: 8, maxLength: 128 }),
          name: Type.String({ minLength: 1, maxLength: 60 }),
        }),
        response: { 200: DeviceDetail },
      },
    },
    async (req) => {
      const meta = {
        platform: header(req.headers['x-client-platform']),
        model: header(req.headers['x-client-device']),
        appVersion: header(req.headers['x-client-version']),
        lastSeenAt: new Date(),
      };
      const device = await prisma.device.upsert({
        where: { ownerId_installationId: { ownerId: req.userId, installationId: req.body.installationId } },
        create: {
          ownerId: req.userId,
          installationId: req.body.installationId,
          name: req.body.name,
          playback: initialPlayback as unknown as Prisma.InputJsonValue,
          ...meta,
        },
        update: meta,
      });
      return detail(device.id, req.userId);
    },
  );

  app.get(
    '/:id',
    { schema: { tags: ['devices'], summary: 'Device state (owner or delegate)', params: IdParams, response: { 200: DeviceDetail, ...errors(404) } } },
    async (req) => detail(req.params.id, req.userId),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['devices'],
        summary: 'Rename a device (owner)',
        params: IdParams,
        body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 60 }) }),
        response: { 200: DeviceDetail, ...errors(403, 404) },
      },
    },
    async (req) => {
      await ownedDevice(req.params.id, req.userId);
      await prisma.device.update({ where: { id: req.params.id }, data: { name: req.body.name } });
      broadcast(req.params.id);
      return detail(req.params.id, req.userId);
    },
  );

  app.delete(
    '/:id',
    {
      schema: { tags: ['devices'], summary: 'Detach a device from my account (owner)', params: IdParams, response: { 204: Type.Null(), ...errors(403, 404) } },
    },
    async (req, reply) => {
      await ownedDevice(req.params.id, req.userId);
      await prisma.device.delete({ where: { id: req.params.id } });
      app.realtime.close(`device:${req.params.id}`, 'device:deleted', { id: req.params.id });
      return reply.code(204).send(null);
    },
  );

  app.put(
    '/:id/delegations/:userId',
    {
      schema: {
        tags: ['devices'],
        summary: 'Give a friend the control of this device (owner)',
        description: 'Only friends can receive a delegation. Without expiresAt the delegation lasts until revoked.',
        params: DelegationParams,
        body: Type.Object({ expiresAt: Type.Optional(Nullable(DateTimeInput)) }),
        response: { 200: DeviceDetail, ...errors(400, 403, 404) },
      },
    },
    async (req) => {
      await ownedDevice(req.params.id, req.userId);
      if (!(await areFriends(req.userId, req.params.userId))) {
        throw badRequest('NOT_A_FRIEND', 'You can only delegate the control to a friend');
      }
      const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date()) throw badRequest('INVALID_EXPIRY', 'expiresAt must be in the future');
      await prisma.deviceDelegation.upsert({
        where: { deviceId_delegateId: { deviceId: req.params.id, delegateId: req.params.userId } },
        create: { deviceId: req.params.id, delegateId: req.params.userId, expiresAt },
        update: { expiresAt },
      });
      app.realtime.emit(`user:${req.params.userId}`, 'devices:changed', {});
      return detail(req.params.id, req.userId);
    },
  );

  app.delete(
    '/:id/delegations/:userId',
    {
      schema: {
        tags: ['devices'],
        summary: 'Revoke a delegation (owner)',
        params: DelegationParams,
        response: { 200: DeviceDetail, ...errors(403, 404) },
      },
    },
    async (req) => {
      await ownedDevice(req.params.id, req.userId);
      await prisma.deviceDelegation.deleteMany({ where: { deviceId: req.params.id, delegateId: req.params.userId } });
      await app.realtime.revalidate(`device:${req.params.id}`);
      app.realtime.emit(`user:${req.params.userId}`, 'devices:changed', {});
      return detail(req.params.id, req.userId);
    },
  );

  async function resolveCommand(body: Static<typeof CommandBody>, userId: string): Promise<PlaybackCommand> {
    switch (body.action) {
      case 'SET_VOLUME':
        if (body.volume === undefined) throw badRequest('VOLUME_REQUIRED', 'SET_VOLUME needs a volume');
        return { action: 'SET_VOLUME', volume: body.volume };
      case 'PLAY_TRACK': {
        const track = body.trackId ? await app.catalog.get(body.trackId) : null;
        if (!track) throw badRequest('UNKNOWN_TRACK', 'PLAY_TRACK needs a valid trackId');
        return { action: 'LOAD', queue: [toPlaybackTrack(track)], index: 0 };
      }
      case 'PLAY_PLAYLIST': {
        // A delegation does not grant access to the owner's private playlists.
        const playlist = body.playlistId
          ? await prisma.playlist.findUnique({
              where: { id: body.playlistId },
              include: { tracks: { orderBy: { position: 'asc' } }, invites: { where: { userId }, select: { userId: true } } },
            })
          : null;
        if (!playlist || !canSee(playlist, { userId, invited: playlist.invites.length > 0 })) throw notFound('playlist');
        return {
          action: 'LOAD',
          queue: playlist.tracks.map((t) => toPlaybackTrack({ ...t, id: t.trackId })),
          index: body.index ?? 0,
        };
      }
      default:
        return { action: body.action };
    }
  }

  app.post(
    '/:id/commands',
    {
      schema: {
        tags: ['devices'],
        summary: 'Send a playback command (owner or delegate)',
        params: IdParams,
        body: CommandBody,
        response: { 200: DeviceDetail, ...errors(400, 404) },
      },
    },
    async (req) => {
      const command = await resolveCommand(req.body, req.userId);
      await transaction(async (tx) => {
        await lockRow(tx, 'Device', req.params.id);
        const device = await tx.device.findUniqueOrThrow({ where: { id: req.params.id } });
        if (!canControlDevice(device, req.userId, await grantOf(device.id, req.userId, tx), new Date())) {
          throw notFound('device');
        }
        const playback = applyCommand(parsePlayback(device.playback), command);
        await tx.device.update({
          where: { id: device.id },
          data: { playback: playback as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
        });
      });
      broadcast(req.params.id);
      return detail(req.params.id, req.userId);
    },
  );
};

export default routes;
