/**
 * 상담완료 문자(관리자가 직접 쓰는 문자)의 **글자 규칙** — 서버(서버액션)와 화면(관리자 시트)이 같은 것을 쓴다 (OF3-R4 · 0028 · OF3-R4b).
 *
 * 최종 본문 = 관리자가 쓴 문구(양끝 공백을 걷는다) + 빈 줄 + 계약 정보(양끝 공백을 걷는다). 계약 정보는 시트가 열릴 때
 * 서버가 원장으로 만든 기본 블록(■ 대금 · ■ 취소·환불 · 계약 주체 — lib/notify/templates.ts `consultContractBlock`)으로 채워지고,
 * 관리자가 **고칠 수 있다**(OF3-R4b — 약관이 예약 확정 안내에 대금·취소 규정을 알리기로 했으므로 되도록 그대로 두라고 화면이 권한다).
 * 서버액션은 화면이 보낸 계약 정보를 **그대로** 쓴다(원장에서 다시 만들어 덮지 않는다).
 * 화면의 바이트 수와 서버가 실제로 큐에 넣는 본문이 갈리지 않게, 잇는 규칙은 여기 하나다.
 *
 * import 0 — 원장·Node(Buffer)·env 를 모른다. 클라이언트 번들에 들어가도 되는 순수 모듈이다(바이트는 부르는 쪽이 잰다).
 */

/** 문구와 계약 정보 사이 — 빈 줄 하나(문자앱에서 문단이 갈린다). 둘 중 하나가 비면 붙이지 않는다. */
export const CONSULT_SMS_SEPARATOR = "\n\n";

/**
 * 최종 본문의 상한(UTF-8 바이트) — LMS 상한(lib/notify/templates.ts LMS_BYTE_LIMIT)과 같은 수이고 0028 의 CHECK(`octet_length(body) <= 2000`)와 같다.
 * UTF-8 로 재므로 제공자 기준(EUC-KR)보다 늘 크거나 같다 — 여기 들어가면 제공자 상한에도 들어간다(templates.ts 헤더 "SMS / LMS 선택").
 */
export const CONSULT_SMS_MAX_BYTES = 2000;

/** 단문(SMS) 상한 — 넘으면 장문(LMS)으로 나간다(templates.ts SMS_BYTE_LIMIT 와 같은 수 · 시트의 "장문 문자로 보내져요"). */
export const SMS_SHORT_MAX_BYTES = 90;

/** 관리자 문구 칸의 글자 수 상한 — 서버 zod 와 화면 textarea maxLength 가 같은 값을 쓴다. 최종 판정은 바이트(위)다. */
export const CONSULT_FREE_TEXT_MAX_CHARS = 1000;

/**
 * 계약 정보 칸의 글자 수 상한 — 서버 zod 와 화면 textarea maxLength 가 같은 값을 쓴다. 기본 블록은 이보다 훨씬 짧다.
 * 최종 판정은 두 칸의 합 바이트(CONSULT_SMS_MAX_BYTES)다 — 글자 수 상한은 터무니없이 긴 입력을 일찍 거르는 용도다.
 */
export const CONSULT_CONTRACT_MAX_CHARS = 2000;

/** 줄바꿈을 LF 하나로 맞춘다(브라우저 textarea 는 CRLF 를 보낼 수 있다 — 바이트 수가 화면과 서버에서 갈리지 않게). */
export function normalizeConsultText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n");
}

/**
 * 최종 본문 — 문구(정규화 · 양끝 공백 제거) + 빈 줄 + 계약 정보(정규화 · 양끝 공백 제거).
 * 계약 정보를 전부 지우면 빈 줄 없이 문구만, 문구가 비면 계약 정보만 — 둘 다 비면 빈 글자(부르는 쪽이 막는다).
 */
export function joinConsultSms(freeText: string, contract: string): string {
  return [normalizeConsultText(freeText).trim(), normalizeConsultText(contract).trim()].filter((part) => part !== "").join(CONSULT_SMS_SEPARATOR);
}
