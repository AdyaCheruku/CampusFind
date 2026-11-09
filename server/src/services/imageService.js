import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { UPLOAD_ROOT } from '../config/paths.js';

// Blur strength for student-visible copies: enough to show type and colour,
// not fine marks, text or serial numbers.
export const BLUR_SIGMA = Number(process.env.BLUR_SIGMA || 14);

/** Resolve a stored relative path safely inside the uploads root (no path traversal). */
export function resolveUpload(relPath) {
  const full = path.resolve(UPLOAD_ROOT, relPath);
  if (!full.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
    throw new Error('Invalid file path');
  }
  return full;
}

export function randomName(ext = '.jpg') {
  return `${crypto.randomUUID()}${ext}`;
}

/**
 * Normalise an uploaded image: auto-rotate, cap size, re-encode as JPEG.
 * Re-encoding strips EXIF metadata (including GPS location) for privacy.
 */
export async function saveNormalisedImage(buffer, folder) {
  const rel = `${folder}/${randomName('.jpg')}`;
  const info = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(resolveUpload(rel));
  return { relPath: rel, size: info.size, mime: 'image/jpeg' };
}

/** Create the blurred, student-visible copy of an original photo. */
export async function saveBlurredCopy(originalRel) {
  const rel = `blurred/${path.basename(originalRel)}`;
  await sharp(resolveUpload(originalRel))
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .blur(BLUR_SIGMA)
    .jpeg({ quality: 70 })
    .toFile(resolveUpload(rel));
  return rel;
}

export async function removeUpload(relPath) {
  if (!relPath) return;
  try {
    await fs.unlink(resolveUpload(relPath));
  } catch {
    /* already gone */
  }
}

export async function ensureUploadDirs() {
  for (const d of ['originals', 'blurred', 'evidence', 'proofs']) {
    await fs.mkdir(path.join(UPLOAD_ROOT, d), { recursive: true });
  }
}
