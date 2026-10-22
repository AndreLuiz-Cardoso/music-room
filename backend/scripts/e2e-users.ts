// e2e accounts: prints {run, password, emails}; --remove <run> deletes them (see e2e/checks.mjs).
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../src/config';
import { prisma } from '../src/db';
import { pairKey } from '../src/services/users';

const domain = '@e2e.test';

async function create() {
  const run = Date.now().toString(36);
  const password = `E2e-${randomBytes(6).toString('hex')}1`;
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const emails = Object.fromEntries(['alice', 'bob', 'carol'].map((name) => [name, `${name}-${run}${domain}`]));
  const users = await Promise.all(
    Object.entries(emails).map(([name, email]) =>
      prisma.user.create({ data: { email, displayName: `${name} ${run}`, passwordHash, emailVerified: true } }),
    ),
  );
  await prisma.friendship.create({ data: { ...pairKey(users[0].id, users[1].id), requesterId: users[0].id, status: 'ACCEPTED' } });
  console.log(JSON.stringify({ run, password, emails }));
}

async function remove(run: string) {
  // their events, playlists, devices and delegations go with them (cascade)
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}${domain}` } } });
}

const i = process.argv.indexOf('--remove');
(i === -1 ? create() : remove(process.argv[i + 1]))
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
