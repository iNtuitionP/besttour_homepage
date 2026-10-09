"use server";
/**
 * 관리자 대표 노선 서버액션 — 얇은 래퍼 (플랜 v4 P5-6 · ADR-3·ADR-4).
 *
 * 순서: requireAdmin() → zod → DB 한 번 → 바뀌었으면 무효화. **로직 0** —
 * 입력 검증은 lib/admin/routeInput.ts(순수)에서, 쿼리는 lib/admin/routes.ts(세션 클라이언트 + RLS)에서 테스트된다.
 *
 * **export 가 둘뿐인 것이 이 파일의 핵심이다.** 'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 되므로
 * (ADR-3) 노선을 만들거나 지우는 엔드포인트가 **존재하지 않는다** — 화면에서 버튼을 감춘 것이 아니라 경로가 없다.
 * 대표 노선 16개는 스펙 §13.2 가 고정하고 0002 가 지도 핀과 FK 로 묶은 집합이다(근거는 lib/admin/routes.ts 헤더).
 *
 * **가격.** price_from 은 사장님이 직접 넣는 정적 표시값이고, 이 파일은 그 값을 검증된 그대로 넘긴다 —
 * 계산·유도 0(CLAUDE.md §3 · npm run check:pricing).
 *
 * 경계 규칙 (actions/admin/popup.ts 와 같은 규약)
 *   - 두 함수 모두 본문 첫 문장이 `await requireAdmin();` 이고, 게이트는 별칭 없이 정본 이름으로 가져온다.
 *   - 서비스 롤을 쓰지 않는다(ADR-2). DB 에서 한 번 더 막는 것은 0020 의 definer 함수 첫 문장 `is_admin()` 가드다(P5-16 · D10).
 *   - 예외는 여기서 끝난다. 단 requireAdmin() 의 redirect 는 throw 로 전파돼야 하므로 게이트는 try 밖에 있다.
 *   - 로그에 남기는 것은 노선 id 와 결과 코드뿐이다(가격·코드는 싣지 않는다).
 *   - **바뀐 것이 없으면 무효화하지 않는다.**
 */
import { revalidatePath } from "next/cache";

import {
  ROUTE_DUPLICATE,
  ROUTE_FAILED,
  ROUTE_FIELDS,
  ROUTE_NOT_FOUND,
  parseRouteForm,
  parseRouteId,
  routeChanged,
  routeValidationFailed,
  type RouteActionCode,
  type RouteActionResult,
} from "@/lib/admin/routeInput";
import { PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE } from "@/lib/admin/publicRevalidate";
import { ADMIN_ROUTES_PATH, setRouteActive, updateRouteRow, type RouteWriteOutcome } from "@/lib/admin/routes";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";

/** 이 파일이 남기는 로그의 전부. */
interface AdminRouteLogEntry extends StructuredLogEntry {
  id: number | null;
  outcome: RouteActionCode;
}

type RouteAction = "update" | "toggle";

const EVENT: Record<RouteAction, string> = {
  update: "admin.route.update",
  toggle: "admin.route.toggle",
};

function report(action: RouteAction, id: number | null, result: RouteActionResult): RouteActionResult {
  const entry: AdminRouteLogEntry = {
    level: result.ok ? "info" : "error",
    event: EVENT[action],
    id,
    outcome: result.code,
  };
  structuredLog(entry);
  return result;
}

/** 쓰기 한 번 → 결과 매핑 → 바뀌었으면 무효화. duplicate 는 실패와 구분한다(사장님이 고칠 수 있는 오류다). */
async function apply(action: RouteAction, id: number, code: RouteActionCode, write: () => Promise<RouteWriteOutcome>): Promise<RouteActionResult> {
  let outcome: RouteWriteOutcome;
  try {
    outcome = await write();
  } catch {
    return report(action, id, ROUTE_FAILED);
  }
  if (outcome === "duplicate") return report(action, id, ROUTE_DUPLICATE);
  if (outcome === "unchanged") return report(action, id, ROUTE_NOT_FOUND);

  runAfter(() => {
    // 공개 화면(홈 지도·/fares)을 실제로 새로 그리게 하는 것은 **이 한 줄뿐**이다 — 근거·실측표는 lib/admin/publicRevalidate.ts.
    revalidatePath(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
    // 아래 태그는 지금 소비자가 없다(공개 읽기가 unstable_cache 로 감싸여 있지 않다). 누가 감싸는 날을 위한 배선이지 반영 수단이 아니다.
    revalidate(QUERY_TAGS.showcase);
    revalidatePath(ADMIN_ROUTES_PATH);
  });
  return report(action, id, routeChanged(code));
}

/** 노선 한 줄의 값을 덮어쓴다. id 는 폼의 숨은 필드로 온다 — 없거나 형식이 틀리면 검증 실패다. */
export async function updateRoute(formData: FormData): Promise<RouteActionResult> {
  await requireAdmin();
  const id = parseRouteId(formData.get(ROUTE_FIELDS.id));
  if (id === null) return report("update", null, routeValidationFailed({ id: true }));
  const parsed = parseRouteForm(formData);
  if (!parsed.ok) return report("update", id, parsed.result);
  return apply("update", id, "updated", () => updateRouteRow(id, parsed.value));
}

/** 목록에서 한 번에 내리고 올리기. 내린 노선은 홈 지도·카드에서 빠지고 나머지 컬럼은 그대로 남는다. */
export async function toggleRouteActive(id: number, active: boolean): Promise<RouteActionResult> {
  await requireAdmin();
  const routeId = parseRouteId(id);
  if (routeId === null) return report("toggle", null, routeValidationFailed({ id: true }));
  return apply("toggle", routeId, active ? "activated" : "deactivated", () => setRouteActive(routeId, active));
}
