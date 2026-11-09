import { saveNormalisedImage, saveBlurredCopy, removeUpload } from './imageService.js';
import { notFound } from '../utils/httpError.js';
import { queryAll } from '../db/withTx.js';

/** Save uploaded photos to disk (original + blurred copy). */
export async function storePhotos(files = []) {
  const stored = [];
  try {
    for (const f of files) {
      const orig = await saveNormalisedImage(f.buffer, 'originals');
      const blurred = await saveBlurredCopy(orig.relPath);
      stored.push({ original: orig.relPath, blurred, size: orig.size, mime: orig.mime });
    }
    return stored;
  } catch (err) {
    await discardPhotos(stored);
    throw err;
  }
}

export async function discardPhotos(stored = []) {
  await Promise.all(stored.flatMap((p) => [removeUpload(p.original), removeUpload(p.blurred)]));
}

export async function insertPhotos(c, itemId, stored, primaryIndex = 0) {
  const hasPrimary = (await c.query('SELECT 1 FROM item_photos WHERE item_id = $1 AND is_primary', [itemId])).rowCount > 0;
  for (const [i, p] of stored.entries()) {
    await c.query(
      `INSERT INTO item_photos (item_id, original_path, blurred_path, mime_type, size_bytes, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [itemId, p.original, p.blurred, p.mime, p.size, !hasPrimary && i === primaryIndex]);
  }
}

const itemColumns = (it) => [
  it.categoryId, it.brand ?? null, it.model ?? null, it.colourId, it.sizeDesc ?? null, it.contents ?? null,
  it.visibleMarks ?? null, it.publicDescription, it.foundLocationId, it.foundLocationDetail ?? null,
  it.foundAt, it.storageLocation,
];

export async function upsertPrivate(c, itemId, p = {}) {
  if (!p.serialNo && !p.hiddenMarks && !p.privateNotes) {
    const exists = (await c.query('SELECT 1 FROM found_item_private WHERE item_id = $1', [itemId])).rowCount;
    if (!exists) return;
  }
  await c.query(
    `INSERT INTO found_item_private (item_id, serial_no, hidden_marks, private_notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id) DO UPDATE
       SET serial_no = EXCLUDED.serial_no, hidden_marks = EXCLUDED.hidden_marks, private_notes = EXCLUDED.private_notes`,
    [itemId, p.serialNo ?? null, p.hiddenMarks ?? null, p.privateNotes ?? null]);
}

export async function insertFinderStatement(c, itemId, f) {
  await c.query(
    `INSERT INTO finder_statements (item_id, finder_name, finder_contact, finder_roll_no, found_where, found_when, circumstances)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [itemId, f.finderName, f.finderContact ?? null, f.finderRollNo ?? null, f.foundWhere, f.foundWhen ?? null, f.circumstances ?? null]);
}

export async function insertQuestion(c, itemId, q) {
  return (await c.query(
    'INSERT INTO verification_questions (item_id, question_text, expected_answer) VALUES ($1, $2, $3) RETURNING question_id',
    [itemId, q.questionText, q.expectedAnswer])).rows[0].question_id;
}

/**
 * Full intake in ONE transaction: item (DRAFT) + private details + finder
 * statement + photos + verification questions [+ publish].
 */
export async function createItem(c, adminId, data, stored) {
  const item = (await c.query(
    `INSERT INTO found_items (category_id, brand, model, colour_id, size_desc, contents, visible_marks,
                              public_description, found_location_id, found_location_detail, found_at, storage_location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING item_id, reference_code`, itemColumns(data.item))).rows[0];

  await upsertPrivate(c, item.item_id, data.private);
  await insertFinderStatement(c, item.item_id, data.finder);
  await insertPhotos(c, item.item_id, stored, data.primaryIndex);
  for (const q of data.questions) await insertQuestion(c, item.item_id, q);
  await c.query(`SELECT log_audit('ITEM_CREATE', 'found_items', $1, $2)`,
    [item.item_id, JSON.stringify({ reference: item.reference_code, publish: data.publish })]);

  let candidates = null;
  if (data.publish) {
    candidates = (await c.query('SELECT publish_found_item($1, $2) AS n', [item.item_id, adminId])).rows[0].n;
  }
  const status = (await c.query('SELECT status FROM found_items WHERE item_id = $1', [item.item_id])).rows[0].status;
  return { itemId: item.item_id, reference: item.reference_code, status, candidates };
}

export async function updateItem(c, itemId, it) {
  const { rowCount } = await c.query(
    `UPDATE found_items SET category_id = $2, brand = $3, model = $4, colour_id = $5, size_desc = $6, contents = $7,
            visible_marks = $8, public_description = $9, found_location_id = $10, found_location_detail = $11,
            found_at = $12, storage_location = $13
     WHERE item_id = $1 AND status <> 'RETURNED'`, [itemId, ...itemColumns(it)]);
  if (!rowCount) throw notFound('Editable item');
  await c.query(`SELECT log_audit('ITEM_UPDATE', 'found_items', $1)`, [itemId]);
}

export async function getItemDetail(c, itemId) {
  const item = (await c.query('SELECT * FROM v_admin_inventory WHERE item_id = $1', [itemId])).rows[0];
  if (!item) throw notFound('Item');
  const results = await queryAll(c, [
    'SELECT serial_no, hidden_marks, private_notes, updated_at FROM found_item_private WHERE item_id = $1',
    'SELECT * FROM finder_statements WHERE item_id = $1 ORDER BY statement_id',
    'SELECT photo_id, is_primary, mime_type, size_bytes, uploaded_at FROM item_photos WHERE item_id = $1 ORDER BY is_primary DESC, photo_id',
    'SELECT question_id, question_text, expected_answer, created_at FROM verification_questions WHERE item_id = $1 ORDER BY question_id',
    'SELECT * FROM v_admin_matches WHERE item_id = $1 ORDER BY score DESC',
    'SELECT * FROM v_admin_claims WHERE item_id = $1 ORDER BY created_at',
    'SELECT * FROM v_admin_item_history WHERE item_id = $1 ORDER BY changed_at',
  ].map((sql) => [sql, [itemId]]));
  const [priv, finders, photos, questions, matches, claims, history] = results.map((r) => r.rows);
  if (priv.length) {
    await c.query(`SELECT log_audit('PRIVATE_VIEW', 'found_items', $1)`, [itemId]);
  }
  return { ...item, private: priv[0] || null, finderStatements: finders, photos, questions, matches, claims, history };
}
