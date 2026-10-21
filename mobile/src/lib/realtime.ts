import { useEffect, useEffectEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshSession } from './api';
import { getApiUrl } from './client';

// One Socket.IO connection for the whole app. Screens subscribe to rooms
// (event:<id>, playlist:<id>, device:<id>); subscriptions are replayed after a reconnection.

let socket: Socket | null = null;
const rooms = new Map<string, number>();

function connect(): Socket {
  if (socket) return socket;
  const s = io(getApiUrl(), {
    transports: ['websocket'],
    // called on every (re)connection, so a refreshed access token is always used
    auth: (cb) => cb({ token: getAccessToken() }),
  });
  s.on('connect', () => {
    for (const room of rooms.keys()) s.emit('subscribe', room);
  });
  s.on('connect_error', async (err) => {
    if (err.message === 'UNAUTHORIZED' && (await refreshSession())) s.connect();
  });
  socket = s;
  return s;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
  rooms.clear();
}

/** Subscribes to a room while the component is mounted and calls `handler` on each message. */
export function useRealtime<T>(room: string | null, event: string, handler: (payload: T) => void) {
  const onMessage = useEffectEvent(handler);

  useEffect(() => {
    if (!room) return;
    const s = connect();
    const listener = (payload: T) => onMessage(payload);
    s.on(event, listener);
    rooms.set(room, (rooms.get(room) ?? 0) + 1);
    if (s.connected) s.emit('subscribe', room);
    return () => {
      s.off(event, listener);
      const count = (rooms.get(room) ?? 1) - 1;
      if (count <= 0) {
        rooms.delete(room);
        s.emit('unsubscribe', room);
      } else rooms.set(room, count);
    };
  }, [room, event]);
}

/** Listens to a message sent to the user's own room (joined automatically by the server). */
export function useUserEvent(event: string, handler: () => void) {
  const onMessage = useEffectEvent(handler);
  useEffect(() => {
    const s = connect();
    const listener = () => onMessage();
    s.on(event, listener);
    return () => {
      s.off(event, listener);
    };
  }, [event]);
}

/** Keeps the most recent state: a message older than what is displayed is ignored. */
export function newer<T extends { version: number }>(current: T | null, incoming: T): boolean {
  return !current || incoming.version >= current.version;
}
