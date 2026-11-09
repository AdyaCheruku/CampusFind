import pg from 'pg';
import { env } from './env.js';

// timestamptz -> JS Date (default); numeric -> JS number for scores.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
// DATE stays a plain 'YYYY-MM-DD' string (no time-zone shifting).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

/**
 * Two pools, one per least-privilege database role. A student request can
 * never run with admin privileges because it never touches adminPool.
 */
export const studentPool = new pg.Pool({
  ...env.pg,
  user: 'student_app',
  password: env.studentDbPassword,
  max: 10,
  application_name: 'campusfind-student',
});

export const adminPool = new pg.Pool({
  ...env.pg,
  user: 'admin_app',
  password: env.adminDbPassword,
  max: 5,
  application_name: 'campusfind-admin',
});

export function poolForRole(role) {
  if (role === 'admin') return adminPool;
  if (role === 'student') return studentPool;
  throw new Error(`No database pool for role ${role}`);
}

export async function closePools() {
  await Promise.all([studentPool.end(), adminPool.end()]);
}
