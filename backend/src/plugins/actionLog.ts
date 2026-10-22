import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../db';

// Logged at once to the server log and in batches to ActionLog: no extra DB round trip per request.

const FLUSH_EVERY_MS = 2000;
const MAX_BUFFER = 500;
const SKIPPED = ['/docs', '/health', '/socket.io'];

function header(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  const s = Array.isArray(value) ? value[0] : value;
  return s ? s.slice(0, 120) : null;
}

export default fp(async (app: FastifyInstance) => {
  let buffer: Prisma.ActionLogCreateManyInput[] = [];

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      await prisma.actionLog.createMany({ data: batch });
    } catch (err) {
      app.log.error({ err }, 'could not persist action logs');
    }
  }

  const timer = setInterval(flush, FLUSH_EVERY_MS);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await flush();
  });

  app.addHook('onResponse', async (req, reply) => {
    if (SKIPPED.some((p) => req.url.startsWith(p))) return;
    const entry = {
      userId: req.userId || null,
      method: req.method,
      route: req.routeOptions.url ?? req.url.split('?')[0],
      statusCode: reply.statusCode,
      platform: header(req, 'x-client-platform'),
      device: header(req, 'x-client-device'),
      appVersion: header(req, 'x-client-version'),
      ip: req.ip,
      durationMs: Math.round(reply.elapsedTime),
    };
    req.log.info({ action: entry }, `${entry.method} ${entry.route} ${entry.statusCode}`);
    buffer.push(entry);
    if (buffer.length >= MAX_BUFFER) void flush();
  });
});
