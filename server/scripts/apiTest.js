/**
 * npm run test:api
 * 1. rebuild a fresh demo database, 2. run the HTTP API tests,
 * 3. rebuild again so the demo data is clean afterwards.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args, extraEnv = {}) =>
  spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } }).status;

const quietReset = () => spawnSync(process.execPath, ['scripts/dbSetup.js', '--reset'], { cwd: root, encoding: 'utf8' });

console.log('Resetting database for API tests...');
let r = quietReset();
if (r.status !== 0) {
  console.error(r.stdout, r.stderr);
  process.exit(1);
}
const status = run(['--test', '--test-concurrency=1', 'tests/api.test.js'], { NODE_ENV: 'test' });
console.log('\nRestoring clean demo database...');
r = quietReset();
if (r.status !== 0) console.error(r.stdout, r.stderr);
process.exit(status ?? 1);
