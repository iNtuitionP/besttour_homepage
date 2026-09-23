/**
 * P3-4 — 견적 신청 위저드 6단계 `/quote` 계약 테스트 (브리프 §검증 1~5 + 렌더 전략·토큰).
 *
 * vitest 는 node 환경이다 — DOM 렌더 패키지를 설치하지 않는다. 여기서는
 *   (1) 순수 로직(리듀서·프리필·초안 직렬화·검증·폼 값 변환·제출 게이트·프리뷰 결과·폼 토큰),
 *   (2) 소스 정적 검사(원장 import·문구 리터럴 0·사전 체크 0·localStorage 0·금지어 0·가격 0·email 옵션 0·
 *       useActionState 래퍼·force-dynamic·'use client' 경계·필드명 1:1)
 * 만 잠그고, 실제 렌더(6단계 통과·동의 disabled·aria-live·새로고침·뒤로가기·프리필)는 browse 로 실측해 보고서에 남긴다.
 *
 * 주의: tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 * 금지어 리터럴은 유니코드 이스케이프로 조립한다(tests/home.test.ts 규약).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  clearDraft,
  DRAFT_STORAGE_KEY,
  loadDraft,
  parseDraft,
  saveDraft,
  serializeDraft,
  type StorageLike,
} from "@/components/quote/draft";
import { FORM_TOKEN_UNAVAILABLE_EVENT, issueQuoteFormToken } from "@/components/quote/form-token";
import { F, G } from "@/components/quote/fields";
import {
  CONTACT_METHODS,
  HIDDEN_CONTACT_METHODS,
  locationGroups,
  PAYMENT_METHODS,
  PHONE_INTL_INPUT_PATTERN,
  PHONE_KR_INPUT_PATTERN,
  formatKrPhone,
} from "@/components/quote/options";
import { hasPrefill, parsePrefill, stripPrefillParams } from "@/components/quote/prefill";
import { parsePreviewSubmit, PREVIEW_SUBMIT_MODES, previewSubmitResult } from "@/components/quote/preview-submit";
import { isIntakeReady, submitBlock } from "@/components/quote/submit-gate";
import {
  clampStep,
  departAtLocal,
  firstInvalidStep,
  INITIAL_STATE,
  MAX_WAYPOINTS,
  reducer,
  returnAtLocal,
  returnMode,
  STEP_COUNT,
  STEP_KEYS,
  stepForField,
  toFormValues,
  validateAll,
  validateStep,
  type WizardState,
} from "@/components/quote/wizard-state";
import { LOCATION_CODES, PLACES, REGIONS } from "@/lib/codes";
import { GUARD_SECRET_MIN_LENGTH, guardSecret } from "@/lib/guard/deps";
import { verifyFormToken } from "@/lib/guard/timetrap";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";
import { CANCELLATION, PAYMENT, PRIVACY_NOTICE, QUOTE_BASIS, TERMS, VERBATIM, WITHDRAWAL } from "@/lib/legal/disclosures";
import { GUARD_FORM_FIELDS, RESERVATION_FORM_FIELDS } from "@/lib/reservations/formData";
import { PUBLIC_CODE_PATTERN } from "@/lib/reservations/publicCode";
import { RESERVATION_ERROR_KEYS } from "@/lib/reservations/submitResult";
import { PHONE_INTL_PATTERN, PHONE_KR_PATTERN } from "@/lib/types";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const QUOTE_DIR = "components/quote";
const PAGE = "app/[locale]/(site)/quote/page.tsx";
const DONE_PAGE = "app/[locale]/(site)/quote/done/page.tsx";
const WIZARD = `${QUOTE_DIR}/QuoteWizard.tsx`;
const TURNSTILE = `${QUOTE_DIR}/TurnstileWidget.tsx`;
const WITHDRAWAL_FILE = `${QUOTE_DIR}/WithdrawalNotice.tsx`;
const DEPS = "lib/guard/deps.ts";
const MESSAGES_KO = "messages/ko.json";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function walk(absDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    const p = path.join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const toPosix = (p: string) => p.split(path.sep).join("/");

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

function ledgerImports(src: string): string[] {
  const names: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/legal\/disclosures["']/g;
  for (const m of src.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const n = raw.trim().split(/\s+as\s+/)[0].trim();
      if (n) names.push(n);
    }
  }
  return names;
}

const quoteFiles = walk(path.join(ROOT, QUOTE_DIR)).map((p) => toPosix(path.relative(ROOT, p)));
const quoteTsx = quoteFiles.filter((f) => f.endsWith(".tsx"));
const quoteCodeFiles = [...quoteFiles.filter((f) => /\.(tsx?|css)$/.test(f)), PAGE, DONE_PAGE];
const quoteSources = quoteCodeFiles.map((file) => ({ file, text: read(file), code: codeOf(file) }));

const ko = JSON.parse(read(MESSAGES_KO)) as Record<string, unknown>;
const quoteKo = JSON.stringify(ko.quote ?? null);

// ── 금지어 (리터럴 금지 — 헤더 참조) ──────────────────────────────────────
// 코드포인트로 조립한다 — 이 파일 자체가 금지어 게이트의 검사 대상이라 리터럴을 둘 수 없다.
const W_LICENSE = String.fromCharCode(47732, 54728); // "등록"이 맞다 — CLAUDE.md §3
const W_RIVAL = String.fromCharCode(51204, 49464, 48260, 49828, 54616, 45208); // 타사 상호
const W_BM_OUTBOUND = String.fromCharCode(45208, 44032, 45716, 32, 48260, 49828); // soul §10.2
const W_BM_TAKEOUT = String.fromCharCode(53468, 50864, 44256, 32, 45208, 44032); // soul §10.2
const W_BM_EMPTY = String.fromCharCode(44277, 52264); // soul §10.2
const W_BM_RETURN = String.fromCharCode(54924, 49569); // soul §10.2
const FORBIDDEN = [W_LICENSE, W_RIVAL, W_BM_OUTBOUND, W_BM_TAKEOUT, W_BM_EMPTY, W_BM_RETURN];

/** 가격 노출 흔적 — 금액 단위·통화 기호 (원장이 렌더하는 계약금 문구는 원장 import 로만 온다). */
const PRICE_MARKS = [/\d\s*만\s*원/, /₩/, /\bKRW\b/, /priceFrom/, /price_from/];

const SECRET = "unit-test-guard-secret-0123456789abcdef0123456789abcdef";

/** 6단계 전부 유효한 상태 (테스트 픽스처 — 실데이터 아님). */
function validState(over: Partial<WizardState> = {}): WizardState {
  return {
    ...INITIAL_STATE,
    purposeCode: "workshop",
    vehicleSlug: "bus45",
    originCode: "SEL",
    destinationCode: "TYG",
    waypointCodes: [],
    tripType: "round",
    departDate: "2026-10-01",
    departTime: "08:00",
    returnDate: "2026-10-01",
    returnTime: "18:00",
    busCount: "1",
    passengers: "30",
    name: "홍길동",
    phoneKind: "kr",
    phone: "010-1234-5678",
    phoneIntl: "",
    email: "",
    privacyConsent: true,
    marketingConsent: false,
    withdrawalConsent: true,
    ...over,
  };
}

// =============================================================================
// 1. 리듀서 — 6단계 전이 · 귀가 필드 규칙 · 경유지 최대 5
// =============================================================================
describe("1. 리듀서 — 단계 전이", () => {
  test("6단계 상수와 초기 단계", () => {
    expect(STEP_COUNT).toBe(6);
    expect(STEP_KEYS).toEqual(["purpose", "vehicle", "route", "schedule", "options", "contact"]);
    expect(INITIAL_STATE.step).toBe(1);
  });

  test("next 는 1→6 까지 올라가고 6 에서 멈춘다, prev 는 1 에서 멈춘다", () => {
    let s = INITIAL_STATE;
    const seen = [s.step];
    for (let i = 0; i < 7; i++) {
      s = reducer(s, { type: "next" });
      seen.push(s.step);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 6, 6]);
    s = reducer(s, { type: "prev" });
    expect(s.step).toBe(5);
    s = reducer({ ...s, step: 1 }, { type: "prev" });
    expect(s.step).toBe(1);
  });

  test("goto / clampStep 은 1..6 으로 자른다 (문자열·NaN·범위 밖)", () => {
    expect(clampStep("3")).toBe(3);
    expect(clampStep(3)).toBe(3);
    expect(clampStep("0")).toBe(1);
    expect(clampStep("9")).toBe(6);
    expect(clampStep("abc")).toBe(1);
    expect(clampStep(null)).toBe(1);
    expect(clampStep(undefined)).toBe(1);
    expect(clampStep("2.7")).toBe(1);
    expect(reducer(INITIAL_STATE, { type: "goto", step: 4 }).step).toBe(4);
    expect(reducer(INITIAL_STATE, { type: "goto", step: 99 }).step).toBe(6);
  });

  test("귀가 필드 규칙 — round 필수 · oneway_oneway 선택 · oneway 숨김 · 미선택 숨김", () => {
    expect(returnMode("round")).toBe("required");
    expect(returnMode("oneway_oneway")).toBe("optional");
    expect(returnMode("oneway")).toBe("hidden");
    expect(returnMode("")).toBe("hidden");
  });

  test("setTripType('oneway') 는 귀가 날짜를 비우고, oneway 의 returnAtLocal 은 언제나 빈 문자열", () => {
    const withReturn = validState({ tripType: "round" });
    const oneway = reducer(withReturn, { type: "setTripType", value: "oneway" });
    expect(oneway.tripType).toBe("oneway");
    expect(oneway.returnDate).toBe("");
    expect(returnAtLocal(oneway)).toBe("");
    // 방어: 상태에 귀가 값이 남아 있어도 oneway 면 보내지 않는다
    expect(returnAtLocal({ ...oneway, returnDate: "2026-10-02", returnTime: "18:00" })).toBe("");
    expect(toFormValues({ ...oneway, returnDate: "2026-10-02" }).returnAtLocal).toBe("");
  });

  test("경유지는 최대 5개 — addWaypoint 6번 → 5개, set/remove 동작", () => {
    let s = INITIAL_STATE;
    for (let i = 0; i < 6; i++) s = reducer(s, { type: "addWaypoint" });
    expect(MAX_WAYPOINTS).toBe(5);
    expect(s.waypointCodes).toHaveLength(5);
    s = reducer(s, { type: "setWaypoint", index: 1, value: "DJN" });
    expect(s.waypointCodes[1]).toBe("DJN");
    s = reducer(s, { type: "removeWaypoint", index: 0 });
    expect(s.waypointCodes).toHaveLength(4);
    expect(s.waypointCodes[0]).toBe("DJN");
    // 범위 밖 인덱스는 무시
    expect(reducer(s, { type: "setWaypoint", index: 9, value: "SEL" })).toEqual(s);
    expect(reducer(s, { type: "removeWaypoint", index: 9 })).toEqual(s);
  });

  test("set / toggle 은 해당 필드만 바꾸고 나머지는 그대로", () => {
    const a = reducer(INITIAL_STATE, { type: "set", field: "name", value: "김" });
    expect(a.name).toBe("김");
    expect({ ...a, name: INITIAL_STATE.name }).toEqual(INITIAL_STATE);
    const b = reducer(INITIAL_STATE, { type: "toggle", field: "privacyConsent", value: true });
    expect(b.privacyConsent).toBe(true);
    expect(reducer(b, { type: "toggle", field: "privacyConsent", value: false }).privacyConsent).toBe(false);
  });

  test("reset 은 초기 상태로 (단계 1 포함)", () => {
    expect(reducer(validState({ step: 6 }), { type: "reset" })).toEqual(INITIAL_STATE);
  });
});

// =============================================================================
// 2. 검증 — 단계별 규칙 · 필드→단계 · 폼 값 변환
// =============================================================================
describe("2. 검증 · 폼 값", () => {
  test("빈 상태: 1단계는 purposeCode 오류 하나, firstInvalidStep 은 1", () => {
    expect(validateStep(INITIAL_STATE, 1).map((e) => e.field)).toEqual(["purposeCode"]);
    expect(firstInvalidStep(INITIAL_STATE)).toBe(1);
  });

  test("유효한 상태는 오류 0, firstInvalidStep 은 6", () => {
    expect(validateAll(validState())).toEqual([]);
    expect(firstInvalidStep(validState())).toBe(6);
    // 5단계까지만 유효(연락처 비움)면 6
    expect(firstInvalidStep(validState({ name: "", privacyConsent: false }))).toBe(6);
  });

  test("잘못된 코드는 거부 — purpose XXX · 장소 XXX · 차량 빈값", () => {
    expect(validateStep(validState({ purposeCode: "XXX" }), 1).map((e) => e.field)).toEqual(["purposeCode"]);
    expect(validateStep(validState({ vehicleSlug: "" }), 2).map((e) => e.field)).toEqual(["vehicleSlug"]);
    expect(validateStep(validState({ destinationCode: "" }), 3).map((e) => e.field)).toEqual(["destinationCode"]);
    expect(validateStep(validState({ originCode: "XXX", destinationCode: "" }), 3).map((e) => e.field)).toEqual([
      "originCode",
      "destinationCode",
    ]);
  });

  test("추가만 하고 고르지 않은 경유지는 오류, 고른 경유지는 통과", () => {
    expect(validateStep(validState({ waypointCodes: [""] }), 3).map((e) => e.field)).toEqual(["waypointCodes"]);
    expect(validateStep(validState({ waypointCodes: ["DJN", "XXX"] }), 3).map((e) => e.field)).toEqual(["waypointCodes"]);
    expect(validateStep(validState({ waypointCodes: ["DJN", "GN"] }), 3)).toEqual([]);
  });

  test("4단계 — 운행 구분·출발 필수, round 귀가 필수, 귀가 ≤ 출발 거부, oneway_oneway 귀가 선택", () => {
    const f = (over: Partial<WizardState>) => validateStep(validState(over), 4).map((e) => e.field);
    expect(f({ tripType: "" })).toContain("tripType");
    expect(f({ departDate: "" })).toEqual(["departAtLocal"]);
    expect(f({ departTime: "" })).toEqual(["departAtLocal"]);
    expect(f({ tripType: "round", returnDate: "" })).toEqual(["returnAtLocal"]);
    expect(f({ tripType: "round", returnDate: "2026-10-01", returnTime: "08:00" })).toEqual(["returnAtLocal"]);
    expect(f({ tripType: "round", returnDate: "2026-09-30", returnTime: "23:00" })).toEqual(["returnAtLocal"]);
    expect(f({ tripType: "round", returnDate: "2026-10-01", returnTime: "08:01" })).toEqual([]);
    expect(f({ tripType: "oneway_oneway", returnDate: "", returnTime: "" })).toEqual([]);
    expect(f({ tripType: "oneway_oneway", returnDate: "2026-10-02", returnTime: "09:00" })).toEqual([]);
    expect(f({ tripType: "oneway_oneway", returnDate: "2026-09-01", returnTime: "09:00" })).toEqual(["returnAtLocal"]);
    // 날짜만 있고 시각이 없으면 불완전
    expect(f({ tripType: "oneway_oneway", returnDate: "2026-10-02", returnTime: "" })).toEqual(["returnAtLocal"]);
    expect(f({ tripType: "oneway", returnDate: "", returnTime: "" })).toEqual([]);
  });

  test("4단계 — 대수 1~20 · 인원 1~900 정수", () => {
    const f = (over: Partial<WizardState>) => validateStep(validState(over), 4).map((e) => e.field);
    expect(f({ busCount: "0" })).toEqual(["busCount"]);
    expect(f({ busCount: "21" })).toEqual(["busCount"]);
    expect(f({ busCount: "1.5" })).toEqual(["busCount"]);
    expect(f({ busCount: "" })).toEqual(["busCount"]);
    expect(f({ passengers: "" })).toEqual(["passengers"]);
    expect(f({ passengers: "901" })).toEqual(["passengers"]);
    expect(f({ passengers: "abc" })).toEqual(["passengers"]);
    expect(f({ busCount: "20", passengers: "900" })).toEqual([]);
  });

  test("5단계 — 전부 선택이지만 남기는 말씀은 1000자 이내", () => {
    expect(validateStep(validState({ message: "a".repeat(1000) }), 5)).toEqual([]);
    expect(validateStep(validState({ message: "a".repeat(1001) }), 5).map((e) => e.field)).toEqual(["message"]);
  });

  test("6단계 — 성명·연락처(국내 XOR 해외)·이메일 형식·필수 동의", () => {
    const f = (over: Partial<WizardState>) => validateStep(validState(over), 6).map((e) => e.field);
    expect(f({ name: "  " })).toEqual(["name"]);
    expect(f({ name: "a".repeat(31) })).toEqual(["name"]);
    expect(f({ phone: "010-12-5678" })).toEqual(["phone"]);
    expect(f({ phone: "" })).toEqual(["phone"]);
    expect(f({ phone: "01012345678" })).toEqual([]);
    expect(f({ phoneKind: "intl", phoneIntl: "+14155550123", phone: "" })).toEqual([]);
    expect(f({ phoneKind: "intl", phoneIntl: "14155550123" })).toEqual(["phoneIntl"]);
    expect(f({ phoneKind: "intl", phoneIntl: "" })).toEqual(["phoneIntl"]);
    expect(f({ email: "not-an-email" })).toEqual(["email"]);
    expect(f({ email: "name@example.com" })).toEqual([]);
    expect(f({ privacyConsent: false })).toEqual(["privacyConsent"]);
    // P1-7 — 청약철회 제한 확인도 필수 동의다
    expect(f({ withdrawalConsent: false })).toEqual(["withdrawalConsent"]);
    expect(f({ privacyConsent: false, withdrawalConsent: false })).toEqual(["privacyConsent", "withdrawalConsent"]);
    // 선택 동의는 검증 대상이 아니다
    expect(f({ marketingConsent: true })).toEqual([]);
  });

  test("오류 항목은 messageKey 를 갖는다 (UI 가 t() 로 푼다)", () => {
    for (const e of validateAll(INITIAL_STATE)) {
      expect(typeof e.messageKey).toBe("string");
      expect(e.messageKey.length).toBeGreaterThan(0);
    }
  });

  test("stepForField — 서버 fieldErrors 키(= FormData 키)를 단계로 되돌린다", () => {
    const expected: Record<string, number> = {
      purposeCode: 1,
      vehicleSlug: 2,
      originCode: 3,
      destinationCode: 3,
      waypointCodes: 3,
      tripType: 4,
      departAtLocal: 4,
      returnAtLocal: 4,
      busCount: 4,
      passengers: 4,
      contactMethod: 5,
      paymentMethod: 5,
      parkingIncluded: 5,
      vatIncluded: 5,
      message: 5,
      name: 6,
      phone: 6,
      phoneIntl: 6,
      email: 6,
      locale: 6,
      privacyConsent: 6,
      marketingConsent: 6,
      withdrawalConsent: 6,
    };
    for (const k of Object.keys(RESERVATION_FORM_FIELDS)) expect(stepForField(k), k).toBe(expected[k]);
    expect(stepForField("turnstileToken")).toBe(6);
    expect(stepForField("unknown-field")).toBe(6);
  });

  test("toFormValues 의 키는 lib/reservations/formData 계약표와 1:1", () => {
    expect(Object.keys(toFormValues(validState())).sort()).toEqual(Object.keys(RESERVATION_FORM_FIELDS).sort());
  });

  test("toFormValues — KST 벽시계 문자열 그대로(Z 없음), 체크박스는 boolean, 경유지 빈 항목 제거", () => {
    const v = toFormValues(validState({ waypointCodes: ["DJN", "", "GN"], parkingIncluded: true }));
    expect(v.departAtLocal).toBe("2026-10-01T08:00");
    expect(v.returnAtLocal).toBe("2026-10-01T18:00");
    expect(String(v.departAtLocal)).not.toMatch(/Z$/);
    expect(v.waypointCodes).toEqual(["DJN", "GN"]);
    expect(v.parkingIncluded).toBe(true);
    expect(v.vatIncluded).toBe(false);
    expect(v.privacyConsent).toBe(true);
    expect(v.marketingConsent).toBe(false);
    expect(v.withdrawalConsent).toBe(true);
    expect(v.busCount).toBe("1");
    expect(v.passengers).toBe("30");
    expect(departAtLocal(validState({ departTime: "" }))).toBe("");
  });

  test("toFormValues — phone / phoneIntl 는 정확히 하나만 값이 있다 (XOR)", () => {
    const kr = toFormValues(validState({ phoneKind: "kr", phone: "010-1234-5678", phoneIntl: "+14155550123" }));
    expect(kr.phone).toBe("010-1234-5678");
    expect(kr.phoneIntl).toBe("");
    const intl = toFormValues(validState({ phoneKind: "intl", phone: "010-1234-5678", phoneIntl: "+14155550123" }));
    expect(intl.phone).toBe("");
    expect(intl.phoneIntl).toBe("+14155550123");
  });

  test("formatKrPhone — 숫자만 남기고 3-4-4 하이픈, 11자리 초과 절단", () => {
    expect(formatKrPhone("01012345678")).toBe("010-1234-5678");
    expect(formatKrPhone("0101234")).toBe("010-1234");
    expect(formatKrPhone("010")).toBe("010");
    expect(formatKrPhone("010-1234-5678-999")).toBe("010-1234-5678");
    expect(formatKrPhone("abc")).toBe("");
  });
});

// =============================================================================
// 3. 프리필 — ?origin=&dest=&date=&pax=&vehicle=
// =============================================================================
describe("3. 프리필", () => {
  test("?origin=SEL&dest=TYG&date=2026-09-20T08:00&pax=30 → 상태 반영", () => {
    const p = parsePrefill(new URLSearchParams("origin=SEL&dest=TYG&date=2026-09-20T08:00&pax=30"));
    expect(p).toEqual({
      originCode: "SEL",
      destinationCode: "TYG",
      departDate: "2026-09-20",
      departTime: "08:00",
      passengers: "30",
    });
    const s = reducer(INITIAL_STATE, { type: "init", draft: null, prefill: p });
    expect(s.originCode).toBe("SEL");
    expect(s.destinationCode).toBe("TYG");
    expect(s.departDate).toBe("2026-09-20");
    expect(s.departTime).toBe("08:00");
    expect(s.passengers).toBe("30");
  });

  test("홈 위젯 형식(date=YYYY-MM-DD, vehicle=slug)도 받는다", () => {
    const p = parsePrefill(new URLSearchParams("origin=ICN&dest=SEL&date=2026-09-20&pax=4&vehicle=bus16"));
    expect(p).toEqual({ originCode: "ICN", destinationCode: "SEL", departDate: "2026-09-20", passengers: "4", vehicleSlug: "bus16" });
  });

  test("잘못된 값은 무시 — 코드 XXX · 날짜 형식 · 달력에 없는 날 · pax 0/음수/소수/900 초과 · vehicle 특수문자", () => {
    expect(parsePrefill(new URLSearchParams("origin=XXX&dest=tyg"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("date=2026/09/20"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("date=2026-02-30"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("date=2026-09-20T25:00"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("pax=0"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("pax=-3"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("pax=2.5"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("pax=901"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("vehicle=BUS!45"))).toEqual({});
    expect(parsePrefill(new URLSearchParams("vehicle=bus45&origin=XXX"))).toEqual({ vehicleSlug: "bus45" });
    expect(hasPrefill(new URLSearchParams("step=3"))).toBe(false);
    expect(hasPrefill(new URLSearchParams("step=3&origin=SEL"))).toBe(true);
  });

  test("URL 정리 — 프리필 파라미터만 지우고 step 등은 남긴다", () => {
    expect(stripPrefillParams("?origin=SEL&dest=TYG&step=3&x=1")).toBe("?step=3&x=1");
    expect(stripPrefillParams("?origin=SEL&date=2026-09-20&pax=30&vehicle=bus45")).toBe("");
    expect(stripPrefillParams("")).toBe("");
    expect(stripPrefillParams("?step=2")).toBe("?step=2");
  });

  test("init — 초안 위에 프리필이 덮어쓰고, 단계는 도달 가능한 곳까지만", () => {
    const draft = parseDraft(serializeDraft(validState({ originCode: "BSN", destinationCode: "DGU" })));
    const p = parsePrefill(new URLSearchParams("origin=SEL&dest=TYG"));
    const s = reducer({ ...INITIAL_STATE, step: 6 }, { type: "init", draft, prefill: p });
    expect(s.originCode).toBe("SEL");
    expect(s.destinationCode).toBe("TYG");
    expect(s.vehicleSlug).toBe("bus45"); // 초안에서
    expect(s.step).toBe(6); // 1~5 가 유효하므로 6 유지
    // 초안 없이 ?step=6 으로 들어오면 1단계로 돌아간다
    expect(reducer({ ...INITIAL_STATE, step: 6 }, { type: "init", draft: null, prefill: {} }).step).toBe(1);
    // 프리필만 있으면 1단계(여행 구분)부터
    expect(reducer({ ...INITIAL_STATE, step: 3 }, { type: "init", draft: null, prefill: p }).step).toBe(1);
  });
});

// =============================================================================
// 4. 초안 저장 — sessionStorage 키 · 동의 필드 제외 · try/catch
// =============================================================================
describe("4. 초안 저장", () => {
  test("직렬화에 동의 필드·단계가 없다 — 재방문 시 다시 체크하게", () => {
    const json = serializeDraft(validState({ privacyConsent: true, marketingConsent: true, withdrawalConsent: true, step: 6 }));
    const obj = JSON.parse(json) as Record<string, unknown>;
    expect("privacyConsent" in obj).toBe(false);
    expect("marketingConsent" in obj).toBe(false);
    expect("withdrawalConsent" in obj).toBe(false);
    expect("step" in obj).toBe(false);
    expect(json.includes("Consent")).toBe(false);
    // 개인정보 필드는 초안에 있다(탭이 살아 있는 동안만 — sessionStorage)
    expect(obj.name).toBe("홍길동");
    expect(obj.phone).toBe("010-1234-5678");
  });

  test("parseDraft 는 모양을 검사한다 — 왕복 일치 · 쓰레기 null · 타입이 다른 필드는 버림 · 동의는 절대 복원하지 않음", () => {
    const back = parseDraft(serializeDraft(validState({ waypointCodes: ["DJN"] })));
    expect(back).not.toBeNull();
    expect(back?.name).toBe("홍길동");
    expect(back?.waypointCodes).toEqual(["DJN"]);
    expect(parseDraft("garbage{")).toBeNull();
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("[1,2]")).toBeNull();
    const dirty = parseDraft(JSON.stringify({ name: 123, waypointCodes: ["SEL", 7], privacyConsent: true, marketingConsent: true, step: 6, extra: 1 }));
    expect(dirty).toEqual({ waypointCodes: ["SEL"] });
    // init 이 초안에서 동의를 켤 수 없다
    const applied = reducer(INITIAL_STATE, { type: "init", draft: { ...(dirty ?? {}), privacyConsent: true, withdrawalConsent: true } as never, prefill: {} });
    expect(applied.privacyConsent).toBe(false);
    expect(applied.marketingConsent).toBe(false);
    expect(applied.withdrawalConsent).toBe(false);
  });

  test("저장소 키 고정 + 저장/복원/삭제 + 던지는 저장소에서도 throw 0", () => {
    expect(DRAFT_STORAGE_KEY).toBe("bestour.quote.draft.v1");
    const mem = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
    expect(saveDraft(storage, validState())).toBe(true);
    expect(mem.has(DRAFT_STORAGE_KEY)).toBe(true);
    expect(loadDraft(storage)?.destinationCode).toBe("TYG");
    clearDraft(storage);
    expect(loadDraft(storage)).toBeNull();

    const boom: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(saveDraft(boom, validState())).toBe(false);
    expect(loadDraft(boom)).toBeNull();
    expect(() => clearDraft(boom)).not.toThrow();
    expect(saveDraft(null, validState())).toBe(false);
    expect(loadDraft(undefined)).toBeNull();
  });
});

// =============================================================================
// 5. 선택지 — 장소 그룹 · 연락 방법(email 숨김) · 계산 방법
// =============================================================================
describe("5. 선택지", () => {
  test("장소 그룹 = 도시(PLACES) 우선 + 그 외 지역(시도), 합집합 = LOCATION_CODES, 겹침 0", () => {
    const groups = locationGroups();
    expect(groups.map((g) => g.key)).toEqual(["cities", "regions"]);
    const cities = groups[0].codes;
    const regions = groups[1].codes;
    expect(cities).toEqual([...PLACES].sort((a, b) => a.sort - b.sort).map((p) => p.code));
    expect(cities[0]).toBe("ICN");
    const placeSet = new Set<string>(PLACES.map((p) => p.code));
    expect(regions).toEqual(REGIONS.filter((r) => !placeSet.has(r)));
    expect([...cities, ...regions].sort()).toEqual([...LOCATION_CODES].sort());
    expect(new Set([...cities, ...regions]).size).toBe(LOCATION_CODES.length);
  });

  test("contactMethod 선택지에 email 이 없다 (메일 발송 경로 없음 — P4-5 후 복구)", () => {
    expect(CONTACT_METHODS).toEqual(["mobile", "phone", "fax"]);
    expect(CONTACT_METHODS as readonly string[]).not.toContain("email");
    expect(HIDDEN_CONTACT_METHODS).toEqual(["email"]);
    const contactKo = (ko.quote as { steps: { options: { contact: Record<string, string> } } }).steps.options.contact;
    expect(Object.keys(contactKo).sort()).toEqual([...CONTACT_METHODS].sort());
    expect(PAYMENT_METHODS).toEqual(["cash", "card", "tax_invoice"]);
  });
});

// =============================================================================
// 6. 제출 게이트 · 프리뷰 결과 · 청약철회 문장
// =============================================================================
describe("6. 제출 게이트 · 프리뷰", () => {
  test("submitBlock — 토큰/사이트키 없음 > 동의 없음 > 제출 중 > null", () => {
    const base = { formToken: "1.abc", siteKey: "site", privacyConsent: true, withdrawalConsent: true, pending: false };
    expect(submitBlock(base)).toBeNull();
    expect(submitBlock({ ...base, formToken: null })).toBe("not-ready");
    expect(submitBlock({ ...base, siteKey: "" })).toBe("not-ready");
    expect(submitBlock({ ...base, formToken: null, privacyConsent: false })).toBe("not-ready");
    expect(submitBlock({ ...base, privacyConsent: false })).toBe("consent");
    // P1-7 — 청약철회 제한 확인이 빠져도 닫힌다
    expect(submitBlock({ ...base, withdrawalConsent: false })).toBe("consent");
    expect(submitBlock({ ...base, pending: true })).toBe("pending");
    expect(isIntakeReady("tok", "key")).toBe(true);
    expect(isIntakeReady(null, "key")).toBe(false);
    expect(isIntakeReady("tok", "")).toBe(false);
  });

  test("previewSubmitResult — ok / fieldErrors(phone) / infra 세 모양, 접수번호는 형식에 맞는다", () => {
    expect(PREVIEW_SUBMIT_MODES).toEqual(["ok", "fieldErrors", "infra"]);
    const ok = previewSubmitResult("ok");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.publicCode).toMatch(PUBLIC_CODE_PATTERN);
    const fe = previewSubmitResult("fieldErrors");
    expect(fe).toEqual({
      ok: false,
      code: "validation",
      messageKey: RESERVATION_ERROR_KEYS.validation,
      fieldErrors: { phone: RESERVATION_ERROR_KEYS.validation },
    });
    expect(previewSubmitResult("infra")).toEqual({ ok: false, code: "infra", messageKey: RESERVATION_ERROR_KEYS.infra });
    expect(parsePreviewSubmit("1")).toBe("ok");
    expect(parsePreviewSubmit("fieldErrors")).toBe("fieldErrors");
    expect(parsePreviewSubmit("infra")).toBe("infra");
    expect(parsePreviewSubmit(undefined)).toBeNull();
    expect(parsePreviewSubmit("nope")).toBeNull();
    expect(parsePreviewSubmit(["ok"])).toBeNull();
  });

  // P1-7 — 6단계의 청약철회 제한 문장은 약관 제8조에서 잘라 낸 문장(P3-4) 대신 사장님이 확정한 원장 WITHDRAWAL.notice 다.
  // 약관 제8조 자체는 그대로이고 /terms 에 있다. 잘라 내던 도우미(components/quote/withdrawal.ts)는 쓰는 곳이 없어져 지웠다.
  test("청약철회 고지 — 원장 WITHDRAWAL.notice 를 렌더하고, 약관 제8조를 잘라 쓰던 도우미는 없다", () => {
    expect(TERMS.articles[7].no).toBe(8);
    expect(WITHDRAWAL.notice).toContain("청약철회");
    expect(existsSync(path.join(ROOT, QUOTE_DIR, "withdrawal.ts"))).toBe(false);
    const code = codeOf(WITHDRAWAL_FILE);
    expect(code).toMatch(/\{WITHDRAWAL\.notice\}/);
    expect(code).not.toMatch(/withdrawalSentence|TERMS\.articles/);
  });
});

// =============================================================================
// 7. 폼 토큰 — guardSecret() · issueQuoteFormToken() (렌더 전략·토큰 — 컨트롤러 결정)
// =============================================================================
describe("7. 폼 토큰 — env 없이도 페이지는 죽지 않는다", () => {
  const KEYS = ["GUARD_SECRET"] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("guardSecret — 없거나 32자 미만이면 throw, 있으면 그대로", () => {
    delete process.env.GUARD_SECRET;
    expect(() => guardSecret()).toThrow(/GUARD_SECRET/);
    process.env.GUARD_SECRET = "short";
    expect(() => guardSecret()).toThrow(/GUARD_SECRET/);
    process.env.GUARD_SECRET = SECRET;
    expect(SECRET.length).toBeGreaterThanOrEqual(GUARD_SECRET_MIN_LENGTH);
    expect(guardSecret()).toBe(SECRET);
  });

  test("issueQuoteFormToken — 시크릿 없음 → throw 0 · null · structuredLog 1건(quote.form_token_unavailable)", () => {
    delete process.env.GUARD_SECRET;
    const log = vi.fn();
    expect(issueQuoteFormToken(new Date(), log)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({ level: "error", event: FORM_TOKEN_UNAVAILABLE_EVENT });
    expect(FORM_TOKEN_UNAVAILABLE_EVENT).toBe("quote.form_token_unavailable");
    // 로그에 시크릿 값이 실리지 않는다
    expect(JSON.stringify(log.mock.calls[0][0])).not.toContain(SECRET);
  });

  test("issueQuoteFormToken — 시크릿 있음 → 서명된 토큰, 4초 뒤 verifyFormToken 통과, 로그 0", () => {
    process.env.GUARD_SECRET = SECRET;
    const log = vi.fn();
    const now = new Date("2026-09-13T00:00:00Z");
    const token = issueQuoteFormToken(now, log);
    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(verifyFormToken(token, new Date(now.getTime() + 4_000), SECRET)).toEqual({ ok: true });
    expect(log).not.toHaveBeenCalled();
  });

  test("deps.ts — defaultGuardDeps 가 guardSecret() 을 쓰고 GUARD_SECRET 을 읽는 곳은 한 곳", () => {
    const src = codeOf(DEPS);
    expect(src).toMatch(/export function guardSecret\(\): string/);
    expect((src.match(/process\.env\.GUARD_SECRET/g) ?? []).length).toBe(1);
    const body = src.slice(src.indexOf("export function defaultGuardDeps"));
    expect(body).toMatch(/guardSecret\(\)/);
    expect(body).not.toMatch(/process\.env\.GUARD_SECRET/);
  });
});

// =============================================================================
// 8. 정적 — 원장 import · 문구 리터럴 0 · 사전 체크 0 · localStorage 0 · 금지어 0 · 가격 0 · 경계
// =============================================================================
describe("8. 정적 검사", () => {
  test("산출물 파일이 있다", () => {
    for (const f of [PAGE, DONE_PAGE, WIZARD, TURNSTILE, WITHDRAWAL_FILE, `${QUOTE_DIR}/ConsentBlock.tsx`, `${QUOTE_DIR}/quote.module.css`]) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(true);
    }
    expect(quoteTsx.length).toBeGreaterThanOrEqual(8);
  });

  test("원장 import — PRIVACY_NOTICE·VERBATIM·QUOTE_BASIS·PAYMENT·CANCELLATION·WITHDRAWAL·LEGAL_LINKS 를 서버 파일이 가져온다", () => {
    const union = new Set(quoteSources.flatMap((s) => ledgerImports(s.text)));
    for (const n of ["PRIVACY_NOTICE", "VERBATIM", "QUOTE_BASIS", "PAYMENT", "CANCELLATION", "WITHDRAWAL", "LEGAL_LINKS"]) {
      expect(union.has(n), n).toBe(true);
    }
    // 청약철회 고지 컴포넌트가 5종을 직접 가져온다 (P1-7: 약관 제8조 대신 원장 WITHDRAWAL)
    const w = ledgerImports(read(WITHDRAWAL_FILE));
    for (const n of ["VERBATIM", "QUOTE_BASIS", "PAYMENT", "CANCELLATION", "WITHDRAWAL"]) expect(w, n).toContain(n);
    // 동의 문구는 page.tsx 가 원장에서 읽어 props 로 내린다
    expect(ledgerImports(read(PAGE))).toContain("PRIVACY_NOTICE");
  });

  test("원장 문구 리터럴 0 — 코드·ko.json quote 어디에도 법정 문장을 다시 쓰지 않았다", () => {
    const phrases = [
      VERBATIM.bookingNotice,
      QUOTE_BASIS.line,
      PAYMENT.line,
      CANCELLATION.referenceTime,
      CANCELLATION.tiers[0].label,
      PRIVACY_NOTICE.purpose,
      PRIVACY_NOTICE.itemsLine,
      PRIVACY_NOTICE.retention,
      PRIVACY_NOTICE.refusal,
      PRIVACY_NOTICE.consentLabel,
      PRIVACY_NOTICE.marketingConsentLabel,
      PRIVACY_NOTICE.publicFeedNotice,
      WITHDRAWAL.notice,
      WITHDRAWAL.consentLabel,
      WITHDRAWAL.consentLabelEn,
    ];
    for (const { file, code } of quoteSources) {
      for (const p of phrases) expect(code.includes(p), `${file} 에 원장 문구 리터럴: ${p.slice(0, 20)}…`).toBe(false);
    }
    for (const p of phrases) expect(quoteKo.includes(p), `ko.json quote 에 원장 문구: ${p.slice(0, 20)}…`).toBe(false);
  });

  test("클라이언트 위저드는 원장을 import 하지 않는다 (법정 문구는 서버가 props 로)", () => {
    expect(ledgerImports(read(WIZARD))).toEqual([]);
    expect(ledgerImports(read(TURNSTILE))).toEqual([]);
    expect(ledgerImports(read(`${QUOTE_DIR}/ConsentBlock.tsx`))).toEqual([]);
  });

  test("동의 사전 선택 0 — defaultChecked · checked={true} 리터럴 없음", () => {
    for (const { file, code } of quoteSources) {
      expect(/defaultChecked/.test(code), file).toBe(false);
      expect(/checked=\{?\s*true\s*\}?/.test(code), file).toBe(false);
    }
    const consent = read(`${QUOTE_DIR}/ConsentBlock.tsx`);
    expect(consent).toMatch(/name=\{F\.privacyConsent\}/);
    expect(consent).toMatch(/name=\{F\.marketingConsent\}/);
    expect(consent).toMatch(/type="checkbox"/);
  });

  test("localStorage 0 · sessionStorage 는 draft.ts 경유", () => {
    for (const { file, code } of quoteSources) expect(/localStorage/.test(code), file).toBe(false);
    for (const { file, code } of quoteSources) {
      if (file === `${QUOTE_DIR}/draft.ts` || file === WIZARD) continue;
      expect(/sessionStorage/.test(code), file).toBe(false);
    }
  });

  test("금지어 0 — components/quote · quote 페이지 · ko.json quote", () => {
    for (const { file, code } of quoteSources) for (const w of FORBIDDEN) expect(code.includes(w), `${file}: ${w}`).toBe(false);
    for (const w of FORBIDDEN) expect(quoteKo.includes(w), w).toBe(false);
  });

  test("가격 표시 0 — 금액 단위·통화·priceFrom 참조 없음", () => {
    for (const { file, code } of quoteSources) for (const re of PRICE_MARKS) expect(re.test(code), `${file}: ${re}`).toBe(false);
    for (const re of PRICE_MARKS) expect(re.test(quoteKo), String(re)).toBe(false);
  });

  test("useActionState — submitReservation 을 직접 넘기지 않고 (_prev, fd) 래퍼로 감싼다", () => {
    const src = codeOf(WIZARD);
    expect(src).not.toMatch(/useActionState\(\s*submitReservation/);
    expect(src).not.toMatch(/useActionState<[^>]*>\(\s*submitReservation/);
    expect(src).toMatch(/useActionState/);
    expect(src).toMatch(/submitReservation\(\s*fd\s*\)/);
    expect(src).toMatch(/from\s+["']@\/actions\/reservation["']/);
  });

  test("/quote 는 force-dynamic — 폼 토큰이 요청마다 새로 나온다", () => {
    const src = codeOf(PAGE);
    expect(src).toMatch(/^export const dynamic = ["']force-dynamic["'];?$/m);
    expect(src).not.toMatch(/export const revalidate/);
    expect(src).not.toMatch(/defaultGuardDeps/);
    expect(src).toMatch(/issueQuoteFormToken\(/);
    expect(src).toMatch(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  });

  test("폼 토큰 모듈은 guardSecret() 만 부르고 try/catch 로 감싼다", () => {
    const src = codeOf(`${QUOTE_DIR}/form-token.ts`);
    expect(src).toMatch(/guardSecret\(\)/);
    expect(src).not.toMatch(/defaultGuardDeps/);
    expect(src).toMatch(/try\s*\{[\s\S]*issueFormToken\([\s\S]*\}\s*catch/);
  });

  // P6-6: reservation.errors.* 의 ratelimit·infra·server 가 `{tel}` 보간을 쓰게 됐다(감사 R-6 — 리터럴 대표전화 제거).
  // 값을 넘기지 않으면 next-intl 이 렌더 시점에 던지므로, 카탈로그 쪽 단언과 짝이 되는 소스 쪽 단언을 둔다.
  test("서버 오류 문구를 풀 때 원장 tel 을 보간 인자로 넘긴다 ({tel} 자리가 비지 않게)", () => {
    const wiz = codeOf(WIZARD);
    // P1-7 — tel 은 { display, href } 다(영문은 +82 표기). 문장에는 표시 문자열을 넣는다.
    expect(wiz).toMatch(/tRoot\(\s*key\s*,\s*\{\s*tel:\s*tel\.display\s*\}\s*\)/);
  });

  test("'use client' 는 QuoteWizard.tsx · TurnstileWidget.tsx 두 파일뿐", () => {
    const clients = quoteTsx.filter((f) => /^\s*["']use client["']/m.test(read(f)));
    expect(clients.sort()).toEqual([TURNSTILE, WIZARD].sort());
    expect(/^\s*["']use client["']/m.test(read(PAGE))).toBe(false);
    expect(/^\s*["']use client["']/m.test(read(DONE_PAGE))).toBe(false);
  });

  test("next/link 0 · 청약철회 고지 data-legal · Turnstile action 상수 · 허니팟 속성", () => {
    for (const { file, code } of quoteSources) expect(/from\s+["']next\/link["']/.test(code), file).toBe(false);
    expect(read(WITHDRAWAL_FILE)).toMatch(/data-legal="withdrawal-notice"/);
    expect(read(PAGE)).toMatch(/TURNSTILE_ACTION/);
    const ts = read(TURNSTILE);
    expect(ts).toMatch(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
    expect(ts).not.toMatch(/response-field-name/);
    const wiz = codeOf(WIZARD);
    const hp = wiz.match(/<input[^>]*name=\{G\.website\}[^>]*\/>/)?.[0] ?? "";
    expect(hp, "허니팟 input 이 있어야 한다").not.toBe("");
    expect(hp).toMatch(/tabIndex=\{-1\}/);
    expect(hp).toMatch(/autoComplete="off"/);
    expect(hp).toMatch(/aria-hidden/);
  });

  test("페이지는 개인정보를 서버 컴포넌트 props 로 넘기지 않는다 (P3-5 리뷰 N-2) — 프리뷰는 mode 문자열만", () => {
    const src = codeOf(PAGE);
    expect(src).toMatch(/previewSubmit=\{/);
    expect(src).not.toMatch(/PREVIEW_RECENT_ROWS|name:\s*["']|phone:\s*["']/);
  });

  test("ko.json — quote 네임스페이스가 기존 5개 뒤에 추가됐고 기존 최상위 키 순서는 그대로 (뒤에 붙는 네임스페이스는 각 태스크가 잠근다 — P6-3a reservationCheck)", () => {
    const keys = Object.keys(ko);
    expect(keys.slice(0, 6)).toEqual(["common", "layout", "errors", "home", "reservation", "quote"]);
  });

  test("legacy-menu — 견적요청 ready:true (라우트 파일과 함께)", () => {
    expect(LEGACY_MENU.find((m) => m.key === "quote")?.ready).toBe(true);
    expect(existsSync(path.join(ROOT, PAGE))).toBe(true);
  });
});

// =============================================================================
// 9. 폼 필드명 1:1 — name={F.xxx} / name={G.xxx} 만 쓰고, 계약표와 집합이 같다
// =============================================================================
describe("9. 폼 필드명 1:1", () => {
  const code = quoteTsx.map((f) => codeOf(f)).join("\n");

  test("RESERVATION_FORM_FIELDS 의 키를 전부, 그것만 name= 으로 쓴다", () => {
    const used = new Set([...code.matchAll(/name=\{F\.([A-Za-z]+)\}/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(Object.keys(RESERVATION_FORM_FIELDS).sort());
  });

  test("guard 필드는 website·formToken 두 개 (cf-turnstile-response 는 위젯이 넣는다)", () => {
    const used = new Set([...code.matchAll(/name=\{G\.([A-Za-z]+)\}/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(["formToken", "website"]);
    expect(GUARD_FORM_FIELDS.turnstile).toBe("cf-turnstile-response");
  });

  test("문자열 리터럴 name=\"…\" 0건 — 계약표 밖 이름이 폼에 들어올 길이 없다", () => {
    expect(code.match(/\sname="[^"]*"/g) ?? []).toEqual([]);
    expect(code.match(/\sname=\{["'`]/g) ?? []).toEqual([]);
  });

  test("F·G(components/quote/fields.ts)는 lib/reservations/formData 의 상수와 값이 같다 (typeof 로 컴파일 시 잠그고 여기서 런타임 대조)", () => {
    expect(F).toEqual(RESERVATION_FORM_FIELDS);
    expect(G).toEqual({ website: GUARD_FORM_FIELDS.website, formToken: GUARD_FORM_FIELDS.formToken });
    for (const f of quoteTsx) {
      const src = codeOf(f);
      if (/\b[FG]\.[A-Za-z]+/.test(src)) expect(src, f).toMatch(/from\s+["']\.\/fields["']/);
    }
  });

  test("클라이언트 번들 위생 — components/quote 는 zod·node:crypto 를 끌어오는 lib 을 런타임 import 하지 않는다 (form-token.ts 는 서버 전용 예외)", () => {
    const HEAVY = /^import\s+(?!type\s)[^;]*from\s+["']@\/lib\/(types|guard(\/[a-z]+)?|reservations\/formData|reservations\/create|reservations\/db|supabase\/[a-z]+)["']/m;
    for (const f of quoteFiles.filter((x) => /\.tsx?$/.test(x))) {
      if (f === `${QUOTE_DIR}/form-token.ts`) continue;
      expect(HEAVY.test(codeOf(f)), f).toBe(false);
    }
    // 휴대폰 패턴은 lib/types(zod) 를 피해 복제했다 — 원본과 소스가 같아야 한다
    expect(PHONE_KR_INPUT_PATTERN.source).toBe(PHONE_KR_PATTERN.source);
    expect(PHONE_INTL_INPUT_PATTERN.source).toBe(PHONE_INTL_PATTERN.source);
  });
});
