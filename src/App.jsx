import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { AuthContext } from './auth-context.jsx';
import Board from './Board.jsx';
import ProjectPage from './ProjectPage.jsx';
import Login from './Login.jsx';

export default function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState({
    loading: true,
    authenticated: false,
    configured: true,
  });

  const refresh = async () => {
    try {
      const data = await api('/api/session');
      setSession({ loading: false, ...data });
    } catch {
      setSession({ loading: false, authenticated: false, configured: false });
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const logout = async () => {
    try {
      await api('/api/logout', { method: 'POST', body: '{}' });
    } catch {}
    await refresh();
    navigate('/');
  };

  return (
    <AuthContext.Provider value={{ ...session, refresh, logout }}>
      <div className="app-shell">
        <header className="topbar">
          <Link to="/" className="brand" aria-label="N/PM 首页">
            <span className="brand-mark">N</span>
            <span className="brand-text">/PM</span>
            <span className="brand-sub">projects · commits · notes</span>
          </Link>
          <nav className="topnav">
            <Link to="/">看板</Link>
            <a href="https://github.com/natricknye" target="_blank" rel="noreferrer">
              GitHub
            </a>
            {session.loading ? (
              <span className="muted small">检查会话…</span>
            ) : session.authenticated ? (
              <button type="button" className="btn ghost" onClick={logout}>
                退出
              </button>
            ) : (
              <Link to="/login" className="btn primary">
                登录
              </Link>
            )}
          </nav>
        </header>

        <main className="page">
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/p/:id" element={<ProjectPage />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="*"
              element={
                <section className="empty-state">
                  <h1>404</h1>
                  <p>这个页面不存在。</p>
                  <Link to="/" className="btn">
                    回看板
                  </Link>
                </section>
              }
            />
          </Routes>
        </main>

        <footer className="footer">
          <span>N/PM · 只给自己用的项目管理</span>
          <span>
            GitHub 更新 → Webhook 自动同步 · 公开看板只读
          </span>
        </footer>
      </div>
    </AuthContext.Provider>
  );
}
