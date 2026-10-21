import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyAccessToken } from './auth/tokens';
import { canAccessRoom } from './services/access';

/**
 * Real-time channel (Socket.IO / WebSocket). It is push-only: every state change goes
 * through the REST API, which then broadcasts the new state to the subscribed clients.
 * Subscribing to a room requires the same read permission as the matching GET route.
 *
 * Client -> server: "subscribe" / "unsubscribe" with a room name: event:<id>,
 *   playlist:<id> or device:<id>. The ack is { ok: boolean }.
 * Server -> client: "event:state", "playlist:state", "device:state", "<kind>:deleted".
 */
export class Realtime {
  readonly io: Server;

  constructor(server: HttpServer, corsOrigins: string[]) {
    this.io = new Server(server, { cors: { origin: corsOrigins.length ? corsOrigins : false } });

    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        socket.data.userId = verifyAccessToken(typeof token === 'string' ? token : '');
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });

    this.io.on('connection', (socket) => {
      const userId: string = socket.data.userId;
      socket.join(`user:${userId}`);

      socket.on('subscribe', async (room: unknown, ack?: (r: { ok: boolean }) => void) => {
        const ok = typeof room === 'string' && room.length < 100 && (await canAccessRoom(userId, room).catch(() => false));
        if (ok) socket.join(room as string);
        if (typeof ack === 'function') ack({ ok });
      });

      socket.on('unsubscribe', (room: unknown) => {
        if (typeof room === 'string' && !room.startsWith('user:')) socket.leave(room);
      });
    });
  }

  private pending = new Map<string, NodeJS.Timeout>();

  emit(room: string, event: string, payload: unknown): void {
    this.io.to(room).emit(event, payload);
  }

  /**
   * Coalesced broadcast: during a burst (hundreds of votes per second on one event), the
   * state is loaded and pushed at most once per window instead of once per write. The
   * subscribers always end up with the latest state, carried with its version number.
   */
  schedule(room: string, event: string, load: () => Promise<unknown>, windowMs = 100): void {
    if (this.pending.has(room)) return;
    const timer = setTimeout(async () => {
      this.pending.delete(room);
      try {
        this.emit(room, event, await load());
      } catch {
        // the aggregate was deleted meanwhile: its own "deleted" message was already sent
      }
    }, windowMs);
    this.pending.set(room, timer);
  }

  async flushAll(): Promise<void> {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  /** Re-checks every subscriber of a room after a permission change and evicts the ones who lost access. */
  async revalidate(room: string): Promise<void> {
    const sockets = await this.io.in(room).fetchSockets();
    await Promise.all(
      sockets.map(async (s) => {
        if (!(await canAccessRoom(s.data.userId, room))) s.leave(room);
      }),
    );
  }

  close(room: string, event: string, payload: unknown): void {
    this.io.to(room).emit(event, payload);
    this.io.in(room).socketsLeave(room);
  }
}
