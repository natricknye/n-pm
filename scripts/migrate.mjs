import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { loadLocalEnv } from './load-env.mjs';

loadLocalEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required. Add it to .env.local or your shell.');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 2 });
try {
  const schema = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  console.log('Schema migrated.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
