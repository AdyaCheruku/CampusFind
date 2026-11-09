import { queryAll } from '../db/withTx.js';
import { notFound } from '../utils/httpError.js';

export async function submitClaim(c, { reportId, itemId, answers }) {
  const claimId = (await c.query('SELECT submit_claim($1, $2, $3) AS id',
    [reportId, itemId, JSON.stringify(answers || {})])).rows[0].id;
  return (await c.query('SELECT claim_id, reference_code, status FROM v_student_claims WHERE claim_id = $1', [claimId])).rows[0];
}

export async function listMyClaims(c) {
  return (await c.query('SELECT * FROM v_student_claims ORDER BY created_at DESC')).rows;
}

export async function getMyClaim(c, id) {
  const claim = (await c.query('SELECT * FROM v_student_claims WHERE claim_id = $1', [id])).rows[0];
  if (!claim) throw notFound('Claim');
  const [responses, evidence, history, report] = await queryAll(c, [
    ['SELECT question_id, question_text, answer_text FROM v_student_claim_responses WHERE claim_id = $1 ORDER BY question_id', [id]],
    ['SELECT * FROM v_student_claim_evidence WHERE claim_id = $1 ORDER BY evidence_id', [id]],
    ['SELECT * FROM v_student_claim_history WHERE claim_id = $1 ORDER BY changed_at', [id]],
    ['SELECT * FROM v_student_reports WHERE report_id = $1', [claim.report_id]],
  ]);
  return {
    ...claim,
    responses: responses.rows,
    evidence: evidence.rows,
    history: history.rows,
    report: report.rows[0],
  };
}

export async function addEvidence(c, claimId, file) {
  return (await c.query('SELECT add_claim_evidence($1, $2, $3, $4, $5) AS id',
    [claimId, file.relPath, file.mime, file.type, file.note ?? null])).rows[0].id;
}

export async function appealClaim(c, claimId, statement) {
  const id = (await c.query('SELECT appeal_claim($1, $2) AS id', [claimId, statement])).rows[0].id;
  return (await c.query('SELECT claim_id, reference_code, status FROM v_student_claims WHERE claim_id = $1', [id])).rows[0];
}
