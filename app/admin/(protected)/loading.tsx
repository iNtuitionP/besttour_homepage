import { AdminSkeleton } from "@/components/admin/AdminSkeleton";

/**
 * 탭 사이를 옮길 때 누르는 즉시 본문 자리에 뜨는 로딩 화면 (P5-18).
 *
 * 탭 바는 (protected) 레이아웃에 있어 그대로 남고(선택 표시도 누르는 즉시 옮겨 간다), 본문만 스켈레톤으로 바뀐 뒤
 * 서버 응답이 오면 채워진다. 예전에는 경계가 없어 응답이 올 때까지 화면이 멈춰 있었고, 동적 화면이라 링크 프리페치로 미리 받을 것도 없었다.
 *
 * **이 파일은 게이트와 무관하게 렌더된다** (P5-18 독립 리뷰 P1-1). Next 는 loading 을 레이아웃의 자식이 아니라 같은 세그먼트의
 * **형제 칸**(loadingData)으로 직렬화한다(next/dist/server/app-render/create-component-tree.js) — 레이아웃의 `await requireAdmin()` 이
 * 이 렌더를 막지 않는다. 실측: 비로그인 요청의 307 응답에도 이 스켈레톤이 RSC 페이로드로 실려 있었다(P5-18 보고서 7-6).
 * **그래서 규칙은 '데이터 0' 이다** — 정적 스켈레톤 하나만 그린다(async 0 · import 는 AdminSkeleton 하나). scripts/check-admin-gate.mjs
 * 규칙 7 과 tests/admin-speed.test.ts §3-c 가 파일시스템에서 모든 loading 을 찾아 잠근다. 데이터가 필요하면 loading 이 아니라 page 에 둔다.
 *
 * 게이트 레이아웃과 같은 폴더(레이아웃 안쪽)에 두어 지켜지는 것은 **비로그인 전체 로드의 307 상태코드** 하나뿐이다 — 셸이 게이트보다
 * 먼저 흘러나가지 않는다. 그래서 이 폴더의 조상(app/admin · app)에는 loading 을 두지 않는다(게이트 규칙 8 · §3-c 가 조상을 유도해 잠근다).
 *
 * 구역 안의 목록↔상세 이동은 상세가 있는 네 구역(reservations·popups·notices·routes)의 loading.tsx 가 맡는다.
 * **필터·이전/다음 페이지처럼 주소의 ?쿼리만 바뀌는 이동에는 어떤 loading.tsx 도 뜨지 않는다** — Next 가 같은 화면의 경계를 쿼리 없이
 * 식별해 그대로 두기 때문이다(실측: 응답이 올 때까지 이전 화면·이전 주소가 남는다). 그 이동의 대기는 지역 이전(icn1)으로 줄인다.
 */
export default function AdminLoading() {
  return <AdminSkeleton />;
}
