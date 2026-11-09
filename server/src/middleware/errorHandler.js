import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { mapPgError } from '../db/pgErrors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(422).json({ error: issues[0]?.message || 'Invalid input', issues });
  }
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `File too large (max ${process.env.MAX_UPLOAD_MB || 5} MB)`
      : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files' : err.message;
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({ error: msg });
  }
  const pg = mapPgError(err);
  if (pg) {
    return res.status(pg.status).json({ error: pg.message, code: pg.code });
  }
  if (/unsupported image format|Input buffer|corrupt/i.test(err?.message || '')) {
    return res.status(422).json({ error: 'The uploaded file is not a valid image' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}
