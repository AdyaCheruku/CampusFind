import { Router } from 'express';
import { z } from 'zod';
import { validate, optionalId, pagination } from '../../middleware/validate.js';
import { txFor, queryAll } from '../../db/withTx.js';
import { idParam, HttpError } from '../../utils/httpError.js';
import { Filter } from '../../utils/filters.js';
import { sendUpload } from '../../utils/sendUpload.js';

const router = Router();

router.get('/dashboard', async (req, res) => {
  const data = await txFor(req, async (c) => {
    const [stats, byCategory, claimQueue, pickups, recentItems, activity] = await queryAll(c, [
      ['SELECT * FROM v_dashboard_stats'],
      [`SELECT category, sum(items)::int AS items,
                      sum(items) FILTER (WHERE status IN ('IN_CUSTODY','CLAIM_PENDING'))::int AS in_custody
               FROM v_admin_category_stats GROUP BY category ORDER BY items DESC`],
      [`SELECT * FROM v_admin_claims WHERE status IN ('PENDING','QUEUED')
               ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, created_at LIMIT 6`],
      ['SELECT * FROM v_admin_pending_handovers ORDER BY pickup_deadline LIMIT 5'],
      [`SELECT item_id, reference_code, category, status, public_description, found_location, created_at, primary_photo_id
               FROM v_admin_inventory ORDER BY created_at DESC LIMIT 5`],
      [`SELECT * FROM v_admin_audit WHERE action NOT IN ('PHOTO_VIEW_BLURRED','LOGIN')
               ORDER BY at DESC LIMIT 8`],
    ]);
    return {
      stats: stats.rows[0], byCategory: byCategory.rows, claimQueue: claimQueue.rows,
      pickups: pickups.rows, recentItems: recentItems.rows, activity: activity.rows,
    };
  });
  res.json(data);
});

// ---------------------------------------------------------------- photos
// Admin list thumbnails use the blurred copy; viewing an ORIGINAL is audited.
router.get('/photos/:photoId/:variant', async (req, res) => {
  const id = idParam(req.params.photoId, 'Photo');
  const variant = req.params.variant;
  if (!['original', 'thumb'].includes(variant)) throw new HttpError(404, 'Not found');
  const photo = await txFor(req, async (c) => {
    const p = (await c.query('SELECT original_path, blurred_path, mime_type FROM item_photos WHERE photo_id = $1', [id])).rows[0];
    if (p && variant === 'original') {
      await c.query(`SELECT log_audit('PHOTO_VIEW_ORIGINAL', 'item_photos', $1)`, [id]);
    }
    return p;
  });
  if (!photo) throw new HttpError(404, 'Photo not found');
  sendUpload(res, variant === 'original' ? photo.original_path : photo.blurred_path, 'image/jpeg');
});

// ---------------------------------------------------------------- audit log
const auditQuery = pagination.extend({
  action: z.string().optional(),
  actorId: optionalId,
  table: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

router.get('/audit-log', validate(auditQuery, 'query'), async (req, res) => {
  const p = req.validQuery;
  const f = new Filter()
    .add('action = ANY($)', p.action ? p.action.split(',') : null)
    .add('actor_id = $', p.actorId)
    .add('target_table = $', p.table)
    .add('at >= $::date', p.from)
    .add("at < ($::date + interval '1 day')", p.to);
  const data = await txFor(req, async (c) => {
    const total = (await c.query(`SELECT count(*)::int AS n FROM v_admin_audit ${f.where()}`, f.params)).rows[0].n;
    const rows = (await c.query(
      `SELECT * FROM v_admin_audit ${f.where()} ORDER BY at DESC LIMIT ${f.param(p.limit)} OFFSET ${f.param(p.offset)}`,
      f.params)).rows;
    return { entries: rows, total };
  });
  res.json(data);
});

// ---------------------------------------------------------------- users
router.get('/users', validate(pagination.extend({ q: z.string().trim().max(100).optional() }), 'query'), async (req, res) => {
  const p = req.validQuery;
  const f = new Filter().add(`(full_name ILIKE '%' || $ || '%' OR email ILIKE '%' || $ || '%' OR roll_no ILIKE '%' || $ || '%')`, p.q);
  const rows = await txFor(req, async (c) =>
    (await c.query(`SELECT * FROM v_admin_students ${f.where()} ORDER BY full_name
                    LIMIT ${f.param(p.limit)} OFFSET ${f.param(p.offset)}`, f.params)).rows);
  res.json({ users: rows });
});

router.patch('/users/:id', validate(z.object({ isActive: z.boolean() })), async (req, res) => {
  const id = idParam(req.params.id, 'User');
  await txFor(req, (c) => c.query('SELECT set_user_active($1, $2, $3)', [id, req.user.id, req.body.isActive]));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- config & maintenance
router.get('/config', async (req, res) => {
  const rows = await txFor(req, async (c) =>
    (await c.query('SELECT key, value, description, updated_at FROM app_config ORDER BY key')).rows);
  res.json({ config: rows });
});

router.patch('/config/:key', validate(z.object({ value: z.union([z.number(), z.string()]) })), async (req, res) => {
  const key = String(req.params.key);
  if (!/^[a-z_]+$/.test(key)) throw new HttpError(404, 'Unknown setting');
  await txFor(req, (c) => c.query('SELECT update_config($1, $2, $3)', [key, JSON.stringify(req.body.value), req.user.id]));
  res.json({ ok: true });
});

// Several settings in ONE transaction (needed for match weights, whose sum is
// checked by a deferred constraint trigger at COMMIT).
router.patch('/config', validate(z.object({
  values: z.record(z.string().regex(/^[a-z_]+$/), z.union([z.number(), z.string()])),
})), async (req, res) => {
  const entries = Object.entries(req.body.values);
  if (!entries.length) throw new HttpError(422, 'No settings to update');
  await txFor(req, async (c) => {
    for (const [key, value] of entries) {
      await c.query('SELECT update_config($1, $2, $3)', [key, JSON.stringify(value), req.user.id]);
    }
  });
  res.json({ ok: true, updated: entries.length });
});

router.post('/maintenance/archive', async (req, res) => {
  const result = await txFor(req, async (c) =>
    (await c.query('SELECT archive_stale_records($1) AS r', [req.user.id])).rows[0].r);
  res.json(result);
});

router.post('/maintenance/rematch', async (req, res) => {
  const reports = await txFor(req, async (c) =>
    (await c.query('SELECT admin_rematch_all($1) AS n', [req.user.id])).rows[0].n);
  res.json({ reports });
});

export default router;
