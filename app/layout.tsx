import type { Metadata } from "next";
// 글꼴(P7-3): Pretendard Variable 동적 서브셋 @font-face — 자체 호스팅(public/fonts/pretendard). 스택은 globals.css 의 body.
// 이 레이아웃 아래에 공개 셸·관리자·전역 404 가 모두 있어 여기서 한 번 싣는다.
import "../styles/pretendard.css";
// 순서 고정: 원시 토큰 → 의미 토큰 → 전역 스타일.
// semantic.css 가 tokens.css 를 var() 로 참조하므로 tokens 가 먼저 와야 한다.
import "../styles/tokens.css";
import "../styles/semantic.css";
import "./globals.css";

import { COMPANY } from "@/lib/legal/disclosures";
import ko from "@/messages/ko.json";

/**
 * 루트 레이아웃 — <html>·<body>만 담는다.
 * 공개 셸(헤더/푸터)은 여기에 두지 않는다. /admin이 공개 셸을 상속하면 안 되기 때문이다.
 * 실제 <html lang>은 app/[locale]/layout.tsx가 로케일에 맞춰 다시 렌더한다.
 *
 * 기본 제목은 원장 브랜드(COMPANY.brandName — 사장님 요청 14 · 2026-10-10 간판 변경), 설명은 ko 카탈로그 common.description —
 * 로케일 레이아웃의 ko 메타(common.siteName · description)와 같은 글자다. 상호를 여기 다시 적지 않는다.
 */
export const metadata: Metadata = {
  title: COMPANY.brandName,
  description: ko.common.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
