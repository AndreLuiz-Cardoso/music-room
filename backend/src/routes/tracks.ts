import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ApiError, notFound } from '../errors';
import { Track, errors } from '../schemas';
import { isPreviewSigned } from '../services/catalog';

const routes: FastifyPluginAsyncTypebox = async (app) => {
  const unavailable = () => new ApiError(502, 'CATALOG_UNAVAILABLE', 'The music catalog is unavailable, retry later');

  app.get(
    '/search',
    {
      onRequest: app.authenticate,
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
        throw unavailable();
      }
    },
  );

  // Public: an audio player cannot send the access token, and a 30 s preview is public anyway.
  app.get(
    '/:id/preview',
    {
      schema: {
        tags: ['tracks'],
        security: [],
        summary: 'Listen to the 30 s preview of a track',
        description:
          'Redirects (302) to a fresh link of the catalog. Catalog links expire, so the API gives this stable ' +
          'address as the previewUrl of the tracks it stores (event queues, playlists, device queues). ' +
          'The address is signed (`sig`): any other track id answers 404 without a catalog lookup.',
        params: Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) }),
        querystring: Type.Object({ sig: Type.Optional(Type.String({ maxLength: 64 })) }),
        response: errors(404, 502),
      },
    },
    async (req, reply) => {
      if (!isPreviewSigned(req.params.id, req.query.sig ?? '')) throw notFound('preview');
      let track;
      try {
        track = await app.catalog.get(req.params.id);
      } catch (err) {
        req.log.warn({ err }, 'catalog lookup failed');
        throw unavailable();
      }
      if (!track?.previewUrl) throw notFound('preview');
      // played by the web app from another origin: helmet's same-origin policy would block it
      return reply.header('cross-origin-resource-policy', 'cross-origin').redirect(track.previewUrl);
    },
  );
};

export default routes;
