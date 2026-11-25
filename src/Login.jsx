import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth-context.jsx';

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth.authenticated) navigate('/', { replace: true });
  }, [auth.authenticated, navigate]);

  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      await auth.refresh();
      navigate('/', { replace: true });
    } catch (err) {
      const code = err.data?.error || err.message;
      if (code === 'invalid_credentials') setError('密码不正确。');
      else if (code === 'limit') setError('尝试次数太多，过十五分钟再试。');
      else if (code === 'not_configured') setError('N/PM 还没配置密码哈希，先看 README 的 setup。');
      else setError(`登录失败：${code}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="login-page">
      <div className="login-card">
        <span className="eyebrow">PRIVATE ACCESS</span>
        <h1>登录</h1>
        <p className="muted">和博客同一个密码。登录后才能修改项目、看 commit 和 diff。</p>
        {!auth.configured && (
          <div className="notice warn">
            服务端还没配置 <code>PM_PASSWORD_HASH</code> 或 <code>PM_SESSION_SECRET</code>。
          </div>
        )}
        <form onSubmit={submit} className="form-stack">
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoFocus
              required
            />
          </label>
          {error && <div className="notice error">{error}</div>}
          <button type="submit" className="btn primary wide" disabled={busy || !password}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
        <Link to="/" className="back-link">
          ← 返回公开看板
        </Link>
      </div>
    </section>
  );
}
