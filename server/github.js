import { createHmac, timingSafeEqual } from 'node:crypto';
import { execute, query } from './db.js';

const API = 'https://api.github.com';
const MAX_REPOS = 80;
const ACTIVE_DAYS = 90;

function githubHeaders(accept = 'application/vnd.github+json') {
  const headers = {
    accept,
    'user-agent': 'nate-pm',
    'x-github-api-version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function gh(path, { accept = 'application/vnd.github+json', raw = false } = {}) {
  const response = await fetch(`${API}${path}`, { headers: githubHeaders(accept) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    const error = new Error(`github_${response.status}`);
    error.status = response.status;
    error.body = body;
    error.remaining = response.headers.get('x-ratelimit-remaining');
    throw error;
  }
  return raw ? response.text() : response.json();
}

function repoRelation(repo) {
  const owner = String(repo.owner?.login || repo.full_name?.split('/')[0] || '').toLowerCase();
  const username = String(process.env.GITHUB_USERNAME || 'natricknye').toLowerCase();
  if (repo.fork) return 'contribute';
  return owner === username ? 'ownership' : 'contribute';
}

export function mapRepo(repo) {
  const pushed = repo.pushed_at ? new Date(repo.pushed_at) : null;
  const active = pushed ? Date.now() - pushed.getTime() < ACTIVE_DAYS * 24 * 60 * 60 * 1000 : false;
  return {
    github_id: repo.id,
    full_name: repo.full_name,
    owner_login: repo.owner?.login || String(repo.full_name || '').split('/')[0] || '',
    name: repo.name || repo.full_name,
    description: repo.description || '',
    html_url: repo.html_url || '',
    homepage: repo.homepage || '',
    language: repo.language || '',
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    open_issues: repo.open_issues_count || 0,
    is_private: Boolean(repo.private),
    is_fork: Boolean(repo.fork),
    is_archived: Boolean(repo.archived),
    is_deleted: false,
    relation: repoRelation(repo),
    relation_source: 'auto',
    status: active ? 'active' : 'paused',
    priority: 'medium',
    visible: !repo.private && !repo.archived,
    last_commit_at: repo.pushed_at || null,
  };
}

export async function listRepos() {
  const repos = [];
  for (let page = 1; page <= 3; page += 1) {
    const path = process.env.GITHUB_TOKEN
      ? `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member&visibility=all`
      : `/users/${encodeURIComponent(process.env.GITHUB_USERNAME || 'natricknye')}/repos?per_page=100&page=${page}&sort=pushed`;
    const batch = await gh(path);
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const unique = new Map();
  for (const repo of repos) unique.set(repo.id, repo);
  return [...unique.values()];
}

export async function upsertProject(repo) {
  const p = mapRepo(repo);
  const rows = await query(
    `insert into projects (
       github_id, full_name, owner_login, name, description, html_url, homepage,
       language, stars, forks, open_issues, is_private, is_fork, is_archived,
       is_deleted, relation, relation_source, status, priority, visible, last_commit_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     )
     on conflict (github_id) do update set
       full_name = excluded.full_name,
       owner_login = excluded.owner_login,
       name = excluded.name,
       description = excluded.description,
       html_url = excluded.html_url,
       homepage = excluded.homepage,
       language = excluded.language,
       stars = excluded.stars,
       forks = excluded.forks,
       open_issues = excluded.open_issues,
       is_private = excluded.is_private,
       is_fork = excluded.is_fork,
       is_archived = excluded.is_archived,
       is_deleted = false,
       relation = case when projects.relation_source = 'manual' then projects.relation else excluded.relation end,
       visible = case when excluded.is_private or excluded.is_archived then false else projects.visible end,
       last_commit_at = greatest(projects.last_commit_at, excluded.last_commit_at),
       updated_at = now()
     returning id, last_synced_at, relation_source`,
    [
      p.github_id, p.full_name, p.owner_login, p.name, p.description, p.html_url, p.homepage,
      p.language, p.stars, p.forks, p.open_issues, p.is_private, p.is_fork, p.is_archived,
      p.is_deleted, p.relation, p.relation_source, p.status, p.priority, p.visible, p.last_commit_at,
    ]
  );
  return rows[0];
}

export async function upsertCommits(projectId, commits) {
  if (!Array.isArray(commits) || commits.length === 0) return 0;
  const clean = commits
    .filter(c => c && typeof c.sha === 'string' && c.sha)
    .map(c => ({
      sha: c.sha,
      message: String(c.message || '').slice(0, 4000),
      author_name: String(c.author_name || '').slice(0, 200),
      author_login: String(c.author_login || '').slice(0, 200),
      committed_at: c.committed_at || null,
      html_url: c.html_url || '',
    }));
  if (!clean.length) return 0;
  const result = await execute(
    `insert into commits (project_id, sha, message, author_name, author_login, committed_at, html_url)
     select $1, * from unnest(
       $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::text[]
     )
     on conflict (project_id, sha) do nothing`,
    [
      projectId,
      clean.map(c => c.sha),
      clean.map(c => c.message),
      clean.map(c => c.author_name),
      clean.map(c => c.author_login),
      clean.map(c => c.committed_at),
      clean.map(c => c.html_url),
    ]
  );
  return result.rowCount || 0;
}

async function listCommits(fullName, since) {
  const params = new URLSearchParams({ per_page: since ? '30' : '10' });
  if (since) params.set('since', new Date(since).toISOString());
  const data = await gh(`/repos/${fullName}/commits?${params}`);
  if (!Array.isArray(data)) return [];
  return data.map(c => ({
    sha: c.sha,
    message: c.commit?.message || '',
    author_name: c.commit?.author?.name || '',
    author_login: c.author?.login || '',
    committed_at: c.commit?.committer?.date || c.commit?.author?.date || null,
    html_url: c.html_url || '',
  }));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = { ok: true, value: await worker(items[current]) };
      } catch (error) {
        results[current] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function syncGithub(source = 'manual') {
  const runRows = await query('insert into sync_runs (source) values ($1) returning id', [source]);
  const runId = runRows[0].id;
  let repos = 0;
  let commits = 0;
  const errors = [];
  try {
    const list = await listRepos();
    const targets = list.slice(0, MAX_REPOS);
    const results = await mapLimit(targets, 5, async repo => {
      const project = await upsertProject(repo);
      const recent = await listCommits(repo.full_name, project.last_synced_at);
      const inserted = await upsertCommits(project.id, recent);
      const latest = recent[0]?.committed_at || null;
      await query(
        `update projects set last_synced_at = now(),
           last_commit_at = greatest(last_commit_at, $2::timestamptz),
           updated_at = now()
         where id = $1`,
        [project.id, latest]
      );
      return inserted;
    });
    results.forEach((result, index) => {
      if (result.ok) {
        repos += 1;
        commits += result.value;
      } else {
        errors.push({
          repo: targets[index]?.full_name || '*',
          error: String(result.error?.message || result.error).slice(0, 300),
        });
      }
    });
    if (list.length > MAX_REPOS) errors.push({ repo: '*', error: `limited_to_${MAX_REPOS}` });
    await query(
      `update sync_runs set status = 'ok', repos = $2, commits = $3, error = $4, finished_at = now()
       where id = $1`,
      [runId, repos, commits, errors.length ? JSON.stringify(errors).slice(0, 4000) : null]
    );
    return { ok: true, source, repos, commits, errors };
  } catch (error) {
    await query(
      `update sync_runs set status = 'error', repos = $2, commits = $3, error = $4, finished_at = now()
       where id = $1`,
      [runId, repos, commits, String(error.message || error).slice(0, 4000)]
    );
    throw error;
  }
}

export function verifyWebhook(rawBody, signature) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error('webhook_not_configured');
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const actual = signature.slice(7);
  if (actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function handleWebhook(rawBody, signature, event) {
  if (!verifyWebhook(rawBody, signature)) throw new Error('invalid_signature');
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error('invalid_payload');
  }
  return handleWebhookPayload(payload, event);
}

export async function handleWebhookPayload(payload, event) {
  if (event === 'ping') return { ok: true, pong: true };

  if (event === 'push') {
    const repo = payload.repository;
    if (!repo) return { ok: true, event, ignored: true };
    const project = await upsertProject(repo);
    const commits = (payload.commits || []).map(c => ({
      sha: c.id,
      message: c.message || '',
      author_name: c.author?.name || '',
      author_login: c.author?.username || '',
      committed_at: c.timestamp || null,
      html_url: c.url || '',
    }));
    const inserted = await upsertCommits(project.id, commits);
    await query(
      `update projects set last_synced_at = now(),
         last_commit_at = greatest(last_commit_at, $2::timestamptz), updated_at = now()
       where id = $1`,
      [project.id, commits[0]?.committed_at || repo.pushed_at || null]
    );
    return { ok: true, event, repo: repo.full_name, commits: inserted };
  }

  if (event === 'repository') {
    const repo = payload.repository;
    if (!repo) return { ok: true, event, ignored: true };
    if (payload.action === 'deleted') {
      await query(
        'update projects set is_deleted = true, visible = false, updated_at = now() where github_id = $1',
        [repo.id]
      );
      return { ok: true, event, action: 'deleted', repo: repo.full_name };
    }
    const project = await upsertProject(repo);
    if (payload.action === 'publicized') {
      await query(
        'update projects set visible = (not is_fork and not is_archived), updated_at = now() where id = $1',
        [project.id]
      );
    }
    return { ok: true, event, action: payload.action, repo: repo.full_name };
  }

  if (['release', 'public', 'fork'].includes(event) && payload.repository) {
    await upsertProject(payload.repository);
    return { ok: true, event, repo: payload.repository.full_name };
  }

  return { ok: true, event, ignored: true };
}

export async function getCommitDiff(fullName, sha) {
  const text = await gh(`/repos/${fullName}/commits/${sha}`, {
    accept: 'application/vnd.github.v3.diff',
    raw: true,
  });
  if (text.length > 1_500_000) throw new Error('diff_too_large');
  return text;
}
