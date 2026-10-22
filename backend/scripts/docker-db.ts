// PostgreSQL in Docker (npm run db:docker), configured from DATABASE_URL like npm run db:local.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first (see .env.example)');
const url = new URL(process.env.DATABASE_URL);

execFileSync('docker', ['compose', '-f', path.resolve(__dirname, '..', '..', 'docker-compose.yml'), 'up', '-d', 'db'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    POSTGRES_USER: decodeURIComponent(url.username),
    POSTGRES_PASSWORD: decodeURIComponent(url.password),
    POSTGRES_DB: url.pathname.slice(1),
    POSTGRES_PORT: url.port || '5432',
  },
});
