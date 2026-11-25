import { loadLocalEnv } from './load-env.mjs';
import { syncGithub } from '../server/github.js';

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Add it to .env.local or your shell.');
  process.exit(1);
}

try {
  const result = await syncGithub('cli');
  console.log(JSON.stringify(result, null, 2));
  if (result.errors?.length) process.exitCode = 1;
} catch (error) {
  console.error('Sync failed:', error.message);
  process.exitCode = 1;
}
