import multer from 'multer';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EVIDENCE_TYPES = new Set([...IMAGE_TYPES, 'application/pdf']);

/**
 * Files are kept in memory, then validated and re-encoded by sharp (images)
 * or checked for the PDF signature before anything touches the disk.
 * Filenames are always generated server-side (never the client's name).
 */
function make(allowed, maxFiles) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.maxUploadBytes, files: maxFiles, fields: 30 },
    fileFilter: (req, file, cb) => {
      if (!allowed.has(file.mimetype)) {
        return cb(new HttpError(422, `Unsupported file type ${file.mimetype}. Use JPEG, PNG or WebP${allowed.has('application/pdf') ? ' or PDF' : ''}.`));
      }
      cb(null, true);
    },
  });
}

export const imageUpload = make(IMAGE_TYPES, 6);
export const evidenceUpload = make(EVIDENCE_TYPES, 3);

export function isPdf(buffer) {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}
