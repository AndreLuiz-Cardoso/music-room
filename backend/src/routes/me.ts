import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { isUniqueViolation, prisma } from '../db';
import { ApiError, conflict, notFound } from '../errors';
import { Me, Nullable, Password, errors } from '../schemas';
import type { Provider } from '../services/social';
import { toMe } from '../services/users';

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  async function me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('user');
    return user;
  }

  app.get('/', { schema: { tags: ['profile'], summary: 'My full profile', response: { 200: Me } } }, async (req) =>
    toMe(await me(req.userId)),
  );

  app.patch(
    '/',
    {
      schema: {
        tags: ['profile'],
        summary: 'Update my profile',
        description:
          'Public: displayName, avatarUrl, bio, musicPreferences. Friends only: friendsInfo. Private: privateInfo.',
        body: Type.Object({
          displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
          avatarUrl: Type.Optional(Nullable(Type.String({ format: 'uri', pattern: '^https?://', maxLength: 500 }))),
          bio: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
          musicPreferences: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 30 }), { maxItems: 20 })),
          friendsInfo: Type.Optional(Nullable(Type.String({ maxLength: 1000 }))),
          privateInfo: Type.Optional(Nullable(Type.String({ maxLength: 1000 }))),
        }),
        response: { 200: Me, ...errors(400) },
      },
    },
    async (req) => {
      const data = { ...req.body };
      if (data.musicPreferences) {
        data.musicPreferences = [...new Set(data.musicPreferences.map((g) => g.trim().toLowerCase()))];
      }
      return toMe(await prisma.user.update({ where: { id: req.userId }, data }));
    },
  );

  app.put(
    '/password',
    {
      config: { rateLimit: { max: config.rateLimit.auth, timeWindow: '1 minute' } },
      schema: {
        tags: ['profile'],
        summary: 'Change (or create, for social accounts) my password',
        body: Type.Object({ currentPassword: Type.Optional(Type.String({ maxLength: 128 })), newPassword: Password }),
        response: { 204: Type.Null(), ...errors(400, 403) },
      },
    },
    async (req, reply) => {
      const user = await me(req.userId);
      if (user.passwordHash) {
        const ok = await bcrypt.compare(req.body.currentPassword ?? '', user.passwordHash);
        if (!ok) throw new ApiError(403, 'INVALID_PASSWORD', 'Current password is incorrect');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(req.body.newPassword, config.bcryptRounds) },
      });
      return reply.code(204).send(null);
    },
  );

  const linkRoutes = (provider: Provider, field: 'idToken' | 'accessToken') => {
    const column = provider === 'google' ? 'googleId' : 'facebookId';

    app.post(
      `/links/${provider}`,
      {
        schema: {
          tags: ['profile'],
          summary: `Link my ${provider} account`,
          body: Type.Object({ [field]: Type.String({ minLength: 10, maxLength: 4096 }) }),
          response: { 200: Me, ...errors(401, 409, 501) },
        },
      },
      async (req) => {
        const identity = await app.social.verify(provider, (req.body as Record<string, string>)[field]);
        try {
          const user = await prisma.user.update({ where: { id: req.userId }, data: { [column]: identity.providerId } });
          return toMe(user);
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict('ALREADY_LINKED', `This ${provider} account is linked to another user`);
          throw err;
        }
      },
    );

    app.delete(
      `/links/${provider}`,
      {
        schema: {
          tags: ['profile'],
          summary: `Unlink my ${provider} account`,
          response: { 200: Me, ...errors(409) },
        },
      },
      async (req) => {
        const user = await me(req.userId);
        const other = provider === 'google' ? user.facebookId : user.googleId;
        if (!user.passwordHash && !other) {
          throw conflict('LAST_LOGIN_METHOD', 'Set a password or link another provider first');
        }
        return toMe(await prisma.user.update({ where: { id: user.id }, data: { [column]: null } }));
      },
    );
  };
  linkRoutes('google', 'idToken');
  linkRoutes('facebook', 'accessToken');
};

export default routes;
