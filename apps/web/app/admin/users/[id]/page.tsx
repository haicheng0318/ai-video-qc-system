'use client';

import Link from 'next/link';
import { FormEvent, use, useCallback, useEffect, useRef, useState } from 'react';
import { QuotaAdjustmentForm, QuotaItem } from '@/components/admin/quota-adjustment-form';
import { apiFetch, ApiUser } from '@/lib/api';
import { ManagedUser, roleLabels } from '@/lib/admin-types';

type Session = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; ipAddress?: string | null; userAgent?: string | null };
type PasswordInput = { password: string; mustChangePassword: boolean; reason: string };
const formatTime = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const credentialLogin = (notice: 'account_changed' | 'password_changed') => window.location.assign(`/admin/login?notice=${notice}`);

export default function AdminUserDetailPage({ params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = use(pendingParams);
  const [user, setUser] = useState<ManagedUser | null>(null), [sessions, setSessions] = useState<Session[]>([]), [quotas, setQuotas] = useState<QuotaItem[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [credential, setCredential] = useState('');
  const [actorId, setActorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationRef = useRef(false);
  const load = useCallback(async () => { setError(''); try { const [detail, sessionData, quotaData] = await Promise.all([apiFetch<{ user: ManagedUser }>(`/api/admin/users/${params.id}`), apiFetch<{ items: Session[] }>(`/api/admin/users/${params.id}/sessions`), apiFetch<{ quotas: QuotaItem[] }>(`/api/admin/users/${params.id}/quotas`)]); setUser(detail.user); setSessions(sessionData.items); setQuotas(quotaData.quotas); } catch (err) { setError(err instanceof Error ? err.message : '账号详情加载失败。'); } }, [params.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    void apiFetch<{ user: ApiUser }>('/api/auth/me').then((result) => { if (active) setActorId(result.user.id); }).catch(() => { if (active) setError('当前登录身份读取失败，请刷新页面后重试。'); });
    return () => { active = false; };
  }, []);

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationRef.current || !actorId) return;
    const data = new FormData(event.currentTarget);
    const account = String(data.get('account') || '').trim();
    const accountCharacters = Array.from(account);
    const hasControlCharacter = accountCharacters.some((character) => { const code = character.codePointAt(0)!; return code <= 31 || (code >= 127 && code <= 159); });
    if (!account || accountCharacters.length > 100 || hasControlCharacter || /[\p{Cf}\p{Cs}]/u.test(account)) { setError('登录用户名需为 1–100 个字符，不能包含控制字符。'); return; }
    const accountChanged = account !== user?.account;
    mutationRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<{ user: ManagedUser }>(`/api/admin/users/${params.id}`, { method: 'PATCH', body: JSON.stringify({ account, name: data.get('name'), role: data.get('role'), status: data.get('status'), expiresAt: data.get('expiresAt') ? new Date(String(data.get('expiresAt'))).toISOString() : null, reason: data.get('reason') }) });
      setUser(result.user);
      if (accountChanged && actorId === params.id) { credentialLogin('account_changed'); return; }
      await load();
      setNotice('账号资料已更新，相关旧会话会按安全规则失效。');
    } catch (err) { setError(err instanceof Error ? err.message : '更新失败。'); }
    finally { mutationRef.current = false; setBusy(false); }
  }

  async function setPassword(input: PasswordInput) {
    if (mutationRef.current || !actorId) return false;
    mutationRef.current = true; setBusy(true); setError(''); setNotice(''); setCredential('');
    try {
      await apiFetch<{ success: true }>(`/api/admin/users/${params.id}/set-password`, { method: 'POST', body: JSON.stringify(input) });
      setNotice('密码已修改，该账号全部旧会话已撤销。');
      if (actorId === params.id) credentialLogin('password_changed');
      else await load();
      return true;
    } catch { setError('设置密码失败，请检查密码要求、操作原因和账号状态后重试。'); return false; }
    finally { mutationRef.current = false; setBusy(false); }
  }

  async function action(path: string, reason: string, confirmText?: string) {
    if (mutationRef.current || !actorId) return;
    if (!reason.trim()) return setError('请先填写操作原因。');
    if (confirmText && !window.confirm(confirmText)) return;
    mutationRef.current = true; setBusy(true); setError(''); setNotice(''); setCredential('');
    try {
      const result = await apiFetch<{ initialPassword?: string }>(`/api/admin/users/${params.id}/${path}`, { method: 'POST', body: JSON.stringify({ reason }) });
      if (result.initialPassword) setCredential(result.initialPassword);
      setNotice('操作已完成。');
      // A random self-reset must remain visible until its one-time credential is saved.
      if (actorId === params.id) {
        if (path === 'reset-password') { setNotice('密码已重置，请保存随机密码后重新登录。'); return; }
        window.location.assign('/admin/login'); return;
      }
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败。'); }
    finally { mutationRef.current = false; setBusy(false); }
  }

  if (error && !user) return <main className="page" id="main-content"><div className="error-state" role="alert"><p>{error}</p><button className="button secondary" onClick={() => void load()}>重试</button></div></main>;
  if (!user) return <main className="page" id="main-content"><p className="muted" role="status">正在加载账号详情…</p></main>;
  const disabled = busy || !actorId || Boolean(credential && actorId === params.id);
  return <main className="page" id="main-content">
    <Link className="text-link" href="/admin/users">← 返回账号列表</Link>
    <div className="page-title section-gap"><div><p className="eyebrow">ACCOUNT</p><h1>{user.name}</h1><p className="muted">{user.account} · {roleLabels[user.role] || user.role}</p></div></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {notice ? <p className="success" role="status">{notice}</p> : null}
    {credential ? <div className="credential-notice" role="status"><strong>新初始密码只显示一次</strong><code>{credential}</code><button className="button secondary" onClick={() => { setCredential(''); if (actorId === params.id) credentialLogin('password_changed'); }}>我已保存，关闭提示</button></div> : null}
    <div className="detail-grid">
      <section className="panel"><h2>账号资料</h2><form className="form-grid" onSubmit={update}>
        <div className="form-field"><label htmlFor="detail-account">登录用户名</label><input id="detail-account" name="account" defaultValue={user.account} maxLength={100} autoComplete="off" required /></div>
        <div className="form-field"><label htmlFor="detail-name">姓名</label><input id="detail-name" name="name" defaultValue={user.name} required /></div>
        <div className="form-field"><label htmlFor="detail-role">角色</label><select id="detail-role" name="role" defaultValue={user.role}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="form-field"><label htmlFor="detail-status">状态</label><select id="detail-status" name="status" defaultValue={user.status}><option value="active">启用</option><option value="disabled">停用</option><option value="archived">已归档</option></select></div>
        <div className="form-field"><label htmlFor="detail-expiry">到期时间</label><input id="detail-expiry" name="expiresAt" type="datetime-local" defaultValue={user.expiresAt ? new Date(user.expiresAt).toISOString().slice(0, 16) : ''} /></div>
        <div className="form-field full"><label htmlFor="update-reason">变更原因</label><input id="update-reason" name="reason" maxLength={500} required /></div>
        <div className="full"><button className="button" disabled={disabled}>保存账号资料</button></div>
      </form></section>
      <SensitiveActions onAction={action} onSetPassword={setPassword} disabled={disabled} />
    </div>
    <div className="section-gap"><QuotaAdjustmentForm userId={params.id} quotas={quotas} onAdjusted={load} /></div>
    <section className="panel section-gap"><h2>登录会话</h2>{sessions.length === 0 ? <p className="empty-state">暂无会话记录。</p> : <div className="table-scroll" tabIndex={0}><table><thead><tr><th>创建时间</th><th>到期时间</th><th>IP</th><th>状态</th><th>设备</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><td>{formatTime(session.createdAt)}</td><td>{formatTime(session.expiresAt)}</td><td>{session.ipAddress || '—'}</td><td>{session.revokedAt ? `已撤销 ${formatTime(session.revokedAt)}` : '有效'}</td><td>{session.userAgent || '—'}</td></tr>)}</tbody></table></div>}</section>
  </main>;
}

function SensitiveActions({ onAction, onSetPassword, disabled }: {
  onAction: (path: string, reason: string, confirmText?: string) => Promise<void>;
  onSetPassword: (input: PasswordInput) => Promise<boolean>;
  disabled: boolean;
}) {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitting.current) return;
    setPasswordError('');
    if (Array.from(password).length < 8 || Array.from(password).length > 128 || new TextEncoder().encode(password).length > 72) { setPasswordError('密码需为 8–128 个字符，且 UTF-8 长度不超过 72 字节。'); return; }
    if (password !== confirmPassword) { setPasswordError('两次输入的密码不一致。'); return; }
    if (!reason.trim() || reason.trim().length > 500) { setPasswordError('请填写 1–500 个字符的操作原因。'); return; }
    submitting.current = true;
    try {
      if (await onSetPassword({ password, mustChangePassword, reason: reason.trim() })) {
        setPassword(''); setConfirmPassword(''); setShowPassword(false); setMustChangePassword(false);
      }
    } finally { submitting.current = false; }
  }
  return <section className="panel"><h2>登录凭据</h2>
    <form className="form-grid" onSubmit={submit}>
      <div className="form-field full"><label htmlFor="assigned-password">设置新密码</label><input id="assigned-password" name="newPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <div className="form-field full"><label htmlFor="confirm-assigned-password">确认新密码</label><input id="confirm-assigned-password" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <label className="checkbox-row full"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />显示密码</label>
      <label className="checkbox-row full"><input type="checkbox" checked={mustChangePassword} onChange={(event) => setMustChangePassword(event.target.checked)} />首次登录要求修改密码</label>
      <div className="form-field full"><label htmlFor="security-reason">操作原因</label><input id="security-reason" value={reason} maxLength={500} required onChange={(event) => setReason(event.target.value)} /></div>
      {passwordError ? <p className="error full" role="alert">{passwordError}</p> : null}
      <div className="full"><button className="button" disabled={disabled}>设置新密码</button></div>
    </form>
    <div className="button-stack section-gap">
      <button className="button secondary" type="button" disabled={disabled} onClick={() => void onAction('reset-password', reason, '确认重置该账号密码并使现有会话失效？')}>生成随机密码</button>
      <button className="button secondary" type="button" disabled={disabled} onClick={() => void onAction('revoke-sessions', reason, '确认撤销该账号全部会话？')}>撤销全部会话</button>
      <button className="button danger-button" type="button" disabled={disabled} onClick={() => void onAction('archive', reason, '归档后不能恢复，确认继续？')}>归档账号</button>
    </div>
  </section>;
}
