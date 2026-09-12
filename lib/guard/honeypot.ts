/**
 * 허니팟 — 사람에게 보이지 않는 필드가 채워지면 봇 (P3-1 순서 2, 무료).
 *
 * 폼(P3-3/P6)은 `website` 를 aria-hidden + tabindex=-1 + offscreen 으로 렌더한다. 자동완성이 채울 수 있는 이름을 피하지 않은 이유:
 * 봇이 "그럴듯한 폼 필드"를 채우도록 유도하는 것이 목적이다. 실제 사람은 보지도 포커스하지도 못한다.
 *
 * 결과는 silent — 호출자는 봇에게 실패를 알리지 않고 가짜 성공을 돌려준다(저장 없음). 실패를 알려주면 봇 제작자가 필드를 찾아낸다.
 */
import type { GuardResult } from "./types";

/** 숨은 필드 이름. lib/types.ts ReservationInput 의 `website: z.string().max(0).optional()` 과 같은 이름이다. */
export const HONEYPOT_FIELD = "website";

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === "";

/** 넘어온 숨은 필드 중 하나라도 비어 있지 않으면 bot(silent). 비문자열(배열·숫자·객체)도 채워진 것이다 — 사람은 그런 값을 낼 수 없다. */
export function checkHoneypot(fields: Record<string, unknown>): GuardResult {
  for (const [name, value] of Object.entries(fields)) {
    if (!isEmpty(value)) {
      return { ok: false, reason: "bot", silent: true, detail: { code: "honeypot", field: name } };
    }
  }
  return { ok: true };
}
