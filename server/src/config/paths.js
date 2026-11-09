import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(here, '../..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');
export const DATABASE_DIR = path.join(PROJECT_ROOT, 'database');

dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });

export const UPLOAD_ROOT = path.resolve(SERVER_ROOT, process.env.UPLOAD_DIR || 'uploads');
