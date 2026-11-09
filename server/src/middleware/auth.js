import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { poolForRole } from '../config/db.js';
import { withTx } from '../db/withTx.js';
import { HttpError } from '../utils/httpError.js';

export const SESSION_COOKIE = 'cf_session';

const cookieOptions = () => ({
  httpOnly: true,                 // not readable by JavaScript (XSS cannot steal it)
  sameSite: 'strict',             // not sent on cross-site requests (CSRF protection)
  secure: env.isProd,             // HTTPS-only in production
  path: '/',
});

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user.user_id), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
  const decoded = jwt.decode(token);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), expires: new Date(decoded.exp * 1000) });
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/**
 * Verifies the session cookie, then re-loads the user from PostgreSQL (through
 * the pool for that role) so a deactivated account is locked out immediately.
 * Sets req.user and req.pool. The role used for the DB pool comes from the
 * signed token, never from anything the browser sends.
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next(new HttpError(401, 'Please log in'));

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    clearSession(res);
    return next(new HttpError(401, 'Your session has expired. Please log in again.'));
  }

  const pool = poolForRole(payload.role);
  const user = await withTx(pool, payload.sub, async (c) =>
    (await c.query('SELECT * FROM session_user_info()')).rows[0]);

  if (!user || !user.is_active || user.role !== payload.role) {
    clearSession(res);
    return next(new HttpError(401, 'Your account is not active. Please contact the admin desk.'));
  }

  req.user = { id: user.user_id, role: user.role, fullName: user.full_name, email: user.email, rollNo: user.roll_no };
  req.pool = pool;
  next();
}

export const requireRole = (role) => (req, res, next) => {
  if (req.user?.role !== role) {
    return next(new HttpError(403, role === 'admin' ? 'Admin access only' : 'Student access only'));
  }
  next();
};
