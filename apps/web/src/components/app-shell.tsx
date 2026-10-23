'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, ApiUser } from '@/lib/api';
import { PRODUCT_VERSION } from '@ai-video-qc/shared';

const authPaths = new Set(['/login', '/admin/login']);
const businessLinks = [
  ['/videos', '视频任务'], ['/videos/new', '上传视频'], ['/dashboard', '结果看板'],
  ['/cases/excellent', '案例库'], ['/settings/benchmarks', '评价基准'],
] as const;
const adminLinks = [['/admin', '系统总览'], ['/admin/users', '用户管理'], ['/admin/roles', '角色权限'], ['/admin/operations', '运行与配置']] as const;

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
    <div className={`app-shell${admin ? ' admin-shell' : ''}${pathname.startsWith('/settings/') ? ' content-shell' : ''}`} onKeyDown={(event) => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('navigation-toggle')?.focus(); } }}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="mobile-header">
        <Link className="brand" href={admin ? '/admin' : '/videos'}>AI QC <small>V{PRODUCT_VERSION}</small></Link>
        <button id="navigation-toggle" type="button" className="menu-button" aria-label={menuOpen ? '关闭导航' : '打开导航'} aria-controls="workspace-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><span aria-hidden="true">{menuOpen ? '×' : '☰'}</span></button>
      </header>
      {menuOpen ? <button type="button" tabIndex={-1} className="navigation-overlay" aria-label="关闭导航" onClick={() => setMenuOpen(false)} /> : null}
      <aside id="workspace-navigation" className={`sidebar${menuOpen ? ' open' : ''}`} aria-label={admin ? '管理端导航' : '工作台导航'}>
        <Link className="sidebar-brand" href={admin ? '/admin' : '/videos'}>
          <span>AI QC</span><strong>短视频质检评估</strong><small>V{PRODUCT_VERSION}</small>
        </Link>
        <nav>
          {links.map(([href, label]) => {
            const active = href === '/admin' ? pathname === href : href === '/videos' ? pathname === href || (pathname.startsWith('/videos/') && pathname !== '/videos/new') : href === '/cases/excellent' ? pathname.startsWith('/cases/') : pathname.startsWith(href);
            const group = admin ? href === '/admin' ? '管理工作台' : href === '/admin/users' ? '用户与权限' : href === '/admin/operations' ? '运行、配置与审计' : null : href === '/videos' ? '工作台' : href === '/dashboard' ? '分析' : href === '/settings/benchmarks' ? '业务配置' : null;
            return <div className="nav-item" key={href}>{group ? <p className="nav-group-label">{group}</p> : null}<Link className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} href={href} onClick={() => setMenuOpen(false)}><span className="nav-marker" aria-hidden="true" />{label}</Link></div>;
          })}
        </nav>
        <div className="sidebar-footer">
          {admin ? <Link href="/videos" onClick={() => setMenuOpen(false)}>返回业务工作台</Link> : user?.role === 'admin' ? <Link href="/admin" onClick={() => setMenuOpen(false)}>系统管理</Link> : null}
          <button type="button" onClick={() => void logout()}>退出登录</button>
        </div>
      </aside>
      <div className="app-content" inert={menuOpen}>
        {user?.role === 'visitor' && quotaSummary ? <div className="visitor-banner" role="status"><strong>访客试用账号</strong><span>到期：{quotaSummary.expiresAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(quotaSummary.expiresAt)) : '未设置'}</span>{quotaSummary.quotas.map((quota) => <span key={quota.kind}>{quota.kind === 'upload_count' ? '上传' : quota.kind === 'storage_bytes' ? '存储字节' : '内容评估'}剩余：{quota.remaining === null ? '不限' : quota.remaining}</span>)}</div> : null}
        {children}
      </div>
    </div>
  );
}
