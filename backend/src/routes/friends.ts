import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { isUniqueViolation, prisma } from '../db';
import { badRequest, conflict } from '../errors';
import { IdParams, UserCard, errors } from '../schemas';
import { ensureUser, pairKey, userCardSelect } from '../services/users';

const FriendStatus = Type.Object({
  status: Type.Union([Type.Literal('request_sent'), Type.Literal('friend')]),
});

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['friends'],
        summary: 'My friends and pending requests',
        response: {
          200: Type.Object({
            friends: Type.Array(UserCard),
            received: Type.Array(UserCard),
            sent: Type.Array(UserCard),
          }),
        },
      },
    },
    async (req) => {
      const me = req.userId;
      const rows = await prisma.friendship.findMany({
        where: { OR: [{ userAId: me }, { userBId: me }] },
        include: { userA: { select: userCardSelect }, userB: { select: userCardSelect } },
        orderBy: { updatedAt: 'desc' },
      });
      const other = (f: (typeof rows)[number]) => (f.userAId === me ? f.userB : f.userA);
      return {
        friends: rows.filter((f) => f.status === 'ACCEPTED').map(other),
        received: rows.filter((f) => f.status === 'PENDING' && f.requesterId !== me).map(other),
        sent: rows.filter((f) => f.status === 'PENDING' && f.requesterId === me).map(other),
      };
    },
  );

  app.post(
    '/:id',
    {
      schema: {
        tags: ['friends'],
        summary: 'Send a friend request, or accept the one this user sent me',
        description:
          'A single row exists per pair of users, so two users who invite each other at the same time end up friends.',
        params: IdParams,
        response: { 200: FriendStatus, ...errors(400, 404, 409) },
      },
    },
    async (req) => {
      const me = req.userId;
      const target = req.params.id;
      if (target === me) throw badRequest('SELF_FRIENDSHIP', 'You cannot befriend yourself');
      await ensureUser(target);

      const key = pairKey(me, target);
      // Each new attempt means the other user changed the pair meanwhile (sent or cancelled a request).
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await prisma.friendship.findUnique({ where: { userAId_userBId: key } });
        if (existing) {
          if (existing.status === 'ACCEPTED') return { status: 'friend' as const };
          if (existing.requesterId === me) return { status: 'request_sent' as const };
          // only if the request is still there: it may have been cancelled meanwhile (then loop)
          const accepted = await prisma.friendship.updateMany({
            where: { id: existing.id, status: 'PENDING' },
            data: { status: 'ACCEPTED' },
          });
          if (accepted.count === 1) return { status: 'friend' as const };
          continue;
        }
        try {
          await prisma.friendship.create({ data: { ...key, requesterId: me } });
          return { status: 'request_sent' as const };
        } catch (err) {
          // the other user sent a request at the same moment: loop to accept it
          if (!isUniqueViolation(err)) throw err;
        }
      }
      throw conflict('FRIENDSHIP_CHANGED', 'The other user is changing this friendship right now, retry');
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['friends'],
        summary: 'Remove a friend, decline or cancel a request',
        description: 'Also revokes the device control delegations between the two users.',
        params: IdParams,
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      const me = req.userId;
      const other = req.params.id;
      await prisma.$transaction([
        prisma.friendship.deleteMany({ where: pairKey(me, other) }),
        prisma.deviceDelegation.deleteMany({
          where: {
            OR: [
              { delegateId: other, device: { ownerId: me } },
              { delegateId: me, device: { ownerId: other } },
            ],
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );
};

export default routes;
