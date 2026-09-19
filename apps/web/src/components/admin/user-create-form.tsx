'use client';

import { FormEvent, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { ManagedUser, roleLabels } from '@/lib/admin-types';

type CreatedAccount = { user: ManagedUser; initialPassword: string };

export function UserCreateForm({ onCreated }: { onCreated: (user: ManagedUser) => void }) {
  const [role, setRole] = useState('director');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [credential, setCredential] = useState<CreatedAccount | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  async function fillDefaults() {
    try { const settings = await apiFetch<any>('/api/admin/operations/settings'); const value = settings.items.find((v: any) => v.key === 'visitor_defaults')?.value || settings.defaults.visitor_defaults;
      const fields: Record<string, string> = { expiresAt: new Date(Date.now() + value.validDays * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), uploadLimit: String(value.uploadCount), storageLimit: String(value.storageBytes / 1048576), evaluationLimit: String(value.contentEvaluations) };
      for (const [name, content] of Object.entries(fields)) { const input = formRef.current?.elements.namedItem(name) as HTMLInputElement; if (input) input.value = content; }
    } catch { setError('访客默认策略读取失败，请手动填写并检查授权。'); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitting(true); setError(''); setCredential(null);
    const data = new FormData(form);
    const expiresValue = String(data.get('expiresAt') || '');
    const reason = String(data.get('reason') || '');
    const payload = {
      account: String(data.get('account') || '').trim(), name: String(data.get('name') || '').trim(), role,
      department: String(data.get('department') || '').trim() || null,
      expiresAt: expiresValue ? new Date(expiresValue).toISOString() : null,
      initialPassword: String(data.get('initialPassword') || '') || undefined, reason,
      ...(role === 'visitor' ? { quotas: [
        { kind: 'upload_count', period: 'daily', limit: Number(data.get('uploadLimit')) },
        { kind: 'storage_bytes', period: 'lifetime', limit: Number(data.get('storageLimit')) * 1024 * 1024 },
        { kind: 'content_evaluations', period: 'monthly', limit: Number(data.get('evaluationLimit')) },
      ] } : {}),
    };
    try {
      const result = await apiFetch<CreatedAccount>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
      setCredential(result); onCreated(result.user); form.reset(); setRole('director');
    } catch (err) {
      setError(err instanceof Error ? err.message : '账号创建失败，请检查输入后重试。');
    } finally { setSubmitting(false); }
  }

  return (
    <section className="panel" aria-labelledby="create-account-title">
      <div className="page-title"><div><p className="eyebrow">新增</p><h2 id="create-account-title">创建账号</h2></div></div>
      <form ref={formRef} className="form-grid" onSubmit={submit}>
        <div className="form-field"><label htmlFor="new-account">账号</label><input id="new-account" name="account" autoComplete="off" pattern="[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,99}" required /></div>
        <div className="form-field"><label htmlFor="new-name">姓名</label><input id="new-name" name="name" required /></div>
        <div className="form-field"><label htmlFor="new-role">角色</label><select id="new-role" name="role" value={role} onChange={(event) => setRole(event.target.value)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="form-field"><label htmlFor="new-department">部门</label><input id="new-department" name="department" /></div>
        <div className="form-field"><label htmlFor="new-expiry">到期时间{role === 'visitor' ? '（必填）' : '（可选）'}</label><input id="new-expiry" name="expiresAt" type="datetime-local" required={role === 'visitor'} /></div>
        <div className="form-field"><label htmlFor="new-password">初始密码（可选）</label><input id="new-password" name="initialPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" /><small className="muted">留空时由系统生成；首次登录必须修改。</small></div>
        {role === 'visitor' ? <fieldset className="quota-fields full"><legend>访客额度（必填）</legend>
          <button type="button" onClick={fillDefaults}>填入访客默认策略</button><small>填入后仍需检查有效期与额度，再明确提交创建。</small>
          <div className="form-grid"><div className="form-field"><label htmlFor="upload-limit">每日上传次数</label><input id="upload-limit" name="uploadLimit" type="number" min="0" step="1" required /></div><div className="form-field"><label htmlFor="storage-limit">存储容量（MB，总量）</label><input id="storage-limit" name="storageLimit" type="number" min="0" step="1" required /></div><div className="form-field"><label htmlFor="evaluation-limit">每月内容评估次数</label><input id="evaluation-limit" name="evaluationLimit" type="number" min="0" step="1" required /></div></div>
        </fieldset> : null}
        <div className="form-field full"><label htmlFor="create-reason">创建原因</label><input id="create-reason" name="reason" maxLength={500} required /></div>
        {error ? <p className="error full" role="alert">{error}</p> : null}
        <div className="full"><button className="button" disabled={submitting} type="submit">{submitting ? '正在创建…' : '创建账号'}</button></div>
      </form>
      {credential ? <div className="credential-notice" role="status"><strong>账号已创建，请立即安全交付初始密码</strong><p>账号：{credential.user.account}</p><p>初始密码：<code>{credential.initialPassword}</code></p><button className="button secondary" type="button" onClick={() => setCredential(null)}>我已保存，关闭提示</button><small>此凭据仅在当前页面临时显示，关闭后不会再次展示。</small></div> : null}
    </section>
  );
}
