import { Router } from 'express';
import { z } from 'zod';
import { validate, requiredText, optionalText, requiredId, optionalId, dateTime, pagination } from '../../middleware/validate.js';
import { imageUpload } from '../../middleware/upload.js';
import { txFor } from '../../db/withTx.js';
import { idParam, HttpError } from '../../utils/httpError.js';
import { Filter } from '../../utils/filters.js';
import { removeUpload } from '../../services/imageService.js';
import * as items from '../../services/itemService.js';

const router = Router();

// ---------------------------------------------------------------- schemas
const itemFields = z.object({
  categoryId: requiredId('Category'),
  brand: optionalText(60),
  model: optionalText(80),
  colourId: requiredId('Colour'),
  sizeDesc: optionalText(60),
  contents: optionalText(500),
  visibleMarks: optionalText(500),
  publicDescription: requiredText(10, 500, 'Public description'),
  foundLocationId: requiredId('Found location'),
  foundLocationDetail: optionalText(120),
  foundAt: dateTime('Found date and time'),
  storageLocation: requiredText(1, 80, 'Storage location'),
});
const privateFields = z.object({
  serialNo: optionalText(80),
  hiddenMarks: optionalText(500),
  privateNotes: optionalText(1000),
});
const finderFields = z.object({
  finderName: requiredText(2, 100, 'Finder name'),
  finderContact: optionalText(100),
  finderRollNo: optionalText(30),
  foundWhere: requiredText(2, 200, 'Where it was found'),
  foundWhen: z.preprocess((v) => (v === '' || v === null ? undefined : v), dateTime('Found time').optional()),
  circumstances: optionalText(1000),
});
const questionFields = z.object({
  questionText: requiredText(5, 200, 'Question'),
  expectedAnswer: requiredText(1, 200, 'Expected answer'),
});
const intakeSchema = z.object({
  item: itemFields,
  private: privateFields.default({}),
  finder: finderFields,
  questions: z.array(questionFields).max(5, 'At most 5 verification questions').default([]),
  publish: z.boolean().default(false),
  primaryIndex: z.number().int().min(0).default(0),
});

/** Multipart forms send structured data as a JSON string in the "data" field. */
const parseJsonField = (req, res, next) => {
  try {
    req.body = req.body?.data ? JSON.parse(req.body.data) : {};
    next();
  } catch {
    next(new HttpError(400, 'Malformed form data'));
  }
};

// ---------------------------------------------------------------- list / detail
const listQuery = pagination.extend({
  status: z.string().optional(),
  categoryId: optionalId,
  locationId: optionalId,
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().trim().max(100).optional(),
});

router.get('/found-items', validate(listQuery, 'query'), async (req, res) => {
  const p = req.validQuery;
  const f = new Filter()
    .add('status = ANY($)', p.status ? p.status.split(',') : null)
    .add('category_id = $', p.categoryId)
    .add('found_location_id = $', p.locationId)
    .add('found_at >= $::date', p.from)
    .add("found_at < ($::date + interval '1 day')", p.to)
    .add(`(reference_code ILIKE '%' || $ || '%' OR brand ILIKE '%' || $ || '%' OR model ILIKE '%' || $ || '%'
           OR public_description ILIKE '%' || $ || '%' OR storage_location ILIKE '%' || $ || '%')`, p.q);
  const data = await txFor(req, async (c) => {
    const total = (await c.query(`SELECT count(*)::int AS n FROM v_admin_inventory ${f.where()}`, f.params)).rows[0].n;
    const rows = (await c.query(
      `SELECT * FROM v_admin_inventory ${f.where()} ORDER BY created_at DESC LIMIT ${f.param(p.limit)} OFFSET ${f.param(p.offset)}`,
      f.params)).rows;
    return { items: rows, total };
  });
  res.json(data);
});

router.get('/found-items/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  res.json({ item: await txFor(req, (c) => items.getItemDetail(c, id)) });
});

// ---------------------------------------------------------------- intake
router.post('/found-items', imageUpload.array('photos', 6), parseJsonField, validate(intakeSchema), async (req, res) => {
  if (req.body.publish && !req.files?.length) {
    throw new HttpError(422, 'Add at least one photo before publishing');
  }
  const stored = await items.storePhotos(req.files);
  try {
    const result = await txFor(req, (c) => items.createItem(c, req.user.id, req.body, stored));
    res.status(201).json(result);
  } catch (err) {
    await items.discardPhotos(stored);
    throw err;
  }
});

router.put('/found-items/:id', validate(itemFields), async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  await txFor(req, (c) => items.updateItem(c, id, req.body));
  res.json({ ok: true });
});

router.put('/found-items/:id/private', validate(privateFields), async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  await txFor(req, (c) => items.upsertPrivate(c, id, req.body));
  res.json({ ok: true });
});

router.post('/found-items/:id/finder-statements', validate(finderFields), async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  await txFor(req, (c) => items.insertFinderStatement(c, id, req.body));
  res.status(201).json({ ok: true });
});

router.post('/found-items/:id/questions', validate(questionFields), async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  const questionId = await txFor(req, (c) => items.insertQuestion(c, id, req.body));
  res.status(201).json({ questionId });
});

router.delete('/questions/:questionId', async (req, res) => {
  const qid = idParam(req.params.questionId, 'Question');
  const n = await txFor(req, async (c) =>
    (await c.query('DELETE FROM verification_questions WHERE question_id = $1', [qid])).rowCount);
  if (!n) throw new HttpError(404, 'Question not found');
  res.json({ ok: true });
});

router.post('/found-items/:id/photos', imageUpload.array('photos', 6), async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  if (!req.files?.length) throw new HttpError(422, 'Choose at least one photo');
  const stored = await items.storePhotos(req.files);
  try {
    await txFor(req, async (c) => {
      const exists = (await c.query('SELECT status FROM found_items WHERE item_id = $1', [id])).rows[0];
      if (!exists) throw new HttpError(404, 'Item not found');
      if (exists.status === 'RETURNED') throw new HttpError(409, 'Item has already been returned');
      const count = (await c.query('SELECT count(*)::int AS n FROM item_photos WHERE item_id = $1', [id])).rows[0].n;
      if (count + stored.length > 8) throw new HttpError(422, 'An item can have at most 8 photos');
      await items.insertPhotos(c, id, stored, 0);
    });
    res.status(201).json({ ok: true, added: stored.length });
  } catch (err) {
    await items.discardPhotos(stored);
    throw err;
  }
});

router.delete('/photos/:photoId', async (req, res) => {
  const pid = idParam(req.params.photoId, 'Photo');
  const photo = await txFor(req, async (c) => {
    const p = (await c.query('DELETE FROM item_photos WHERE photo_id = $1 RETURNING original_path, blurred_path, item_id, is_primary', [pid])).rows[0];
    if (!p) throw new HttpError(404, 'Photo not found');
    if (p.is_primary) {
      await c.query(`UPDATE item_photos SET is_primary = true
                     WHERE photo_id = (SELECT min(photo_id) FROM item_photos WHERE item_id = $1)`, [p.item_id]);
    }
    return p;
  });
  await removeUpload(photo.original_path);
  await removeUpload(photo.blurred_path);
  res.json({ ok: true });
});

router.post('/photos/:photoId/primary', async (req, res) => {
  const pid = idParam(req.params.photoId, 'Photo');
  await txFor(req, async (c) => {
    const p = (await c.query('SELECT item_id FROM item_photos WHERE photo_id = $1', [pid])).rows[0];
    if (!p) throw new HttpError(404, 'Photo not found');
    await c.query('UPDATE item_photos SET is_primary = false WHERE item_id = $1 AND is_primary', [p.item_id]);
    await c.query('UPDATE item_photos SET is_primary = true WHERE photo_id = $1', [pid]);
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- lifecycle
router.post('/found-items/:id/publish', async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  const candidates = await txFor(req, async (c) =>
    (await c.query('SELECT publish_found_item($1, $2) AS n', [id, req.user.id])).rows[0].n);
  res.json({ ok: true, candidates });
});

router.post('/found-items/:id/archive', validate(z.object({ reason: optionalText(300) })), async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  await txFor(req, (c) => c.query('SELECT archive_item($1, $2, $3)', [id, req.user.id, req.body.reason ?? null]));
  res.json({ ok: true });
});

router.post('/found-items/:id/restore', async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  await txFor(req, (c) => c.query('SELECT restore_item($1, $2)', [id, req.user.id]));
  res.json({ ok: true });
});

router.delete('/found-items/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Item');
  const files = await txFor(req, async (c) =>
    (await c.query('SELECT * FROM delete_draft_item($1, $2)', [id, req.user.id])).rows);
  for (const f of files) {
    await removeUpload(f.original_path);
    await removeUpload(f.blurred_path);
  }
  res.json({ ok: true });
});

export default router;
