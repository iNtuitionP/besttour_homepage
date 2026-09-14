import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "베스트투어 관리자",
  robots: { index: false, follow: false },
};

/**
 * 요청마다 렌더한다 (REVIEW-FIX M8 — 리뷰 2026-09-11 실측: /admin 이 ○ Static + Cache-Control: s-maxage=31536000 + x-nextjs-prerender).
 * 인증 게이트(P5-1)는 요청마다 평가돼야 하고, 관리자 응답은 어떤 것도 CDN 에 남으면 안 된다. 정적 프리렌더로 두면
 * P5-1 이 RSC 에 requireAdmin() 을 넣어도 프리렌더된 HTML 이 게이트를 한 번도 거치지 않고 캐시에서 나간다.
 * 레이아웃의 세그먼트 설정은 /admin 아래 라우트 전부에 적용된다 — 로그인 화면도 포함이다(no-store).
 */
export const dynamic = "force-dynamic";

/**
 * 관리자 셸 — 로케일 밖(로케일 프리픽스 없음). <html>·<body> 만 만든다.
 * 공개 헤더/푸터를 상속하지 않는다. 공개 셸 컴포넌트를 여기에 import 하지 말 것.
 *
 * **인증 게이트는 여기가 아니라 app/admin/(protected)/layout.tsx 에 있다** (P5-1).
 * 로그인 화면(/admin/login)과 매직링크 콜백(/admin/auth/callback)은 이 셸 안에 있지만 (protected) 밖이다 —
 * 게이트를 이 파일에 두면 로그인 화면이 자기 자신으로 무한 리다이렉트한다. 경로 분기(pathname === "/admin/login")로
 * 예외를 파는 대신 **라우트 구조로** 나눈다: 분기는 조건을 하나 놓치는 순간 뚫리지만, 구조는 파일 위치가 곧 규칙이다.
 * 라우트 그룹 `(protected)` 는 URL 에 나타나지 않으므로 /admin 주소는 그대로다.
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
