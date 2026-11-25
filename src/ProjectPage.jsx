import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { api } from './api.js';
import { useAuth } from './auth-context.jsx';
import { formatDate, priorityLabel, relationLabel, statusLabel, timeAgo } from './format.js';

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'tasks', label: '任务' },
  { id: 'notes', label: '笔记' },
  { id: 'commits', label: 'Commits' },
];

function Markdown({ value }) {
  const html = DOMPurify.sanitize(marked.parse(value || ''));
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function ProjectPage() {
  const { id } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [commits, setCommits] = useState([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [diff, setDiff] = useState('');
  const [diffSha, setDiffSha] = useState('');
  const [diffError, setDiffError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadProject = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api(auth.authenticated ? `/api/admin/projects/${id}` : `/api/projects/${id}`);
      setProject(data.project);
    } catch (err) {
      setError(err.status === 404 ? '项目不存在，或未公开。' : err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async () => {
    try {
      const data = await api(`/api/admin/projects/${id}/tasks`);
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadNotes = async () => {
    try {
      const data = await api(`/api/admin/projects/${id}/notes`);
      setNotes(data.notes || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadCommits = async () => {
    try {
      const data = await api(`/api/admin/projects/${id}/commits`);
      setCommits(data.commits || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadProject();
  }, [id, auth.authenticated]);

  useEffect(() => {
    if (!auth.authenticated) return;
    if (tab === 'tasks') loadTasks();
    if (tab === 'notes') loadNotes();
    if (tab === 'commits') loadCommits();
  }, [tab, auth.authenticated, id]);

  const patch = async payload => {
    setSaving(true);
    setError('');
    try {
      const data = await api(`/api/admin/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setProject(previous => ({ ...previous, ...data.project }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addTask = async event => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await api(`/api/admin/projects/${id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      setTaskTitle('');
      await loadTasks();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const updateTask = async (taskId, payload) => {
    try {
      await api(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await loadTasks();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteTask = async taskId => {
    try {
      await api(`/api/admin/tasks/${taskId}`, { method: 'DELETE' });
      await loadTasks();
    } catch (err) {
      setError(err.message);
    }
  };

  const addNote = async event => {
    event.preventDefault();
    const body = noteBody.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await api(`/api/admin/projects/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body_md: body }),
      });
      setNoteBody('');
      await loadNotes();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteNote = async noteId => {
    try {
      await api(`/api/admin/notes/${noteId}`, { method: 'DELETE' });
      await loadNotes();
    } catch (err) {
      setError(err.message);
    }
  };

  const openDiff = async sha => {
    setDiffSha(sha);
    setDiff('');
    setDiffError('');
    try {
      const data = await api(`/api/admin/commits/${id}/${sha}/diff`);
      setDiff(data.diff || '');
    } catch (err) {
      setDiffError(err.data?.message || err.message);
    }
  };

  if (loading) return <div className="loading">正在读取项目…</div>;
  if (!project) {
    return (
      <section className="empty-state">
        <h1>读不到这个项目</h1>
        <p>{error}</p>
        <Link to="/" className="btn">回看板</Link>
      </section>
    );
  }

  return (
    <section className="project-page">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        ← 返回
      </button>

      <div className="project-head">
        <div>
          <div className="card-tags">
            <span className={`tag relation-${project.relation}`}>
              {relationLabel[project.relation] || project.relation}
            </span>
            <span className="tag">{statusLabel[project.status] || project.status}</span>
            {project.is_private && <span className="tag private">Private</span>}
            {project.is_fork && <span className="tag">Fork</span>}
          </div>
          <h1>{project.name}</h1>
          {project.description && <p className="project-desc">{project.description}</p>}
          <div className="project-meta">
            {project.language && <span>{project.language}</span>}
            <span>★ {project.stars}</span>
            <span>Fork {project.forks}</span>
            <span>最后 commit {formatDate(project.last_commit_at)}</span>
            {auth.authenticated && <span>同步 {timeAgo(project.last_synced_at)}</span>}
          </div>
          <div className="project-links">
            {project.html_url && (
              <a href={project.html_url} target="_blank" rel="noreferrer">GitHub ↗</a>
            )}
            {project.homepage && (
              <a href={project.homepage} target="_blank" rel="noreferrer">Live ↗</a>
            )}
          </div>
        </div>
        {!auth.authenticated && (
          <div className="login-hint">
            <span>公开只读</span>
            <Link to="/login" className="btn primary">登录看 commit / 修改</Link>
          </div>
        )}
      </div>

      {error && <div className="notice error">{error}</div>}

      {auth.authenticated && (
        <div className="admin-panel">
          <div className="admin-row">
            <label className="field inline">
              <span>状态</span>
              <select
                value={project.status}
                disabled={saving}
                onChange={event => patch({ status: event.target.value })}
              >
                {Object.entries(statusLabel).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span>优先级</span>
              <select
                value={project.priority}
                disabled={saving}
                onChange={event => patch({ priority: event.target.value })}
              >
                {Object.entries(priorityLabel).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span>分类</span>
              <select
                value={project.relation}
                disabled={saving}
                onChange={event => patch({ relation: event.target.value })}
              >
                <option value="ownership">Ownership</option>
                <option value="contribute">Contribute</option>
              </select>
            </label>
            <label className="checkline">
              <input
                type="checkbox"
                checked={Boolean(project.visible)}
                disabled={saving || project.is_private || project.is_archived || project.is_fork}
                onChange={event => patch({ visible: event.target.checked })}
              />
              公开看板可见
            </label>
          </div>
          <p className="small muted">
            GitHub 同步会自动更新仓库信息；分类默认按“仓库 owner 是否是你”判断，手动改过之后不再被覆盖。
          </p>
        </div>
      )}

      {auth.authenticated && (
        <div className="tabs">
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`tab${tab === item.id ? ' active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {(!auth.authenticated || tab === 'overview') && (
        <div className="overview-grid">
          <div className="panel">
            <h2>项目概览</h2>
            <p className="muted">
              {auth.authenticated
                ? '这里放项目目标、当前进展和下一步。'
                : '公开看板只展示项目摘要、状态和最近更新时间。'}
            </p>
            <dl className="facts">
              <div><dt>分类</dt><dd>{relationLabel[project.relation]}</dd></div>
              <div><dt>状态</dt><dd>{statusLabel[project.status]}</dd></div>
              <div><dt>优先级</dt><dd>{priorityLabel[project.priority]}</dd></div>
              <div><dt>最近 commit</dt><dd>{formatDate(project.last_commit_at)}</dd></div>
              {auth.authenticated && <div><dt>Commit 数</dt><dd>{project.commit_count}</dd></div>}
              {auth.authenticated && <div><dt>未完成任务</dt><dd>{project.open_tasks}</dd></div>}
            </dl>
          </div>
          <div className="panel">
            <h2>怎么用</h2>
            <ul className="plain-list">
              <li>拖卡片改状态（登录后）</li>
              <li>任务、笔记、commit diff 只对登录可见</li>
              <li>GitHub push 后 webhook 自动同步；页面每 60 秒刷新</li>
              <li>私有仓库不会出现在公开看板</li>
            </ul>
          </div>
        </div>
      )}

      {auth.authenticated && tab === 'tasks' && (
        <div className="panel">
          <div className="panel-head">
            <h2>任务</h2>
            <span className="count">{tasks.length}</span>
          </div>
          <form className="inline-form" onSubmit={addTask}>
            <input
              value={taskTitle}
              onChange={event => setTaskTitle(event.target.value)}
              placeholder="加一个任务，例如：补 commit diff 缓存"
              maxLength={200}
            />
            <button type="submit" className="btn primary" disabled={busy || !taskTitle.trim()}>
              添加
            </button>
          </form>
          <div className="task-list">
            {tasks.map(task => (
              <div className="task-row" key={task.id}>
                <select
                  value={task.status}
                  onChange={event => updateTask(task.id, { status: event.target.value })}
                  aria-label="任务状态"
                >
                  <option value="todo">Todo</option>
                  <option value="doing">Doing</option>
                  <option value="done">Done</option>
                </select>
                <span className={`task-title${task.status === 'done' ? ' done' : ''}`}>
                  {task.title}
                </span>
                <span className="small muted">{formatDate(task.due_date)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => deleteTask(task.id)}
                  aria-label="删除任务"
                >
                  ×
                </button>
              </div>
            ))}
            {!tasks.length && <p className="muted">还没有任务。</p>}
          </div>
        </div>
      )}

      {auth.authenticated && tab === 'notes' && (
        <div className="panel">
          <h2>笔记</h2>
          <form className="stack-form" onSubmit={addNote}>
            <textarea
              value={noteBody}
              onChange={event => setNoteBody(event.target.value)}
              placeholder="写项目笔记，支持 Markdown…"
              rows={6}
              maxLength={20000}
            />
            <button type="submit" className="btn primary" disabled={busy || !noteBody.trim()}>
              保存笔记
            </button>
          </form>
          <div className="note-list">
            {notes.map(note => (
              <article className="note" key={note.id}>
                <div className="note-head">
                  <span className="small muted">{formatDate(note.created_at)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => deleteNote(note.id)}
                    aria-label="删除笔记"
                  >
                    ×
                  </button>
                </div>
                <Markdown value={note.body_md} />
              </article>
            ))}
            {!notes.length && <p className="muted">还没有笔记。</p>}
          </div>
        </div>
      )}

      {auth.authenticated && tab === 'commits' && (
        <div className="panel">
          <div className="panel-head">
            <h2>Commits</h2>
            <span className="count">{commits.length}</span>
          </div>
          <div className="commit-layout">
            <div className="commit-list">
              {commits.map(commit => (
                <button
                  type="button"
                  key={commit.id}
                  className={`commit-row${diffSha === commit.sha ? ' active' : ''}`}
                  onClick={() => openDiff(commit.sha)}
                >
                  <code>{commit.sha.slice(0, 7)}</code>
                  <span>{commit.message?.split('\n')[0] || '(no message)'}</span>
                  <small>{formatDate(commit.committed_at)}</small>
                </button>
              ))}
              {!commits.length && <p className="muted">还没有同步到 commit。</p>}
            </div>
            <div className="diff-panel">
              {!diffSha && <p className="muted">点一条 commit 查看代码改动。</p>}
              {diffSha && !diff && !diffError && <p className="muted">正在读取 diff…</p>}
              {diffError && <div className="notice error">{diffError}</div>}
              {diff && <pre className="diff">{diff}</pre>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
