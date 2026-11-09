import { z } from 'zod';

/** Validate req[source] against a zod schema; the parsed value replaces it. */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) return next(result.error);
  if (source === 'query') req.validQuery = result.data;
  else req[source] = result.data;
  next();
};

// ---------- reusable field schemas ------------------------------------------
export const optionalText = (max) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max, `Must be at most ${max} characters`).optional(),
  );

export const requiredText = (min, max, label) =>
  z.string({ error: `${label} is required` }).trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

export const optionalId = z.preprocess(
  (v) => (v === '' || v === null || v === 'null' || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

export const requiredId = (label) =>
  z.coerce.number({ error: `${label} is required` }).int().positive(`${label} is required`);

export const dateTime = (label) =>
  z.coerce.date({ error: `${label} must be a valid date and time` })
    .refine((d) => !Number.isNaN(d.getTime()), `${label} must be a valid date and time`);

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
