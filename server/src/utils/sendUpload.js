import fs from 'node:fs';
import { resolveUpload } from '../services/imageService.js';
import { HttpError } from './httpError.js';

/**
 * Stream a stored upload. Uploads are never served statically; every file goes
 * through an authorising route that calls this. Responses are private/no-store
 * so shared caches never keep them.
 */
export function sendUpload(res, relPath, mime = 'image/jpeg', downloadName) {
  let full;
  try {
    full = resolveUpload(relPath);
  } catch {
    throw new HttpError(404, 'File not found');
  }
  if (!fs.existsSync(full)) throw new HttpError(404, 'File not found');
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(mime);
  if (downloadName) res.attachment(downloadName);
  fs.createReadStream(full).pipe(res);
}
