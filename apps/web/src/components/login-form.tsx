'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiUser } from '@/lib/api';

export function LoginForm({ adminOnly = false }: { adminOnly?: boolean }) {
  const router = useRouter();
  const [account, setAccount] = useState(adminOnly ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await apiFetch<{ user: ApiUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ account: account.trim(), password, ...(adminOnly ? { adminOnly: true } : {}) }),
      });
      if (result.user.mustChangePassword) router.push('/change-password');
      else router.push(adminOnly ? '/admin' : '/videos');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand" aria-label="系统介绍">
        <p className="eyebrow">CONTENT OPERATIONS</p>
        <h1>AI短视频质检<br />评估系统</h1>
        <p>让内容质量、数据表现与最终有效等级各有依据，全程可追踪、可复盘。</p>
      </section>
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">V1.01</p>
        <h2 id="login-title">{adminOnly ? '管理员登录' : '登录工作台'}</h2>
        <p className="muted">{adminOnly ? '仅管理员账号可进入后台管理。' : '使用内容中台账号继续。'}</p>
        <form onSubmit={onSubmit} className="auth-form">
          <div className="form-field">
            <label htmlFor="account">账号</label>
            <input id="account" name="username" value={account} onChange={(event) => setAccount(event.target.value)} autoComplete="username" required />
          </div>
          <div className="form-field">
            <label htmlFor="password">密码</label>
            <input id="password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </div>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="button auth-submit" disabled={submitting} type="submit">
            {submitting ? '正在验证…' : '登录'}
          </button>
        </form>
        <Link className="auth-switch" href={adminOnly ? '/login' : '/admin/login'}>
          {adminOnly ? '返回普通登录' : '进入管理员登录'}
        </Link>
      </section>
    </main>
  );
}
