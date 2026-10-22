/**
 * 상담완료 문자 보내기 — 입력 검증 · 대상 판정 · RPC 결과 해석 (OF3-R4 · 마이그레이션 0028). 순수 모듈.
 *
 * 서버액션(actions/admin/consultSms.ts)이 이 판정들을 차례로 부르고, 분기는 여기서만 테스트된다(액션에는 로직이 거의 없다).
 * DB·Next·env 없음. 결과 타입에는 개인정보가 없다 — 서버액션 응답으로 브라우저까지 나가는 값이다(lib/admin/result.ts 와 같은 규약).
 */
import { z } from "zod";

import { CONSULT_CONTRACT_MAX_CHARS, CONSULT_FREE_TEXT_MAX_CHARS, normalizeConsultText } from "../notify/consult-text";

/** 0028 함수 이름 — RPC 이름 문자열을 코드에 흩뿌리지 않는다. */
export const CONSULT_SMS_RPC = "admin_send_reservation_sms";

/** 대상 판정이 읽는 칸 — 상태 · 상담완료 시각. 이름·전화는 읽지 않는다(받는 번호는 DB 가 정한다). 계약 정보는 화면이 보내므로 접수 시각도 필요 없다(OF3-R4b). */
export const CONSULT_TARGET_SELECT = "status,confirmed_at";

/** 화면 문구 키 — messages/ko.json `admin.detail.sms.result.*`. */
export type ConsultSmsCode = "queued" | "notConsulted" | "invalid" | "tooLong" | "failed";

export interface ConsultSmsResult {
  ok: boolean;
  code: ConsultSmsCode;
}

export const CONSULT_SMS_FAILED: ConsultSmsResult = { ok: false, code: "failed" };

/** 제어문자 — 줄바꿈(\n)·탭만 남기고 C0·DEL·C1 은 받지 않는다(문자 제공자가 바꾸거나 거절한다). */
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

/** 칸 하나 — 문자열 · 줄바꿈 정규화 · 양끝 공백 제거 뒤 0~상한 글자 · 제어문자 없음. 비어도 이 칸만으로는 거부하지 않는다(둘 다 비면 아래에서 거부). */
const smsField = (maxChars: number) =>
  z
    .string()
    .transform((s) => normalizeConsultText(s).trim())
    .pipe(
      z
        .string()
        .max(maxChars)
        .refine((s) => !FORBIDDEN_CONTROL.test(s)),
    );

/**
 * 서버액션 입력 — uuid · 문구 · 계약 정보(화면이 보낸 글자 그대로 — OF3-R4b). 두 칸이 모두 비면 거부한다(보낼 글자가 없다).
 * 최종 본문의 2000바이트 상한은 두 칸을 이은 뒤 서버액션이 잰다(칸 하나씩의 글자 수 상한만으로는 합을 막을 수 없다).
 */
export const consultSmsInputSchema = z
  .object({
    id: z.uuid(),
    freeText: smsField(CONSULT_FREE_TEXT_MAX_CHARS),
    contract: smsField(CONSULT_CONTRACT_MAX_CHARS),
  })
  .refine((v) => v.freeText !== "" || v.contract !== "");

export type ConsultSmsInput = z.infer<typeof consultSmsInputSchema>;

/** 예약 행(대상 판정용 두 칸). */
export interface ConsultTargetRow {
  status: string;
  confirmed_at: string | null;
}

/**
 * 문자를 보낼 수 있는 예약인가 — 0028 함수와 같은 규칙(상담완료 시각이 있고 지금 confirmed 또는 done). 최종 판정은 DB 가 다시 한다
 * (화면이 낡았을 수 있다). 여기서 먼저 거르면 상담완료가 아닌 접수에는 RPC 를 부르지 않는다.
 */
export function isConsulted(row: ConsultTargetRow | null): row is ConsultTargetRow {
  return row !== null && row.confirmed_at !== null && (row.status === "confirmed" || row.status === "done");
}

/** PostgREST 는 table 반환 함수의 결과를 배열로 준다. outcome 을 읽지 못하면 실패다(모르는 응답을 성공으로 읽지 않는다). */
export function toConsultSmsResult(rows: unknown): ConsultSmsResult {
  const row = Array.isArray(rows) ? rows[0] : rows;
  const outcome = typeof row === "object" && row !== null ? (row as Record<string, unknown>).outcome : null;
  if (outcome === "queued") return { ok: true, code: "queued" };
  // 없는 id(noop)도 "상담완료가 아니다" 로 보인다 — 화면은 새로 불러와 최신 상태를 보여 준다.
  if (outcome === "not_consulted" || outcome === "noop") return { ok: false, code: "notConsulted" };
  return CONSULT_SMS_FAILED;
}
