/**
 * 상담완료 문자(관리자가 직접 쓰는 문자)의 **글자 규칙** — 서버(서버액션·문안)와 화면(관리자 시트)이 같은 것을 쓴다 (OF3-R4 · 0028).
 *
 * 최종 본문 = 관리자가 쓴 문구(양끝 공백을 걷는다) + 빈 줄 + 계약 정보 블록(■ 대금 · ■ 취소·환불 · 계약 주체 — lib/notify/templates.ts
 * `consultContractBlock` 이 원장에서 만든다). 블록은 **언제나 끝에 붙는다** — 문구가 블록을 흉내 내도 진짜 블록이 그 뒤에 온다.
 * 화면의 미리보기·바이트 수와 서버가 실제로 큐에 넣는 본문이 갈리지 않게, 잇는 규칙은 여기 하나다.
 *
 * import 0 — 원장·Node(Buffer)·env 를 모른다. 클라이언트 번들에 들어가도 되는 순수 모듈이다(바이트는 부르는 쪽이 잰다).
 */

/** 문구와 블록 사이 — 빈 줄 하나(문자앱에서 문단이 갈린다). */
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

/** 줄바꿈을 LF 하나로 맞춘다(브라우저 textarea 는 CRLF 를 보낼 수 있다 — 바이트 수가 화면과 서버에서 갈리지 않게). */
export function normalizeConsultText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n");
}

/** 최종 본문 — 문구(정규화 · 양끝 공백 제거) + 빈 줄 + 블록. */
export function joinConsultSms(freeText: string, block: string): string {
  return `${normalizeConsultText(freeText).trim()}${CONSULT_SMS_SEPARATOR}${block}`;
}
