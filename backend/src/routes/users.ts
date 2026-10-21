import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { prisma } from '../db';
import { notFound } from '../errors';
import { IdParams, Profile, UserSummary, errors } from '../schemas';
import { pairKey, userSummarySelect } from '../services/users';

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['users'],
        summary: 'Search users by name or by music taste',
        querystring: Type.Object({
          q: Type.Optional(Type.String({ minLength: 2, maxLength: 50 })),
          genre: Type.Optional(Type.String({ minLength: 1, maxLength: 30 })),
        }),
        response: { 200: Type.Array(UserSummary) },
      },
    },
    async (req) => {
      const { q, genre } = req.query;
      if (!q && !genre) return [];
      return prisma.user.findMany({
        where: {
          id: { not: req.userId },
          ...(q ? { displayName: { contains: q, mode: 'insensitive' } } : {}),
          ...(genre ? { musicPreferences: { has: genre.toLowerCase() } } : {}),
        },
        select: userSummarySelect,
        orderBy: { displayName: 'asc' },
        take: 20,
      });
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['users'],
        summary: 'A user profile, filtered by our relation',
        description: 'friendsInfo is only returned to friends, privateInfo only to the user himself.',
        params: IdParams,
        response: { 200: Profile, ...errors(404) },
      },
    },
    async (req) => {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) throw notFound('user');
      const self = user.id === req.userId;
      const friendship = self
        ? null
        : await prisma.friendship.findUnique({ where: { userAId_userBId: pairKey(user.id, req.userId) } });
      const relation = self
        ? 'self'
        : !friendship
          ? 'none'
          : friendship.status === 'ACCEPTED'
            ? 'friend'
            : friendship.requesterId === req.userId
              ? 'request_sent'
              : 'request_received';
      return {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        musicPreferences: user.musicPreferences,
        friendsInfo: self || relation === 'friend' ? user.friendsInfo : null,
        privateInfo: self ? user.privateInfo : null,
        relation,
      } as const;
    },
  );
};

export default routes;
