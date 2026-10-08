'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { UserCreateForm } from '@/components/admin/user-create-form';
import { apiFetch } from '@/lib/api';
import { ManagedUser, roleLabels, UserListResponse } from '@/lib/admin-types';

const statusLabels = { active: '启用', disabled: '停用', archived: '已归档' } as const;

export default function AdminUsersPage() {
  const [result, setResult] = useState<UserListResponse>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (search = '') => {
    setLoading(true); setError('');
    try { setResult(await apiFetch<UserListResponse>(`/api/admin/users?page=1&pageSize=20&search=${encodeURIComponent(search)}`)); }
    catch (err) { setError(err instanceof Error ? err.message : '账号列表加载失败。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function search(event: FormEvent) { event.preventDefault(); void load(query.trim()); }
  function add(user: ManagedUser) { setResult((current) => ({ ...current, total: current.total + 1, items: [user, ...current.items].slice(0, current.pageSize) })); }

  return <main className="page" id="main-content">
    <div className="page-title"><div><p className="eyebrow">后台管理</p><h1>账号管理</h1><p className="muted">创建账号、查看状态与进入单个账号的会话和额度管理。</p></div></div>
    <section className="panel">
      <form className="toolbar" onSubmit={search}><div className="form-field"><label htmlFor="user-search">搜索账号或姓名</label><input id="user-search" value={query} onChange={(event) => setQuery(event.target.value)} /></div><button className="button secondary" type="submit" disabled={loading}>查询</button></form>
      {error ? <div className="error-state" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={() => void load(query)}>重试</button></div> : null}
      {!error && loading ? <p className="muted" role="status">正在加载账号…</p> : null}
      {!error && !loading && result.items.length === 0 ? <p className="empty-state">没有符合条件的账号。</p> : null}
      {!error && result.items.length > 0 ? <div className="table-scroll" tabIndex={0} aria-label="账号列表，可横向滚动"><table><thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>到期时间</th><th>操作</th></tr></thead><tbody>{result.items.map((user) => <tr key={user.id}><td>{user.account}</td><td>{user.name}</td><td>{roleLabels[user.role] || user.role}</td><td><span className={`status-badge ${user.status}`}>{statusLabels[user.status]}</span></td><td>{user.expiresAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(user.expiresAt)) : '长期有效'}</td><td><Link className="text-link" href={`/admin/users/${user.id}`}>查看详情</Link></td></tr>)}</tbody></table></div> : null}
      <p className="muted">共 {result.total} 个账号</p>
    </section>
    <div className="section-gap"><UserCreateForm onCreated={add} /></div>
  </main>;
}
