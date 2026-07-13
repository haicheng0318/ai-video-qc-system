'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setToken } from '@/lib/api';

type LoginResponse = {
  accessToken: string;
  user: {
    id: string;
    name: string;
    account: string;
    role: string;
  };
};

export default function LoginPage() {
  const router = useRouter();
  const [account, setAccount] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const result = await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
      setToken(result.accessToken);
      router.push('/videos');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <div className="panel" style={{ maxWidth: 440, margin: '80px auto' }}>
        <div className="page-title">
          <h1>登录</h1>
        </div>
        <form onSubmit={onSubmit} className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="form-field">
            <label htmlFor="account">账号</label>
            <input id="account" value={account} onChange={(event) => setAccount(event.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="button" disabled={submitting} type="submit">
            {submitting ? '登录中' : '登录'}
          </button>
        </form>
      </div>
    </main>
  );
}
