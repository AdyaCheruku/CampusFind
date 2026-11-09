import { Router } from 'express';
import { z } from 'zod';
import { validate, requiredText } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimits.js';
import { requireAuth, requireRole, issueSession, clearSession } from '../middleware/auth.js';
import { registerStudent, login, publicUser, loadSessionUser } from '../services/authService.js';
import { txFor } from '../db/withTx.js';

const router = Router();

const email = z.string({ error: 'Email is required' }).trim().toLowerCase()
  .email('Enter a valid email address').max(254);

const registerSchema = z.object({
  fullName: requiredText(2, 100, 'Full name'),
  email,
  rollNo: z.string({ error: 'Roll number is required' }).trim().toUpperCase()
    .regex(/^[A-Z0-9-]{3,30}$/, 'Roll number may contain only letters, digits and hyphens (3-30)'),
  password: z.string({ error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});

const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(200),
});

// Student self-registration (role is always 'student', set in PostgreSQL).
router.post('/auth/register', authLimiter, validate(registerSchema), async (req, res) => {
  const user = await registerStudent(req.body);
  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/auth/login', authLimiter, validate(loginSchema), async (req, res) => {
  const user = await login(req.body, 'student');
  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

// Separate admin portal. Admin accounts are seeded; there is no admin registration.
router.post('/admin/auth/login', authLimiter, validate(loginSchema), async (req, res) => {
  const user = await login(req.body, 'admin');
  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, async (req, res) => {
  const user = await loadSessionUser(req.user.role, req.user.id);
  res.json({ user: publicUser(user) });
});

router.patch('/auth/me', requireAuth, requireRole('student'),
  validate(z.object({ fullName: requiredText(2, 100, 'Full name') })),
  async (req, res) => {
    await txFor(req, (c) => c.query('SELECT update_my_name($1)', [req.body.fullName]));
    const user = await loadSessionUser(req.user.role, req.user.id);
    res.json({ user: publicUser(user) });
  });

export default router;
