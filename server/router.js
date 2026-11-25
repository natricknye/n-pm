import {
  clearSessionCookie,
  readSession,
  sessionCookie,
  signSession,
  verifyPassword,
} from './auth.js';
import { query } from './db.js';
import { clientIp, json, method, readJson, readRaw, sameOrigin } from './http.js';
import { getCommitDiff, handleWebhook, handleWebhookPayload, syncGithub } from './github.js';

const PUBLIC_FIELDS = `id, name, full_name, description, html_url, homepage, language,
  stars, forks, relation, status, priority, last_commit_at, updated_at,
  case when github_id is null then 'local' else 'github' end as source`;
const ADMIN_FIELDS = `${PUBLIC_FIELDS}, owner_login, open_issues, is_private, is_fork,
  is_archived, is_deleted, relation_source, visible, sort_order, last_synced_at, created_at,
  local_path`;

const STATUSES = new Set(['planning', 'active', 'paused', 'done']);
const PRIORITIES = new Set(['low', 'medium', 'high']);
const RELATIONS = new Set(['ownership', 'contribute']);

function authConfigured() {
  return Boolean(process.env.PM_PASSWORD_HASH && process.env.PM_SESSION_SECRET);
}

function requireAuth(req, res) {
  const session = readSession(req);
  if (!session) {
    json(res, 401, { error: 'unauthorized' });
    return null;
  }
  return session;
}

function guardWrite(req, res) {
  if (!sameOrigin(req)) {
    json(res, 403, { error: 'origin' });
    return false;
  }
  return true;
}

function idOf(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validDate(value) {
  return value == null || value === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function login(req, res) {
  if (!guardWrite(req, res)) return;
  if (!authConfigured()) return json(res, 503, { error: 'not_configured' });
  const ip = clientIp(req);
  try {
    const recent = await query(
      `select count(*)::int as n from login_attempts
       where ip = $1 and at > now() - interval '15 minutes'`,
      [ip]
    );
    if (recent[0].n >= 8) return json(res, 429, { error: 'limit' });
    let body;
    try {
      body = await readJson(req);
    } catch {
      return json(res, 400, { error: 'body' });
    }
    const password = typeof body.password === 'string' ? body.password : '';
    if (!verifyPassword(password, process.env.PM_PASSWORD_HASH)) {
      await query('insert into login_attempts (ip) values ($1)', [ip]);
      return json(res, 401, { error: 'invalid_credentials' });
    }
    await query('delete from login_attempts where ip = $1', [ip]);
    const token = signSession(process.env.PM_SESSION_SECRET);
    res.setHeader('set-cookie', sessionCookie(token));
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('login failed', error);
    return json(res, 500, { error: 'server' });
  }
}

async function publicProjects(res) {
  const rows = await query(
    `select ${PUBLIC_FIELDS}
     from projects
     where visible = true and is_private = false and is_deleted = false
     order by relation,
       case status when 'active' then 1 when 'planning' then 2 when 'paused' then 3 else 4 end,
       last_commit_at desc nulls last, name`
  );
  json(res, 200, { projects: rows });
}

async function publicProject(res, id) {
  const rows = await query(
    `select ${PUBLIC_FIELDS},
       (select count(*)::int from commits c where c.project_id = projects.id) as commit_count
     from projects
     where id = $1 and visible = true and is_private = false and is_deleted = false`,
    [id]
  );
  if (!rows[0]) return json(res, 404, { error: 'not_found' });
  json(res, 200, { project: rows[0] });
}

async function adminProjects(res) {
  const rows = await query(
    `select ${ADMIN_FIELDS},
       (select count(*)::int from commits c where c.project_id = projects.id) as commit_count,
       (select count(*)::int from tasks t where t.project_id = projects.id and t.status <> 'done') as open_tasks
     from projects
     order by relation,
       case status when 'active' then 1 when 'planning' then 2 when 'paused' then 3 else 4 end,
       last_commit_at desc nulls last, name`
  );
  json(res, 200, { projects: rows });
}

async function adminProject(res, id) {
  const rows = await query(
    `select ${ADMIN_FIELDS},
       (select count(*)::int from commits c where c.project_id = projects.id) as commit_count,
       (select count(*)::int from tasks t where t.project_id = projects.id and t.status <> 'done') as open_tasks
     from projects where id = $1`,
    [id]
  );
  if (!rows[0]) return json(res, 404, { error: 'not_found' });
  json(res, 200, { project: rows[0] });
}

async function patchProject(req, res, id) {
  if (!guardWrite(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: 'body' });
  }
  const fields = [];
  const values = [];
  const add = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return json(res, 400, { error: 'status' });
    add('status', body.status);
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.has(body.priority)) return json(res, 400, { error: 'priority' });
    add('priority', body.priority);
  }
  if (body.relation !== undefined) {
    if (!RELATIONS.has(body.relation)) return json(res, 400, { error: 'relation' });
    add('relation', body.relation);
    add('relation_source', 'manual');
  }
  if (body.visible !== undefined) {
    if (typeof body.visible !== 'boolean') return json(res, 400, { error: 'visible' });
    add('visible', body.visible);
  }
  if (body.sort_order !== undefined) {
    const order = Number(body.sort_order);
    if (!Number.isInteger(order)) return json(res, 400, { error: 'sort_order' });
    add('sort_order', order);
  }
  if (body.name !== undefined) {
    const name = cleanText(body.name, 120);
    if (!name) return json(res, 400, { error: 'name' });
    add('name', name);
  }
  if (body.description !== undefined) add('description', cleanText(body.description, 2000));
  if (body.local_path !== undefined) add('local_path', cleanText(body.local_path, 500));
  if (!fields.length) return json(res, 400, { error: 'empty' });
  values.push(id);
  const rows = await query(
    `update projects set ${fields.join(', ')}, updated_at = now()
     where id = $${values.length} returning ${ADMIN_FIELDS}`,
    values
  );
  if (!rows[0]) return json(res, 404, { error: 'not_found' });
  json(res, 200, { project: rows[0] });
}

async function createLocalProject(req, res) {
  if (!guardWrite(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: 'body' });
  }
  const name = cleanText(body.name, 120);
  if (!name) return json(res, 400, { error: 'name' });
  const description = cleanText(body.description, 2000);
  const localPath = cleanText(body.local_path, 500);
  const relation = RELATIONS.has(body.relation) ? body.relation : 'ownership';
  const status = STATUSES.has(body.status) ? body.status : 'active';
  const priority = PRIORITIES.has(body.priority) ? body.priority : 'medium';
  const fullName = `local/${slugify(name) || 'project'}-${Date.now().toString(36)}`;
  const rows = await query(
    `insert into projects (
       github_id, full_name, owner_login, name, description, html_url, homepage,
       language, stars, forks, open_issues, is_private, is_fork, is_archived,
       is_deleted, relation, relation_source, status, priority, visible, local_path
     ) values (
       null,$1,null,$2,$3,'','','',0,0,0,false,false,false,false,$4,'manual',$5,$6,true,$7
     ) returning ${ADMIN_FIELDS}`,
    [fullName, name, description, relation, status, priority, localPath]
  );
  json(res, 201, { project: rows[0] });
}

async function deleteLocalProject(req, res, id) {
  if (!guardWrite(req, res)) return;
  const rows = await query(
    'delete from projects where id = $1 and github_id is null returning id',
    [id]
  );
  if (!rows[0]) return json(res, 404, { error: 'not_found' });
  json(res, 200, { ok: true });
}

async function tasks(req, res, projectId) {
  if (method(req) === 'GET') {
    const rows = await query(
      `select id, project_id, title, status, priority, due_date, notes, created_at, completed_at
       from tasks where project_id = $1 order by created_at desc`,
      [projectId]
    );
    return json(res, 200, { tasks: rows });
  }
  if (!guardWrite(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: 'body' });
  }
  const title = cleanText(body.title, 200);
  if (!title) return json(res, 400, { error: 'title' });
  const status = STATUSES.has(body.status) ? body.status : 'todo';
  const priority = PRIORITIES.has(body.priority) ? body.priority : 'medium';
  if (!validDate(body.due_date)) return json(res, 400, { error: 'due_date' });
  const notes = cleanText(body.notes, 5000);
  const rows = await query(
    `insert into tasks (project_id, title, status, priority, due_date, notes, completed_at)
     values ($1,$2,$3,$4,$5,$6, case when $3 = 'done' then now() else null end)
     returning *`,
    [projectId, title, status, priority, body.due_date || null, notes]
  );
  json(res, 201, { task: rows[0] });
}

async function patchTask(req, res, taskId) {
  if (!guardWrite(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: 'body' });
  }
  const fields = [];
  const values = [];
  const add = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };
  if (body.title !== undefined) {
    const title = cleanText(body.title, 200);
    if (!title) return json(res, 400, { error: 'title' });
    add('title', title);
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return json(res, 400, { error: 'status' });
    add('status', body.status);
    add('completed_at', body.status === 'done' ? new Date().toISOString() : null);
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.has(body.priority)) return json(res, 400, { error: 'priority' });
    add('priority', body.priority);
  }
  if (body.due_date !== undefined) {
    if (!validDate(body.due_date)) return json(res, 400, { error: 'due_date' });
    add('due_date', body.due_date || null);
  }
  if (body.notes !== undefined) add('notes', cleanText(body.notes, 5000));
  if (!fields.length) return json(res, 400, { error: 'empty' });
  values.push(taskId);
  const rows = await query(
    `update tasks set ${fields.join(', ')} where id = $${values.length} returning *`,
    values
  );
  if (!rows[0]) return json(res, 404, { error: 'not_found' });
  json(res, 200, { task: rows[0] });
}

async function deleteTask(res, taskId) {
  const rows = await query('delete from tasks where id = $1 returning id', [taskId]);
  if (!rows[0]) return json(res, 404, { error: 'not_found' });
  json(res, 200, { ok: true });
}

async function notes(req, res, projectId) {
  if (method(req) === 'GET') {
    const rows = await query(
      'select id, project_id, body_md, created_at from notes where project_id = $1 order by created_at desc',
      [projectId]
    );
    return json(res, 200, { notes: rows });
  }
  if (!guardWrite(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: 'body' });
  }
  const bodyMd = cleanText(body.body_md, 20000);
  if (!bodyMd) return json(res, 400, { error: 'body_md' });
  const rows = await query(
    'insert into notes (project_id, body_md) values ($1,$2) returning *',
    [projectId, bodyMd]
  );
  json(res, 201, { note: rows[0] });
}

async function deleteNote(res, noteId) {
  const rows = await query('delete from notes where id = $1 returning id', [noteId]);
  if (!rows[0]) return json(res, 404, { error: 'not_found' });
  json(res, 200, { ok: true });
}

async function commits(res, projectId) {
  const rows = await query(
    `select id, sha, message, author_name, author_login, committed_at, html_url
     from commits where project_id = $1 order by committed_at desc nulls last limit 80`,
    [projectId]
  );
  json(res, 200, { commits: rows });
}

async function diff(res, projectId, sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(sha))) return json(res, 400, { error: 'sha' });
  const rows = await query('select full_name from projects where id = $1', [projectId]);
  if (!rows[0]) return json(res, 404, { error: 'not_found' });
  try {
    const text = await getCommitDiff(rows[0].full_name, sha);
    json(res, 200, { diff: text });
  } catch (error) {
    console.error('diff failed', error);
    json(res, 502, { error: 'github', message: String(error.message || error).slice(0, 300) });
  }
}

async function syncInfo(res) {
  const rows = await query(
    `select id, source, status, repos, commits, error, started_at, finished_at
     from sync_runs order by started_at desc limit 1`
  );
  json(res, 200, { sync: rows[0] || null });
}

async function runSync(req, res, source) {
  if (!guardWrite(req, res)) return;
  try {
    const result = await syncGithub(source);
    json(res, 200, result);
  } catch (error) {
    console.error('sync failed', error);
    json(res, 502, { error: 'github', message: String(error.message || error).slice(0, 300) });
  }
}

async function cronSync(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json(res, 503, { error: 'cron_not_configured' });
  const authorization = String(req.headers.authorization || '');
  if (authorization !== `Bearer ${secret}`) return json(res, 401, { error: 'unauthorized' });
  try {
    const result = await syncGithub('cron');
    json(res, 200, result);
  } catch (error) {
    console.error('cron sync failed', error);
    json(res, 502, { error: 'github', message: String(error.message || error).slice(0, 300) });
  }
}

export async function handle(req, res) {
  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const m = method(req);

  try {
    if (parts[0] === 'session' && parts.length === 1 && m === 'GET') {
      return json(res, 200, { authenticated: Boolean(readSession(req)), configured: authConfigured() });
    }

    if (parts[0] === 'login' && parts.length === 1 && m === 'POST') return login(req, res);
    if (parts[0] === 'logout' && parts.length === 1 && m === 'POST') {
      res.setHeader('set-cookie', clearSessionCookie());
      return json(res, 200, { ok: true });
    }

    if (parts[0] === 'github' && parts[1] === 'webhook' && parts.length === 2 && m === 'POST') {
      let raw;
      try {
        raw = await readRaw(req, 2_000_000);
      } catch {
        return json(res, 413, { error: 'too_large' });
      }
      try {
        const result = await handleWebhook(
          raw,
          String(req.headers['x-hub-signature-256'] || ''),
          String(req.headers['x-github-event'] || '')
        );
        return json(res, 200, result);
      } catch (error) {
        if (error.message === 'webhook_not_configured') return json(res, 503, { error: 'webhook_not_configured' });
        if (error.message === 'invalid_signature') return json(res, 401, { error: 'invalid_signature' });
        console.error('webhook failed', error);
        return json(res, 500, { error: 'webhook' });
      }
    }

    if (parts[0] === 'cron' && parts[1] === 'sync' && parts.length === 2 && m === 'GET') {
      return cronSync(req, res);
    }

    if (parts[0] === 'internal' && parts[1] === 'github-webhook' && parts.length === 2 && m === 'POST') {
      const secret = process.env.GITHUB_WEBHOOK_SECRET;
      if (!secret || req.headers['x-internal-webhook'] !== secret) {
        return json(res, 401, { error: 'unauthorized' });
      }
      let body;
      try {
        body = await readJson(req);
      } catch {
        return json(res, 400, { error: 'body' });
      }
      try {
        const result = await handleWebhookPayload(body.payload, String(body.event || ''));
        return json(res, 200, result);
      } catch (error) {
        console.error('internal webhook failed', error);
        return json(res, 500, { error: 'webhook' });
      }
    }

    if (parts[0] === 'projects' && parts.length === 1 && m === 'GET') return publicProjects(res);
    if (parts[0] === 'projects' && parts.length === 2 && m === 'GET') {
      const id = idOf(parts[1]);
      if (!id) return json(res, 404, { error: 'not_found' });
      return publicProject(res, id);
    }

    if (parts[0] === 'admin') {
      if (!requireAuth(req, res)) return;
      if (parts[1] === 'projects' && parts.length === 2) {
        if (m === 'GET') return adminProjects(res);
        if (m === 'POST') return createLocalProject(req, res);
      }
      if (parts[1] === 'projects' && parts.length === 3) {
        const id = idOf(parts[2]);
        if (!id) return json(res, 404, { error: 'not_found' });
        if (m === 'GET') return adminProject(res, id);
        if (m === 'PATCH') return patchProject(req, res, id);
        if (m === 'DELETE') return deleteLocalProject(req, res, id);
      }
      if (parts[1] === 'projects' && parts.length === 4) {
        const id = idOf(parts[2]);
        if (!id) return json(res, 404, { error: 'not_found' });
        if (parts[3] === 'tasks') return tasks(req, res, id);
        if (parts[3] === 'notes') return notes(req, res, id);
        if (parts[3] === 'commits' && m === 'GET') return commits(res, id);
      }
      if (parts[1] === 'tasks' && parts.length === 3) {
        const id = idOf(parts[2]);
        if (!id) return json(res, 404, { error: 'not_found' });
        if (m === 'PATCH') return patchTask(req, res, id);
        if (m === 'DELETE') return deleteTask(res, id);
      }
      if (parts[1] === 'notes' && parts.length === 3 && m === 'DELETE') {
        const id = idOf(parts[2]);
        if (!id) return json(res, 404, { error: 'not_found' });
        return deleteNote(res, id);
      }
      if (parts[1] === 'commits' && parts.length === 5 && parts[4] === 'diff' && m === 'GET') {
        const id = idOf(parts[2]);
        if (!id) return json(res, 404, { error: 'not_found' });
        return diff(res, id, parts[3]);
      }
      if (parts[1] === 'sync' && parts.length === 2) {
        if (m === 'GET') return syncInfo(res);
        if (m === 'POST') return runSync(req, res, 'manual');
      }
    }

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('api failed', error);
    if (error.message === 'database_not_configured') return json(res, 503, { error: 'database_not_configured' });
    return json(res, 500, { error: 'server' });
  }
}
