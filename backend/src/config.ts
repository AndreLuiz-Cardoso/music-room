import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** TRUST_PROXY: "true" or the proxy addresses. Off by default, or clients could forge their IP. */
function trustProxy(value: string | undefined): boolean | string {
  if (!value || value === 'false') return false;
  return value === 'true' ? true : value;
}

const port = Number(process.env.PORT ?? 3000);
const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long');
// the value of .env.example is public: anyone could sign tokens with it
if (jwtSecret.includes('change-me')) throw new Error('JWT_SECRET is still the example of .env.example: generate one (see .env.example)');

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port,
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlDays: 30,
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
  corsOrigins: list(process.env.CORS_ORIGINS),
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  rateLimit: {
    global: Number(process.env.RATE_LIMIT_MAX ?? 300),
    auth: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.MAIL_FROM ?? 'Music Room <no-reply@musicroom.local>',
  },
  google: { clientIds: list(process.env.GOOGLE_CLIENT_IDS) },
  facebook: {
    appId: process.env.FACEBOOK_APP_ID ?? '',
    appSecret: process.env.FACEBOOK_APP_SECRET ?? '',
  },
  trackCatalog: process.env.TRACK_CATALOG ?? 'deezer',
};
