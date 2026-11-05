import './globals.css';
import './experience.css';
import { AuthBoundary } from '@/components/auth-boundary';
import { AppShell } from '@/components/app-shell';
import { PRODUCT_VERSION } from '@ai-video-qc/shared';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

export const metadata = {
  title: `AI短视频质检评估系统 V${PRODUCT_VERSION}`,
  description: '内容中台 AI 短视频质检与有效产出评定系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body>
        <AuthBoundary>
          <AppShell>{children}</AppShell>
        </AuthBoundary>
      </body>
    </html>
  );
}
