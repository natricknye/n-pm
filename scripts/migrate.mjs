import { existsSync, readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';

const envFile = new URL('../.env.local', import.meta.url);
if (!process.env.DATABASE_URL && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}

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
