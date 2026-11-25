import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth-context.jsx';
import { formatDate, relationLabel, timeAgo } from './format.js';

const COLUMNS = [
  { id: 'active', label: '进行中' },
  { id: 'planning', label: '计划中' },
  { id: 'paused', label: '暂停' },
  { id: 'done', label: '完成' },
];

const RELATIONS = [
  { id: 'all', label: '全部' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'contribute', label: 'Contribute' },
];

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
    const result = { all: projects.length, ownership: 0, contribute: 0 };
    for (const project of projects) {
      if (result[project.relation] !== undefined) result[project.relation] += 1;
    }
    return result;
  }, [projects]);

  const visibleProjects = useMemo(
    () => projects.filter(project => relation === 'all' || project.relation === relation),
    [projects, relation]
  );

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

  const move = async (id, status) => {
    const previous = projects;
    setProjects(items => items.map(item => (item.id === id ? { ...item, status } : item)));
    try {
      await api(`/api/admin/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      setProjects(previous);
      setError(`移动失败：${err.message}`);
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
            GitHub 更新会自动同步到这里。公开看板只读；登录后可改状态、看 commit 与 diff。
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

      <div className="board-grid">
        {COLUMNS.map(column => {
          const items = visibleProjects.filter(project => project.status === column.id);
          return (
            <div
              key={column.id}
              className="board-column"
              onDragOver={event => {
                if (auth.authenticated) event.preventDefault();
              }}
              onDrop={event => {
                if (!auth.authenticated) return;
                event.preventDefault();
                const id = Number(event.dataTransfer.getData('text/plain'));
                if (id) move(id, column.id);
              }}
            >
              <div className="column-head">
                <span>{column.label}</span>
                <span className="count">{items.length}</span>
              </div>
              <div className="column-body">
                {items.map(project => (
                  <article
                    key={project.id}
                    className={`project-card${auth.authenticated ? ' editable' : ''}`}
                    draggable={auth.authenticated}
                    onDragStart={event => {
                      if (!auth.authenticated) return;
                      event.dataTransfer.setData('text/plain', String(project.id));
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => navigate(`/p/${project.id}`)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') navigate(`/p/${project.id}`);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="card-tags">
                      <span className={`tag relation-${project.relation}`}>
                        {relationLabel[project.relation] || project.relation}
                      </span>
                      {project.priority === 'high' && <span className="tag high">高优先</span>}
                      {project.is_private && <span className="tag private">Private</span>}
                    </div>
                    <h3>{project.name}</h3>
                    {project.description && <p className="card-desc">{project.description}</p>}
                    <div className="card-meta">
                      {project.language && <span>{project.language}</span>}
                      {project.stars > 0 && <span>★ {project.stars}</span>}
                      <span>更新 {formatDate(project.last_commit_at)}</span>
                      {auth.authenticated && project.open_tasks > 0 && (
                        <span>{project.open_tasks} 个任务</span>
                      )}
                    </div>
                  </article>
                ))}
                {!items.length && <div className="column-empty">空</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="board-foot">
        <span>每 60 秒自动刷新 · {projects.length} 个项目</span>
        <span>
          分类：
          {RELATIONS.slice(1)
            .map(item => `${item.label} ${counts[item.id]}`)
            .join(' · ')}
        </span>
      </div>
    </section>
  );
}
