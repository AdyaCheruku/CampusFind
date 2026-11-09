import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate, requiredText, optionalText, optionalId, requiredId, dateTime } from '../middleware/validate.js';
import { imageUpload, evidenceUpload, isPdf } from '../middleware/upload.js';
import { candidateLimiter, claimLimiter } from '../middleware/rateLimits.js';
import { txFor } from '../db/withTx.js';
import { idParam, HttpError } from '../utils/httpError.js';
import { sendUpload } from '../utils/sendUpload.js';
import { saveNormalisedImage, removeUpload, resolveUpload, randomName } from '../services/imageService.js';
import * as reports from '../services/reportService.js';
import * as claims from '../services/claimService.js';
import fs from 'node:fs/promises';

const router = Router();
router.use(requireAuth, requireRole('student'));

// ---------------------------------------------------------------- dashboard
router.get('/me/dashboard', async (req, res) => {
  const data = await txFor(req, async (c) => {
    const stats = (await c.query('SELECT * FROM v_student_dashboard')).rows[0];
    const recentReports = (await c.query(
      'SELECT report_id, reference_code, category, status, created_at, candidate_count, open_claim_status FROM v_student_reports ORDER BY created_at DESC LIMIT 5')).rows;
    const recentClaims = (await c.query(
      'SELECT claim_id, reference_code, item_ref, category, status, created_at, pickup_deadline FROM v_student_claims ORDER BY created_at DESC LIMIT 5')).rows;
    const notifications = (await c.query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 5')).rows;
    return { stats, recentReports, recentClaims, notifications };
  });
  res.json(data);
});

// ---------------------------------------------------------------- lost reports
const reportSchema = z.object({
  categoryId: requiredId('Category'),
  brand: optionalText(60),
  model: optionalText(80),
  colourId: optionalId,
  description: requiredText(20, 1000, 'Description'),
  features: optionalText(500),
  serialHint: optionalText(80),
  lostLocationId: optionalId,
  lostLocationDetail: optionalText(120),
  lostAt: dateTime('Date and time lost'),
});

router.post('/lost-reports', imageUpload.single('proofPhoto'), validate(reportSchema), async (req, res) => {
  let proof = null;
  if (req.file) proof = await saveNormalisedImage(req.file.buffer, 'proofs');
  try {
    const created = await txFor(req, (c) => reports.createReport(c, req.body, proof?.relPath));
    res.status(201).json({ report: created });
  } catch (err) {
    if (proof) await removeUpload(proof.relPath);
    throw err;
  }
});

router.get('/lost-reports/mine', async (req, res) => {
  res.json({ reports: await txFor(req, reports.listMyReports) });
});

router.get('/lost-reports/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Report');
  res.json({ report: await txFor(req, (c) => reports.getMyReport(c, id)) });
});

router.post('/lost-reports/:id/withdraw',
  validate(z.object({ reason: requiredText(5, 300, 'Reason') })),
  async (req, res) => {
    const id = idParam(req.params.id, 'Report');
    await txFor(req, (c) => reports.withdrawReport(c, id, req.body.reason));
    res.json({ ok: true });
  });

// ---------------------------------------------------------------- candidates
router.get('/lost-reports/:id/candidates', candidateLimiter, async (req, res) => {
  const id = idParam(req.params.id, 'Report');
  res.json(await txFor(req, (c) => reports.getCandidates(c, id)));
});

router.get('/lost-reports/:id/candidates/:itemId', candidateLimiter, async (req, res) => {
  const id = idParam(req.params.id, 'Report');
  const itemId = idParam(req.params.itemId, 'Candidate');
  res.json(await txFor(req, (c) => reports.getCandidate(c, id, itemId)));
});

router.post('/lost-reports/:id/candidates/:itemId/dismiss', async (req, res) => {
  const id = idParam(req.params.id, 'Report');
  const itemId = idParam(req.params.itemId, 'Candidate');
  await txFor(req, (c) => reports.dismissCandidate(c, id, itemId));
  res.json({ ok: true });
});

router.post('/lost-reports/:id/none-of-these', async (req, res) => {
  const id = idParam(req.params.id, 'Report');
  const dismissed = await txFor(req, (c) => reports.noneOfThese(c, id));
  res.json({ ok: true, dismissed });
});

// Blurred candidate photo. PostgreSQL decides whether this student may see it
// (and writes the view to the audit log).
router.get('/photos/:photoId', candidateLimiter, async (req, res) => {
  const photoId = idParam(req.params.photoId, 'Photo');
  const path = await txFor(req, async (c) =>
    (await c.query('SELECT authorize_blurred_photo($1) AS p', [photoId])).rows[0].p);
  if (!path) throw new HttpError(404, 'Photo not found');
  sendUpload(res, path, 'image/jpeg');
});

// ---------------------------------------------------------------- claims
const claimSchema = z.object({
  reportId: requiredId('Report'),
  itemId: requiredId('Item'),
  answers: z.record(z.string().regex(/^\d+$/), z.string().trim().max(300, 'Answers must be at most 300 characters'))
    .default({}),
});

router.post('/claims', claimLimiter, validate(claimSchema), async (req, res) => {
  const claim = await txFor(req, (c) => claims.submitClaim(c, req.body));
  res.status(201).json({ claim });
});

router.get('/claims/mine', async (req, res) => {
  res.json({ claims: await txFor(req, claims.listMyClaims) });
});

router.get('/claims/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Claim');
  res.json({ claim: await txFor(req, (c) => claims.getMyClaim(c, id)) });
});

router.post('/claims/:id/appeal', claimLimiter,
  validate(z.object({ statement: requiredText(10, 1000, 'Appeal statement') })),
  async (req, res) => {
    const id = idParam(req.params.id, 'Claim');
    const claim = await txFor(req, (c) => claims.appealClaim(c, id, req.body.statement));
    res.status(201).json({ claim });
  });

const evidenceSchema = z.object({
  evidenceType: z.enum(['PHOTO', 'RECEIPT', 'OTHER'], { error: 'Choose an evidence type' }),
  note: optionalText(300),
});

router.post('/claims/:id/evidence', evidenceUpload.array('files', 3), validate(evidenceSchema), async (req, res) => {
  const id = idParam(req.params.id, 'Claim');
  if (!req.files?.length) throw new HttpError(422, 'Choose at least one file');

  // Write files first (validated + re-encoded), then record them atomically.
  const saved = [];
  try {
    for (const f of req.files) {
      if (f.mimetype === 'application/pdf') {
        if (!isPdf(f.buffer)) throw new HttpError(422, 'The uploaded PDF is not valid');
        const relPath = `evidence/${randomName('.pdf')}`;
        await fs.writeFile(resolveUpload(relPath), f.buffer);
        saved.push({ relPath, mime: 'application/pdf' });
      } else {
        const img = await saveNormalisedImage(f.buffer, 'evidence');
        saved.push({ relPath: img.relPath, mime: img.mime });
      }
    }
    const ids = await txFor(req, async (c) => {
      const out = [];
      for (const s of saved) {
        out.push(await claims.addEvidence(c, id, { ...s, type: req.body.evidenceType, note: req.body.note }));
      }
      return out;
    });
    res.status(201).json({ evidenceIds: ids });
  } catch (err) {
    await Promise.all(saved.map((s) => removeUpload(s.relPath)));
    throw err;
  }
});

router.get('/claims/:id/evidence/:evidenceId', async (req, res) => {
  const evidenceId = idParam(req.params.evidenceId, 'Evidence');
  const file = await txFor(req, async (c) =>
    (await c.query('SELECT * FROM authorize_own_evidence($1)', [evidenceId])).rows[0]);
  if (!file) throw new HttpError(404, 'Evidence not found');
  sendUpload(res, file.file_path, file.mime_type);
});

export default router;
