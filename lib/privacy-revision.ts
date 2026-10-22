/**
 * 처리방침 개정 시행일 판정 — 단일 헬퍼 (OF3-H · 독립 리뷰 OF3-ledger-review.md F6).
 *
 * 원장(lib/legal/disclosures.ts)은 상수만 둔다(함수 export 0 — scripts/check-legal-disclosures.sh). 그래서 "언제부터 어느 판인가" 는 이 파일이 맡는다.
 * lib/refund-policy.ts 와 같은 방식이다: **KST 달력 날짜 문자열끼리의 비교 하나**(lib/kst.ts isKstDateOnOrAfter).
 *
 *   KST 날짜 <  PRIVACY_POLICY_REVISION.effectiveDate → 시행 전 — 표시 시행일·동의 버전 = LEGAL_PAGES.privacy.effectiveDate
 *   KST 날짜 >= PRIVACY_POLICY_REVISION.effectiveDate → 시행   — 표시 시행일·동의 버전 = 개정 시행일
 *
 * 누가 이 판정을 쓰는가 — **세 곳이 모두 같은 날짜 비교를 한다**(고지보다 수집이 먼저 시작되는 일이 없게):
 *   1. /privacy 표시(app/[locale]/(legal)/privacy/page.tsx) — `privacyRevisionActive(now)` 로 개정 예정 안내·addendum 표지를 고르고
 *      `privacyEffectiveDate(now)` 를 표시 시행일로 쓴다. 정적이면 시행일에 저절로 바뀌지 않으므로 /guide 와 같은 ISR(revalidate = 600)이다.
 *   2. 동의 기록(lib/reservations/consent.ts privacyPolicyVersion) — 접수 시각으로 판을 고른다. 예전 상수(모듈 로드 시 한 번 계산)는 시행일을 못 따라간다.
 *   3. 네이버 스크립트 게이트(lib/analytics/naver-wcs.ts) — 클라이언트 번들에 원장이 들어가지 않도록 시행일 문자열은 서버 레이아웃이 prop 으로 내리고
 *      비교는 같은 isKstDateOnOrAfter 로 한다(PRIVACY_POLICY_REVISION.effectiveDate 가 그 prop 의 값이다 — tests/naver-wcs.test.ts 가 연결을 잠근다).
 *
 * 서버 TZ 와 무관하다(고정 +09:00). 환경변수로 시행일을 앞당기는 길은 두지 않았다 — 고지 없이 수집이 시작되는 사고를 막는다.
 */
import { isKstDateOnOrAfter } from "./kst";
import { LEGAL_PAGES, PRIVACY_POLICY_REVISION } from "./legal/disclosures";

/** 개정 시행일(KST 달력 날짜)이 지났는가 — 시행일 00:00:00.000 KST 부터 true. */
export function privacyRevisionActive(now: Date): boolean {
  return isKstDateOnOrAfter(PRIVACY_POLICY_REVISION.effectiveDate, now);
}

/** 그 시각에 유효한 처리방침의 시행일(`YYYY-MM-DD`) — 시행 전 = 기존 시행일, 시행 후 = 개정 시행일. 화면 표시와 동의 버전이 같은 값을 쓴다. */
export function privacyEffectiveDate(now: Date): string {
  return privacyRevisionActive(now) ? PRIVACY_POLICY_REVISION.effectiveDate : LEGAL_PAGES.privacy.effectiveDate;
}
