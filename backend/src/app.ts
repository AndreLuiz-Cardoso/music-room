import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { config } from './config';
import { ApiError } from './errors';
import { verifyAccessToken } from './auth/tokens';
import { Realtime } from './realtime';
import actionLog from './plugins/actionLog';
import { DeezerCatalog, FakeCatalog, type TrackCatalog } from './services/catalog';
import { createMailer, type Mailer } from './services/mailer';
import { ProviderVerifier, type SocialVerifier } from './services/social';
import authRoutes from './routes/auth';
import meRoutes from './routes/me';
import userRoutes from './routes/users';
import friendRoutes from './routes/friends';
import trackRoutes from './routes/tracks';
import eventRoutes from './routes/events';
import playlistRoutes from './routes/playlists';
import deviceRoutes from './routes/devices';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    realtime: Realtime;
    catalog: TrackCatalog;
    mailer: Mailer;
    social: SocialVerifier;
  }
  interface FastifyRequest {
    userId: string;
  }
}

export interface AppDeps {
  catalog?: TrackCatalog;
  mailer?: Mailer;
  social?: SocialVerifier;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps = {}) {
  const app = Fastify({
    logger:
      deps.logger === false
        ? false
        : config.env === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : true,
    bodyLimit: 100 * 1024,
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: 'all' } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('catalog', deps.catalog ?? (config.trackCatalog === 'fake' ? new FakeCatalog() : new DeezerCatalog()));
  app.decorate('mailer', deps.mailer ?? createMailer());
  app.decorate('social', deps.social ?? new ProviderVerifier());
  app.decorate('realtime', new Realtime(app.server, config.corsOrigins));
  app.addHook('onClose', async () => {
    await app.realtime.flushAll();
    app.realtime.io.close();
  });

  app.decorateRequest('userId', '');
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
    req.userId = verifyAccessToken(header.slice(7));
  });

  // The API only speaks JSON; the few HTML pages (email links) set their own strict CSP.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });
  await app.register(formbody);
  await app.register(rateLimit, {
    max: config.rateLimit.global,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: `Too many requests, retry in ${ctx.after}`,
    }),
  });
  await app.register(actionLog);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Music Room API',
        version: '1.0.0',
        description:
          'REST/JSON API of Music Room. Authenticate with `POST /auth/login` (or a social provider), then send ' +
          '`Authorization: Bearer <accessToken>`. Clients should also send `X-Client-Platform`, `X-Client-Device` ' +
          'and `X-Client-Version` on every request (used for the action logs).\n\n' +
          'Real time: connect with Socket.IO to the same host, `auth: { token: <accessToken> }`, then emit ' +
          '`subscribe` with `event:<id>`, `playlist:<id>` or `device:<id>` to receive `event:state`, ' +
          '`playlist:state` and `device:state` messages whose payload is the same object as the matching GET.',
      },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
      security: [{ bearer: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((err: FastifyError | ApiError, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    if ((err as FastifyError).validation) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: err.message });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
    return reply.code(status).send({ error: (err as FastifyError).code ?? 'ERROR', message: err.message });
  });

  // A POST without payload (e.g. a vote) is treated as an empty JSON object.
  app.addHook('preValidation', async (req) => {
    if (req.body === undefined && req.method !== 'GET' && req.method !== 'DELETE') req.body = {};
  });

  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(friendRoutes, { prefix: '/friends' });
  await app.register(trackRoutes, { prefix: '/tracks' });
  await app.register(eventRoutes, { prefix: '/events' });
  await app.register(playlistRoutes, { prefix: '/playlists' });
  await app.register(deviceRoutes, { prefix: '/devices' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
