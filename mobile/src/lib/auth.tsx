import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearSession, refreshSession, setSessionLostHandler, storeSession } from './api';
import { deviceName, installationId, loadApiUrl } from './client';
import { disconnectRealtime } from './realtime';
import type { Me, Session } from './types';

interface AuthState {
  ready: boolean;
  user: Me | null;
  /** id of this device on the back-end (Music Control Delegation) */
  deviceId: string | null;
  startSession: (session: Session) => Promise<void>;
  setUser: (user: Me) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Me | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  /** Every logged-in installation is attached to the account as a controllable device. */
  const registerDevice = useCallback(async () => {
    try {
      const device = await api.devices.register(await installationId(), deviceName);
      setDeviceId(device.id);
    } catch {
      setDeviceId(null);
    }
  }, []);

  const startSession = useCallback(
    async (session: Session) => {
      await storeSession(session);
      setUser(session.user);
      await registerDevice();
    },
    [registerDevice],
  );

  const logout = useCallback(async () => {
    disconnectRealtime();
    await api.auth.logout();
    setUser(null);
    setDeviceId(null);
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      disconnectRealtime();
      void clearSession();
      setUser(null);
    });
    (async () => {
      await loadApiUrl();
      if (await refreshSession()) {
        try {
          setUser(await api.me.get());
          await registerDevice();
        } catch {
          setUser(null);
        }
      }
      setReady(true);
    })();
  }, [registerDevice]);

  const value = useMemo(
    () => ({ ready, user, deviceId, startSession, setUser, logout }),
    [ready, user, deviceId, startSession, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
