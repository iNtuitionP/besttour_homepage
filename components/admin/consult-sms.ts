/**
 * 상담완료 문자 시트 — 순수 판정 · 상태 (OF3-R4 · 마이그레이션 0028 · OF3-R4b).
 *
 * 시트(components/admin/ConsultSmsSheet.tsx)는 칸 둘을 보여 주고 둘을 이은 **최종 본문의 바이트 수**를 센다.
 *   위  = 관리자가 쓰는 문구 · 아래 = 계약 정보(시트를 열 때마다 서버가 원장으로 만들어 내린 기본 블록으로 채워지고, 관리자가 고칠 수 있다 — OF3-R4b).
 * 잇는 규칙은 서버와 같은 함수다(lib/notify/consult-text.ts joinConsultSms) — 화면이 센 수와 서버가 큐에 넣는 본문이 갈리지 않는다.
 * 서버액션은 이 두 칸의 글자를 그대로 쓴다(원장에서 다시 만들어 덮지 않는다).
 *
 * 상태: 열림 · 문구 · 계약 정보 · 배너 · "보내지 않음" 안내. [보내지 않음](ESC · 바깥 누르기 포함)은 시트를 닫고
 * "대금·취소 규정은 다른 방법으로 꼭 안내해 주세요" 를 남긴다(요구 R4). **계약 정보를 전부 지우고 보냈을 때도 같은 안내를 한 번 남긴다**(막지는 않는다).
 * 보내고 나면 문구·계약 정보는 기본값으로 돌아간다(다음 문자는 처음부터), 시트를 다시 열면 계약 정보는 언제나 기본값부터다(문구는 이어 쓴다).
 *
 * React·DOM·env·한글 없음 — tests/of3-r4-consult-sms.test.ts 가 그대로 부른다.
 */
import type { ConsultSmsResult } from "@/lib/admin/consultSms";
import { CONSULT_SMS_MAX_BYTES, SMS_SHORT_MAX_BYTES, joinConsultSms, normalizeConsultText } from "@/lib/notify/consult-text";

/** UTF-8 바이트 수 — 브라우저·Node 둘 다(TextEncoder). 서버(templates.ts utf8ByteLength — Buffer)와 같은 수를 낸다. */
export function smsByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type ConsultSmsCheck =
  | { kind: "ok"; bytes: number; long: boolean }
  | { kind: "empty"; bytes: number }
  | { kind: "tooLong"; bytes: number; max: number };

/** 보낼 수 있는가 — 두 칸이 모두 비었나 · 최종 본문이 2000바이트를 넘나 · 90바이트를 넘어 장문으로 나가나. */
export function checkConsultSms(freeText: string, contract: string): ConsultSmsCheck {
  const body = joinConsultSms(freeText, contract);
  const bytes = smsByteLength(body);
  if (body === "") return { kind: "empty", bytes };
  if (bytes > CONSULT_SMS_MAX_BYTES) return { kind: "tooLong", bytes, max: CONSULT_SMS_MAX_BYTES };
  return { kind: "ok", bytes, long: bytes > SMS_SHORT_MAX_BYTES };
}

/** 계약 정보가 기본값과 다른가 — 줄바꿈(CRLF)만 다른 것은 고친 것이 아니다. */
export function isContractEdited(contract: string, defaultContract: string): boolean {
  return normalizeConsultText(contract) !== normalizeConsultText(defaultContract);
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
  /** 아래 칸(계약 정보)의 값 — 열 때마다 `block` 으로 채워지고 관리자가 고칠 수 있다. */
  contract: string;
  /** 서버가 원장에서 만든 기본 계약 정보 블록 — 열 때 · 되돌릴 때 · 보낸 뒤 돌아가는 값. */
  block: string;
  /** 시트가 열릴 때 서버가 그린 이름 칸에서 읽은 이름(제목용 — props 로 받지 않는다). */
  customerName: string;
  banner: ConsultSmsBanner | null;
  bannerSeq: number;
  /** 대금·취소 규정 안내가 필요하다 — [보내지 않음]으로 닫았거나 계약 정보를 지우고 보냈다(처리 영역에 안내 한 줄이 남는다. 다시 열면 지운다). */
  skipped: boolean;
}

export type ConsultSmsEvent =
  /**
   * 서버가 새 두 조각을 내렸다(상담완료로 바뀐 뒤의 새로고침 — 처리 영역은 다시 만들어지지 않는다). 고치지 않은 문구·계약 정보는 새 기본값을 따르고,
   * 고치던 것은 지킨다(메모 칸의 propMemo 와 같은 규칙).
   */
  | { type: "draft"; defaultText: string; block: string }
  | { type: "open"; customerName: string }
  | { type: "edit"; text: string }
  /** 계약 정보 칸을 고쳤다. */
  | { type: "contract"; text: string }
  /** [기본 내용으로 되돌리기] — 계약 정보만 기본 블록으로(문구는 그대로). */
  | { type: "resetContract" }
  | { type: "skip" }
  | { type: "blocked"; banner: ConsultSmsBanner }
  | { type: "settled"; result: ConsultSmsResult };

export function initialConsultSmsState(defaultText: string, block = ""): ConsultSmsState {
  return { open: false, text: defaultText, defaultText, contract: block, block, customerName: "", banner: null, bannerSeq: 0, skipped: false };
}

export function consultSmsReducer(state: ConsultSmsState, event: ConsultSmsEvent): ConsultSmsState {
  switch (event.type) {
    case "draft":
      if (event.defaultText === state.defaultText && event.block === state.block) return state;
      return {
        ...state,
        text: state.text === state.defaultText ? event.defaultText : state.text,
        defaultText: event.defaultText,
        contract: state.contract === state.block ? event.block : state.contract,
        block: event.block,
      };
    case "open":
      // 열 때마다 계약 정보는 기본값부터 — 고치다 닫은 것을 다음에 그대로 보내는 일이 없게(문구는 이어 쓴다)
      return { ...state, open: true, contract: state.block, customerName: event.customerName, banner: null, skipped: false };
    case "edit":
      return { ...state, text: event.text, banner: null };
    case "contract":
      return { ...state, contract: event.text, banner: null };
    case "resetContract":
      return { ...state, contract: state.block, banner: null };
    case "skip":
      if (!state.open) return state;
      return { ...state, open: false, banner: null, skipped: true };
    case "blocked":
      return state.open ? { ...state, banner: event.banner, bannerSeq: state.bannerSeq + 1 } : state;
    case "settled": {
      const { result } = event;
      // 계약 정보를 전부 지우고 보냈다 — 막지는 않되 "보내지 않음" 과 같은 안내를 한 번 남긴다
      if (result.ok) return { ...state, open: false, text: state.defaultText, contract: state.block, banner: null, skipped: state.contract.trim() === "" };
      if (!state.open) return state;
      const banner: ConsultSmsBanner =
        result.code === "notConsulted"
          ? { kind: "notConsulted" }
          : result.code === "invalid"
            ? { kind: "invalid" }
            : result.code === "tooLong"
              ? { kind: "tooLong", bytes: smsByteLength(joinConsultSms(state.text, state.contract)), max: CONSULT_SMS_MAX_BYTES }
              : { kind: "failed" };
      return { ...state, banner, bannerSeq: state.bannerSeq + 1 };
    }
  }
}

/** 보내기 전에 막을 것 — 막으면 배너, 아니면 null(서버액션을 부른다). */
export function blockBeforeSend(freeText: string, contract: string): ConsultSmsBanner | null {
  const check = checkConsultSms(freeText, contract);
  if (check.kind === "empty") return { kind: "empty" };
  if (check.kind === "tooLong") return { kind: "tooLong", bytes: check.bytes, max: check.max };
  return null;
}
