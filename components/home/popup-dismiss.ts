/**
 * 팝업 "오늘 하루 보지 않기" 저장 키 (순수 함수).
 *
 * 키에 KST 달력 날짜를 넣는다 — 자정 경계에서 UTC 날짜를 쓰면 KST 00:00~08:59 에 전날 키가 되어 하루 어긋난다
 * (CLAUDE.md §3). 날짜가 바뀌면 키가 달라지므로 "오늘 하루" 는 자연히 만료된다(삭제 불필요).
 * 처리방침 PRIVACY_POLICY_SECTIONS.cookies 가 "브라우저 저장소(localStorage)" 사용을 고지한다 — 키 이름과 무관.
 */
import { toKstDateString } from "@/lib/kst";

export const POPUP_DISMISS_PREFIX = "popup-dismissed";

export function dismissKey(popupId: number, now: Date): string {
  return `${POPUP_DISMISS_PREFIX}:${popupId}:${toKstDateString(now)}`;
}

/**
 * 오늘 하루 보지 않기로 숨긴 팝업을 뺀 id 목록 — 순서는 그대로(여러 창이 뜨는 순서 = 서버가 정한 순서).
 * 남은 것이 0개면 빈 배열이고, 그때는 어두운 막도 그리지 않는다. `isDismissed` 는 저장소 읽기(실패는 false) — 호출자가 넘긴다.
 */
export function undismissedIds(ids: readonly number[], now: Date, isDismissed: (key: string) => boolean): number[] {
  return ids.filter((id) => !isDismissed(dismissKey(id, now)));
}
