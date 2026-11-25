import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth-context.jsx';
import { formatDate, priorityLabel, relationLabel, statusLabel, timeAgo } from './format.js';

const RELATIONS = [
  { id: 'all', label: '全部' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'contribute', label: 'Contribute' },
];

const STATUSES = [
  { id: 'active', label: '进行中' },
  { id: 'planning', label: '计划中' },
  { id: 'paused', label: '暂停' },
  { id: 'done', label: '完成' },
];

const PRIORITIES = [
  { id: 'high', label: '高' },
  { id: 'medium', label: '中' },
  { id: 'low', label: '低' },
];

function isLocal(project) {
  return project.source === 'local' || (!project.source && String(project.full_name || '').startsWith('local/'));
}

function ProjectCard({ project, auth, onStatus, onOpen }) {
  return (
    <article
      className="project-card"
      onClick={() => onOpen(project.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(project.id);
      }}
      role="button"
      tabIndex={0}
    >
      <div className="card-tags">
        <span className={`tag relation-${project.relation}`}>
          {relationLabel[project.relation] || project.relation}
        </span>
        <span className={`tag status-${project.status}`}>{statusLabel[project.status] || project.status}</span>
        {project.priority === 'high' && <span className="tag high">高优先</span>}
        {project.is_private && <span className="tag private">Private</span>}
        {project.is_fork && <span className="tag">Fork</span>}
        {isLocal(project) && <span className="tag local">本地</span>}
      </div>
      <h3>{project.name}</h3>
      {project.description && <p className="card-desc">{project.description}</p>}
      <div className="card-meta">
        {project.language && <span>{project.language}</span>}
        {project.stars > 0 && <span>★ {project.stars}</span>}
        <span>{isLocal(project) ? '未上传 GitHub' : `更新 ${formatDate(project.last_commit_at)}`}</span>
        {auth.authenticated && project.open_tasks > 0 && <span>{project.open_tasks} 个任务</span>}
        {auth.authenticated && project.local_path && (
          <span className="local-path" title={project.local_path}>{project.local_path}</span>
        )}
      </div>
      {auth.authenticated && (
        <label className="card-status" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <span>状态</span>
          <select value={project.status} onChange={event => onStatus(project.id, event.target.value)} aria-label={`${project.name} 状态`}>
            {STATUSES.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}

export default function Board() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [relation, setRelation] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [showLocalForm, setShowLocalForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [localForm, setLocalForm] = useState({
    name: '',
    description: '',
    local_path: '',
    relation: 'ownership',
    status: 'active',
    priority: 'medium',
  });

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await api(auth.authenticated ? '/api/admin/projects' : '/api/projects');
      setProjects((data.projects || []).filter(project => !project.is_deleted));
    } catch (err) {
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadSync = async () => {
    if (!auth.authenticated) return;
    try {
      const data = await api('/api/admin/sync');
      setLastSync(data.sync || null);
    } catch {}
  };

  useEffect(() => {
    load();
    loadSync();
  }, [auth.authenticated]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load(true);
        loadSync();
      }
    }, 60_000);
    const onFocus = () => {
      load(true);
      loadSync();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [auth.authenticated]);

  const counts = useMemo(() => {
    const result = { all: projects.length, ownership: 0, contribute: 0, github: 0, local: 0 };
    for (const project of projects) {
      if (result[project.relation] !== undefined) result[project.relation] += 1;
      if (isLocal(project)) result.local += 1;
      else result.github += 1;
    }
    return result;
  }, [projects]);

  const visibleProjects = useMemo(
    () => projects.filter(project => relation === 'all' || project.relation === relation),
    [projects, relation]
  );
  const githubProjects = visibleProjects.filter(project => !isLocal(project));
  const localProjects = visibleProjects.filter(isLocal);

  const sync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api('/api/admin/sync', { method: 'POST', body: '{}' });
      setSyncResult(result);
      await load(true);
      await loadSync();
    } catch (err) {
      setSyncResult({ error: err.message, details: err.data?.message });
    } finally {
      setSyncing(false);
    }
  };

  const updateStatus = async (id, status) => {
    const previous = projects;
    setProjects(items => items.map(item => (item.id === id ? { ...item, status } : item)));
    try {
      await api(`/api/admin/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      setProjects(previous);
      setError(`修改状态失败：${err.message}`);
    }
  };

  const addLocalProject = async event => {
    event.preventDefault();
    if (!localForm.name.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      await api('/api/admin/projects', {
        method: 'POST',
        body: JSON.stringify(localForm),
      });
      setLocalForm({
        name: '',
        description: '',
        local_path: '',
        relation: 'ownership',
        status: 'active',
        priority: 'medium',
      });
      setShowLocalForm(false);
      await load(true);
    } catch (err) {
      setError(`添加失败：${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="loading">正在读取项目…</div>;
  }

  return (
    <section className="board-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">PROJECT BOARD</span>
          <h1>开发项目</h1>
          <p className="muted">
            GitHub 仓库自动同步，本地项目手动维护。公开看板只读；登录后可改状态、看 commit 与 diff。
          </p>
        </div>
        <div className="head-actions">
          {auth.authenticated ? (
            <>
              <button type="button" className="btn" onClick={sync} disabled={syncing}>
                {syncing ? '同步中…' : '同步 GitHub'}
              </button>
              <span className="sync-note">
                {lastSync
                  ? `上次同步 ${timeAgo(lastSync.finished_at || lastSync.started_at)}`
                  : '尚未同步'}
              </span>
            </>
          ) : (
            <span className="readonly-badge">公开只读 · 登录后可编辑</span>
          )}
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {syncResult && (
        <div className={`notice ${syncResult.error ? 'error' : 'ok'}`}>
          {syncResult.error
            ? `同步失败：${syncResult.error}${syncResult.details ? ` · ${syncResult.details}` : ''}`
            : `同步完成：${syncResult.repos} 个仓库，${syncResult.commits} 条新 commit${
                syncResult.errors?.length ? `，${syncResult.errors.length} 个仓库失败` : ''
              }`}
        </div>
      )}

      <div className="summary-grid" aria-label="项目概况">
        <div className="summary-card">
          <span>已上传 GitHub</span>
          <strong>{counts.github}</strong>
          <small>自动同步的仓库</small>
        </div>
        <div className="summary-card">
          <span>未上传 GitHub</span>
          <strong>{counts.local}</strong>
          <small>本地维护的项目</small>
        </div>
        <div className="summary-card">
          <span>Ownership</span>
          <strong>{counts.ownership}</strong>
          <small>自己的项目</small>
        </div>
        <div className="summary-card">
          <span>Contribute</span>
          <strong>{counts.contribute}</strong>
          <small>参与贡献的项目</small>
        </div>
      </div>

      <div className="relation-tabs" role="tablist" aria-label="项目分类">
        {RELATIONS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={relation === item.id}
            className={`relation-tab${relation === item.id ? ' active' : ''}`}
            onClick={() => setRelation(item.id)}
          >
            {item.label}
            <span className="count">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      <section className="source-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">GITHUB</span>
            <h2>已上传 GitHub</h2>
            <p className="muted">push、release、repository 事件会自动更新。</p>
          </div>
          <span className="section-count">{githubProjects.length} 个</span>
        </div>
        {githubProjects.length ? (
          <div className="project-grid">
            {githubProjects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                auth={auth}
                onStatus={updateStatus}
                onOpen={id => navigate(`/p/${id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="section-empty">这个分类下还没有已上传 GitHub 的项目。</div>
        )}
      </section>

      <section className="source-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">LOCAL</span>
            <h2>未上传 GitHub</h2>
            <p className="muted">还没推到 GitHub 的项目，手动添加和维护。</p>
          </div>
          <div className="section-actions">
            <span className="section-count">{localProjects.length} 个</span>
            {auth.authenticated && (
              <button type="button" className="btn primary" onClick={() => setShowLocalForm(value => !value)}>
                {showLocalForm ? '收起表单' : '添加本地项目'}
              </button>
            )}
          </div>
        </div>

        {auth.authenticated && showLocalForm && (
          <form className="local-form" onSubmit={addLocalProject}>
            <div className="form-grid">
              <label className="field">
                <span>项目名</span>
                <input
                  value={localForm.name}
                  onChange={event => setLocalForm({ ...localForm, name: event.target.value })}
                  placeholder="例如：math-paper"
                  maxLength={120}
                  required
                />
              </label>
              <label className="field">
                <span>本地路径</span>
                <input
                  value={localForm.local_path}
                  onChange={event => setLocalForm({ ...localForm, local_path: event.target.value })}
                  placeholder="E:\path\to\project"
                  maxLength={500}
                />
              </label>
              <label className="field">
                <span>分类</span>
                <select
                  value={localForm.relation}
                  onChange={event => setLocalForm({ ...localForm, relation: event.target.value })}
                >
                  <option value="ownership">Ownership</option>
                  <option value="contribute">Contribute</option>
                </select>
              </label>
              <label className="field">
                <span>状态</span>
                <select
                  value={localForm.status}
                  onChange={event => setLocalForm({ ...localForm, status: event.target.value })}
                >
                  {STATUSES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>优先级</span>
                <select
                  value={localForm.priority}
                  onChange={event => setLocalForm({ ...localForm, priority: event.target.value })}
                >
                  {PRIORITIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>描述</span>
              <textarea
                value={localForm.description}
                onChange={event => setLocalForm({ ...localForm, description: event.target.value })}
                placeholder="这个项目在做什么、现在到哪一步…"
                rows={3}
                maxLength={2000}
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={creating || !localForm.name.trim()}>
                {creating ? '保存中…' : '保存本地项目'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setShowLocalForm(false)}>
                取消
              </button>
            </div>
          </form>
        )}

        {localProjects.length ? (
          <div className="project-grid">
            {localProjects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                auth={auth}
                onStatus={updateStatus}
                onOpen={id => navigate(`/p/${id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="section-empty">
            这个分类下还没有本地项目。{auth.authenticated ? '点“添加本地项目”补一个。' : '登录后可添加。'}
          </div>
        )}
      </section>

      <div className="board-foot">
        <span>每 60 秒自动刷新 · {projects.length} 个项目</span>
        <span>GitHub {counts.github} · 本地 {counts.local} · Ownership {counts.ownership} · Contribute {counts.contribute}</span>
      </div>
    </section>
  );
}
