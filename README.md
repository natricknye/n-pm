# N/PM

**N/PM** is a personal project dashboard for GitHub projects. It is public to read, private to edit, and updates itself when GitHub changes.

- Public board: anyone can see project summaries, status, language, stars and last activity.
- Private details: commit history, commit diffs, tasks and notes require login.
- Any mutation requires login.
- GitHub repos are imported automatically and split into **Ownership** (your repos) and **Contribute** (other people's repos / contributions).
- GitHub webhooks update the board in near real time; a daily cron and a 60-second UI refresh are the fallback.

Repo: `https://github.com/natricknye/n-pm`

Live: `https://pm.natricknye.cn` — **not deployed yet**; waiting for Neon + Vercel environment variables.

## Status

- [x] N/PM UI, API, auth, GitHub sync code
- [x] Public repository
- [ ] Neon database + `DATABASE_URL`
- [ ] Vercel project + env + `pm.natricknye.cn`
- [ ] GitHub PAT + webhook secret

## Stack

```text
React + Vite
  → Vercel Functions (Node runtime)
  → Neon PostgreSQL
  → GitHub REST API + GitHub Webhooks
```

Why this shape:

- The board is a Vite SPA with hash routes, so static hosting needs no rewrites.
- The API is a Node function, which keeps `pg`/Neon and GitHub API calls simple.
- A separate Vercel project keeps N/PM isolated from the public personal site and blog.
- GitHub webhooks are handled by a small Edge function so the raw body can be verified with `X-Hub-Signature-256`; it forwards to an internal Node route.

## Features

- Project board grouped by `planning / active / paused / done`
- Ownership / Contribute tabs and per-project override
- Drag project cards to change status
- Tasks (`todo / doing / done`) per project
- Markdown notes per project
- Commit list and on-demand diff, login only
- Public board hides private, fork, archived and deleted repos
- GitHub sync:
  - manual "Sync GitHub" button
  - webhook on `push` / `repository` events
  - daily Vercel Cron fallback
  - page refresh every 60 seconds and on window focus
- Single-user auth with rate limiting

## Quick start

### 1. Neon

Create a project at <https://neon.tech>, copy the PostgreSQL connection string, then:

```bash
cp .env.example .env.local
# edit .env.local: DATABASE_URL=...
npm install
npm run db:migrate
```

### 2. Password

Use the **same password as the blog**, but generate a separate hash for N/PM:

```bash
npm run hash-password
```

Put the printed `scrypt$...` value into `PM_PASSWORD_HASH` in `.env.local` and Vercel Production. Also set a random `PM_SESSION_SECRET`:

```bash
# macOS/Linux
openssl rand -base64 32
# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

The plaintext password is never stored in this repo.

### 3. GitHub

Create a **fine-grained personal access token**:

- Repository access: the repos you want to see (or all repos)
- Permissions: **Metadata: Read**, **Contents: Read**
- For private repos: include those repos in the token scope

Set:

```env
GITHUB_USERNAME=natricknye
GITHUB_TOKEN=github_pat_...
```

Without a token the app only imports public repos and is subject to GitHub's unauthenticated rate limit (60 requests/hour), which is not enough for regular syncs. Use a token in production.

### 4. Run locally

```bash
npm run vercel:dev
```

`vercel dev` serves the Vite app and `/api/*` functions together. `npm run dev` only serves the frontend.

### 5. Deploy

```bash
vercel
vercel deploy --prod
```

Set these Vercel Production env vars:

- `DATABASE_URL`
- `GITHUB_USERNAME`
- `GITHUB_TOKEN`
- `GITHUB_WEBHOOK_SECRET`
- `PM_PASSWORD_HASH`
- `PM_SESSION_SECRET`
- `CRON_SECRET`
- `PM_SITE_URL=https://pm.natricknye.cn`

Add the domain `pm.natricknye.cn` in Vercel. At Aliyun DNS add the record Vercel gives you (usually a `CNAME` for `pm` → `cname.vercel-dns.com`, plus a `_vercel` TXT verification if asked). Do not change the root/`www` records. Vercel issues SSL automatically.

## GitHub auto-update

### Option A — repository webhook (quick)

For each repo you want real-time updates on:

1. GitHub repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://pm.natricknye.cn/api/github/webhook`
3. Content type: `application/json`
4. Secret: the same value as `GITHUB_WEBHOOK_SECRET`
5. Events: `push` and `repository` (or "Send me everything")
6. Save, then use "Recent Deliveries" → Ping to verify

### Option B — GitHub App (all repos)

GitHub personal accounts do not have a single user-level webhook. To cover every repo without adding a webhook one by one, create a GitHub App:

- Webhook URL: `https://pm.natricknye.cn/api/github/webhook`
- Webhook secret: `GITHUB_WEBHOOK_SECRET`
- Subscribe to `push` and `repository` events
- Install the app on all repositories

The app only receives events; N/PM still uses the fine-grained PAT for reading repo metadata and diffs.

### Fallback cron

`vercel.json` schedules `GET /api/cron/sync` daily. Vercel sends `Authorization: Bearer $CRON_SECRET`. This catches missed webhooks. On Vercel Hobby, cron frequency may be limited; the webhook is the primary path.

## Ownership vs Contribute

`projects.relation` is one of:

- `ownership` — repo owner is `GITHUB_USERNAME`
- `contribute` — repo owner is someone else, or the repo is a fork

On sync, new rows are classified automatically. Changing the relation in the UI sets `relation_source = 'manual'`; later syncs will not overwrite it. A fork is classified as `contribute` by default.

## Public vs private

Public `GET /api/projects` only returns rows that are:

```text
visible = true
is_private = false
is_deleted = false
is_fork = false
```

It returns summaries only: name, description, language, stars, forks, relation, status, priority, last commit time. It never returns commit messages, diffs, tasks, notes, owner login, or private repo names.

Logged-in `GET /api/admin/projects` returns all rows, including private repos. The public page still hides private repos even if `visible` is true.

## Auth

- One owner account. No signup.
- Password hash: `scrypt` with salt (format `scrypt$N$r$p$salt$hash`).
- Session: HMAC-SHA256 signed payload in a `HttpOnly`, `SameSite=Strict`, `Secure` cookie, 30 days.
- Login rate limit: 8 failures per IP per 15 minutes (stored in Postgres).
- All writes require the session and a same-origin check.
- Webhook endpoint is public but requires a valid GitHub HMAC signature; it forwards to an internal route with `GITHUB_WEBHOOK_SECRET`.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/session` | no | session state |
| POST | `/api/login` | no | password login |
| POST | `/api/logout` | no | clear session |
| GET | `/api/projects` | no | public project summaries |
| GET | `/api/projects/:id` | no | public project summary |
| GET | `/api/admin/projects` | yes | all projects |
| GET | `/api/admin/projects/:id` | yes | project detail |
| PATCH | `/api/admin/projects/:id` | yes | status / priority / relation / visible |
| GET | `/api/admin/projects/:id/tasks` | yes | tasks |
| POST | `/api/admin/projects/:id/tasks` | yes | create task |
| PATCH | `/api/admin/tasks/:id` | yes | update task |
| DELETE | `/api/admin/tasks/:id` | yes | delete task |
| GET | `/api/admin/projects/:id/notes` | yes | notes |
| POST | `/api/admin/projects/:id/notes` | yes | create note |
| DELETE | `/api/admin/notes/:id` | yes | delete note |
| GET | `/api/admin/projects/:id/commits` | yes | commit list |
| GET | `/api/admin/commits/:projectId/:sha/diff` | yes | GitHub diff |
| POST | `/api/admin/sync` | yes | manual GitHub sync |
| GET | `/api/admin/sync` | yes | last sync run |
| GET | `/api/cron/sync` | cron secret | daily fallback |
| POST | `/api/github/webhook` | GitHub signature | webhook receiver |

## Repo layout

```text
api/[...route].js          Node API catch-all
api/github/webhook.js      Edge webhook signature verifier
server/auth.js             scrypt + HMAC session
server/db.js               Neon pool
server/github.js           repo/commit sync, webhook payloads, diffs
server/http.js             JSON body / origin / IP helpers
server/router.js           API routing
sql/schema.sql             Postgres schema
src/                       React app
scripts/                   migrate + password hash
tests/                     auth + repo classification
```

## Limits / notes

- Single owner only. Multi-user would need a users table, per-user repos and authorization.
- Sync is capped at 80 repos per run; each repo fetches the latest 10 commits on first sync, then commits since the last sync.
- Diffs are fetched on demand from GitHub and capped at 1.5 MB.
- GitHub API rate limits still apply; use a PAT.
- Private repos are never exposed on the public API. Do not mark a private repo visible and expect it to appear; the server filters `is_private`.
- The frontend polls every 60 seconds. Real-time webhook delivery depends on GitHub reaching the deployment.

## Windows note

If the project lives under a symlinked worktree, Vite can see `C:\...` and `E:\...` as two different roots and fail with:

```text
The "fileName" or "name" properties ... received "E:/.../index.html"
```

Run the build from the real path (`E:\...\pm`), or move the project to a normal directory.

No license has been added yet. Add one before treating this as an open-source template.
