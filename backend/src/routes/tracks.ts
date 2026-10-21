import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ApiError } from '../errors';
import { Track, errors } from '../schemas';

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/search',
    {
      schema: {
        tags: ['tracks'],
        summary: 'Search the music catalog',
        querystring: Type.Object({
          q: Type.String({ minLength: 1, maxLength: 100 }),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
        }),
        response: { 200: Type.Array(Track), ...errors(502) },
      },
    },
    async (req) => {
      try {
        return await app.catalog.search(req.query.q, req.query.limit ?? 20);
      } catch (err) {
        req.log.warn({ err }, 'catalog search failed');
        throw new ApiError(502, 'CATALOG_UNAVAILABLE', 'The music catalog is unavailable, retry later');
      }
    },
  );
};

export default routes;
