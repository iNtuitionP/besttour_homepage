/**
 * P3-8 — 간편 견적 입력(lib/types.ts quickReservationSchema(now)) 규칙.
 *
 * 공개 접수 경로는 이것 하나다(6단계 위저드 폐지). 옛 `ReservationInput`(위저드 전체 필드)의 테스트가 지키던 성질 중 간편 견적에도
 * 해당하는 것을 여기로 옮겼다 — 동의 필수(literal true) · 연락처 XOR · 달력에 없는 날짜는 validation(server 가 아니다) ·
 * regex 가 이미 실패한 값에는 두 번째 issue 를 더하지 않는다 · 장소 코드는 LOCATION_CODES 만.
 * 새로 생긴 규칙: 출발일 ≥ KST 오늘(서버 시계 — 옛 위저드의 브라우저 min 속성을 서버로 올렸다) · 도착일 ≥ 출발일 · 인원 필수 1~900.
 *
 * `now` 를 고정해 "오늘" 경계를 KST 로 본다 — UTC 날짜와 KST 날짜가 갈리는 새벽(KST 00:00~08:59)을 따로 단언한다.
 * tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { LOCATION_CODES } from "@/lib/codes";
import { QuickReservationShape, isCalendarDate, quickReservationSchema } from "@/lib/types";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");

/** KST 2026-09-13 12:00 (UTC 03:00). */
const NOW = new Date("2026-09-13T03:00:00.000Z");

const BASE = {
  name: "홍길동",
  phone: "010-1234-5678",
  originCode: "ICN",
  destinationCode: "SEL",
  departDate: "2026-10-01",
  returnDate: "2026-10-01",
  passengers: 30,
  turnstileToken: "tok",
  privacyConsent: true,
  withdrawalConsent: true,
} as const;

/** `undefined` 로 덮으면 그 키를 뺀다(폼이 빈 칸을 빼서 보내는 것과 같다). */
function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...BASE, ...overrides };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return merged;
}

function issues(raw: Record<string, unknown>, now: Date = NOW) {
  const r = quickReservationSchema(now).safeParse(raw);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code, message: i.message }));
}
const at = (raw: Record<string, unknown>, field: string, now?: Date) => issues(raw, now).filter((i) => i.path === field);
const ok = (raw: Record<string, unknown>, now: Date = NOW) => quickReservationSchema(now).safeParse(raw).success;

describe("기본 — 유효한 간편 입력은 통과하고, 기본값(locale ko)이 붙는다", () => {
  test("통과 · locale 기본 ko · 계약 밖 키는 버린다(strip)", () => {
    const r = quickReservationSchema(NOW).safeParse({ ...input(), vehicleSlug: "bus45", busCount: 2, marketingConsent: true });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.locale).toBe("ko");
    for (const k of ["vehicleSlug", "busCount", "marketingConsent"]) expect(k in r.data, k).toBe(false);
  });

  test("스키마 키 = 이름·연락처2·출발지·도착지·출발일·도착일·인원·locale·turnstileToken·website·동의2 (차종·목적·시각·왕복·대수 없음)", () => {
    expect(Object.keys(QuickReservationShape.shape).sort()).toEqual(
      ["name", "phone", "phoneIntl", "originCode", "destinationCode", "departDate", "returnDate", "passengers", "locale", "turnstileToken", "website", "privacyConsent", "withdrawalConsent"].sort(),
    );
  });
});

describe("필수 누락", () => {
  test.each(["name", "originCode", "destinationCode", "departDate", "returnDate", "passengers", "privacyConsent", "withdrawalConsent"])(
    "%s 누락 → 그 필드 issue",
    (field) => {
      expect(at(input({ [field]: undefined }), field).length).toBeGreaterThan(0);
    },
  );

  test("이름 31자 → issue · 30자 → 통과 (0001 CHECK 1~30)", () => {
    expect(at(input({ name: "가".repeat(31) }), "name")).toHaveLength(1);
    expect(ok(input({ name: "가".repeat(30) }))).toBe(true);
  });
});

describe("연락처 XOR (M6)", () => {
  test("둘 다 없음 → phone issue 1개", () => {
    expect(at(input({ phone: undefined }), "phone")).toHaveLength(1);
  });
  test("둘 다 있음 → phone issue 1개", () => {
    expect(at(input({ phoneIntl: "+15551234567" }), "phone")).toHaveLength(1);
  });
  test("phoneIntl 하나 → 통과 · 빈 문자열은 없음이 아니라 형식 위반", () => {
    expect(ok(input({ phone: undefined, phoneIntl: "+15551234567" }))).toBe(true);
    expect(ok(input({ phone: "" }))).toBe(false);
  });
});

describe("날짜 — 달력 · 과거 · 도착 < 출발", () => {
  test("달력에 없는 출발일(2026-02-30 · 비윤년 2027-02-29) → departDate issue 정확히 1개 · 윤년 2028-02-29 는 통과", () => {
    expect(at(input({ departDate: "2027-02-29", returnDate: "2027-03-02" }), "departDate")).toHaveLength(1);
    expect(at(input({ departDate: "2026-02-30", returnDate: "2027-03-02" }), "departDate")).toHaveLength(1);
    expect(ok(input({ departDate: "2028-02-29", returnDate: "2028-02-29" }))).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
  });

  test("regex 가 이미 실패한 값(2026-2-3 · 2026-10-01T08:00)에는 두 번째 issue 를 더하지 않는다", () => {
    expect(at(input({ departDate: "2026-2-3" }), "departDate")).toHaveLength(1);
    expect(at(input({ departDate: "2026-10-01T08:00" }), "departDate")).toHaveLength(1);
  });

  test("과거 출발일 → departDate issue · KST 오늘은 통과", () => {
    expect(at(input({ departDate: "2026-09-12", returnDate: "2026-09-12" }), "departDate")).toHaveLength(1);
    expect(ok(input({ departDate: "2026-09-13", returnDate: "2026-09-13" }))).toBe(true);
  });

  test("KST 새벽 — UTC 로는 아직 어제(9/12 20:00Z)여도 KST 로 9/13 이면 9/12 출발은 과거다", () => {
    const kstDawn = new Date("2026-09-12T20:00:00.000Z"); // KST 2026-09-13 05:00
    expect(at(input({ departDate: "2026-09-12", returnDate: "2026-09-12" }), "departDate", kstDawn)).toHaveLength(1);
    expect(ok(input({ departDate: "2026-09-13", returnDate: "2026-09-13" }), kstDawn)).toBe(true);
  });

  test("도착일 < 출발일 → returnDate issue 1개 · 같은 날·뒤는 통과", () => {
    expect(at(input({ departDate: "2026-10-02", returnDate: "2026-10-01" }), "returnDate")).toHaveLength(1);
    expect(ok(input({ departDate: "2026-10-02", returnDate: "2026-10-02" }))).toBe(true);
    expect(ok(input({ departDate: "2026-10-02", returnDate: "2026-10-05" }))).toBe(true);
  });

  test("출발일이 달력에 없으면 도착일 비교는 건너뛴다(이중 issue 없음)", () => {
    expect(at(input({ departDate: "2026-02-30", returnDate: "2026-01-01" }), "returnDate")).toHaveLength(0);
  });
});

describe("인원 — 필수 1~900 정수", () => {
  test.each([0, 901, 1.5, Number.NaN, -3])("%s → passengers issue", (passengers) => {
    expect(at(input({ passengers }), "passengers").length).toBeGreaterThan(0);
  });
  test("문자열 '30' 은 거부 (폼 변환이 number 로 만든다 — 조용한 보정 없음)", () => {
    expect(at(input({ passengers: "30" }), "passengers").length).toBeGreaterThan(0);
  });
  test("1 · 900 → 통과", () => {
    expect(ok(input({ passengers: 1 }))).toBe(true);
    expect(ok(input({ passengers: 900 }))).toBe(true);
  });
});

describe("동의 2종 — literal(true) (ADR-6 · P1-7)", () => {
  test.each([
    ["false", false],
    ["문자열 'true'", "true"],
    ["1", 1],
    ["'on'", "on"],
  ])("privacyConsent %s → 거부", (_label, value) => {
    expect(at(input({ privacyConsent: value }), "privacyConsent")).toHaveLength(1);
  });
  test.each([
    ["false", false],
    ["문자열 'true'", "true"],
    ["1", 1],
  ])("withdrawalConsent %s → 거부", (_label, value) => {
    expect(at(input({ withdrawalConsent: value }), "withdrawalConsent")).toHaveLength(1);
  });
});

describe("장소 코드 — LOCATION_CODES(28) 만", () => {
  test("도시·시도 코드 전부 통과 · 모르는 코드·한글 이름은 거부", () => {
    for (const code of LOCATION_CODES) expect(ok(input({ originCode: code })), code).toBe(true);
    expect(at(input({ originCode: "XXX" }), "originCode")).toHaveLength(1);
    expect(at(input({ destinationCode: "통영" }), "destinationCode")).toHaveLength(1);
  });
});

describe("정적 — lib/types.ts", () => {
  const src = stripComments(readFileSync(path.join(ROOT, "lib", "types.ts"), "utf-8"), "lib/types.ts");
  test("옛 위저드 스키마(ReservationInput)가 남아 있지 않다 — 공개 접수 경로는 하나", () => {
    expect(src).not.toMatch(/\bReservationInput\b/);
    expect(src).not.toMatch(/departAtLocal|returnAtLocal|waypointCodes|busCount|tripType/);
  });
  test("날짜 하한은 toKstDateString(now) 로 — 서버 TZ 와 무관(CLAUDE.md §3)", () => {
    expect(src).toMatch(/toKstDateString\(now\)/);
    expect(src).not.toMatch(/new Date\(\)/);
  });
});
