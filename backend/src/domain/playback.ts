// Device playback state machine: the server owns the state, devices and delegates send commands.

export interface PlaybackTrack {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  previewUrl: string | null;
  durationSec: number;
}

export interface PlaybackState {
  queue: PlaybackTrack[];
  index: number;
  isPlaying: boolean;
  volume: number;
}

export type PlaybackCommand =
  | { action: 'PLAY' }
  | { action: 'PAUSE' }
  | { action: 'NEXT' }
  | { action: 'PREVIOUS' }
  | { action: 'SET_VOLUME'; volume: number }
  | { action: 'LOAD'; queue: PlaybackTrack[]; index: number };

export const MAX_QUEUE = 500;

export const initialPlayback: PlaybackState = { queue: [], index: 0, isPlaying: false, volume: 80 };

export function applyCommand(state: PlaybackState, cmd: PlaybackCommand): PlaybackState {
  switch (cmd.action) {
    case 'PLAY':
      return { ...state, isPlaying: state.queue.length > 0 };
    case 'PAUSE':
      return { ...state, isPlaying: false };
    case 'NEXT':
      if (state.index + 1 >= state.queue.length) return { ...state, isPlaying: false };
      return { ...state, index: state.index + 1 };
    case 'PREVIOUS':
      return { ...state, index: Math.max(0, state.index - 1) };
    case 'SET_VOLUME':
      return { ...state, volume: Math.min(100, Math.max(0, Math.round(cmd.volume))) };
    case 'LOAD': {
      const queue = cmd.queue.slice(0, MAX_QUEUE);
      const index = Math.min(Math.max(0, cmd.index), Math.max(0, queue.length - 1));
      return { ...state, queue, index, isPlaying: queue.length > 0 };
    }
  }
}

/** Defensive parse of the JSON column: anything malformed falls back to the initial state. */
export function parsePlayback(value: unknown): PlaybackState {
  if (!value || typeof value !== 'object') return initialPlayback;
  const v = value as Partial<PlaybackState>;
  return {
    queue: Array.isArray(v.queue) ? v.queue : [],
    index: typeof v.index === 'number' ? v.index : 0,
    isPlaying: v.isPlaying === true,
    volume: typeof v.volume === 'number' ? v.volume : initialPlayback.volume,
  };
}
