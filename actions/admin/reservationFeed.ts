"use server";
/**
 * 관리자 "홈에서 숨기기 / 다시 보이기" 서버액션 (OF2-B · 0026). 얇은 래퍼: requireAdmin() → rpc 한 번 → 결과 매핑 → 무효화.
 *
 * 왜 따로 파일인가: actions/admin/reservation.ts 는 "export 는 상태 전이 4개뿐" 이라는 경계(ADR-3)와 통지 발송 배선을 갖고 있다.
 * 이 액션은 상태를 바꾸지 않고 통지도 없다 — 같은 파일에 섞지 않는다.
 *
 * 경계 규칙 (reservation.ts 와 같다)
 *   - export 는 async 함수 하나다('use server' 파일의 export 는 전부 공개 POST 엔드포인트). **본문 첫 문장이 requireAdmin()** 이다.
 *   - 서비스 롤을 쓰지 않는다. 0026 함수는 definer 라 RLS 를 우회하지만 **함수 자신이 is_admin() 을 확인한다** — 세션 클라이언트로 부른다.
 *   - 예외는 여기서 끝난다(redirect 의 throw 는 전파). 로그에는 id(uuid)와 결과 코드뿐 — 이름·전화·DB 오류 원문은 싣지 않는다.
 *   - 바뀌었으면 홈 접수 현황 캐시 태그를 무효화한다(QUERY_TAGS.recent) — 숨긴 접수가 바로 홈에서 빠진다.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { FEED_HIDDEN_FAILED, toFeedHiddenResult, type FeedHiddenResult } from "@/lib/admin/feedHidden";
import { isUuid } from "@/lib/admin/reservations";
import { ADMIN_REVALIDATE_PATH } from "@/lib/admin/result";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";
import { createSsrClient } from "@/lib/supabase/ssr";

/** 이 파일이 남기는 로그의 전부. 필드를 늘리기 전에 그것이 개인정보가 아닌지 먼저 확인할 것. */
interface FeedHiddenLogEntry extends StructuredLogEntry {
  /** 예약 uuid. uuid 가 아니면 "invalid". */
  id: string;
  outcome: FeedHiddenResult["code"];
}

function report(id: string, result: FeedHiddenResult): FeedHiddenResult {
  const entry: FeedHiddenLogEntry = {
    level: result.ok ? "info" : "error",
    event: "admin.reservation.feed_hidden",
    id: isUuid(id) ? id : "invalid",
    outcome: result.code,
  };
  structuredLog(entry);
  return result;
}

/** hidden=true 면 홈에서 숨기고, false 면 다시 보이게 한다. 접수 기록은 지우지 않는다. */
export async function setReservationFeedHidden(id: string, hidden: boolean): Promise<FeedHiddenResult> {
  await requireAdmin();
  if (!isUuid(id) || typeof hidden !== "boolean") return report(String(id), FEED_HIDDEN_FAILED);

  let rows: unknown;
  try {
    const db = createSsrClient(await cookies());
    const { data, error } = await db.rpc("admin_set_feed_hidden", { p_id: id, p_hidden: hidden });
    if (error) return report(id, FEED_HIDDEN_FAILED);
    rows = data;
  } catch {
    return report(id, FEED_HIDDEN_FAILED);
  }

  const result = toFeedHiddenResult(hidden, rows);
  if (result.changed) {
    runAfter(() => {
      revalidate(QUERY_TAGS.recent);
      revalidatePath(ADMIN_REVALIDATE_PATH, "layout");
    });
  }
  return report(id, result);
}
