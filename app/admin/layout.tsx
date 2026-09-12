import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "베스트투어 관리자",
  robots: { index: false, follow: false },
};

/**
 * 요청마다 렌더한다 (REVIEW-FIX M8 — 리뷰 2026-09-11 실측: /admin 이 ○ Static + Cache-Control: s-maxage=31536000 + x-nextjs-prerender).
 * 인증 게이트(P5-1)는 요청마다 평가돼야 하고, 관리자 응답은 어떤 것도 CDN 에 남으면 안 된다. 정적 프리렌더로 두면
 * P5-1 이 RSC 에 requireAdmin() 을 넣어도 프리렌더된 HTML 이 게이트를 한 번도 거치지 않고 캐시에서 나간다.
 * 레이아웃의 세그먼트 설정은 /admin 아래 라우트 전부에 적용된다.
 */
export const dynamic = "force-dynamic";

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
