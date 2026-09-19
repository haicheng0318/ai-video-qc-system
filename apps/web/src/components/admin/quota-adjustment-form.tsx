'use client';

import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';

export type QuotaItem = { kind: string; period: string; limit: number | null; used: number; reserved: number; remaining: number | null; windowStart: string; windowEnd: string | null };
const kindLabels: Record<string, string> = { upload_count: '上传次数', storage_bytes: '存储容量', content_evaluations: '内容评估次数' };

export function QuotaAdjustmentForm({ userId, quotas, onAdjusted }: { userId: string; quotas: QuotaItem[]; onAdjusted: () => void }) {
  const [kind, setKind] = useState('upload_count');
  const [period, setPeriod] = useState('daily');
  const [businessKey, setBusinessKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  function changeKind(value: string) { setKind(value); if (value === 'storage_bytes') setPeriod('lifetime'); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setSubmitting(true); setError('');
    const data = new FormData(form), unlimited = data.get('unlimited') === 'on';
    const shownLimit = Number(data.get('limit'));
    const limit = unlimited ? null : kind === 'storage_bytes' ? shownLimit * 1024 * 1024 : shownLimit;
    try {
      await apiFetch(`/api/admin/users/${userId}/quotas/adjust`, { method: 'POST', body: JSON.stringify({ kind, period: kind === 'storage_bytes' ? 'lifetime' : period, limit, reason: String(data.get('reason') || ''), businessKey }) });
      setBusinessKey(crypto.randomUUID()); onAdjusted(); form.reset();
    } catch (err) { setError(err instanceof Error ? err.message : '额度调整失败；可直接重试，本次业务键会保持不变。'); }
    finally { setSubmitting(false); }
  }
  return <section className="panel"><div className="page-title"><div><p className="eyebrow">LIMITS</p><h2>额度</h2></div></div><div className="quota-summary">{quotas.map((quota) => <article key={quota.kind}><strong>{kindLabels[quota.kind] || quota.kind}</strong><span>{quota.limit === null ? '不限额' : `${quota.used + quota.reserved} / ${quota.limit}${quota.kind === 'storage_bytes' ? ' 字节' : ''}`}</span><small>已用 {quota.used} · 预占 {quota.reserved} · {quota.period}</small></article>)}</div><form className="form-grid section-gap" onSubmit={submit}><div className="form-field"><label htmlFor="quota-kind">额度类型</label><select id="quota-kind" value={kind} onChange={(event) => changeKind(event.target.value)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="form-field"><label htmlFor="quota-period">周期</label><select id="quota-period" value={kind === 'storage_bytes' ? 'lifetime' : period} disabled={kind === 'storage_bytes'} onChange={(event) => setPeriod(event.target.value)}><option value="daily">每日</option><option value="monthly">每月</option><option value="lifetime">总量</option></select></div><div className="form-field"><label htmlFor="quota-limit">新上限{kind === 'storage_bytes' ? '（MB）' : ''}</label><input id="quota-limit" name="limit" type="number" min="0" step="1" required /></div><div className="form-field checkbox-field"><label><input name="unlimited" type="checkbox" /> 不限额</label></div><div className="form-field full"><label htmlFor="quota-reason">调整原因</label><input id="quota-reason" name="reason" maxLength={500} required /></div>{error ? <p className="error full" role="alert">{error}</p> : null}<div className="full"><button className="button" type="submit" disabled={submitting}>{submitting ? '正在保存…' : '调整额度'}</button></div></form></section>;
}
