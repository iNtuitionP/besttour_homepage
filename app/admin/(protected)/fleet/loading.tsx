import { AdminSkeleton } from "@/components/admin/AdminSkeleton";

/**
 * 차량 목록↔새 차량·수정 화면을 옮길 때 누르는 즉시 뜨는 로딩 화면 (T4-1 · routes/loading.tsx 와 같은 규약).
 * 게이트와 무관하게 렌더될 수 있어 데이터 0 — 스켈레톤 하나만 그린다(게이트 규칙 7).
 */
export default function FleetLoading() {
  return <AdminSkeleton />;
}
