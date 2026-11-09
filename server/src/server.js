import { env } from './config/env.js';
import { createApp } from './app.js';
import { studentPool, closePools } from './config/db.js';
import { ensureUploadDirs } from './services/imageService.js';

await ensureUploadDirs();

try {
  await studentPool.query('SELECT 1');
} catch (err) {
  console.error(`Cannot connect to PostgreSQL as student_app: ${err.message}`);
  console.error('Run "npm run db:setup" first and check server/.env.');
  process.exit(1);
}

const server = createApp().listen(env.port, () => {
  console.log(`CampusFind API listening on http://localhost:${env.port}`);
});

const shutdown = async () => {
  server.close();
  await closePools();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
