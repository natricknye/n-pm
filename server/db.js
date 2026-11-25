import { Pool } from '@neondatabase/serverless';

let pool;

export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('database_not_configured');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }
  return pool;
}

export async function query(text, params = []) {
  const result = await getPool().query(text, params);
  return result.rows;
}

export async function execute(text, params = []) {
  return getPool().query(text, params);
}
