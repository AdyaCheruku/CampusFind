import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import items from './items.js';
import review from './review.js';
import system from './system.js';

/** Every /api/admin route requires an authenticated admin (checked per request). */
const router = Router();
router.use(requireAuth, requireRole('admin'));
router.use(items);
router.use(review);
router.use(system);
router.use((req, res) => res.status(404).json({ error: 'Not found' }));

export default router;
