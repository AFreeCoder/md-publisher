import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '锦章 Jinzhang · Markdown 发布助手',
  description:
    '让文字，锦绣成章。贴入 Markdown，预览公众号排版或知乎结构，复制到平台编辑器。正文在本地处理，无需注册。',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
