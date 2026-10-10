/**
 * 서버 전용 — 취소·환불 개정 예고 문구 (OF-T2-3 · 사장님 요청 16 · 결정 4 B안).
 *
 * 시행일(원장 REFUND_POLICY_EFFECTIVE_FROM) 전에는 화면이 지금 규정을 그대로 보이고 그 아래에 예고 한 줄을 단다.
 *   ko "2026년 11월 9일 접수분부터 취소·환불 규정이 바뀝니다: <개정 규정 한 문장>"
 *   en "For bookings received on or after Nov 9, 2026, the cancellation and refund policy changes: <개정 규정 영문 요약>"
 * 시행일부터는 null — 예고할 것이 없다(화면은 개정 규정만 보인다 · lib/refund-policy.ts).
 *
 * 어디서 무엇이 오는가
 *   - 규정 문장(`{rule}`)은 **원장에서 조립**한다: ko = CANCELLATION_NEXT.smsItem(개정 규정의 한 문장 — 범위 괄호까지),
 *     en = WITHDRAWAL_NEXT.summaryEn.tiers(두 구간 영문)를 " · " 로 이은 것. 여기서 규정을 다시 적지 않는다.
 *   - 날짜(`{date}`)는 공개 날짜 형식(lib/public-date.ts formatPublicDate · style "posted" — ko "2026년 11월 9일" · en "Nov 9, 2026").
 *   - 틀(문장의 나머지)은 카탈로그 `common.refundChange` — 법정 페이지(/guide · /terms)는 getTranslations 를 쓰지 않으므로
 *     (tests/legal-pages.test.ts §3) lib/i18n/public-dates.ts 와 같이 순수 함수 loadMessages 로 틀만 읽는다.
 *     원장에는 예고 틀 상수가 없다(원장 수정 금지 — 보고서 ① 에 기록). 컨트롤러가 원장으로 옮기면 이 파일의 출처만 바뀐다.
 *
 * 클라이언트에서 import 하지 않는다 — 두 카탈로그 전체가 번들로 딸려 간다(public-dates.ts 와 같다).
 */
import { loadMessages } from "@/i18n/messages";
import { publicDateLabelsFor } from "@/lib/i18n/public-dates";
import { formatPublicDate } from "@/lib/public-date";
import {
  REFUND_POLICY_EFFECTIVE_DATE,
  REFUND_POLICY_LAST_CURRENT_DATE,
  upcomingRefundPolicy,
} from "@/lib/refund-policy";

export interface RefundChangeTexts {
  /** 예고 한 줄 — 지금 규정 아래. */
  notice: string;
  /** /guide 의 지금 규정 머리 — "현재 규정 — {시행일 전날} 접수분까지 적용". */
  currentTitle: string;
  /** /guide 의 개정 규정 머리 — "변경 예정 — {시행일} 접수분부터 적용". */
  nextTitle: string;
}

interface Frames {
  notice: string;
  currentTitle: string;
  nextTitle: string;
}

function framesFor(locale: string): Frames {
  const raw = (loadMessages(locale).common as { refundChange?: unknown } | undefined)?.refundChange;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const frames = {
    notice: typeof o.notice === "string" ? o.notice : "",
    currentTitle: typeof o.currentTitle === "string" ? o.currentTitle : "",
    nextTitle: typeof o.nextTitle === "string" ? o.nextTitle : "",
  };
  // 틀이 비면 "{date}" 가 그대로 나가거나 예고가 통째로 빠진다 — 조용히 숨기지 않고 멈춘다(공개 날짜 틀과 같은 원칙).
  if (!frames.notice.includes("{date}") || !frames.notice.includes("{rule}") || !frames.currentTitle.includes("{date}") || !frames.nextTitle.includes("{date}")) {
    throw new Error(`refundChangeTexts: catalog common.refundChange has the wrong shape (${locale})`);
  }
  return frames;
}

const fill = (tpl: string, values: Record<string, string>): string => tpl.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

/** 시행일 전이면 예고 문구, 시행일부터는 null. `now` 는 서버가 렌더하는 순간(화면) — 판정은 lib/refund-policy.ts 와 같다. */
export function refundChangeTexts(locale: string, now: Date): RefundChangeTexts | null {
  const next = upcomingRefundPolicy(now);
  if (next === null) return null;
  const frames = framesFor(locale);
  const labels = publicDateLabelsFor(locale);
  const effective = formatPublicDate(REFUND_POLICY_EFFECTIVE_DATE, labels, { style: "posted" }) ?? REFUND_POLICY_EFFECTIVE_DATE;
  const lastCurrent = formatPublicDate(REFUND_POLICY_LAST_CURRENT_DATE, labels, { style: "posted" }) ?? REFUND_POLICY_LAST_CURRENT_DATE;
  // en 은 두 구간 다음에 범위 단서(summaryEn.scope 의 첫 문장 "These rules cover cancellations you request.")를 붙인다 —
  // ko {rule}(smsItem)의 "(고객 사정으로 취소하는 경우)" 와 같은 뜻(릴리스 C 리뷰 P2-3). 둘 다 원장 문장 그대로다.
  const enScope = next.withdrawal.summaryEn.scope.split(/(?<=\.)\s/)[0];
  const rule = locale === "en" ? `${next.withdrawal.summaryEn.tiers.join(" · ")}. ${enScope}` : next.cancellation.smsItem;
  return {
    notice: fill(frames.notice, { date: effective, rule }),
    currentTitle: fill(frames.currentTitle, { date: lastCurrent }),
    nextTitle: fill(frames.nextTitle, { date: effective }),
  };
}
