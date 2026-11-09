import { notFound } from '../utils/httpError.js';

/**
 * Filing a report is a plain INSERT by student_app. PostgreSQL does the rest:
 * column grants (no user_id/status/locked_at), RLS (own rows only), the
 * BEFORE INSERT trigger (lock, limits, dates) and the AFTER INSERT trigger
 * (matching + notifications).
 */
export async function createReport(c, r, proofPath) {
  const { rows } = await c.query(
    `INSERT INTO lost_reports (category_id, brand, model, colour_id, description, features, serial_hint,
                               lost_location_id, lost_location_detail, lost_at, proof_photo_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING report_id, reference_code, locked_at, status`,
    [r.categoryId, r.brand ?? null, r.model ?? null, r.colourId ?? null, r.description, r.features ?? null,
     r.serialHint ?? null, r.lostLocationId ?? null, r.lostLocationDetail ?? null, r.lostAt, proofPath ?? null],
  );
  const created = rows[0];
  const { rows: cand } = await c.query(
    'SELECT count(*)::int AS n FROM v_student_candidates WHERE report_id = $1', [created.report_id]);
  return { ...created, candidate_count: cand[0].n };
}

export async function listMyReports(c) {
  return (await c.query('SELECT * FROM v_student_reports ORDER BY created_at DESC')).rows;
}

export async function getMyReport(c, id) {
  const report = (await c.query('SELECT * FROM v_student_reports WHERE report_id = $1', [id])).rows[0];
  if (!report) throw notFound('Report');
  const history = (await c.query(
    'SELECT * FROM v_student_report_history WHERE report_id = $1 ORDER BY changed_at', [id])).rows;
  return { ...report, history };
}

export async function withdrawReport(c, id, reason) {
  await c.query('SELECT withdraw_report($1, $2)', [id, reason]);
}

export async function getCandidates(c, reportId) {
  const report = (await c.query(
    'SELECT report_id, reference_code, status, category, open_claim_id, open_claim_ref, open_claim_status FROM v_student_reports WHERE report_id = $1',
    [reportId])).rows[0];
  if (!report) throw notFound('Report');
  const candidates = (await c.query(
    'SELECT * FROM v_student_candidates WHERE report_id = $1 ORDER BY rank', [reportId])).rows;
  return { report, candidates };
}

export async function getCandidate(c, reportId, itemId) {
  const cand = (await c.query(
    'SELECT * FROM v_student_candidates WHERE report_id = $1 AND item_id = $2', [reportId, itemId])).rows[0];
  if (!cand) throw notFound('Candidate');
  const questions = (await c.query(
    'SELECT * FROM get_candidate_questions($1, $2)', [reportId, itemId])).rows;
  const report = (await c.query('SELECT * FROM v_student_reports WHERE report_id = $1', [reportId])).rows[0];
  return { candidate: cand, questions, report };
}

export async function dismissCandidate(c, reportId, itemId) {
  await c.query('SELECT dismiss_candidate($1, $2)', [reportId, itemId]);
}

export async function noneOfThese(c, reportId) {
  return (await c.query('SELECT reject_all_candidates($1) AS n', [reportId])).rows[0].n;
}
