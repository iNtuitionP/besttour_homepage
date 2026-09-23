/**
 * 동의 기록 순수 함수 (플랜 v4 P1-3 · ADR-6).
 *
 * 0003_consent.sql 의 컬럼 4개 + 0021_withdrawal_consent.sql 의 청약철회 제한 확인 시각 값을 만든다. DB·네트워크·서버 액션 없음 — 접수 서버 액션(P3)이 이 결과를
 * insert 페이로드(lib/types.ts ReservationInsert)에 합친다.
 *
 * 원칙
 *   - 동의 시각은 서버가 접수 요청을 받은 인스턴트(now)다. 클라이언트가 보낸 시각은 믿지 않는다.
 *   - privacyConsent 가 true 가 아니면 값을 만들지 않고 throw 한다. 받은 적 없는 동의의 시각을 만드는 것은
 *     허위 기록이다 — DB 도 default 없이 NOT NULL 로 같은 원칙을 강제한다(0003 헤더).
 *   - 보유기간 숫자는 여기서 정의하지 않는다. lib/legal/disclosures.ts PRIVACY_NOTICE.retentionDays 가 진실이다.
 *   - 값은 ISO 8601 UTC 문자열('Z')이다. timestamptz 는 인스턴트를 저장한다 — CLAUDE.md §3 의 "KST 벽시계
 *     문자열" 규칙은 방문자가 입력하는 운행 일시에 대한 것이고, 서버가 찍는 동의·파기 시각은 인스턴트가 맞다.
 */
import { LEGAL_PAGES, PRIVACY_NOTICE } from "../legal/disclosures";
import type { ReservationConsentColumns, ReservationInput } from "../types";

/**
 * 개인정보 처리방침 문안 버전 — 처리방침 페이지(`/privacy`)가 표시하는 **시행일(원장 LEGAL_PAGES.privacy.effectiveDate)을 그대로 읽는다**(P1-7 R2 [P2-9]).
 * 예전에는 여기 날짜를 따로 적어, 동의 기록은 2026-09-21 을, 공개된 방침은 2026-09-11 을 가리키는 어긋남이 생겼다.
 * 이제 방침 문안이 바뀌면 원장의 시행일 하나만 올린다 — 행마다 "동의 당시 버전"이 남아, 나중에 문안이 바뀌어도 그때 무엇에 동의했는지 말할 수 있다.
 */
export const PRIVACY_POLICY_VERSION: string = LEGAL_PAGES.privacy.effectiveDate;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function assertValidDate(d: Date, label: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(`consent: ${label} 가 유효한 Date 가 아니다`);
  }
}

/**
 * 파기 예정 시각 = 접수 시각 + 원장의 보유기간(일).
 * 확정건에 적용되는 전자상거래법 보존기간(계약 기록 5년)은 P1-5 배치가 status 를 보고 별도 계산한다 — 여기서는 접수분 기준만.
 */
export function retentionUntil(createdAt: Date): Date {
  assertValidDate(createdAt, "createdAt");
  return new Date(createdAt.getTime() + PRIVACY_NOTICE.retentionDays * MS_PER_DAY);
}

/** consentFields 가 필요로 하는 입력 — zod 파싱 결과(ReservationInput)를 그대로 넘길 수 있다. */
export type ConsentInput = Pick<ReservationInput, "privacyConsent" | "marketingConsent" | "withdrawalConsent">;

/**
 * 0003 컬럼 4개 + 0021 컬럼 1개. `now` 는 서버가 접수 요청을 받은 인스턴트 — 동의 시각이자 retention_until 의 기산점이다.
 * DB 의 created_at(default now())과는 ms 단위로만 어긋나며, 0003·0021 제약의 허용 폭(+5분 / -1일)이 그 오차를 흡수한다.
 * 청약철회 제한 확인 시각(withdrawal_consent_at)도 같은 인스턴트다 — 클라이언트가 보낸 시각을 받는 경로가 없다(폼에 시각 필드가 없다).
 */
export function consentFields(input: ConsentInput, now: Date): ReservationConsentColumns {
  assertValidDate(now, "now");
  if (input.privacyConsent !== true) {
    throw new Error("consentFields: privacyConsent 가 true 가 아니다 — 동의 없이 동의 시각을 만들 수 없다 (ADR-6)");
  }
  if (input.withdrawalConsent !== true) {
    throw new Error("consentFields: withdrawalConsent 가 true 가 아니다 — 청약철회 제한 확인 없이 그 시각을 만들 수 없다 (P1-7 · 0021)");
  }
  const at = now.toISOString();
  return {
    privacy_consent_at: at,
    privacy_policy_version: PRIVACY_POLICY_VERSION,
    marketing_consent_at: input.marketingConsent === true ? at : null,
    retention_until: retentionUntil(now).toISOString(),
    withdrawal_consent_at: at,
  };
}
