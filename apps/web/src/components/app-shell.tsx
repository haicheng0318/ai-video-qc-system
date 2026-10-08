'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, ApiUser } from '@/lib/api';

const authPaths = new Set(['/login', '/admin/login']);
const businessLinks = [
  ['/videos', '视频列表'], ['/videos/new', '上传评估'], ['/dashboard', '业务看板'],
  ['/cases/excellent', '优秀案例'], ['/cases/negative', '反面案例'], ['/settings/benchmarks', '基准配置'],
] as const;
const adminLinks = [['/admin', '总览'], ['/admin/users', '账号管理'], ['/admin/roles', '角色权限'], ['/admin/operations', '管理运行中心']] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [quotaSummary, setQuotaSummary] = useState<{ expiresAt?: string | null; quotas: Array<{ kind: string; remaining: number | null }> } | null>(null);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (authPaths.has(pathname)) return;
    let active = true;
    void apiFetch<{ user: ApiUser }>('/api/auth/me').then(async ({ user: identity }) => {
      if (!active) return;
      setUser(identity);
      if ((pathname === '/admin' || pathname.startsWith('/admin/')) && identity.role !== 'admin') { router.replace('/videos'); return; }
      if (identity.role === 'visitor') {
        const summary = await apiFetch<{ expiresAt?: string | null; quotas: Array<{ kind: string; remaining: number | null }> }>('/api/auth/quotas');
        if (active) setQuotaSummary(summary);
      } else setQuotaSummary(null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [pathname, router]);

  if (authPaths.has(pathname)) return children;
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  const links = admin ? adminLinks : user?.role === 'visitor' ? businessLinks.slice(0, 2) : businessLinks;

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => undefined);
    router.replace(admin ? '/admin/login' : '/login');
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="mobile-header">
        <Link className="brand" href={admin ? '/admin' : '/videos'}>AI短视频质检</Link>
        <button type="button" className="menu-button" aria-label="切换导航" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>菜单</button>
      </header>
      <aside className={`sidebar${menuOpen ? ' open' : ''}`} aria-label={admin ? '管理端导航' : '工作台导航'}>
        <Link className="sidebar-brand" href={admin ? '/admin' : '/videos'}>
          <span>AI QC</span><strong>短视频质检评估</strong><small>V1.01</small>
        </Link>
        <nav>
          {links.map(([href, label]) => {
            const active = href === '/admin' || href === '/videos' ? pathname === href : pathname.startsWith(href);
            return <Link key={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} href={href}>{label}</Link>;
          })}
        </nav>
        <div className="sidebar-footer">
          {admin ? <Link href="/videos">返回业务工作台</Link> : user?.role === 'admin' ? <Link href="/admin">后台管理</Link> : null}
          <button type="button" onClick={() => void logout()}>退出登录</button>
        </div>
      </aside>
      <div className="app-content">
        {user?.role === 'visitor' && quotaSummary ? <div className="visitor-banner" role="status"><strong>访客试用账号</strong><span>到期：{quotaSummary.expiresAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(quotaSummary.expiresAt)) : '未设置'}</span>{quotaSummary.quotas.map((quota) => <span key={quota.kind}>{quota.kind === 'upload_count' ? '上传' : quota.kind === 'storage_bytes' ? '存储字节' : '内容评估'}剩余：{quota.remaining === null ? '不限' : quota.remaining}</span>)}</div> : null}
        {children}
      </div>
    </div>
  );
}
