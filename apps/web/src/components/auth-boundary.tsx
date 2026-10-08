'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, ApiUser } from '@/lib/api';

const publicPaths = new Set(['/login', '/admin/login']);

export function AuthBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(publicPaths.has(pathname));

  useEffect(() => {
    let active = true;
    if (publicPaths.has(pathname)) {
      setAuthorized(true);
      return () => { active = false; };
    }

    setAuthorized(false);
    void apiFetch<{ user: ApiUser }>('/api/auth/me')
      .then(({ user }) => {
        if (!active) return;
        if (user.mustChangePassword && pathname !== '/change-password') {
          router.replace('/change-password');
          return;
        }
        setAuthorized(true);
      })
      .catch(() => {
        if (active) router.replace('/login');
      });
    return () => { active = false; };
  }, [pathname, router]);

  if (!authorized) {
    return (
      <main className="page">
        <div className="panel">正在验证登录状态……</div>
      </main>
    );
  }

  return children;
}
