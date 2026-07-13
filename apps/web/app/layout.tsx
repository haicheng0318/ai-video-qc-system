import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'AI短视频质检评估系统 V1.0',
  description: 'Content middle-platform video quality control system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <nav className="topbar">
            <Link className="brand" href="/videos">
              AI短视频质检评估系统 V1.0
            </Link>
            <Link href="/videos">视频列表</Link>
            <Link href="/videos/new">上传视频</Link>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
