/**
 * 방문자 일회용 값(vid) — 서버 전용(node:crypto). 클라이언트 번들에 섞이지 않게 비콘 규칙(./site-view.ts)과 분리했다.
 *
 * vid = sha256(GUARD_SECRET + KST 날짜 + IP + UA) 앞 32자(hex).
 *   · 날짜가 들어가므로 내일의 값으로 오늘의 사람을 알아볼 수 없다(처리방침: "그날에만 쓰이는 일회용 값").
 *   · secret 이 비면 던진다 — secret 없는 해시는 IPv4 전체 공간(2^32)에서 역산된다(lib/guard/ipKey.ts 와 같은 이유).
 *   · 입력 사이에 구분자를 둬 이어 붙인 문자열이 모호하지 않게 한다.
 * 반환값은 DB 로 가는 **유일한** 방문자 식별 값이다 — IP·UA 원문은 이 함수 밖으로 나가지 않는다.
 */
import { createHash } from "node:crypto";

/** vid 길이(hex 문자 수) — 128비트. DB 함수(0027 record_site_view)가 같은 모양(소문자 hex 32자)만 받는다. */
export const VISITOR_ID_LENGTH = 32;

export interface VisitorIdInput {
  secret: string;
  /** KST 날짜 `YYYY-MM-DD` (lib/kst.ts toKstDateString). */
  kstDate: string;
  ip: string;
  userAgent: string;
}

export function visitorId({ secret, kstDate, ip, userAgent }: VisitorIdInput): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("visitorId: GUARD_SECRET 이 비어 있다 — secret 없는 해시는 IP 를 되짚을 수 있다");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kstDate)) throw new Error(`visitorId: KST 날짜 형식이 아니다 (${kstDate})`);
  return createHash("sha256").update([secret, kstDate, ip, userAgent].join("|")).digest("hex").slice(0, VISITOR_ID_LENGTH);
}
