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
