/**
 * 취소·환불 규정의 판 고르기 — 옛 규정(CANCELLATION·WITHDRAWAL) ↔ 개정 규정(CANCELLATION_NEXT·WITHDRAWAL_NEXT)
 * (사장님 요청 16 · 결정 4 B안 · OF-T2-3).
 *
 * 원장(lib/legal/disclosures.ts)은 상수만 둔다(함수 export 0 — scripts/check-legal-disclosures.sh). 그래서 "언제 어느 판인가" 는
 * 이 파일이 맡는다. 판정은 **KST 달력 날짜 문자열**끼리의 비교 하나다:
 *
 *   KST 날짜 <  REFUND_POLICY_EFFECTIVE_FROM  → "current"(옛 규정 — 운행일 3일 전까지 전액 / 2일 전부터 불가)
 *   KST 날짜 >= REFUND_POLICY_EFFECTIVE_FROM  → "next"   (개정 규정 — 운행일 7일 전까지 전액 / 6일 전부터 불가)
 *
 * 경계: 시행일 전날 23:59:59.999 KST 는 옛 판, 시행일 00:00:00.000 KST 는 새 판. 서버 TZ 와 무관하다(lib/kst.ts toKstDateString —
 * 고정 +09:00). 운영에서는 원장 상수만 쓴다 — 환경변수로 시행일을 앞당기는 길은 두지 않았다(브리프: 운영 위험이 없을 때만 · 보고서 ④).
 *
 * 누가 무엇을 기준으로 부르는가
 *   - 화면(견적 모달 · /guide · /terms): 서버가 렌더하는 순간 `refundPolicyAt(new Date())`. 시행일 전에는 옛 판과 함께 예고 한 줄
 *     (`upcomingRefundPolicy` — 문구 틀은 lib/i18n/refund-change.ts).
 *   - 확정 문자·확정 알림톡(lib/notify/templates.ts): **그 예약의 접수 시각**(reservations.created_at)으로 `refundPolicyAt(createdAt)`.
 *     배포 뒤에 확정되더라도 옛 규정에 동의하고 접수한 손님은 옛 문장을 받는다.
 *   - 동의 기록: 청약철회 동의(0021 withdrawal_consent_at)는 "어느 판" 칸이 없다(마이그레이션 금지 — 보고서 ④).
 *     동의 시각은 접수 서버액션이 created_at 과 같은 인스턴트로 찍으므로(lib/reservations/consent.ts), **어느 판에 동의했는지는
 *     `refundPolicyEditionAt(withdrawal_consent_at)` 로 판별한다** — 화면이 그 순간 고른 판과 같은 함수·같은 경계다.
 */
import { toKstDateString } from "./kst";
import {
  CANCELLATION,
  CANCELLATION_NEXT,
  REFUND_POLICY_EFFECTIVE_FROM,
  WITHDRAWAL,
  WITHDRAWAL_NEXT,
} from "./legal/disclosures";

/** current = 옛 규정(시행일 전 접수분) · next = 개정 규정(시행일부터 접수분). */
export type RefundPolicyEdition = "current" | "next";

/** 한 판의 원장 상수 묶음. 두 판은 모양이 같다(원장 주석 — "WITHDRAWAL 과 같은 모양"). */
export interface RefundPolicy {
  edition: RefundPolicyEdition;
  cancellation: typeof CANCELLATION | typeof CANCELLATION_NEXT;
  withdrawal: typeof WITHDRAWAL | typeof WITHDRAWAL_NEXT;
}

const POLICIES: Readonly<Record<RefundPolicyEdition, RefundPolicy>> = {
  current: { edition: "current", cancellation: CANCELLATION, withdrawal: WITHDRAWAL },
  next: { edition: "next", cancellation: CANCELLATION_NEXT, withdrawal: WITHDRAWAL_NEXT },
};

const KST_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 시간대가 붙은 ISO 인스턴트만 받는다 — 시간대 없는 모양을 실행 환경의 로컬 시간대 해석에 맡기지 않는다(lib/public-date.ts 와 같은 원칙). */
const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/i;

if (!KST_DATE.test(REFUND_POLICY_EFFECTIVE_FROM)) {
  // 원장 상수가 형식을 벗어나면 모듈을 불러오는 순간 멈춘다 — 문자열 비교가 조용히 틀린 판을 고르는 것보다 낫다.
  throw new Error(`refund-policy: REFUND_POLICY_EFFECTIVE_FROM 이 YYYY-MM-DD 가 아니다 (${REFUND_POLICY_EFFECTIVE_FROM})`);
}

/** 시행일 — 원장 상수 그대로(KST 달력 날짜 `YYYY-MM-DD`). */
export const REFUND_POLICY_EFFECTIVE_DATE: string = REFUND_POLICY_EFFECTIVE_FROM;

/** 옛 규정이 적용되는 마지막 접수일(시행일 전날, KST 달력 날짜). /guide 의 "현재 규정 — …까지 접수분" 에 쓴다. */
export const REFUND_POLICY_LAST_CURRENT_DATE: string = (() => {
  const [y, m, d] = REFUND_POLICY_EFFECTIVE_FROM.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
})();

/** KST 달력 날짜(`YYYY-MM-DD`)의 판. 문자열 비교 — 같은 자릿수 형식이라 달력 순서와 같다. */
export function refundPolicyEditionOn(kstDate: string): RefundPolicyEdition {
  if (!KST_DATE.test(kstDate)) throw new Error(`refundPolicyEditionOn: KST 날짜(YYYY-MM-DD)가 아니다 (${kstDate})`);
  return kstDate >= REFUND_POLICY_EFFECTIVE_FROM ? "next" : "current";
}

/** 인스턴트(Date, 또는 시간대가 붙은 ISO 문자열 — DB timestamptz 값 그대로)를 Date 로. 읽을 수 없으면 throw(판을 짐작하지 않는다). */
function toInstant(at: Date | string): Date {
  if (at instanceof Date) {
    if (Number.isNaN(at.getTime())) throw new Error("refund-policy: 유효하지 않은 Date 다");
    return at;
  }
  const v = typeof at === "string" ? at.trim() : "";
  if (!ZONED_ISO.test(v)) throw new Error(`refund-policy: 시간대가 붙은 ISO 인스턴트가 아니다 (${String(at)})`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`refund-policy: 읽을 수 없는 시각이다 (${v})`);
  return d;
}

/** 인스턴트의 판 — 그 순간의 KST 달력 날짜로 정한다. */
export function refundPolicyEditionAt(at: Date | string): RefundPolicyEdition {
  return refundPolicyEditionOn(toKstDateString(toInstant(at)));
}

/** 판 → 원장 상수 묶음. */
export function refundPolicyFor(edition: RefundPolicyEdition): RefundPolicy {
  return POLICIES[edition];
}

/** 인스턴트에 적용되는 규정 — 화면은 렌더 시각, 문자는 접수 시각(created_at)을 넘긴다. */
export function refundPolicyAt(at: Date | string): RefundPolicy {
  return refundPolicyFor(refundPolicyEditionAt(at));
}

/** 시행일 전이면 곧 적용될 개정 규정(예고용), 시행일부터는 null — 예고할 것이 없다. */
export function upcomingRefundPolicy(at: Date | string): RefundPolicy | null {
  return refundPolicyEditionAt(at) === "current" ? POLICIES.next : null;
}
