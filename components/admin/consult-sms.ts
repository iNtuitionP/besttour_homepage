/**
 * 상담완료 문자 시트 — 순수 판정 · 상태 (OF3-R4 · 마이그레이션 0028).
 *
 * 시트(components/admin/ConsultSmsSheet.tsx)는 위 칸(관리자가 고치는 문구)과 아래 계약 정보 블록(서버가 원장에서 만들어 내린 글자 — 읽기 전용)을
 * 보여 주고, 둘을 이은 **최종 본문의 바이트 수**를 센다. 잇는 규칙은 서버와 같은 함수다(lib/notify/consult-text.ts joinConsultSms) —
 * 화면이 센 수와 서버가 큐에 넣는 본문이 갈리지 않는다. 서버는 블록을 다시 만든다(화면의 미리보기를 믿지 않는다).
 *
 * 상태: 열림 · 문구 · 배너 · "보내지 않음" 안내. [보내지 않음](ESC · 바깥 누르기 포함)은 시트를 닫고
 * "대금·취소 규정은 다른 방법으로 꼭 안내해 주세요" 를 남긴다(요구 R4). 보내고 나면 문구는 기본값으로 돌아간다(다음 문자는 처음부터).
 *
 * React·DOM·env·한글 없음 — tests/of3-r4-consult-sms.test.ts 가 그대로 부른다.
 */
import type { ConsultSmsResult } from "@/lib/admin/consultSms";
import { CONSULT_SMS_MAX_BYTES, SMS_SHORT_MAX_BYTES, joinConsultSms } from "@/lib/notify/consult-text";

/** UTF-8 바이트 수 — 브라우저·Node 둘 다(TextEncoder). 서버(templates.ts utf8ByteLength — Buffer)와 같은 수를 낸다. */
export function smsByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type ConsultSmsCheck =
  | { kind: "ok"; bytes: number; long: boolean }
  | { kind: "empty"; bytes: number }
  | { kind: "tooLong"; bytes: number; max: number };

/** 보낼 수 있는가 — 문구가 비었나 · 최종 본문이 2000바이트를 넘나 · 90바이트를 넘어 장문으로 나가나. */
export function checkConsultSms(freeText: string, block: string): ConsultSmsCheck {
  const bytes = smsByteLength(joinConsultSms(freeText, block));
  if (freeText.trim() === "") return { kind: "empty", bytes };
  if (bytes > CONSULT_SMS_MAX_BYTES) return { kind: "tooLong", bytes, max: CONSULT_SMS_MAX_BYTES };
  return { kind: "ok", bytes, long: bytes > SMS_SHORT_MAX_BYTES };
}

export type ConsultSmsBanner =
  | { kind: "empty" }
  | { kind: "tooLong"; bytes: number; max: number }
  | { kind: "notConsulted" }
  | { kind: "invalid" }
  | { kind: "failed" };

export interface ConsultSmsState {
  open: boolean;
  /** 위 칸의 값. */
  text: string;
  /** 서버가 내린 기본 문구 — 보낸 뒤 여기로 돌아간다. */
  defaultText: string;
  /** 서버가 원장에서 만든 계약 정보 블록(읽기 전용) — 바이트 수를 셀 때 문구 뒤에 잇는다. */
  block: string;
  /** 시트가 열릴 때 서버가 그린 이름 칸에서 읽은 이름(제목용 — props 로 받지 않는다). */
  customerName: string;
  banner: ConsultSmsBanner | null;
  bannerSeq: number;
  /** [보내지 않음]으로 닫았다 — 처리 영역에 안내 한 줄이 남는다(다시 열거나 보내면 지운다). */
  skipped: boolean;
}

export type ConsultSmsEvent =
  /**
   * 서버가 새 두 조각을 내렸다(상담완료로 바뀐 뒤의 새로고침 — 처리 영역은 다시 만들어지지 않는다). 고치지 않은 문구는 새 기본값을 따르고,
   * 고치던 문구는 지킨다(메모 칸의 propMemo 와 같은 규칙).
   */
  | { type: "draft"; defaultText: string; block: string }
  | { type: "open"; customerName: string }
  | { type: "edit"; text: string }
  | { type: "skip" }
  | { type: "blocked"; banner: ConsultSmsBanner }
  | { type: "settled"; result: ConsultSmsResult };

export function initialConsultSmsState(defaultText: string, block = ""): ConsultSmsState {
  return { open: false, text: defaultText, defaultText, block, customerName: "", banner: null, bannerSeq: 0, skipped: false };
}

export function consultSmsReducer(state: ConsultSmsState, event: ConsultSmsEvent): ConsultSmsState {
  switch (event.type) {
    case "draft":
      if (event.defaultText === state.defaultText && event.block === state.block) return state;
      return {
        ...state,
        text: state.text === state.defaultText ? event.defaultText : state.text,
        defaultText: event.defaultText,
        block: event.block,
      };
    case "open":
      return { ...state, open: true, customerName: event.customerName, banner: null, skipped: false };
    case "edit":
      return { ...state, text: event.text, banner: null };
    case "skip":
      if (!state.open) return state;
      return { ...state, open: false, banner: null, skipped: true };
    case "blocked":
      return state.open ? { ...state, banner: event.banner, bannerSeq: state.bannerSeq + 1 } : state;
    case "settled": {
      const { result } = event;
      if (result.ok) return { ...state, open: false, text: state.defaultText, banner: null, skipped: false };
      if (!state.open) return state;
      const banner: ConsultSmsBanner =
        result.code === "notConsulted"
          ? { kind: "notConsulted" }
          : result.code === "invalid"
            ? { kind: "invalid" }
            : result.code === "tooLong"
              ? { kind: "tooLong", bytes: smsByteLength(joinConsultSms(state.text, state.block)), max: CONSULT_SMS_MAX_BYTES }
              : { kind: "failed" };
      return { ...state, banner, bannerSeq: state.bannerSeq + 1 };
    }
  }
}

/** 보내기 전에 막을 것 — 막으면 배너, 아니면 null(서버액션을 부른다). */
export function blockBeforeSend(freeText: string, block: string): ConsultSmsBanner | null {
  const check = checkConsultSms(freeText, block);
  if (check.kind === "empty") return { kind: "empty" };
  if (check.kind === "tooLong") return { kind: "tooLong", bytes: check.bytes, max: check.max };
  return null;
}
