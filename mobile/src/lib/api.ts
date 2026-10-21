import { clientHeaders, getApiUrl } from './client';
import { secureStorage } from './storage';
import type {
  DeviceAction,
  DeviceDetail,
  DeviceState,
  EventDetail,
  EventLicense,
  EventLocation,
  EventSummary,
  Me,
  PlaylistDetail,
  PlaylistLicense,
  PlaylistSummary,
  Profile,
  Session,
  Track,
  UserSummary,
  Visibility,
  VoteWindow,
} from './types';

// The app is a remote control of the back-end: every action is one of these calls.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const REFRESH_KEY = 'refreshToken';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => {};

export const getAccessToken = () => accessToken;
export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn;
};

export async function storeSession(s: Pick<Session, 'accessToken' | 'refreshToken'>) {
  accessToken = s.accessToken;
  await secureStorage.set(REFRESH_KEY, s.refreshToken);
}

export async function clearSession() {
  accessToken = null;
  await secureStorage.remove(REFRESH_KEY);
}

async function raw<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { ...clientHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Cannot reach the server (${getApiUrl()})`);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? `HTTP ${res.status}`);
  return data as T;
}

/**
 * Exchanges the refresh token for a new session. Concurrent callers share one refresh:
 * a refresh token is single use, two parallel refreshes would look like a theft.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const token = await secureStorage.get(REFRESH_KEY);
      if (!token) return false;
      const s = await raw<Session>('POST', '/auth/refresh', { refreshToken: token }, false);
      await storeSession(s);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) await clearSession();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await raw<T>(method, path, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && (await refreshSession())) {
      return raw<T>(method, path, body);
    }
    if (err instanceof ApiError && err.status === 401) onSessionLost();
    throw err;
  }
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
const put = <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);
const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return entries.length ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
};

export interface EventInput {
  name: string;
  description?: string | null;
  visibility?: Visibility;
  license?: EventLicense;
  location?: EventLocation | null;
  voteWindow?: VoteWindow | null;
}

export interface Geo {
  latitude: number;
  longitude: number;
}

export const api = {
  auth: {
    register: (email: string, password: string, displayName: string) =>
      raw<{ message: string }>('POST', '/auth/register', { email, password, displayName }, false),
    login: (email: string, password: string) => raw<Session>('POST', '/auth/login', { email, password }, false),
    google: (idToken: string) => raw<Session>('POST', '/auth/google', { idToken }, false),
    facebook: (accessToken: string) => raw<Session>('POST', '/auth/facebook', { accessToken }, false),
    forgotPassword: (email: string) => raw<void>('POST', '/auth/forgot-password', { email }, false),
    resetPassword: (token: string, password: string) =>
      raw<void>('POST', '/auth/reset-password', { token, password }, false),
    resendVerification: (email: string) => raw<void>('POST', '/auth/resend-verification', { email }, false),
    verifyEmail: (token: string) => raw<void>('POST', '/auth/verify-email', { token }, false),
    logout: async () => {
      const refreshToken = await secureStorage.get(REFRESH_KEY);
      if (refreshToken) await raw<void>('POST', '/auth/logout', { refreshToken }, false).catch(() => {});
      await clearSession();
    },
  },
  me: {
    get: () => get<Me>('/me'),
    update: (body: Partial<Pick<Me, 'displayName' | 'avatarUrl' | 'bio' | 'musicPreferences' | 'friendsInfo' | 'privateInfo'>>) =>
      patch<Me>('/me', body),
    changePassword: (currentPassword: string | undefined, newPassword: string) =>
      put<void>('/me/password', { currentPassword, newPassword }),
    linkGoogle: (idToken: string) => post<Me>('/me/links/google', { idToken }),
    linkFacebook: (accessToken: string) => post<Me>('/me/links/facebook', { accessToken }),
    unlink: (provider: 'google' | 'facebook') => del<Me>(`/me/links/${provider}`),
  },
  users: {
    search: (q?: string, genre?: string) => get<UserSummary[]>(`/users${qs({ q, genre })}`),
    get: (id: string) => get<Profile>(`/users/${id}`),
  },
  friends: {
    list: () => get<{ friends: UserSummary[]; received: UserSummary[]; sent: UserSummary[] }>('/friends'),
    request: (userId: string) => post<{ status: 'request_sent' | 'friend' }>(`/friends/${userId}`),
    remove: (userId: string) => del<void>(`/friends/${userId}`),
  },
  tracks: {
    search: (q: string) => get<Track[]>(`/tracks/search${qs({ q })}`),
  },
  events: {
    list: (filter: 'all' | 'mine' | 'invited' = 'all', q?: string) => get<EventSummary[]>(`/events${qs({ filter, q })}`),
    create: (body: EventInput) => post<EventDetail>('/events', body),
    get: (id: string) => get<EventDetail>(`/events/${id}`),
    update: (id: string, body: Partial<EventInput>) => patch<EventDetail>(`/events/${id}`, body),
    remove: (id: string) => del<void>(`/events/${id}`),
    invites: (id: string) => get<UserSummary[]>(`/events/${id}/invites`),
    invite: (id: string, userId: string) => post<EventDetail>(`/events/${id}/invites`, { userId }),
    uninvite: (id: string, userId: string) => del<EventDetail>(`/events/${id}/invites/${userId}`),
    suggest: (id: string, trackId: string, geo?: Geo | null) =>
      post<EventDetail>(`/events/${id}/tracks`, { trackId, ...(geo ?? {}) }),
    vote: (id: string, entryId: string, geo?: Geo | null) => post<EventDetail>(`/events/${id}/tracks/${entryId}/vote`, geo ?? {}),
    unvote: (id: string, entryId: string) => del<EventDetail>(`/events/${id}/tracks/${entryId}/vote`),
    next: (id: string) => post<EventDetail>(`/events/${id}/next`),
  },
  playlists: {
    list: (filter: 'all' | 'mine' | 'invited' = 'all', q?: string) =>
      get<PlaylistSummary[]>(`/playlists${qs({ filter, q })}`),
    create: (body: { name: string; description?: string | null; visibility?: Visibility; license?: PlaylistLicense }) =>
      post<PlaylistDetail>('/playlists', body),
    get: (id: string) => get<PlaylistDetail>(`/playlists/${id}`),
    update: (id: string, body: { name?: string; description?: string | null; visibility?: Visibility; license?: PlaylistLicense }) =>
      patch<PlaylistDetail>(`/playlists/${id}`, body),
    remove: (id: string) => del<void>(`/playlists/${id}`),
    invites: (id: string) => get<UserSummary[]>(`/playlists/${id}/invites`),
    invite: (id: string, userId: string) => post<PlaylistDetail>(`/playlists/${id}/invites`, { userId }),
    uninvite: (id: string, userId: string) => del<PlaylistDetail>(`/playlists/${id}/invites/${userId}`),
    addTrack: (id: string, trackId: string, afterEntryId?: string | null) =>
      post<PlaylistDetail>(`/playlists/${id}/tracks`, { trackId, afterEntryId }),
    moveTrack: (id: string, entryId: string, afterEntryId: string | null) =>
      post<PlaylistDetail>(`/playlists/${id}/tracks/${entryId}/move`, { afterEntryId }),
    removeTrack: (id: string, entryId: string) => del<PlaylistDetail>(`/playlists/${id}/tracks/${entryId}`),
  },
  devices: {
    list: () => get<{ owned: DeviceState[]; delegated: DeviceState[] }>('/devices'),
    register: (installationId: string, name: string) => post<DeviceDetail>('/devices', { installationId, name }),
    get: (id: string) => get<DeviceDetail>(`/devices/${id}`),
    rename: (id: string, name: string) => patch<DeviceDetail>(`/devices/${id}`, { name }),
    remove: (id: string) => del<void>(`/devices/${id}`),
    delegate: (id: string, userId: string, expiresAt: string | null) =>
      put<DeviceDetail>(`/devices/${id}/delegations/${userId}`, { expiresAt }),
    revoke: (id: string, userId: string) => del<DeviceDetail>(`/devices/${id}/delegations/${userId}`),
    command: (
      id: string,
      action: DeviceAction,
      extra: { volume?: number; trackId?: string; playlistId?: string; index?: number } = {},
    ) => post<DeviceDetail>(`/devices/${id}/commands`, { action, ...extra }),
  },
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
