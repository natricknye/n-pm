# N/PM · 交付记录

## 2026-11-25

### 这一版做了什么

- 把个人项目管理看板定名为 **N/PM**（N + /PM）。
- 新建独立公开仓库：<https://github.com/natricknye/n-pm>。
- 完成 React + Vite + Vercel Functions + Neon 的生产部署。
- 公开看板只读；登录后可改状态/优先级/分类/可见性、管理任务和 Markdown 笔记；commit 列表和 diff 仅登录可见。
- GitHub 仓库自动成为项目，按 `ownership` / `contribute` 分类；手动改分类后同步不覆盖。
- GitHub 同步三路兜底：webhook 实时、每日 cron、前端 60 秒轮询。
- 私有仓库、fork、archived、deleted 默认不进公开 API。
- 为 `natricknye` 名下 9 个仓库创建 webhook。

### 生产状态

```text
Vercel project     nate-pm
Production domain  pm.natricknye.cn
Deployment         dpl_72rJ6mxAijwTfPjYgNFYhdnfcCwm
Neon resource      n-pm-db（Free）
```

Vercel 部署 `READY`；Neon schema 已迁移；首次同步得到 9 个仓库、70 条 commit。

### 验证

- `npm test`：6/6。
- `npm run build`：通过。
- 本地 mock smoke：公开看板、登录、详情、任务、笔记、diff。
- 真实 Neon + API router smoke：
  - 公开看板 6 个项目，Contribute 0（fork 隐藏）。
  - 未登录 `/api/admin/projects` 401。
  - 登录后 9 个项目，私有仓库标记可见。
  - 任务创建/读取/删除。
  - Markdown 笔记创建/渲染/删除。
  - commit diff 866 字符。
  - 同步状态 `ok`，9 repos / 70 commits。
  - 退出后 admin 401。
- 修复了 `/api/admin/commits/:id/:sha/diff` 路由下标 bug。

### 还没做

- 阿里云 DNS 加 `pm` CNAME → `571a54a8621f89cb.vercel-dns-017.com.`。
- 加完后验证公网访问、SSL、GitHub webhook ping。
- 可选：连接 Vercel Git 自动部署。

## 2026-11-25 · 白亮主题 + 本地项目

### 这一版做了什么

- 全站从深色改为白亮主题，保留蓝色作为主强调色。
- 看板主体分成两个大分区：**已上传 GitHub** 和 **未上传 GitHub**。
- 项目卡片直接铺在主区，不再用四列看板/侧栏；点卡片进入详情，卡片上保留状态、优先级、分类和最近更新。
- 登录后可直接在卡片上用下拉改状态；详情页仍可改状态/优先级/分类/公开性。
- 新增本地项目模型：`github_id is null` + `local_path`，支持在“未上传 GitHub”区手动创建和删除。
- 从 `E:\sandbox\默认项目` 扫描到未上传 GitHub 的大项目 `math-paper`（7.7GB，Lean 4 形式化/验证），写入为本地项目。
- `Dela`、`opencode` 作为可见的 Contribute 项目；公开看板现在有 2 个 Contribute。
- 修复 Vercel 非 Next 项目 catch-all 只匹配一层的问题，加 `/api/(.*)` → `/api/[...route]` rewrite。
- 新增 favicon，修复控制台 favicon 404。

### 线上验证

- 生产部署：`dpl_4Y96a1vzuPG3etu81WJvoNBuczeF`
- 公开看板：9 个（7 Ownership + 2 Contribute），两个来源分区正常。
- 登录后：10 个（含私有 JIAO 和本地 math-paper）。
- 本地项目详情：显示“本地项目”和本地路径，隐藏 Commits 标签。
- 本地项目表单：UI 创建 → 列表出现 → API 删除成功。
- 任务/笔记/commit diff/同步状态/退出 401 全部通过。
- `npm test`：7/7；`npm run build`：通过。

### 还没做

- `math-paper` 仍只在本地，尚未推到 GitHub。
- Vercel Git 自动部署还需要 GitHub 登录连接；目前用 CLI 部署。
- 本机对 `*.vercel.app` 有 DNS 污染，线上验收走 `pm.natricknye.cn` + 代理。
