import { requireAdmin } from "@/lib/auth/requireAdmin";

/**
 * 보호 구역 — 이 아래의 모든 라우트는 렌더 전에 requireAdmin() 을 통과한다 (P5-1).
 *
 * 라우트 그룹이라 URL 에는 나타나지 않는다: /admin 은 여전히 /admin 이다.
 * 로그인 화면·콜백은 이 그룹 밖(app/admin/login, app/admin/auth/callback)에 있어 게이트를 타지 않는다 —
 * 경로 예외를 코드로 파지 않고 구조로 나눈 이유는 app/admin/layout.tsx 주석 참조.
 *
 * 게이트를 통과하지 못하면 requireAdmin() 이 /admin/login 으로 redirect 한다(= throw). 아래 화면은 렌더되지 않는다.
 * 세션 정보를 children 에 props 로 내리지 않는다 — 필요한 화면이 자기 자리에서 다시 requireAdmin() 을 부른다
 * (호출이 싸고, 화면 하나하나가 스스로 잠기는 편이 안전하다). P5-3~6 의 탭 화면이 그 규약을 따른다.
 */
export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return <>{children}</>;
}
