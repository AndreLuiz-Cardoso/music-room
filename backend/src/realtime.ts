import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyAccess } from './auth/tokens';
import { canAccessRoom } from './services/access';

/** Push-only real-time channel: writes go through REST (protocol in docs/ARCHITECTURE.md). */
export class Realtime {
  readonly io: Server;
  private snapshots = new Map<string, { event: string; load: (id: string) => Promise<unknown> }>();

  constructor(server: HttpServer, corsOrigins: string[]) {
    this.io = new Server(server, { cors: { origin: corsOrigins.length ? corsOrigins : false } });

    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        const { userId, expiresAt } = verifyAccess(typeof token === 'string' ? token : '');
        socket.data.userId = userId;
        socket.data.expiresAt = expiresAt;
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });

    this.io.on('connection', (socket) => {
      const userId: string = socket.data.userId;
      socket.join(`user:${userId}`);

      // A socket lives as long as its access token: a fresh one re-checks the session on reconnect.
      const expiry = setTimeout(() => socket.disconnect(true), socket.data.expiresAt - Date.now());
      socket.on('disconnect', () => clearTimeout(expiry));

      socket.on('subscribe', async (room: unknown, ack?: (r: { ok: boolean }) => void) => {
        const ok = typeof room === 'string' && room.length < 100 && (await canAccessRoom(userId, room).catch(() => false));
        if (ok) {
          socket.join(room as string);
          // Pushes sent while the socket was out of the room are lost: send the current state once.
          const [kind, id] = (room as string).split(':');
          const snapshot = this.snapshots.get(kind);
          const state = await snapshot?.load(id).catch(() => null);
          if (snapshot && state) socket.emit(snapshot.event, state);
        }
        if (typeof ack === 'function') ack({ ok });
      });

      socket.on('unsubscribe', (room: unknown) => {
        if (typeof room === 'string' && !room.startsWith('user:')) socket.leave(room);
      });
    });
  }

  private pending = new Map<string, NodeJS.Timeout>();

  /** Loads the state of a room kind ("event", "playlist", "device"), sent to each new subscriber. */
  onSubscribe(kind: string, event: string, load: (id: string) => Promise<unknown>): void {
    this.snapshots.set(kind, { event, load });
  }

  emit(room: string, event: string, payload: unknown): void {
    this.io.to(room).emit(event, payload);
  }

  /** Coalesced broadcast: at most one load and push per room per window, always the latest state. */
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

  /** Evicts subscribers who lost access; a failed check evicts only that one, not the whole push. */
  async revalidate(room: string): Promise<void> {
    const sockets = await this.io.in(room).fetchSockets();
    await Promise.all(
      sockets.map(async (s) => {
        if (!(await canAccessRoom(s.data.userId, room).catch(() => false))) s.leave(room);
      }),
    );
  }

  close(room: string, event: string, payload: unknown): void {
    this.io.to(room).emit(event, payload);
    this.io.in(room).socketsLeave(room);
  }
}
