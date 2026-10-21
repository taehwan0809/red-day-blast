import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '빨간날 폭격기 — RED DAY BLAST', description: '다음 빨간날, 얼마나 남았을까? 한국 공휴일과 황금연휴를 한눈에.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body>{children}</body></html>; }
