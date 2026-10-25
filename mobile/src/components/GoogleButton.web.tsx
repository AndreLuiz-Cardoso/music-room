import { useEffect, useRef, useState } from 'react';
import { type HostInstance, View } from 'react-native';
import { Body, space } from '@/components/ui';
import type { GoogleButtonProps } from '@/lib/social';

// Web: Google Identity Services renders its own button and returns an ID token issued for our web
// client id, the same credential as the native SDK (the back-end checks its signature and audience).

const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const SCRIPT_URL = 'https://accounts.google.com/gsi/client?hl=en'; // the app is in English, whatever the browser
const MAX_WIDTH = 400; // Google's limit

interface Gis {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: Gis } };
  }
}

// initialized once per page: the credential goes to the button currently on screen
let receiver: ((idToken: string) => void) | null = null;
let loading: Promise<Gis> | null = null;

function loadGis(): Promise<Gis> {
  loading ??= new Promise<Gis>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const gis = window.google?.accounts.id;
      if (!gis) return reject(new Error('Google sign-in did not load'));
      gis.initialize({ client_id: clientId, callback: ({ credential }) => credential && receiver?.(credential) });
      resolve(gis);
    };
    script.onerror = () => {
      loading = null; // retried by the next button
      reject(new Error('Google sign-in could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function GoogleButton({ purpose, onPress }: GoogleButtonProps) {
  const host = useRef<HostInstance>(null);
  const handler = useRef(onPress);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    handler.current = onPress;
  });

  useEffect(() => {
    const receive = (idToken: string) => handler.current(() => Promise.resolve(idToken));
    receiver = receive;
    return () => {
      if (receiver === receive) receiver = null;
    };
  }, []);

  useEffect(() => {
    if (purpose === 'login' && !width) return; // waits for the layout: Google's button has a fixed width
    let live = true;
    loadGis().then(
      (gis) => {
        // react-native-web views are DOM elements
        if (live && host.current) {
          gis.renderButton(host.current as unknown as HTMLElement, {
            theme: 'filled_black',
            shape: 'pill',
            locale: 'en',
            text: 'continue_with',
            ...(purpose === 'login' ? { size: 'large', width: Math.min(width, MAX_WIDTH) } : { size: 'medium' }),
          });
        }
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [purpose, width]);

  if (failed) return <Body muted>Google sign-in could not be loaded.</Body>;
  return purpose === 'login' ? (
    <View
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={{ alignItems: 'center', marginVertical: space.xs, minHeight: 44 }}
    >
      <View ref={host} />
    </View>
  ) : (
    <View ref={host} />
  );
}
