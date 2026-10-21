import { buildApp } from './app';
import { config } from './config';
import { prisma } from './db';

async function main() {
  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`API docs available on ${config.publicUrl}/docs`);

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
