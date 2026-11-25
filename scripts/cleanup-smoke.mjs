import { loadLocalEnv } from './load-env.mjs';
import { query } from '../server/db.js';

loadLocalEnv();

const tasks = await query("delete from tasks where title like 'smoke task %' returning id");
const notes = await query("delete from notes where body_md like '%smoke note %' returning id");
console.log(JSON.stringify({ tasks: tasks.length, notes: notes.length }));
process.exit(0);
