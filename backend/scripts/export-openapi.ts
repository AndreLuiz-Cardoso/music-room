// Writes the OpenAPI document generated from the route schemas to docs/openapi.json.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/app';

async function main() {
  const app = await buildApp({ logger: false });
  await app.ready();
  const out = path.resolve(__dirname, '..', '..', 'docs', 'openapi.json');
  writeFileSync(out, JSON.stringify(app.swagger(), null, 2));
  await app.close();
  console.log(`OpenAPI document written to ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
