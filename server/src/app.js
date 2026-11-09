import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { PROJECT_ROOT } from './config/paths.js';
import authRoutes from './routes/auth.js';
import commonRoutes from './routes/common.js';
import studentRoutes from './routes/student.js';
import adminRoutes from './routes/admin/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'blob:'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
      },
    },
  }));
  // The Vite dev server proxies /api, so the browser sees one origin. CORS is
  // limited to the configured client origin for direct calls.
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Order matters: admin routes are matched before the student router, whose
  // guard rejects any non-student.
  app.use('/api', authRoutes);
  app.use('/api', commonRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', studentRoutes);
  app.use('/api', notFoundHandler);

  // Production: serve the built React app (uploads are NEVER served statically).
  const dist = path.join(PROJECT_ROOT, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get(/^(?!\/(api|uploads)(\/|$)).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
