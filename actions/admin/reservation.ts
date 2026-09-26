"use server";
/**
 * 관리자 상태 전이 서버액션 — 얇은 래퍼 (플랜 v4 P5-3 · ADR-3·ADR-4).
 *
 * 순서: requireAdmin() → 0010 의 rpc 한 번 → 결과 매핑 → 바뀌었으면 무효화. **로직 0** —
 * 원자성(경합 방어·중복 통지 차단)은 전부 0010 의 SQL 함수 안에 있고, 결과 해석은 lib/admin/result.ts 에서 테스트된다.
 * 여기서 status 를 읽어 판단하지 않는다: 읽고 → 쓰는 순간 두 번 클릭이 통지를 두 번 쌓는다.
 *
 * 경계 규칙
 *   - export 는 async 함수 4개뿐이다(ADR-3 — 'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다).
 *     그래서 네 함수 모두 **자기 자리에서, 본문 첫 문장으로** requireAdmin() 을 부른다. 화면의 게이트를 믿지 않는다.
 *     P5-4 개정: 게이트를 공용 run() 안에 두던 것을 **export 마다 첫 문장**으로 끌어올렸다. 동작은 같지만
 *     (그때도 rpc 앞이었다) 게이트가 한 단계 안쪽에 있으면 scripts/check-admin-gate.sh 가 구조로 확인할 수 없다 —
 *     "첫 문장이 게이트인가" 만이 조건부·try/catch·앞선 early return 을 한꺼번에 막는다(P5-3 독립 리뷰 §재-2 (가)(나)(라)).
 *   - 서비스 롤을 쓰지 않는다(ADR-2). 0010 함수는 definer 라 RLS 를 우회하지만, **함수 자신이 is_admin() 을 확인한다** —
 *     그래서 세션(anon 키 + 쿠키) 클라이언트로 부르는 것이 맞고, 세션이 관리자가 아니면 DB 가 42501 로 거절한다.
 *     확정 뒤의 즉시 발송(P4-7)은 응답 뒤에 도는 **서버 쪽 발송기**이고 크론과 같은 클라이언트를 쓴다(lib/notify/deps.ts) —
 *     이 파일은 트리거 이름만 넘기고, 관리자 조회·전이에 서비스 롤을 쓰지 않는다는 규칙은 그대로다.
 *   - 예외는 여기서 끝난다. 서버액션이 throw 하면 Next 가 500 과 다이제스트만 내고 사장님 화면은 아무 말도 못 한다.
 *     단 requireAdmin() 의 redirect 는 throw 로 전파돼야 한다(그것이 리다이렉트의 구현이다).
 *   - 로그에 개인정보 0: 남기는 것은 `id`(uuid)와 `outcome`(고정 어휘)뿐이다. 이름·전화·메모 본문·DB 오류 원문은 싣지 않는다 —
 *     Postgres 오류 메시지에는 행 내용이 섞여 올 수 있다.
 *   - `noop` 은 오류가 아니다(이미 처리된 예약). 바뀐 것이 없으므로 무효화도 하지 않는다.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { isUuid } from "@/lib/admin/reservations";
import {
  ADMIN_REVALIDATE_PATH,
  ADMIN_RPC,
  FAILED_RESULT,
  toActionResult,
  type AdminAction,
  type AdminActionCode,
  type AdminActionResult,
} from "@/lib/admin/result";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { notifyAfterResponse } from "@/lib/notify/deps";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";
import { createSsrClient } from "@/lib/supabase/ssr";

/** 이 파일이 남기는 로그의 전부. 필드를 늘리기 전에 그것이 개인정보가 아닌지 먼저 확인할 것. */
interface AdminReservationLogEntry extends StructuredLogEntry {
  /** 예약 uuid. 경로에도 이것만 들어간다(URL 에 개인정보 금지). uuid 가 아니면 "invalid". */
  id: string;
  outcome: AdminActionCode;
}

const EVENT: Record<AdminAction, string> = {
  confirm: "admin.reservation.confirm",
  cancel: "admin.reservation.cancel",
  complete: "admin.reservation.complete",
  memo: "admin.reservation.memo",
};

/** 메모 상한 — 제공자 응답 덤프·붙여넣기 사고가 통째로 들어오지 않게(lib/notify/outbox.ts 와 같은 발상). */
const MEMO_MAX_CHARS = 2000;

/** 공백뿐이면 null — 0010 의 confirm·cancel 은 null 을 "메모를 바꾸지 않는다", memo 는 "메모를 지운다" 로 읽는다. */
function normalizeMemo(memo: string | null | undefined): string | null {
  if (typeof memo !== "string") return null;
  const trimmed = memo.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MEMO_MAX_CHARS);
}

function report(action: AdminAction, id: string, result: AdminActionResult): AdminActionResult {
  const entry: AdminReservationLogEntry = {
    level: result.ok ? "info" : "error",
    event: EVENT[action],
    id: isUuid(id) ? id : "invalid",
    outcome: result.code,
  };
  structuredLog(entry);
  return result;
}

/** 게이트를 통과한 뒤의 공통 경로. **이 함수는 인가를 하지 않는다** — 부르는 export 가 첫 문장에서 이미 했다. */
async function run(action: AdminAction, id: string, memo: string | null): Promise<AdminActionResult> {
  if (!isUuid(id)) return report(action, id, FAILED_RESULT);

  let rows: unknown;
  try {
    const db = createSsrClient(await cookies());
    const { data, error } = await db.rpc(ADMIN_RPC[action], { p_id: id, p_memo: memo });
    if (error) return report(action, id, FAILED_RESULT);
    rows = data;
  } catch {
    return report(action, id, FAILED_RESULT);
  }

  const result = toActionResult(action, rows);
  if (result.changed) {
    runAfter(() => {
      revalidate(QUERY_TAGS.recent);
      revalidate(QUERY_TAGS.reservations);
      revalidatePath(ADMIN_REVALIDATE_PATH, "layout");
    });
    // 즉시 발송(P4-7) — 확정만. 0010 이 통지를 넣는 전이는 확정 하나뿐이다(취소·완료·메모는 넣지 않는다).
    // 응답 뒤에 발송기를 한 번 부를 뿐이고 결과를 기다리지 않는다 — 발송이 실패해도 확정은 이미 성공이다.
    // 스위치(NOTIFY_INLINE)는 lib/notify/deps.ts 가 읽는다 — 관리자 경로에는 env 분기를 두지 않는다(check-admin-gate 규칙 6).
    if (action === "confirm") notifyAfterResponse("confirmed", runAfter);
  }
  return report(action, id, result);
}

/** new → confirmed. 성공하면 0010 이 확정 통지 1건을 큐에 넣고, 응답 뒤 즉시 발송(P4-7)이 발송기를 한 번 부른다. */
export async function confirmReservation(id: string, memo?: string | null): Promise<AdminActionResult> {
  await requireAdmin();
  return run("confirm", id, normalizeMemo(memo));
}

/** new·confirmed → cancelled. 취소 통지는 넣지 않는다(문안 미승인 — 0010 헤더). */
export async function cancelReservation(id: string, memo?: string | null): Promise<AdminActionResult> {
  await requireAdmin();
  return run("cancel", id, normalizeMemo(memo));
}

/** confirmed → done (운행이 끝났다). 통지 없음 — 고객에게 알릴 일이 아니다(리뷰 M1: 목록의 '완료' 필터에 도달할 길이 없었다). */
export async function completeReservation(id: string, memo?: string | null): Promise<AdminActionResult> {
  await requireAdmin();
  return run("complete", id, normalizeMemo(memo));
}

/** admin_memo 만 바꾼다. 빈 값이면 메모를 지운다. */
export async function saveReservationMemo(id: string, memo: string): Promise<AdminActionResult> {
  await requireAdmin();
  return run("memo", id, normalizeMemo(memo));
}
