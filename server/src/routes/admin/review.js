import { Router } from 'express';
import { z } from 'zod';
import { validate, requiredText, optionalText, optionalId, dateTime, pagination } from '../../middleware/validate.js';
import { txFor, queryAll } from '../../db/withTx.js';
import { idParam, HttpError } from '../../utils/httpError.js';
import { Filter } from '../../utils/filters.js';
import { sendUpload } from '../../utils/sendUpload.js';

const router = Router();

// ================================================================ lost reports
const reportsQuery = pagination.extend({
  status: z.string().optional(),
  categoryId: optionalId,
  locationId: optionalId,
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().trim().max(100).optional(),
});

router.get('/lost-reports', validate(reportsQuery, 'query'), async (req, res) => {
  const p = req.validQuery;
  const f = new Filter()
    .add('status = ANY($)', p.status ? p.status.split(',') : null)
    .add('category_id = $', p.categoryId)
    .add('lost_location_id = $', p.locationId)
    .add('lost_at >= $::date', p.from)
    .add("lost_at < ($::date + interval '1 day')", p.to)
    .add(`(reference_code ILIKE '%' || $ || '%' OR student_name ILIKE '%' || $ || '%'
           OR description ILIKE '%' || $ || '%' OR brand ILIKE '%' || $ || '%')`, p.q);
  const data = await txFor(req, async (c) => {
    const total = (await c.query(`SELECT count(*)::int AS n FROM v_admin_lost_reports ${f.where()}`, f.params)).rows[0].n;
    const rows = (await c.query(
      `SELECT * FROM v_admin_lost_reports ${f.where()} ORDER BY created_at DESC LIMIT ${f.param(p.limit)} OFFSET ${f.param(p.offset)}`,
      f.params)).rows;
    return { reports: rows, total };
  });
  res.json(data);
});

router.get('/lost-reports/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Report');
  const data = await txFor(req, async (c) => {
    const report = (await c.query('SELECT * FROM v_admin_lost_reports WHERE report_id = $1', [id])).rows[0];
    if (!report) throw new HttpError(404, 'Report not found');
    const [matches, claims, history] = await queryAll(c, [
      ['SELECT * FROM v_admin_matches WHERE report_id = $1 ORDER BY score DESC', [id]],
      ['SELECT * FROM v_admin_claims WHERE report_id = $1 ORDER BY created_at', [id]],
      ['SELECT * FROM v_admin_report_history WHERE report_id = $1 ORDER BY changed_at', [id]],
    ]);
    return { ...report, matches: matches.rows, claims: claims.rows, history: history.rows };
  });
  res.json({ report: data });
});

router.post('/lost-reports/:id/close', validate(z.object({ reason: requiredText(3, 300, 'Reason') })), async (req, res) => {
  const id = idParam(req.params.id, 'Report');
  await txFor(req, (c) => c.query('SELECT close_report($1, $2, $3)', [id, req.user.id, req.body.reason]));
  res.json({ ok: true });
});

router.get('/lost-reports/:id/proof', async (req, res) => {
  const id = idParam(req.params.id, 'Report');
  const path = await txFor(req, async (c) => {
    const p = (await c.query('SELECT proof_photo_path FROM lost_reports WHERE report_id = $1', [id])).rows[0]?.proof_photo_path;
    if (p) await c.query(`SELECT log_audit('EVIDENCE_VIEW', 'lost_reports', $1)`, [id]);
    return p;
  });
  if (!path) throw new HttpError(404, 'No proof photo for this report');
  sendUpload(res, path, 'image/jpeg');
});

// ================================================================ matches
const matchesQuery = pagination.extend({
  visibility: z.enum(['all', 'visible', 'above', 'below']).default('all'),
  reportId: optionalId,
  itemId: optionalId,
  q: z.string().trim().max(100).optional(),
});

router.get('/matches', validate(matchesQuery, 'query'), async (req, res) => {
  const p = req.validQuery;
  const f = new Filter()
    .add('report_id = $', p.reportId)
    .add('item_id = $', p.itemId)
    .add(`(report_ref ILIKE '%' || $ || '%' OR item_ref ILIKE '%' || $ || '%' OR student_name ILIKE '%' || $ || '%')`, p.q);
  if (p.visibility === 'visible') f.parts.push('visible_to_student');
  if (p.visibility === 'above') f.parts.push('above_threshold');
  if (p.visibility === 'below') f.parts.push('NOT above_threshold');
  const data = await txFor(req, async (c) => {
    const total = (await c.query(`SELECT count(*)::int AS n FROM v_admin_matches ${f.where()}`, f.params)).rows[0].n;
    const rows = (await c.query(
      `SELECT * FROM v_admin_matches ${f.where()} ORDER BY score DESC, computed_at DESC
       LIMIT ${f.param(p.limit)} OFFSET ${f.param(p.offset)}`, f.params)).rows;
    const threshold = (await c.query(`SELECT cfg_num('candidate_threshold') AS t`)).rows[0].t;
    return { matches: rows, total, threshold };
  });
  res.json(data);
});

// ================================================================ claims
const claimsQuery = pagination.extend({ status: z.string().optional(), q: z.string().trim().max(100).optional() });

router.get('/claims', validate(claimsQuery, 'query'), async (req, res) => {
  const p = req.validQuery;
  const f = new Filter()
    .add('status = ANY($)', p.status ? p.status.split(',') : null)
    .add(`(reference_code ILIKE '%' || $ || '%' OR item_ref ILIKE '%' || $ || '%' OR student_name ILIKE '%' || $ || '%')`, p.q);
  const data = await txFor(req, async (c) => {
    const total = (await c.query(`SELECT count(*)::int AS n FROM v_admin_claims ${f.where()}`, f.params)).rows[0].n;
    const rows = (await c.query(
      `SELECT * FROM v_admin_claims ${f.where()}
       ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'QUEUED' THEN 1 WHEN 'APPROVED' THEN 2 ELSE 3 END, created_at
       LIMIT ${f.param(p.limit)} OFFSET ${f.param(p.offset)}`, f.params)).rows;
    return { claims: rows, total };
  });
  res.json(data);
});

// Side-by-side review. Reading private details is audited.
router.get('/claims/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Claim');
  const data = await txFor(req, async (c) => {
    const review = (await c.query('SELECT * FROM v_admin_claim_review WHERE claim_id = $1', [id])).rows[0];
    if (!review) throw new HttpError(404, 'Claim not found');
    const verification = (await c.query('SELECT compute_verification_indicator($1) AS v', [id])).rows[0].v;
    const history = (await c.query('SELECT * FROM v_admin_claim_history WHERE claim_id = $1 ORDER BY changed_at', [id])).rows;
    await c.query(`SELECT log_audit('PRIVATE_VIEW', 'ownership_claims', $1)`, [id]);
    return { ...review, verification, history };
  });
  res.json({ claim: data });
});

const approveSchema = z.object({
  reason: requiredText(5, 1000, 'Decision reason'),
  pickupInstructions: requiredText(5, 500, 'Pickup instructions'),
  pickupDeadline: dateTime('Pickup deadline'),
});

router.post('/claims/:id/approve', validate(approveSchema), async (req, res) => {
  const id = idParam(req.params.id, 'Claim');
  const b = req.body;
  // approve_claim is one atomic PostgreSQL transaction (row locks, statuses,
  // notifications, history, audit). Express only passes the session admin id.
  await txFor(req, (c) => c.query('SELECT approve_claim($1, $2, $3, $4, $5)',
    [id, req.user.id, b.reason, b.pickupInstructions, b.pickupDeadline]));
  res.json({ ok: true });
});

router.post('/claims/:id/reject', validate(z.object({ reason: requiredText(5, 1000, 'Rejection reason') })), async (req, res) => {
  const id = idParam(req.params.id, 'Claim');
  await txFor(req, (c) => c.query('SELECT reject_claim($1, $2, $3)', [id, req.user.id, req.body.reason]));
  res.json({ ok: true });
});

router.get('/evidence/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Evidence');
  const file = await txFor(req, async (c) => {
    const e = (await c.query('SELECT file_path, mime_type FROM claim_evidence WHERE evidence_id = $1', [id])).rows[0];
    if (e) await c.query(`SELECT log_audit('EVIDENCE_VIEW', 'claim_evidence', $1)`, [id]);
    return e;
  });
  if (!file) throw new HttpError(404, 'Evidence not found');
  sendUpload(res, file.file_path, file.mime_type);
});

// ================================================================ handovers
router.get('/handovers/pending', async (req, res) => {
  const rows = await txFor(req, async (c) =>
    (await c.query('SELECT * FROM v_admin_pending_handovers ORDER BY pickup_deadline')).rows);
  res.json({ pending: rows });
});

router.get('/handovers', validate(pagination, 'query'), async (req, res) => {
  const { limit, offset } = req.validQuery;
  const rows = await txFor(req, async (c) =>
    (await c.query('SELECT * FROM v_admin_handovers ORDER BY handed_at DESC LIMIT $1 OFFSET $2', [limit, offset])).rows);
  res.json({ handovers: rows });
});

const handoverSchema = z.object({
  idDocument: requiredText(2, 80, 'ID document checked'),
  idVerified: z.literal(true, { error: "You must confirm the claimant's identity was verified" }),
  notes: optionalText(1000),
});

router.post('/handover/:claimId', validate(handoverSchema), async (req, res) => {
  const id = idParam(req.params.claimId, 'Claim');
  const handoverId = await txFor(req, async (c) =>
    (await c.query('SELECT record_handover($1, $2, $3, $4, $5) AS id',
      [id, req.user.id, req.body.idDocument, req.body.idVerified, req.body.notes ?? null])).rows[0].id);
  res.status(201).json({ handoverId });
});

export default router;
