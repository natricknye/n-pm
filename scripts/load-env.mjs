import { existsSync, readFileSync } from 'node:fs';

const envFile = new URL('../.env.local', import.meta.url);

export function loadLocalEnv() {
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}
