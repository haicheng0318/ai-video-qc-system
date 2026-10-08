'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { RoleCapability, roleLabels } from '@/lib/admin-types';

const capabilityLabels: Record<string, string> = { ownVideo: '本人视频', teamVideo: '团队视频', allVideos: '全部视频', contentReview: '内容评估', supervisorReview: '主管初审', resultData: '结果数据', finalConfirmation: '最终确认', caseManagement: '案例管理', dashboard: '业务看板', caseRead: '查看案例', admin: '后台管理' };

export default function AdminRolesPage() {
  const [items, setItems] = useState<RoleCapability[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { void apiFetch<{ items: RoleCapability[] }>('/api/admin/roles').then((result) => setItems(result.items)).catch((err) => setError(err instanceof Error ? err.message : '角色权限加载失败。')); }, []);
  const capabilities = Array.from(new Set(items.flatMap((item) => Object.keys(item.capabilities))));
  return <main className="page" id="main-content"><div className="page-title"><div><p className="eyebrow">后台管理</p><h1>角色权限</h1><p className="muted">权限矩阵来自后端配置，页面可见性不替代接口权限校验。</p></div></div><section className="panel">{error ? <p className="error" role="alert">{error}</p> : null}{!error && items.length === 0 ? <p className="muted" role="status">正在加载权限矩阵…</p> : null}{items.length ? <div className="table-scroll" tabIndex={0} aria-label="角色权限矩阵，可横向滚动"><table><thead><tr><th>角色</th>{capabilities.map((key) => <th key={key}>{capabilityLabels[key] || key}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.role}><th>{roleLabels[item.role] || item.role}</th>{capabilities.map((key) => <td key={key}>{item.capabilities[key] ? <span className="capability yes">允许</span> : <span className="capability no">不允许</span>}</td>)}</tr>)}</tbody></table></div> : null}</section></main>;
}
