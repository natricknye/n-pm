# N/PM · 开发文档

## 1. 这是什么

N/PM 是一个**单用户**的开发项目看板：

- 公开只读：任何人都能看项目摘要、状态、分类、语言、star、最近更新时间
- 登录后可写：改状态/优先级/分类/公开性，管理任务和 Markdown 笔记
- 登录后看细节：commit 列表、commit diff
- GitHub 自动同步：webhook 实时 + 每日 cron 兜底 + 前端 60 秒轮询
- 项目分两类：`ownership`（自己的仓库）和 `contribute`（别人的仓库/参与贡献）

线上入口：`https://pm.natricknye.cn`（Vercel 部署 READY；阿里云 `pm` CNAME 待添加）

## 2. 架构

```text
Browser
  │  React + Vite (HashRouter)
  ▼
Vercel static (dist)
  │  /api/*
  ▼
Node Function  api/[...route].js
  ├─ Neon PostgreSQL (Pool)
  ├─ GitHub REST (token)
  └─ auth / rate limit / CRUD

GitHub
  │  webhook: push / repository
  ▼
Edge Function  api/github/webhook.js
  │  verify X-Hub-Signature-256
  ▼
POST /api/internal/github-webhook
  │  shared GITHUB_WEBHOOK_SECRET
  ▼
handleWebhookPayload() → Postgres
```

为什么 webhook 单独用 Edge：

- Edge `request.text()` 可以拿到**原始 body**，而 Node 运行时可能已经把 JSON 解析成对象，无法重算 HMAC。
- Edge 只做验签和转发，业务逻辑仍在 Node 的 `handleWebhookPayload`。
- 内部接口用 `GITHUB_WEBHOOK_SECRET` 保护；公网 webhook 没有有效签名会 401。

## 3. 目录

```text
api/[...route].js          Node API catch-all
api/github/webhook.js      Edge webhook verifier
server/auth.js             scrypt 哈希 / HMAC session / cookie
server/db.js               Neon Pool / query / execute
server/github.js           repo 映射、sync、webhook、diff
server/http.js             JSON/raw body、IP、same-origin
server/router.js           API 路由
sql/schema.sql             表结构
scripts/migrate.mjs        执行 schema
scripts/hash-password.mjs  生成 PM_PASSWORD_HASH
scripts/sync.mjs           CLI 同步 GitHub
scripts/dev-server.mjs     本地静态 + API router
scripts/load-env.mjs       读取 .env.local
scripts/setup-webhooks.ps1 批量配置 GitHub webhook
src/main.jsx               React 入口（HashRouter）
src/App.jsx                会话、布局、路由
src/Board.jsx              公开/管理员看板、拖拽、同步、轮询
src/ProjectPage.jsx        详情、任务、笔记、commits/diff
src/Login.jsx              单用户登录
src/auth-context.jsx       AuthContext
src/api.js                 fetch 封装
src/format.js              状态/日期/分类文案
tests/auth.test.mjs        哈希/签名
tests/github.test.mjs      ownership/contribute/可见性
```

## 4. 数据模型

### projects

| 字段 | 说明 |
| --- | --- |
| `github_id` | GitHub repo id，唯一；手动项目可为空 |
| `full_name` | `owner/repo`，用于 GitHub API |
| `owner_login` | 仓库 owner |
| `is_private` / `is_fork` / `is_archived` / `is_deleted` | 可见性/状态 |
| `relation` | `ownership` / `contribute` |
| `relation_source` | `auto` / `manual`；手动改过 sync 不覆盖 |
| `status` | `planning` / `active` / `paused` / `done` |
| `priority` | `low` / `medium` / `high` |
| `visible` | 公开看板是否可见；私有仓库仍被 `is_private` 过滤 |
| `last_commit_at` / `last_synced_at` | 展示与增量同步 |

### tasks / notes / commits

- `tasks`：`todo/doing/done`，`completed_at` 在 done 时写入。
- `notes`：Markdown 原文，前端用 marked + DOMPurify 渲染。
- `commits`：`(project_id, sha)` 唯一；只存元数据，diff 按需从 GitHub 拉。
- `sync_runs`：每次 sync 的来源/结果/错误。
- `login_attempts`：IP + 时间，用于登录限流。

## 5. GitHub 同步

### 仓库列表

有 `GITHUB_TOKEN`：

```text
GET /user/repos?per_page=100&page=N&sort=pushed
  &affiliation=owner,collaborator,organization_member&visibility=all
```

无 token：

```text
GET /users/:GITHUB_USERNAME/repos?per_page=100&page=N&sort=pushed
```

最多 3 页；按 repo id 去重；单次 sync 最多处理 80 个仓库。

### 分类

```text
fork                         → contribute
owner.login === username     → ownership
其他                          → contribute
```

手动在 UI 改分类会写 `relation_source='manual'`；后续 sync 不会覆盖。Fork 默认 `contribute`，公开看板默认隐藏 fork。

### 状态

新仓库根据 `pushed_at`：

- 90 天内有 push → `active`
- 更久 → `paused`

已有仓库的 `status` 不会被 sync 覆盖。

### 可见性

新仓库：

```text
visible = !private && !fork && !archived
```

已有仓库：public/private 变化时，private/archived 强制 `visible=false`；public 不会自动恢复，管理员可在详情页打开。`repository publicized` webhook 会自动打开非 fork/非 archived 的仓库。

### commits

- 首次 sync：每个 repo 最新 10 条
- 后续：用 `last_synced_at` 作为 `since`，最多 30 条
- webhook push：直接用 payload 里的 commits，不再请求 GitHub
- diff：用户点 commit 时请求 `GET /repos/:full_name/commits/:sha`，`Accept: application/vnd.github.v3.diff`，上限 1.5 MB

### webhook

支持事件：

- `ping` → pong
- `push` → upsert repo + commits + last_commit_at
- `repository`：
  - `deleted` → `is_deleted=true, visible=false`
  - `publicized` → 打开非 fork/非 archived
  - 其他 action → upsert 元数据
- `release` / `public` / `fork` → upsert repo 元数据
- 其他事件忽略

签名：`X-Hub-Signature-256: sha256=<hex>`，HMAC-SHA256(raw body, `GITHUB_WEBHOOK_SECRET`)。

### 定时兜底

`vercel.json`：

```json
{ "path": "/api/cron/sync", "schedule": "0 4 * * *" }
```

Vercel 发送 `Authorization: Bearer $CRON_SECRET`；`cronSync` 校验后执行 `syncGithub('cron')`。

## 6. 权限边界

公开：

- `/api/projects`、`/api/projects/:id`
- 只返回 `visible=true && is_private=false && is_deleted=false && is_fork=false`
- 字段只有摘要；不含 commit、tasks、notes、owner_login
- 私有仓库即使 `visible=true` 也不会出现

需要登录：

- `/api/admin/*` 全部
- commit 列表、diff、任务、笔记
- 所有 PATCH/POST/DELETE
- 登录 cookie：`HttpOnly; SameSite=Strict; Secure`（生产）
- 写接口额外校验 same-origin

Webhook：

- 公网可访问，但必须通过 GitHub HMAC 签名
- Edge 验签后带 `GITHUB_WEBHOOK_SECRET` 调内部 Node 接口
- 内部接口不暴露给浏览器

## 7. 认证

- 密码哈希：`scrypt`，N=16384、r=8、p=1、64 bytes，随机 16 bytes salt
- 格式：`scrypt$N$r$p$salt$hash`
- 会话：`{sub:'owner', iat, exp}` + HMAC-SHA256，30 天
- 登录限流：同一 IP 15 分钟最多 8 次失败
- PM 与博客使用**同一个明文密码**，但各自独立的 hash 和 session secret；不要把博客的密钥复制过来

生成哈希：

```bash
npm run hash-password
```

## 8. API 路由

见 `README.md` 的 API 表。路由实现在 `server/router.js`：

- 公开：`session`、`login`、`logout`、`projects`、`projects/:id`
- 管理：`admin/projects`、`admin/projects/:id`、`admin/projects/:id/{tasks,notes,commits}`、`admin/tasks/:id`、`admin/notes/:id`、`admin/commits/:id/:sha/diff`、`admin/sync`
- 运维：`cron/sync`、`github/webhook`、`internal/github-webhook`

## 9. 本地开发 / 测试

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run hash-password
npm run vercel:dev
```

只跑前端：

```bash
npm run dev
```

不依赖 Vercel CLI 的本地全栈：

```bash
npm run build
npm run local
# http://127.0.0.1:3001
```

`scripts/dev-server.mjs` 静态托管 `dist`，并把 `/api/*` 交给同一个 `server/router.js`，数据库仍连 `.env.local` 的 Neon。

CLI 同步：

```bash
npm run sync
```

真实环境冒烟（需先启动 `npm run local`）：

```powershell
$env:PM_TEST_PASSWORD='...'; node smoke-live.cjs
```

它会验证公开只读、401、登录、9 个项目、私有仓库可见性、任务/笔记增删、commit diff、同步状态和退出登录；测试数据会自动删除。

测试：

```bash
npm test
npm run build
```

当前测试：auth 2 项 + GitHub 分类/可见性 4 项 = 6 项，另有 mock smoke 和 live smoke。

### Windows 符号链接坑

如果项目同时出现在 `C:\...` 和 `E:\...`（worktree/symlink），Vite 可能报：

```text
The "fileName" or "name" properties ... received "E:/.../index.html"
```

从真实路径运行 `npm run build`（例如 `E:\...\pm`），不要混用 C:/E: 路径。

## 10. 部署

当前生产：

```text
Vercel project     nate-pm
Production domain  pm.natricknye.cn
Deployment         dpl_72rJ6mxAijwTfPjYgNFYhdnfcCwm
Neon resource      n-pm-db（Vercel Marketplace，Free）
Neon project       twilight-unit-04685252
```

部署命令：

```bash
npx vercel deploy --prod --yes --archive=tgz
```

`--archive=tgz` 可以减少上传请求数，网络不稳时更可靠。

Vercel Production 环境变量：

```text
DATABASE_URL          Neon 集成自动注入
GITHUB_USERNAME=natricknye
GITHUB_TOKEN          GitHub 读权限
GITHUB_WEBHOOK_SECRET webhook HMAC
PM_PASSWORD_HASH      博客同密码，PM 独立 hash
PM_SESSION_SECRET     独立随机值
CRON_SECRET           每日 cron
PM_SITE_URL=https://pm.natricknye.cn
```

子域：

1. Vercel 已添加 `pm.natricknye.cn`
2. 阿里云 DNS 加记录：

```text
类型: CNAME
主机: pm
记录值: 571a54a8621f89cb.vercel-dns-017.com.
TTL: 10 分钟（默认）
```

备用值 `cname.vercel-dns.com.`；不要动根域/`www`。加完后 `vercel domains verify pm.natricknye.cn` 应返回 `ok`，SSL 由 Vercel 自动签发。

### 部署保护

`nate-pm` 的 Deployment Protection 是 `all_except_custom_domains`：预览部署需要 Vercel 登录，自定义域名 `pm.natricknye.cn` 公开可读。不要把它改成全站密码保护，否则公开看板会被挡住。

### GitHub webhook

已为 `natricknye` 名下 9 个仓库创建：

```text
URL:    https://pm.natricknye.cn/api/github/webhook
Events: push, repository, release, public, fork
```

重跑/补建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-webhooks.ps1
```

## 11. 已知限制 / 待办

- 单用户，没有多租户/权限表
- 没有 GitHub App 的安装/回滚 UI；webhook 需要按 repo 添加或用 GitHub App
- 无 token 时 GitHub 公共 API 60 次/小时，无法支撑频繁 sync
- 单次 sync 最多 80 个仓库、每 repo 首次 10 条 commit
- Vercel Hobby 的 Cron 频率/函数时长可能受限；webhook 为主
- 任务/笔记没有软删除/回收站
- UI 测试是本地脚本（`smoke.cjs` mock、`smoke-live.cjs` 真实数据库），没有接 CI
- `npm run build` 在 C:/E: 符号链接下需用真实路径
- 阿里云 `pm` CNAME 未添加前，公网域名和 GitHub webhook 都不通；Vercel 部署本身已 READY
- 本机网络对 `*.vercel.app` 有 DNS 污染，不能用部署 URL 直接验收；以自定义域名为准

## 12. 变更记录

- 2026-11-25：创建 N/PM 初版。React/Vite + Vercel Functions + Neon；单用户 scrypt 登录；公开看板/登录编辑；GitHub 仓库自动导入；`ownership` / `contribute` 分类与手动覆盖；webhook（Edge 验签 + 内部 Node）+ 每日 cron + 60 秒前端轮询；任务、笔记、commit diff；6 项单元测试通过。
- 2026-11-25：公开仓库 `https://github.com/natricknye/n-pm` 已创建并推送；N/PM 品牌、README/DEVELOPMENT、公开/私有边界完成。尚未部署：需要 Neon `DATABASE_URL`、Vercel 项目/环境变量、GitHub PAT 与 webhook secret；Vercel API 网络当前超时。
- 2026-11-25：完成生产部署。Vercel `nate-pm` + Neon Marketplace `n-pm-db` + schema；9 个仓库、70 条 commit 已同步；9 个仓库 webhook 已建；Production 环境变量齐全。新增 `scripts/load-env.mjs`、`sync.mjs`、`dev-server.mjs`、`setup-webhooks.ps1`；修复 `/api/admin/commits/:id/:sha/diff` 路由下标 bug；真实环境冒烟通过（公开 6 / 登录 9 / diff 866 字符 / 退出 401）。仅剩阿里云 `pm` CNAME。
