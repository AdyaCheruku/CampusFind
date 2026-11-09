/**
 * CampusFind database setup.
 *
 *   npm run db:setup   create roles, database, schema, logic, security and demo data
 *   npm run db:reset   DROP the campusfind database and rebuild it from scratch
 *
 * Uses the PostgreSQL superuser from server/.env ONLY for this script. All
 * objects are created as role campusfind_owner; the app connects as
 * student_app / admin_app.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { DATABASE_DIR, UPLOAD_ROOT } from '../src/config/paths.js';
import { ensureUploadDirs, resolveUpload, BLUR_SIGMA } from '../src/services/imageService.js';

const SQL_FILES = [
  '01_tables.sql',
  '02_indexes.sql',
  '03_matching.sql',
  '04_workflow.sql',
  '05_triggers.sql',
  '06_views.sql',
  '07_security.sql',
  '08_reference_data.sql',
  '09_seed_demo.sql',
];

const env = process.env;
const DB = env.PGDATABASE || 'campusfind';
const reset = process.argv.includes('--reset');
const noSeed = process.argv.includes('--no-seed');

function client(database) {
  return new pg.Client({
    host: env.PGHOST || 'localhost',
    port: Number(env.PGPORT || 5432),
    user: env.PG_SUPERUSER || 'postgres',
    password: env.PG_SUPERUSER_PASSWORD,
    database,
  });
}

const ident = (s) => pg.escapeIdentifier(s);
const lit = (s) => pg.escapeLiteral(s);

function lineOf(sql, position) {
  if (!position) return '?';
  return sql.slice(0, Number(position)).split('\n').length;
}

async function ensureRole(c, name, password) {
  const { rowCount } = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  if (!rowCount) {
    await c.query(`CREATE ROLE ${ident(name)} ${password ? 'LOGIN PASSWORD ' + lit(password) : 'NOLOGIN'}`);
    console.log(`  created role ${name}`);
  } else if (password) {
    await c.query(`ALTER ROLE ${ident(name)} LOGIN PASSWORD ${lit(password)}`);
  }
}

async function main() {
  if (!env.PG_SUPERUSER_PASSWORD) {
    console.error('\n  PG_SUPERUSER_PASSWORD is empty. Put your postgres password in server/.env and re-run.\n');
    process.exit(1);
  }
  for (const k of ['STUDENT_APP_PASSWORD', 'ADMIN_APP_PASSWORD']) {
    if (!env[k]) {
      console.error(`  ${k} is missing in server/.env`);
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------- cluster level
  const root = client('postgres');
  await root.connect();
  console.log('Connected to PostgreSQL as superuser.');

  const exists = (await root.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB])).rowCount > 0;
  if (exists && reset) {
    console.log(`Dropping database ${DB} ...`);
    await root.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [DB],
    );
    await root.query(`DROP DATABASE ${ident(DB)}`);
    // Files belonging to the dropped database are orphans now.
    for (const d of ['originals', 'blurred', 'evidence', 'proofs']) {
      await fs.rm(path.join(UPLOAD_ROOT, d), { recursive: true, force: true });
    }
  }

  await ensureRole(root, 'campusfind_owner', null);
  await ensureRole(root, 'student_app', env.STUDENT_APP_PASSWORD);
  await ensureRole(root, 'admin_app', env.ADMIN_APP_PASSWORD);

  if (exists && !reset) {
    const check = client(DB);
    await check.connect();
    const hasSchema = (await check.query("SELECT 1 FROM pg_namespace WHERE nspname = 'campusfind'")).rowCount > 0;
    await check.end();
    if (hasSchema) {
      await root.end();
      console.log(`Database "${DB}" is already set up (role passwords synced). Use "npm run db:reset" to rebuild it.`);
      return;
    }
  } else {
    await root.query(`CREATE DATABASE ${ident(DB)} OWNER campusfind_owner`);
    console.log(`Created database ${DB}.`);
  }
  await root.query(`REVOKE ALL ON DATABASE ${ident(DB)} FROM PUBLIC`);
  await root.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(DB)} TO student_app, admin_app, campusfind_owner`);
  await root.end();

  // ---------------------------------------------------------------- database level
  const c = client(DB);
  await c.connect();
  await c.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  for (const r of ['campusfind_owner', 'student_app', 'admin_app']) {
    await c.query(`ALTER ROLE ${ident(r)} IN DATABASE ${ident(DB)} SET search_path = campusfind, public`);
  }

  await c.query('BEGIN');
  try {
    await c.query('CREATE SCHEMA campusfind AUTHORIZATION campusfind_owner');
    await c.query('SET LOCAL ROLE campusfind_owner');
    await c.query('SET LOCAL search_path = campusfind, public');
    for (const file of SQL_FILES) {
      if (noSeed && file.startsWith('09_')) continue;
      const sql = await fs.readFile(path.join(DATABASE_DIR, file), 'utf8');
      try {
        await c.query(sql);
        console.log(`  ✓ ${file}`);
      } catch (err) {
        console.error(`\n  ✗ ${file} (line ${lineOf(sql, err.position)}): ${err.message}`);
        if (err.where) console.error(`    where: ${err.where}`);
        if (err.detail) console.error(`    detail: ${err.detail}`);
        throw err;
      }
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
    console.error('\nSetup failed; all schema changes were rolled back. Fix the error and run "npm run db:reset".');
    process.exit(1);
  }

  // ---------------------------------------------------------------- placeholder photos
  await ensureUploadDirs();
  const photos = await c.query(`
    SELECT p.photo_id, p.original_path, p.blurred_path, i.reference_code, c.name AS category,
           col.name AS colour, col.hex
    FROM campusfind.item_photos p
    JOIN campusfind.found_items i ON i.item_id = p.item_id
    JOIN campusfind.categories c ON c.category_id = i.category_id
    JOIN campusfind.colours col ON col.colour_id = i.colour_id`);
  let made = 0;
  for (const p of photos.rows) {
    const orig = resolveUpload(p.original_path);
    try {
      await fs.access(orig);
      continue;
    } catch {
      /* generate */
    }
    const svg = placeholderSvg(p);
    const info = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(orig);
    await sharp(orig).blur(BLUR_SIGMA).jpeg({ quality: 70 }).toFile(resolveUpload(p.blurred_path));
    await c.query('UPDATE campusfind.item_photos SET size_bytes = $1 WHERE photo_id = $2', [info.size, p.photo_id]);
    made++;
  }
  if (made) console.log(`  ✓ generated ${made} placeholder photo(s)`);

  const counts = await c.query(`SELECT
      (SELECT count(*) FROM campusfind.found_items)       AS items,
      (SELECT count(*) FROM campusfind.lost_reports)      AS reports,
      (SELECT count(*) FROM campusfind.potential_matches) AS matches,
      (SELECT count(*) FROM campusfind.ownership_claims)  AS claims`);
  await c.end();

  const n = counts.rows[0];
  console.log(`\nCampusFind database ready: ${n.items} items, ${n.reports} reports, ${n.matches} stored matches, ${n.claims} claims.`);
  if (!noSeed) {
    console.log('\nDemo accounts');
    console.log('  Admin    admin@campusfind.edu  /  Admin@123   (also desk@campusfind.edu)');
    console.log('  Student  aarav.mehta@college.edu  /  Student@123   (12 students, all Student@123)');
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function placeholderSvg(p) {
  const hex = p.hex || '#888888';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const light = (r * 299 + g * 587 + b * 114) / 1000 > 150;
  const ink = light ? '#1F2328' : '#FFFFFF';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F3EEE2"/><stop offset="1" stop-color="#E4DCC8"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <ellipse cx="400" cy="470" rx="230" ry="26" fill="#000" opacity="0.10"/>
  <rect x="230" y="140" width="340" height="320" rx="42" fill="${hex}" stroke="#00000022" stroke-width="4"/>
  <rect x="262" y="172" width="120" height="18" rx="9" fill="#FFFFFF" opacity="0.35"/>
  <text x="400" y="315" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="${ink}" text-anchor="middle">${esc(p.category)}</text>
  <text x="400" y="358" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="${ink}" opacity="0.85" text-anchor="middle">${esc(p.colour)}</text>
  <text x="400" y="560" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#5B5B5B" text-anchor="middle">${esc(p.reference_code)} · CampusFind intake photo (placeholder)</text>
</svg>`;
}

main().catch((err) => {
  console.error('\nSetup error:', err.message);
  process.exit(1);
});
