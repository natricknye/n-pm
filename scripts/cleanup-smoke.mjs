import { neon } from '@neondatabase/serverless';
import { loadLocalEnv } from './load-env.mjs';

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const tasks = await sql`delete from tasks where title like 'smoke task %' returning id`;
const notes = await sql`delete from notes where body_md like '%smoke note %' returning id`;
console.log(JSON.stringify({ tasks: tasks.length, notes: notes.length }));
