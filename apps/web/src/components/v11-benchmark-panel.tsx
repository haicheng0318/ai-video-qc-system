'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiUser } from '@/lib/api';

type Profile = { id: string; name: string; version: number; platform: string; brand: string | null; videoType: string; primaryMetric: string; requiredMetrics: string[]; status: string; enabled: boolean; thresholds: Array<{ sThreshold: string; aPlusThreshold: string; aThreshold: string; bThreshold: string; bMinusThreshold: string; cThreshold: string }> };
const initial = { name: '', platform: '抖音', brand: '', videoType: 'organic', primaryMetric: 'views', requiredMetrics: 'views', minimumSampleMetric: 'views', minimumSampleValue: '1000', observationWindowDays: '3', S: '100000', APlus: '80000', A: '60000', B: '40000', BMinus: '20000', C: '10000' };

export function V11BenchmarkPanel({ user }: { user: ApiUser | null }) {
  const [items, setItems] = useState<Profile[]>([]);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setItems(await apiFetch<Profile[]>('/api/v11/benchmark-profiles')); } catch { setError('V1.1 Benchmark 暂时不可用。'); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      await apiFetch('/api/v11/benchmark-profiles', { method: 'POST', body: JSON.stringify({
        name: form.name.trim(), platform: form.platform.trim(), brand: form.brand.trim() || null, videoType: form.videoType,
        primaryMetric: form.primaryMetric.trim(), requiredMetrics: form.requiredMetrics.split(',').map((value) => value.trim()).filter(Boolean),
        minimumSampleMetric: form.minimumSampleMetric.trim(), minimumSampleValue: Number(form.minimumSampleValue), observationWindowDays: Number(form.observationWindowDays), guardRules: [],
        thresholds: { direction: 'higher_better', S: Number(form.S), 'A+': Number(form.APlus), A: Number(form.A), B: Number(form.B), 'B-': Number(form.BMinus), C: Number(form.C) },
      }) });
      setForm(initial); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败。'); }
  }
  async function approve(id: string) {
    const reason = window.prompt('请输入审批原因（至少 10 个字符）');
    if (!reason) return;
    try { await apiFetch(`/api/v11/benchmark-profiles/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '审批失败。'); }
  }
  return <section className="section-gap" aria-labelledby="v11-benchmarks-heading"><h2 id="v11-benchmarks-heading">V1.1 评价基准</h2><p className="muted">数据等级只由后端使用已审批且精确匹配的平台、品牌与视频类型配置计算；千问只提供解释。</p>{error ? <p className="error" role="alert">{error}</p> : null}
    <h3>基准配置与审批</h3>
    {user?.role === 'admin' ? <form onSubmit={create}><div className="form-grid"><label>名称<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>平台<input required value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} /></label><label>品牌（可选）<input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label><label>视频类型<select value={form.videoType} onChange={(e) => setForm({ ...form, videoType: e.target.value })}><option value="product_card">商品卡</option><option value="qianchuan_ad">千川投放</option><option value="live_room_traffic">直播引流</option><option value="organic">自然流</option><option value="brand_seeding">品牌种草</option><option value="other">其他</option></select></label><label>主指标<input value={form.primaryMetric} onChange={(e) => setForm({ ...form, primaryMetric: e.target.value })} /></label><label>必需指标（逗号分隔）<input value={form.requiredMetrics} onChange={(e) => setForm({ ...form, requiredMetrics: e.target.value })} /></label><label>最小样本指标<input value={form.minimumSampleMetric} onChange={(e) => setForm({ ...form, minimumSampleMetric: e.target.value })} /></label><label>最小样本值<input type="number" min="0" value={form.minimumSampleValue} onChange={(e) => setForm({ ...form, minimumSampleValue: e.target.value })} /></label><label>观察天数<input type="number" min="1" value={form.observationWindowDays} onChange={(e) => setForm({ ...form, observationWindowDays: e.target.value })} /></label>{(['S', 'APlus', 'A', 'B', 'BMinus', 'C'] as const).map((key) => <label key={key}>{key === 'APlus' ? 'A+' : key === 'BMinus' ? 'B-' : key} 阈值<input type="number" min="0" step="0.0001" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}</div><button className="button">创建草稿</button></form> : <p className="muted">只有管理员可以创建和审批 V1.1 Benchmark。</p>}
    <h3 className="section-gap">当前基准与版本</h3>
    <div className="table-scroll"><table className="table"><thead><tr><th scope="col">名称 / 版本</th><th scope="col">匹配范围</th><th scope="col">主指标 / 必需指标</th><th scope="col">等级阈值</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><div className="muted">v{item.version}</div></td><td>{item.platform} / {item.brand || '无品牌'} / {item.videoType}</td><td><strong>{item.primaryMetric}</strong><div className="muted">{item.requiredMetrics.join('、') || '-'}</div></td><td><details><summary>查看阈值</summary><table className="table"><thead><tr><th scope="col">S</th><th scope="col">A+</th><th scope="col">A</th><th scope="col">B</th><th scope="col">B-</th><th scope="col">C</th></tr></thead><tbody>{item.thresholds.map((threshold, index) => <tr key={index}><td>{threshold.sThreshold}</td><td>{threshold.aPlusThreshold}</td><td>{threshold.aThreshold}</td><td>{threshold.bThreshold}</td><td>{threshold.bMinusThreshold}</td><td>{threshold.cThreshold}</td></tr>)}</tbody></table></details></td><td>{item.status}<div className="muted">{item.enabled ? '启用' : '停用'}</div></td><td>{user?.role === 'admin' && item.status !== 'approved' ? <button className="button secondary" onClick={() => void approve(item.id)}>审批</button> : '-'}</td></tr>)}</tbody></table></div>
  </section>;
}
