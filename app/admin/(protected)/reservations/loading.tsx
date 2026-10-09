import { AdminSkeleton } from "@/components/admin/AdminSkeleton";

/**
 * 예약 목록↔상세를 옮길 때 누르는 즉시 뜨는 로딩 화면 (P5-18). 탭 사이 이동은 (protected)/loading.tsx 가 맡는다.
 * 상태 필터·이전/다음 페이지(?쿼리만 바뀌는 이동)에는 뜨지 않는다 — 이유는 (protected)/loading.tsx 헤더.
 * **게이트와 무관하게 렌더된다** — 클라이언트 이동에서 서버가 공유 레이아웃을 건너뛰면 (protected) 게이트가 한 번도 돌지 않은 채 이 파일이
 * 렌더될 수 있다. 그래서 데이터 0: 스켈레톤 하나만 그린다(규약·근거는 components/admin/AdminSkeleton.tsx 헤더 · 게이트 규칙 7).
 */
export default function ReservationsLoading() {
  return <AdminSkeleton />;
}
