'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiUser } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 12) return setError('新密码至少需要 12 个字符。');
    if (newPassword !== confirmPassword) return setError('两次输入的新密码不一致。');
    setError('');
    setSubmitting(true);
    try {
      const result = await apiFetch<{ user: ApiUser }>('/api/auth/change-password', {
        method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
      });
      router.replace(result.user.role === 'admin' ? '/admin' : '/videos');
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码修改失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page narrow-page" id="main-content">
      <section className="panel">
        <div className="page-title"><div><p className="eyebrow">账号安全</p><h1>首次登录请修改密码</h1></div></div>
        <p className="muted">新密码需为 12–128 个字符。修改成功后，其他已登录会话会失效。</p>
        <form className="auth-form" onSubmit={submit}>
          <div className="form-field"><label htmlFor="current-password">当前密码</label><input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
          <div className="form-field"><label htmlFor="new-password">新密码</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div>
          <div className="form-field"><label htmlFor="confirm-password">确认新密码</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="button" type="submit" disabled={submitting}>{submitting ? '正在保存…' : '保存新密码'}</button>
        </form>
      </section>
    </main>
  );
}
