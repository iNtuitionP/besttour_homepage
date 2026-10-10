/**
 * 취소·환불 개정(OF-T2-3) 테스트 고정값 — 판(옛/개정)이 오늘 날짜에 따라 바뀌지 않게 시각을 박는다.
 *
 * 화면·문자는 시행일(원장 REFUND_POLICY_EFFECTIVE_FROM = KST 날짜) 전이면 옛 규정, 그날부터 개정 규정을 쓴다. 옛 규정(CANCELLATION·
 * WITHDRAWAL)을 잠그는 기존 테스트가 시행일 뒤에 저절로 빨개지지 않도록, 그 테스트들은 아래 "시행일 전" 시각으로 렌더한다.
 * 값은 시행일 상수와 대조해 스스로 검증한다(tests/refund-policy.test.ts §0) — 원장 시행일이 이 값보다 앞당겨지면 그 테스트가 먼저 알린다.
 */

/** 시행일 전 접수 — KST 2026-10-01 12:00. 옛 규정(3일/2일)이 적용된다. */
export const CREATED_BEFORE_REFUND_CHANGE = "2026-10-01T03:00:00.000Z";
/** 같은 인스턴트의 Date — 화면(WithdrawalNotice now prop · 법정 페이지 시스템 시각)을 옛 판으로 고정할 때. */
export const BEFORE_REFUND_CHANGE = new Date(CREATED_BEFORE_REFUND_CHANGE);

/** 시행일 전날 23:59:59.999 KST = 2026-11-08T14:59:59.999Z — 마지막 옛 판 순간. */
export const LAST_INSTANT_BEFORE_CHANGE = "2026-11-08T14:59:59.999Z";
/** 시행일 00:00:00.000 KST = 2026-11-08T15:00:00.000Z — 첫 개정 판 순간(UTC 로는 아직 11월 8일이다). */
export const FIRST_INSTANT_OF_CHANGE = "2026-11-08T15:00:00.000Z";
/** 시행일 뒤 접수 — KST 2026-11-20 10:00. 개정 규정(7일/6일)이 적용된다. */
export const CREATED_AFTER_REFUND_CHANGE = "2026-11-20T01:00:00.000Z";
export const AFTER_REFUND_CHANGE = new Date(CREATED_AFTER_REFUND_CHANGE);
