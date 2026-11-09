import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const json = (message) => ({ error: message });
const isTest = process.env.NODE_ENV === 'test';

/** Brute-force protection on login/registration. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: json('Too many login attempts. Please wait 15 minutes and try again.'),
});

/** Limits browsing of candidate lists / photos (privacy: discourages fishing). */
export const candidateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? 10000 : 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u${req.user.id}` : ipKeyGenerator(req.ip)),
  message: json('Too many requests. Please slow down.'),
});

/** Claims are also capped per day inside PostgreSQL (max_claims_per_day). */
export const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u${req.user.id}` : ipKeyGenerator(req.ip)),
  message: json('Too many claim actions. Please wait a minute.'),
});
