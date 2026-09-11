import type { Metadata } from "next";
// 순서 고정: 원시 토큰 → 의미 토큰 → 전역 스타일.
// semantic.css 가 tokens.css 를 var() 로 참조하므로 tokens 가 먼저 와야 한다.
import "../styles/tokens.css";
import "../styles/semantic.css";
import "./globals.css";

/**
 * 루트 레이아웃 — <html>·<body>만 담는다.
 * 공개 셸(헤더/푸터)은 여기에 두지 않는다. /admin이 공개 셸을 상속하면 안 되기 때문이다.
 * 실제 <html lang>은 app/[locale]/layout.tsx가 로케일에 맞춰 다시 렌더한다.
 */
export const metadata: Metadata = {
  title: "베스트투어",
  description: "베스트투어 — 전세버스 대절 알선",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
