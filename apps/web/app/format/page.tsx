'use client';
import dynamic from 'next/dynamic';
const Workspace = dynamic(() => import('./workspace'), {
  ssr: false,
  loading: () => <div className="empty-state">正在准备排版工作区…</div>,
});
export default function FormatPage() {
  return <Workspace />;
}
