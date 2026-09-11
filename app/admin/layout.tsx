import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "베스트투어 관리자",
  robots: { index: false, follow: false },
};

/**
 * 관리자 셸 — 로케일 밖(로케일 프리픽스 없음).
 * 공개 헤더/푸터를 상속하지 않는다. 공개 셸 컴포넌트를 여기에 import 하지 말 것.
 * 인증 게이트는 P5-1에서 middleware + 이 레이아웃에 들어온다.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
