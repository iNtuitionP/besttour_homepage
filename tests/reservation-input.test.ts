/**
 * P3-3-FIX M1 — `ReservationInput`(lib/types.ts) 운행 일시 규칙: 왕복 귀가 필수 · 귀가 > 출발 · 단순 편도는 귀가 금지.
 *
 * 배경(P3-3 독립 리뷰 M1): 이 세 조건은 lib/reservations/create.ts scheduleColumns 의 throw 만 잡고 있었다 → 사용자에게 `server`(일시적 오류)
 * 가 나가고 시도마다 error 스택 로그가 남았다. zod 단계로 올리면 `validation` + `fieldErrors.returnAtLocal` 로 내려간다.
 * create.ts 의 throw 는 방어선으로 남아 있다(tests/reservation-create.test.ts 가 그대로 잠근다 — 이제 step 0 재검증에서 같은 정규식으로 잡힌다).
 *
 * 비교는 문자열이 아니라 lib/kst.ts parseKst 인스턴트로 한다. 둘 중 하나가 parseKst 에서 실패하면 규칙 2 는 건너뛴다 —
 * regex 실패면 기존 regex issue 가, regex 는 통과했지만 달력에 없는 값(02-30·T24:00)이면 규칙 0(컨트롤러 결정 2026-09-13) 이 그 필드에 issue 를
 * 이미 냈으므로 같은 필드에 issue 를 두 번 만들지 않는다.
 * tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { PURPOSES } from "@/lib/codes";
import { ReservationInput } from "@/lib/types";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 왕복·유효 기본 입력. `undefined` 로 덮으면 그 키를 뺀다(폼이 빈 칸을 빼서 보내는 것과 같다). */
const BASE = {
  name: "홍길동",
  phone: "010-1234-5678",
  vehicleSlug: "bus45",
  purposeCode: PURPOSES[0],
  originCode: "SEL",
  destinationCode: "BSN",
  tripType: "round",
  departAtLocal: "2026-10-01T08:00",
  returnAtLocal: "2026-10-01T18:00",
  turnstileToken: "tok",
  privacyConsent: true,
  withdrawalConsent: true, // P1-7 — 청약철회 제한 확인(필수)
} as const;

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...BASE, ...overrides };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return merged;
}

function issues(raw: Record<string, unknown>) {
  const r = ReservationInput.safeParse(raw);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code, message: i.message }));
}
const at = (raw: Record<string, unknown>, field: string) => issues(raw).filter((i) => i.path === field);

// =============================================================================
// 규칙 1 — round 는 returnAtLocal 필수
// =============================================================================
describe("규칙 1 — tripType round 는 returnAtLocal 필수", () => {
  test("round + returnAtLocal 없음 → 실패, issue 정확히 1개, path returnAtLocal, code custom", () => {
    const all = issues(input({ returnAtLocal: undefined }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ path: "returnAtLocal", code: "custom", message: "round trip requires returnAtLocal" });
  });

  test("round + returnAtLocal 있음(출발 이후) → 통과", () => {
    expect(ReservationInput.safeParse(input()).success).toBe(true);
  });

  test("phone XOR 규칙과 독립 — 둘 다 어긋나면 phone·returnAtLocal issue 각 1개", () => {
    const all = issues(input({ phone: undefined, returnAtLocal: undefined }));
    expect(all.map((i) => i.path).sort()).toEqual(["phone", "returnAtLocal"]);
  });
});

// =============================================================================
// 규칙 2 — returnAtLocal > departAtLocal (parseKst 인스턴트 비교)
// =============================================================================
describe("규칙 2 — 귀가는 출발 이후 (parseKst 인스턴트, 문자열 비교 아님)", () => {
  test("귀가 == 출발 → returnAtLocal issue 1개 (0001 return_at > depart_at 은 같은 시각도 거부)", () => {
    const all = issues(input({ returnAtLocal: "2026-10-01T08:00" }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ path: "returnAtLocal", code: "custom" });
  });

  test("귀가 < 출발 (전날·같은 날 이른 시각) → returnAtLocal issue", () => {
    expect(at(input({ returnAtLocal: "2026-09-30T18:00" }), "returnAtLocal")).toHaveLength(1);
    expect(at(input({ returnAtLocal: "2026-10-01T07:59" }), "returnAtLocal")).toHaveLength(1);
  });

  test("귀가 = 출발 + 1분 → 통과 · 자정 경계(23:00 출발 → 다음날 01:00 귀가) → 통과 · 여러 날 뒤 → 통과", () => {
    expect(ReservationInput.safeParse(input({ returnAtLocal: "2026-10-01T08:01" })).success).toBe(true);
    expect(ReservationInput.safeParse(input({ departAtLocal: "2026-10-01T23:00", returnAtLocal: "2026-10-02T01:00" })).success).toBe(true);
    expect(ReservationInput.safeParse(input({ returnAtLocal: "2026-10-05T18:00" })).success).toBe(true);
  });

  test("returnAtLocal 형식 오류(regex 실패)면 규칙 2 는 건너뛴다 — 같은 필드에 issue 가 정확히 1개(regex 것)뿐", () => {
    for (const bad of ["2026-10-01", "2026-10-01T18:00:00", "2026-10-01T18:00Z", "10/01/2026 18:00"]) {
      const here = at(input({ returnAtLocal: bad }), "returnAtLocal");
      expect(here, bad).toHaveLength(1);
      expect(here[0].code, bad).not.toBe("custom");
    }
  });

  test("departAtLocal 형식 오류(regex 실패)면 규칙 2 는 건너뛴다 — departAtLocal issue 1개, returnAtLocal issue 0개", () => {
    const all = issues(input({ departAtLocal: "2026-10-01" }));
    expect(all.filter((i) => i.path === "departAtLocal")).toHaveLength(1);
    expect(all.filter((i) => i.path === "returnAtLocal")).toHaveLength(0);
  });

  test("oneway_oneway 도 귀가가 있으면 출발 이후여야 한다 (create.ts:136 과 동일)", () => {
    expect(at(input({ tripType: "oneway_oneway", returnAtLocal: "2026-10-01T08:00" }), "returnAtLocal")).toHaveLength(1);
    expect(at(input({ tripType: "oneway_oneway", returnAtLocal: "2026-09-30T08:00" }), "returnAtLocal")).toHaveLength(1);
  });
});

// =============================================================================
// 규칙 3 — oneway 는 returnAtLocal 금지 · oneway_oneway 는 있어도 없어도 됨
// =============================================================================
describe("규칙 3 — tripType 별 returnAtLocal 허용 (0006 reservations_round_trip_return_ck 와 일치)", () => {
  test("oneway + returnAtLocal 있음 → returnAtLocal issue 1개 (create.ts:148-153 이 throw 하고 0006 CHECK 가 oneway 의 return_at 을 금지한다)", () => {
    const all = issues(input({ tripType: "oneway" }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ path: "returnAtLocal", code: "custom" });
  });

  test("oneway + returnAtLocal 없음 → 통과", () => {
    expect(ReservationInput.safeParse(input({ tripType: "oneway", returnAtLocal: undefined })).success).toBe(true);
  });

  test("oneway_oneway + returnAtLocal 있음(출발 이후) → 통과 · 없음 → 통과 (0006 은 허용이지 강제가 아니다)", () => {
    expect(ReservationInput.safeParse(input({ tripType: "oneway_oneway" })).success).toBe(true);
    expect(ReservationInput.safeParse(input({ tripType: "oneway_oneway", returnAtLocal: undefined })).success).toBe(true);
  });
});

// =============================================================================
// 규칙 0 — 형식(regex)은 맞지만 달력에 없는 일시 (P3-3-FIX 후속, 컨트롤러 결정 2026-09-13)
// =============================================================================
describe("규칙 0 — regex 통과 ∧ parseKst 실패(달력에 없는 날짜·시각 범위 밖) → 그 필드 issue, ≤ 비교는 건너뜀", () => {
  const CALENDAR_ISSUE = /존재하지 않는 일시/;

  test("departAtLocal 2026-02-30T08:00 → departAtLocal issue 정확히 1개(custom, 메시지 토큰) · returnAtLocal issue 0", () => {
    const all = issues(input({ departAtLocal: "2026-02-30T08:00", returnAtLocal: "2026-03-01T18:00" }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ path: "departAtLocal", code: "custom" });
    expect(all[0].message).toMatch(CALENDAR_ISSUE);
  });

  test("returnAtLocal 2026-02-30T18:00 → returnAtLocal issue 정확히 1개 · departAtLocal issue 0 · 규칙 2(≤) issue 없음", () => {
    const all = issues(input({ departAtLocal: "2026-02-28T08:00", returnAtLocal: "2026-02-30T18:00" }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ path: "returnAtLocal", code: "custom" });
    expect(all[0].message).toMatch(CALENDAR_ISSUE);
  });

  test("시각 범위 밖 — T24:00 · T08:60 → 그 필드 issue 1개 (departAtLocal·returnAtLocal 각각)", () => {
    for (const bad of ["2026-10-01T24:00", "2026-10-01T08:60"]) {
      const dep = issues(input({ departAtLocal: bad, returnAtLocal: "2026-10-02T18:00" }));
      expect(dep, bad).toHaveLength(1);
      expect(dep[0], bad).toMatchObject({ path: "departAtLocal", code: "custom" });
      const ret = issues(input({ departAtLocal: "2026-10-01T08:00", returnAtLocal: bad }));
      expect(ret, bad).toHaveLength(1);
      expect(ret[0], bad).toMatchObject({ path: "returnAtLocal", code: "custom" });
    }
  });

  test("윤일 — 2028-02-29 는 통과, 2026-02-29 는 departAtLocal issue (달력 검증이 실제 달력을 쓴다)", () => {
    expect(ReservationInput.safeParse(input({ departAtLocal: "2028-02-29T08:00", returnAtLocal: "2028-02-29T18:00" })).success).toBe(true);
    const all = issues(input({ departAtLocal: "2026-02-29T08:00", returnAtLocal: "2026-03-01T18:00" }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ path: "departAtLocal", code: "custom" });
  });

  test("둘 다 달력에 없으면 필드마다 1개씩 정확히 2개 — 규칙 2 issue 는 추가되지 않는다", () => {
    const all = issues(input({ departAtLocal: "2026-02-30T08:00", returnAtLocal: "2026-02-31T18:00" }));
    expect(all.map((i) => i.path).sort()).toEqual(["departAtLocal", "returnAtLocal"]);
    for (const i of all) expect(i.code).toBe("custom");
  });

  test("regex 가 이미 실패한 값(2026-02-30 · 2026-02-30T08)에는 규칙 0 issue 를 더하지 않는다 — 그 필드 issue 1개(regex 것)뿐", () => {
    for (const bad of ["2026-02-30", "2026-02-30T08", "2026-02-30 08:00"]) {
      const dep = at(input({ departAtLocal: bad }), "departAtLocal");
      expect(dep, bad).toHaveLength(1);
      expect(dep[0].code, bad).not.toBe("custom");
      const ret = at(input({ returnAtLocal: bad }), "returnAtLocal");
      expect(ret, bad).toHaveLength(1);
      expect(ret[0].code, bad).not.toBe("custom");
    }
  });

  test("oneway 로 달력에 없는 출발만 보내면 departAtLocal issue 1개뿐 (규칙 1·3 과 간섭 없음)", () => {
    const all = issues(input({ tripType: "oneway", departAtLocal: "2026-02-30T08:00", returnAtLocal: undefined }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ path: "departAtLocal", code: "custom" });
  });
});

// =============================================================================
// create.ts 재검증과의 결합 — 메시지 토큰
// =============================================================================
describe("create.ts step 0 재검증과의 결합", () => {
  test("issue message 에 tests/reservation-create.test.ts:276·283·291·318 의 정규식 토큰(returnAtLocal·출발·round_trip_return_ck)이 있다", () => {
    // createReservation 은 저장 전에 ReservationInput.safeParse 를 다시 돌리고 실패하면 issue 문자열을 담아 throw 한다.
    // 그 throw 를 잠근 기존 테스트들의 정규식이 이제 이 message 로 매치된다 — message 를 바꾸면 그쪽이 깨진다.
    expect(at(input({ returnAtLocal: undefined }), "returnAtLocal")[0].message).toMatch(/returnAtLocal/);
    expect(at(input({ returnAtLocal: "2026-10-01T08:00" }), "returnAtLocal")[0].message).toMatch(/출발/);
    expect(at(input({ tripType: "oneway" }), "returnAtLocal")[0].message).toMatch(/round_trip_return_ck/);
  });

  test("정적 — lib/types.ts 는 ./kst 의 parseKst 로 비교한다(문자열 비교 아님)", () => {
    const src = readFileSync(path.join(ROOT, "lib", "types.ts"), "utf-8");
    expect(src).toMatch(/import\s*\{[^}]*\bparseKst\b[^}]*\}\s*from\s*["']\.\/kst["']/);
    expect(src).not.toMatch(/returnAtLocal\s*[<>]=?\s*data\.departAtLocal/);
    expect(src).not.toMatch(/localeCompare/);
  });
});
