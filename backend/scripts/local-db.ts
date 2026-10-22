// Embedded PostgreSQL (npm run db:local, keeps running), configured from DATABASE_URL.
import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first (see .env.example)');
  const url = new URL(process.env.DATABASE_URL);
  const database = url.pathname.slice(1);
  const dir = path.resolve(__dirname, '..', '..', '.pgdata');
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port || 5432),
    persistent: true,
  });

  const fresh = !existsSync(path.join(dir, 'PG_VERSION'));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase(database);
  console.log(`PostgreSQL running on port ${url.port}, database "${database}", data in ${dir}`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
