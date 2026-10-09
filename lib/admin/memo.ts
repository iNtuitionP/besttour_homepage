/**
 * 관리자 메모 규칙 — 서버액션과 화면이 **같은 값**을 쓴다 (P5-19).
 *
 * 예전에는 상한(2000자)과 정규화가 서버액션(actions/admin/reservation.ts) 안에만 있었다. 'use server' 파일은
 * async 함수 말고는 export 할 수 없어(ADR-3) 화면이 그 값을 읽을 수 없었고, 넘친 메모는 서버에서 **몰래 잘렸다**.
 * 확인 시트가 취소 사유 한 줄을 메모 끝에 덧붙이면서(P5-19) 잘리는 쪽이 바로 그 사유 줄이 됐다 — 그래서 상한을 여기로 옮겨
 * 화면이 같은 기준으로 **먼저 막고 안내**한다(components/admin/reservation-sheet.ts planCommit). 서버의 자르기는 마지막 방어선으로 남는다.
 *
 * 순수 모듈이다: DB·Next·env 없음. 클라이언트 번들에도 들어간다(서버 전용 표시를 달지 않는다).
 */

/** 메모 상한 — 제공자 응답 덤프·붙여넣기 사고가 통째로 들어오지 않게(lib/notify/outbox.ts 와 같은 발상). 길이는 양끝을 자른 뒤에 잰다. */
export const ADMIN_MEMO_MAX_CHARS = 2000;

/**
 * 공백뿐이면 null — 0010 의 confirm·cancel·complete 는 null 을 "메모를 바꾸지 않는다", memo 는 "메모를 지운다" 로 읽는다.
 * 상한을 넘으면 자른다(서버의 마지막 방어선 — 화면은 그 전에 막는다).
 */
export function normalizeAdminMemo(memo: string | null | undefined): string | null {
  if (typeof memo !== "string") return null;
  const trimmed = memo.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, ADMIN_MEMO_MAX_CHARS);
}
