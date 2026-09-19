import './globals.css';
import { AuthBoundary } from '@/components/auth-boundary';
import { AppShell } from '@/components/app-shell';

export const metadata = {
  title: 'AI短视频质检评估系统 V1.01',
  description: '内容中台 AI 短视频质检与有效产出评定系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthBoundary>
          <AppShell>{children}</AppShell>
        </AuthBoundary>
      </body>
    </html>
  );
}
