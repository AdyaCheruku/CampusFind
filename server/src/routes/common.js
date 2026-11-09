import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { txFor, queryAll } from '../db/withTx.js';
import { idParam } from '../utils/httpError.js';

/** Routes available to any authenticated user (student or admin). */
const router = Router();

router.get('/lookups', requireAuth, async (req, res) => {
  const data = await txFor(req, async (c) => {
    const [categories, colours, locations] = await queryAll(c, [
      ['SELECT category_id AS id, name, category_group AS "group" FROM categories WHERE is_active ORDER BY category_group, name'],
      ['SELECT colour_id AS id, name, colour_family AS family, hex FROM colours ORDER BY name'],
      ['SELECT location_id AS id, name, building, zone FROM locations WHERE is_active ORDER BY zone, name'],
    ]);
    return { categories: categories.rows, colours: colours.rows, locations: locations.rows };
  });
  res.json(data);
});

// Notifications: RLS restricts both roles to their own rows.
router.get('/notifications', requireAuth,
  validate(z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), 'query'),
  async (req, res) => {
    const { unread, limit } = req.validQuery;
    const data = await txFor(req, async (c) => {
      const items = (await c.query(
        `SELECT notif_id, type, title, message, report_id, claim_id, is_read, created_at
         FROM notifications ${unread === 'true' ? 'WHERE NOT is_read' : ''}
         ORDER BY created_at DESC LIMIT $1`, [limit])).rows;
      const unreadCount = (await c.query('SELECT count(*)::int AS n FROM notifications WHERE NOT is_read')).rows[0].n;
      return { notifications: items, unreadCount };
    });
    res.json(data);
  });

router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  const id = idParam(req.params.id, 'Notification');
  await txFor(req, (c) =>
    c.query('UPDATE notifications SET is_read = true, read_at = now() WHERE notif_id = $1 AND NOT is_read', [id]));
  res.json({ ok: true });
});

router.post('/notifications/read-all', requireAuth, async (req, res) => {
  await txFor(req, (c) => c.query('UPDATE notifications SET is_read = true, read_at = now() WHERE NOT is_read'));
  res.json({ ok: true });
});

export default router;
