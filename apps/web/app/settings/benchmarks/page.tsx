'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  resultMetricFieldDefinitions,
  resultMetricNumericFields,
  VideoType,
} from '@ai-video-qc/shared';
import { apiFetch, ApiUser } from '@/lib/api';

type Direction = 'higher_is_better' | 'lower_is_better';
type Benchmark = {
  id: string;
  platform: string;
  brand: string | null;
  videoType: VideoType;
  metricName: string;
  sThreshold: string;
  aThreshold: string;
  bThreshold: string;
  cThreshold: string;
  direction: Direction;
  enabled: boolean;
  updatedAt: string;
};

const videoTypes: Array<{ value: VideoType; label: string }> = [
  { value: 'product_card', label: '商品卡视频' },
  { value: 'qianchuan_ad', label: '千川投放视频' },
  { value: 'live_room_traffic', label: '直播间引流视频' },
  { value: 'organic', label: '自然流视频' },
  { value: 'brand_seeding', label: '品牌种草视频' },
  { value: 'other', label: '其他' },
];

const emptyForm = {
  platform: '抖音', brand: '', videoType: 'product_card' as VideoType,
  metricName: 'views', sThreshold: '', aThreshold: '', bThreshold: '', cThreshold: '',
  direction: 'higher_is_better' as Direction, enabled: true,
};

export default function PlatformBenchmarksPage() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [items, setItems] = useState<Benchmark[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const canManage = user?.role === 'admin' || user?.role === 'content_owner';
  const metricOptions = useMemo(() => resultMetricNumericFields.map((name) => ({
    name,
    label: resultMetricFieldDefinitions[name].label,
  })), []);

  const load = useCallback(async () => {
    setError('');
    try {
      const [me, result] = await Promise.all([
        apiFetch<{ user: ApiUser }>('/api/auth/me'),
        apiFetch<{ items: Benchmark[] }>('/api/platform-benchmarks'),
      ]);
      setUser(me.user);
      setItems(result.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '平台基准加载失败。');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        brand: form.brand.trim() || null,
        sThreshold: Number(form.sThreshold),
        aThreshold: Number(form.aThreshold),
        bThreshold: Number(form.bThreshold),
        cThreshold: Number(form.cThreshold),
      };
      await apiFetch(editingId ? `/api/platform-benchmarks/${editingId}` : '/api/platform-benchmarks', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      setEditingId(null);
      setForm(emptyForm);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '平台基准保存失败。');
    } finally {
      setSaving(false);
    }
  }

  function edit(item: Benchmark) {
    setEditingId(item.id);
    setForm({
      platform: item.platform,
      brand: item.brand || '',
      videoType: item.videoType,
      metricName: item.metricName,
      sThreshold: item.sThreshold,
      aThreshold: item.aThreshold,
      bThreshold: item.bThreshold,
      cThreshold: item.cThreshold,
      direction: item.direction,
      enabled: item.enabled,
    });
  }

  return <main className="page">
    <div className="page-title"><div><h1>平台基准配置</h1><p className="muted">用于千问数据复盘的相对表现判断；品牌留空表示平台通用基准。</p></div></div>
    {error ? <p className="error">{error}</p> : null}
    {canManage ? <section className="panel section-gap">
      <h2>{editingId ? '编辑基准' : '新增基准'}</h2>
      <form onSubmit={save}>
        <div className="form-grid">
          <label>平台<input required maxLength={100} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} /></label>
          <label>品牌（可选）<input maxLength={100} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label>
          <label>视频类型<select value={form.videoType} onChange={(e) => setForm({ ...form, videoType: e.target.value as VideoType })}>{videoTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>指标<select value={form.metricName} onChange={(e) => setForm({ ...form, metricName: e.target.value })}>{metricOptions.map((item) => <option key={item.name} value={item.name}>{item.label}（{item.name}）</option>)}</select></label>
          <label>S 阈值<input required type="number" min="0" step="0.0001" value={form.sThreshold} onChange={(e) => setForm({ ...form, sThreshold: e.target.value })} /></label>
          <label>A 阈值<input required type="number" min="0" step="0.0001" value={form.aThreshold} onChange={(e) => setForm({ ...form, aThreshold: e.target.value })} /></label>
          <label>B 阈值<input required type="number" min="0" step="0.0001" value={form.bThreshold} onChange={(e) => setForm({ ...form, bThreshold: e.target.value })} /></label>
          <label>C 阈值<input required type="number" min="0" step="0.0001" value={form.cThreshold} onChange={(e) => setForm({ ...form, cThreshold: e.target.value })} /></label>
          <label>方向<select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}><option value="higher_is_better">越高越好（S ≥ A ≥ B ≥ C）</option><option value="lower_is_better">越低越好（S ≤ A ≤ B ≤ C）</option></select></label>
          <label><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> 启用</label>
        </div>
        <button className="button" disabled={saving}>{saving ? '保存中' : editingId ? '保存修改' : '新增基准'}</button>
        {editingId ? <button className="button secondary" type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>取消编辑</button> : null}
      </form>
    </section> : <p className="muted">只有管理员和内容负责人可以管理平台基准。</p>}
    <section className="panel section-gap"><h2>现有基准</h2><div className="table-scroll"><table className="table"><thead><tr><th>平台/品牌</th><th>视频类型</th><th>指标</th><th>S/A/B/C</th><th>方向</th><th>状态</th>{canManage ? <th>操作</th> : null}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.platform} / {item.brand || '通用'}</td><td>{videoTypes.find((type) => type.value === item.videoType)?.label}</td><td>{resultMetricFieldDefinitions[item.metricName as keyof typeof resultMetricFieldDefinitions]?.label || item.metricName}</td><td>{item.sThreshold} / {item.aThreshold} / {item.bThreshold} / {item.cThreshold}</td><td>{item.direction === 'higher_is_better' ? '越高越好' : '越低越好'}</td><td>{item.enabled ? '启用' : '停用'}</td>{canManage ? <td><button className="button secondary" onClick={() => edit(item)}>编辑</button></td> : null}</tr>)}</tbody></table></div></section>
  </main>;
}
