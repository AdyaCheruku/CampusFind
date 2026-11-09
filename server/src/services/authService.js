import bcrypt from 'bcryptjs';
import { studentPool, poolForRole } from '../config/db.js';
import { withTx } from '../db/withTx.js';
import { HttpError } from '../utils/httpError.js';

const BCRYPT_COST = 12;
// Used when the email is unknown so the response time does not reveal
// whether an account exists (user-enumeration protection).
const DUMMY_HASH = bcrypt.hashSync('campusfind-dummy-password', BCRYPT_COST);

export async function registerStudent({ fullName, email, rollNo, password }) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  // Role is assigned inside PostgreSQL (register_student hard-codes 'student').
  const userId = await withTx(studentPool, null, async (c) =>
    (await c.query('SELECT register_student($1, $2, $3, $4) AS id', [fullName, email, rollNo, hash])).rows[0].id);
  return loadSessionUser('student', userId);
}

/**
 * Verify credentials for the given portal. A student cannot log in through
 * the admin form and vice versa.
 */
export async function login({ email, password }, expectedRole) {
  const user = await withTx(studentPool, null, async (c) =>
    (await c.query('SELECT * FROM auth_lookup($1)', [email])).rows[0]);

  const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !ok || user.role !== expectedRole) {
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (!user.is_active) {
    throw new HttpError(403, 'This account has been deactivated. Please contact the admin desk.');
  }

  await withTx(poolForRole(user.role), user.user_id, (c) => c.query('SELECT record_login()'));
  return loadSessionUser(user.role, user.user_id);
}

export async function loadSessionUser(role, userId) {
  return withTx(poolForRole(role), userId, async (c) =>
    (await c.query('SELECT * FROM session_user_info()')).rows[0]);
}

export function publicUser(u) {
  return {
    id: u.user_id,
    fullName: u.full_name,
    email: u.email,
    rollNo: u.roll_no,
    role: u.role,
    memberSince: u.created_at,
  };
}
