/**
 * P4-2b — 통지 문안 변수 로더(lib/notify/vars.ts) 계약 테스트 (플랜 v4 · ADR-7).
 *
 * 브리프 §검증 1~10 을 그대로 단언한다:
 *   1. 타입 격리: CustomerVars 에 name·phone·email·message 키 0 (컴파일 타임 keyof 잠금) · OwnerVars 에 email·message 0
 *   2. select 화이트리스트: 클라이언트가 받은 select 문자열이 정확히 두 목록 · `*` 0 · 금지 컬럼 0
 *   3. 누출 0: 원문 개인정보를 가진 행을 돌려줘도 customerVars 결과에는 그 값이 하나도 없다
 *      (ownerVars 는 name·phone 을 **의도적으로** 담는다 — 사장님이 전화를 걸어야 한다)
 *   4. 부재 → null(throw 0) · DB 오류 → throw
 *   5. KST: depart_at(UTC) → KST 벽시계. TZ=UTC / Asia/Seoul 양쪽에서 같은 답
 *   6. 로그에 개인정보 0 — reservationId·오류 코드·표 이름뿐
 *   7. 서비스 롤 예외 등록은 tests/queries.test.ts SERVICE_ROLE_EXCEPTIONS 가 맡는다(여기서는 정적 경계만 본다)
 *   8. 어댑터 결합: vars 를 주면 solapiSender.configured 가 true, 없으면 false
 *   9. DB 실증: 로컬 스택에 실제 예약 1행 → 서비스 롤은 읽고 anon 은 0행. 즉시 정리
 *
 * **실제 발송 0 · 실제 네트워크 0**(§9 의 로컬 스택 REST 제외). 원격 DB 에는 어떤 쓰기도 하지 않는다 —
 * §9 는 dbWriteGate()(로컬 스택 URL + REQUIRE_DB_TESTS=1)가 열렸을 때만 정의된다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { locationLabelKo } from "@/lib/codes";
import { TEMPLATE_KEYS } from "@/lib/notify/outbox";
import { solapiSender, type SolapiDeps } from "@/lib/notify/solapi";
import { renderTemplate, type CustomerVars, type OwnerVars } from "@/lib/notify/templates";
import {
  CUSTOMER_VARS_COLUMNS,
  CUSTOMER_VARS_KEYS,
  CUSTOMER_VARS_SELECT,
  FORBIDDEN_VARS_COLUMNS,
  OWNER_VARS_COLUMNS,
  OWNER_VARS_KEYS,
  OWNER_VARS_SELECT,
  templateVars,
  type TemplateVarsLogEntry,
} from "@/lib/notify/vars";
import { consentFields } from "@/lib/reservations/consent";
import { dbSmokeEnv, dbWriteGate, isLocalStack } from "./helpers/load-env-local";

const ROOT = path.resolve(import.meta.dirname, "..");
const VARS_SRC = readFileSync(path.join(ROOT, "lib", "notify", "vars.ts"), "utf-8");

// =============================================================================
// 고정값 — mock 행은 **원문 개인정보를 전부 들고 있다**. 로더가 무엇을 버리는지 보려면 줄 것부터 있어야 한다.
// =============================================================================

const RID = "11111111-2222-4333-8444-555555555555";
const ORIGIN = "https://example.test";

/** 이 네 값 중 하나라도 고객 결과·로그에 나오면 실패다. */
const RAW_PII = {
  name: "홍길동",
  phone: "+821012345678",
  email: "leak@example.test",
  message: "새어 나가면 안 되는 요청 내용",
} as const;

/** UTC 23:30 → KST 다음 날 08:30 (날짜가 넘어가는 자리를 고른다). */
const DEPART_AT_UTC = "2026-09-30T23:30:00.000Z";
const DEPART_AT_KST = "2026-10-01 08:30";

const ROW = {
  public_code: "ABCD2345",
  vehicle_slug: "bus45",
  origin_code: "SEL",
  destination_code: "BSN",
  depart_at: DEPART_AT_UTC,
  bus_count: 2,
  passengers: 40,
  // 아래 4개는 고객 select 에 없지만, 클라이언트가 그래도 돌려줬다고 가정한다 —
  // 누출 방지가 "select 를 잘 썼다"가 아니라 **결과를 만드는 코드**에서 구조적으로 성립하는지 보기 위해서다.
  ...RAW_PII,
} as const;

const VEHICLE_NAME_KO = "45인승 우등";

// =============================================================================
// 가짜 Supabase 클라이언트 — 받은 select 문자열과 eq 조건을 기록한다. 네트워크 0.
// =============================================================================

interface RecordedCall {
  table: string;
  columns: string;
  eq: [string, string][];
}

interface FakeOptions {
  reservation?: Record<string, unknown> | null;
  reservationError?: { code: string } | null;
  vehicle?: Record<string, unknown> | null;
  vehicleError?: { code: string } | null;
}

function fakeClient(opts: FakeOptions = {}): { client: SupabaseClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const call: RecordedCall = { table, columns, eq: [] };
          calls.push(call);
          const builder = {
            eq(column: string, value: string) {
              call.eq.push([column, value]);
              return builder;
            },
            limit() {
              return builder;
            },
            async maybeSingle() {
              if (table === "vehicles") {
                return { data: opts.vehicle === undefined ? { name_ko: VEHICLE_NAME_KO } : opts.vehicle, error: opts.vehicleError ?? null };
              }
              return { data: opts.reservation === undefined ? ROW : opts.reservation, error: opts.reservationError ?? null };
            },
          };
          return builder;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function logSpy(): ((e: TemplateVarsLogEntry) => void) & { entries: TemplateVarsLogEntry[] } {
  const entries: TemplateVarsLogEntry[] = [];
  const fn = (e: TemplateVarsLogEntry) => {
    entries.push(e);
  };
  return Object.assign(fn, { entries });
}

// =============================================================================
// 1. 타입 격리 — 컴파일 타임 잠금 + 실행 시 키 집합
// =============================================================================

/** 이 네 줄은 **컴파일이 검사**한다: 타입에 금지 키가 생기면 `never` 가 되어 tsc 가 깨진다. */
const CUSTOMER_HAS_NO_PII: Extract<keyof CustomerVars, "name" | "phone" | "email" | "message"> extends never ? true : never = true;
const OWNER_HAS_NO_EMAIL_OR_MESSAGE: Extract<keyof OwnerVars, "email" | "message"> extends never ? true : never = true;
type CustomerKeyGap = Exclude<keyof CustomerVars, (typeof CUSTOMER_VARS_KEYS)[number]>;
const CUSTOMER_KEYS_COVER_TYPE: CustomerKeyGap extends never ? true : never = true;
type OwnerKeyGap = Exclude<keyof OwnerVars, (typeof OWNER_VARS_KEYS)[number]>;
const OWNER_KEYS_COVER_TYPE: OwnerKeyGap extends never ? true : never = true;

describe("1. 타입 격리 — 고객 변수는 개인정보를 담을 자리 자체가 없다", () => {
  test("컴파일 타임 잠금 4개가 참이다 (타입에 금지 키가 생기면 tsc 가 먼저 깨진다)", () => {
    expect([CUSTOMER_HAS_NO_PII, OWNER_HAS_NO_EMAIL_OR_MESSAGE, CUSTOMER_KEYS_COVER_TYPE, OWNER_KEYS_COVER_TYPE]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test("CUSTOMER_VARS_KEYS 는 접수번호·원점 둘뿐 — 차량·구간·운행일도 없다(고객 문자는 접수번호만 쓴다)", () => {
    expect([...CUSTOMER_VARS_KEYS].sort()).toEqual(["origin", "publicCode"]);
  });

  test("OWNER_VARS_KEYS 는 사장님 문안이 요구하는 11개 — email·message 는 없다", () => {
    expect([...OWNER_VARS_KEYS].sort()).toEqual(
      [
        "busCount",
        "departAtKst",
        "destinationLabel",
        "name",
        "origin",
        "originLabel",
        "passengers",
        "phone",
        "publicCode",
        "reservationId",
        "vehicleLabel",
      ].sort(),
    );
    expect(OWNER_VARS_KEYS).not.toContain("email");
    expect(OWNER_VARS_KEYS).not.toContain("message");
  });

  test("customerVars 결과의 키 집합이 CUSTOMER_VARS_KEYS 와 정확히 같다 (넓은 타입에서 일부만 쓰는 방식 아님)", async () => {
    const { client } = fakeClient();
    const v = await templateVars({ client, origin: ORIGIN }).customerVars(RID);
    expect(v).not.toBeNull();
    expect(Object.keys(v as object).sort()).toEqual([...CUSTOMER_VARS_KEYS].sort());
  });

  test("ownerVars 결과의 키 집합이 OWNER_VARS_KEYS 와 정확히 같다", async () => {
    const { client } = fakeClient();
    const v = await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
    expect(v).not.toBeNull();
    expect(Object.keys(v as object).sort()).toEqual([...OWNER_VARS_KEYS].sort());
  });
});

// =============================================================================
// 2. select 화이트리스트 — `*` 없음, 금지 컬럼 없음, 목록 그대로
// =============================================================================
/**
 * 기대 목록은 **여기 리터럴로 적는다.** 모듈의 상수와 비교하면 상수를 넓히는 순간 테스트도 같이 넓어져
 * 아무것도 잡지 못한다(실측: CUSTOMER_VARS_COLUMNS 에 name·email 을 끼워 넣어도 이 단언은 green 이었다).
 */
const EXPECTED_CUSTOMER_COLUMNS = ["public_code"];
const EXPECTED_OWNER_COLUMNS = [
  "public_code",
  "name",
  "phone",
  "vehicle_slug",
  "origin_code",
  "destination_code",
  "depart_at",
  "bus_count",
  "passengers",
];

describe("2. select 화이트리스트", () => {
  test("고객 조회는 reservations 에서 public_code 한 컬럼만 읽는다 (문안이 그것만 쓴다)", async () => {
    const { client, calls } = fakeClient();
    await templateVars({ client, origin: ORIGIN }).customerVars(RID);
    const reservations = calls.filter((c) => c.table === "reservations");
    expect(reservations).toHaveLength(1);
    expect(reservations[0].columns.split(",").map((s) => s.trim()).sort()).toEqual([...EXPECTED_CUSTOMER_COLUMNS].sort());
    expect(reservations[0].eq).toEqual([["id", RID]]);
  });

  test("사장님 조회는 문안이 쓰는 9컬럼만 읽는다", async () => {
    const { client, calls } = fakeClient();
    await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
    const reservations = calls.filter((c) => c.table === "reservations");
    expect(reservations).toHaveLength(1);
    expect(reservations[0].columns.split(",").map((s) => s.trim()).sort()).toEqual([...EXPECTED_OWNER_COLUMNS].sort());
    expect(reservations[0].eq).toEqual([["id", RID]]);
  });

  test("공개 상수와 리터럴 기대 목록이 일치한다 (상수를 넓히면 여기서 먼저 깨진다)", () => {
    expect([...CUSTOMER_VARS_COLUMNS]).toEqual(EXPECTED_CUSTOMER_COLUMNS);
    expect([...OWNER_VARS_COLUMNS]).toEqual(EXPECTED_OWNER_COLUMNS);
    expect(CUSTOMER_VARS_SELECT).toBe(EXPECTED_CUSTOMER_COLUMNS.join(","));
    expect(OWNER_VARS_SELECT).toBe(EXPECTED_OWNER_COLUMNS.join(","));
  });

  test("차량 라벨은 vehicles.name_ko 로 따로 읽는다 (slug 를 그대로 문안에 쓰지 않는다)", async () => {
    const { client, calls } = fakeClient();
    const v = await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
    const vehicles = calls.filter((c) => c.table === "vehicles");
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].columns).toBe("name_ko");
    expect(vehicles[0].eq).toEqual([["slug", ROW.vehicle_slug]]);
    expect(v?.vehicleLabel).toBe(VEHICLE_NAME_KO);
  });

  test("고객 조회는 vehicles 를 읽지 않는다 (고객 문안에 차량이 없다)", async () => {
    const { client, calls } = fakeClient();
    await templateVars({ client, origin: ORIGIN }).customerVars(RID);
    expect(calls.filter((c) => c.table === "vehicles")).toHaveLength(0);
  });

  test("두 select 문자열 어디에도 `*` 가 없다", () => {
    expect(CUSTOMER_VARS_SELECT).not.toContain("*");
    expect(OWNER_VARS_SELECT).not.toContain("*");
    expect(VARS_SRC).not.toMatch(/select\(\s*["'`]\*/);
  });

  test.each([...FORBIDDEN_VARS_COLUMNS])("금지 컬럼 %s 는 두 화이트리스트 어디에도 없다", (col) => {
    expect(CUSTOMER_VARS_COLUMNS as readonly string[]).not.toContain(col);
    expect(OWNER_VARS_COLUMNS as readonly string[]).not.toContain(col);
  });

  test("고객 목록은 사장님 목록의 부분집합이다 (같은 컬럼을 두 이름으로 부르지 않는다)", () => {
    for (const col of CUSTOMER_VARS_COLUMNS) {
      expect(OWNER_VARS_COLUMNS as readonly string[]).toContain(col);
    }
  });
});

// =============================================================================
// 3. 누출 0 — 고객 결과에 원문 개인정보 0 / 사장님 결과에는 **의도적으로** 이름·전화가 있다
// =============================================================================
describe("3. 누출", () => {
  test("customerVars: 행에 name·phone·email·message 가 실려 와도 결과 JSON 에 그 값이 하나도 없다", async () => {
    const { client } = fakeClient();
    const v = await templateVars({ client, origin: ORIGIN }).customerVars(RID);
    const json = JSON.stringify(v);
    for (const [key, value] of Object.entries(RAW_PII)) {
      expect(json.includes(value), `${key} 가 고객 결과에 새어 나왔다`).toBe(false);
    }
    expect(v).toEqual({ publicCode: ROW.public_code, origin: ORIGIN });
  });

  test("customerVars: 차량·구간·운행일도 담지 않는다 (고객 문안이 쓰지 않는 값은 메모리에도 올리지 않는다)", async () => {
    const { client } = fakeClient();
    const json = JSON.stringify(await templateVars({ client, origin: ORIGIN }).customerVars(RID));
    for (const value of [ROW.vehicle_slug, ROW.origin_code, ROW.destination_code, ROW.depart_at, VEHICLE_NAME_KO]) {
      expect(json.includes(value), `${value} 가 고객 결과에 담겼다`).toBe(false);
    }
  });

  test("ownerVars: name·phone 을 **의도적으로** 담는다 — 사장님은 고객에게 전화를 걸어야 한다(마스킹하지 않는다)", async () => {
    const { client } = fakeClient();
    const v = await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
    expect(v?.name).toBe(RAW_PII.name);
    expect(v?.phone).toBe(RAW_PII.phone);
  });

  test("ownerVars: 그래도 email·message 는 담지 않는다 (문안이 쓰지 않는다)", async () => {
    const { client } = fakeClient();
    const json = JSON.stringify(await templateVars({ client, origin: ORIGIN }).ownerVars(RID));
    expect(json.includes(RAW_PII.email)).toBe(false);
    expect(json.includes(RAW_PII.message)).toBe(false);
  });

  test("ownerVars 결과 전체", async () => {
    const { client } = fakeClient();
    expect(await templateVars({ client, origin: ORIGIN }).ownerVars(RID)).toEqual({
      publicCode: ROW.public_code,
      origin: ORIGIN,
      reservationId: RID,
      name: RAW_PII.name,
      phone: RAW_PII.phone,
      vehicleLabel: VEHICLE_NAME_KO,
      departAtKst: DEPART_AT_KST,
      originLabel: locationLabelKo("SEL"),
      destinationLabel: locationLabelKo("BSN"),
      busCount: ROW.bus_count,
      passengers: ROW.passengers,
    });
  });
});

// =============================================================================
// 4. 실패 정책 — 부재는 null(reservation_not_found), DB 오류는 throw(vars_load_failed)
//    주의: retryable 은 기록용이라 둘 다 attempts 5회를 태운 뒤 failed 가 된다(lib/notify/vars.ts 헤더 §retryable:false).
// =============================================================================
describe("4. 부재 · 오류", () => {
  test("행이 없으면 두 함수 모두 null 이고 throw 하지 않는다 (last_error 에 reservation_not_found 로 남는다)", async () => {
    const { client } = fakeClient({ reservation: null });
    const port = templateVars({ client, origin: ORIGIN });
    await expect(port.customerVars(RID)).resolves.toBeNull();
    await expect(port.ownerVars(RID)).resolves.toBeNull();
  });

  test("uuid 형태가 아닌 id 는 조회 전에 null — 잘못된 id 도 '없는 예약'과 같다", async () => {
    const { client, calls } = fakeClient();
    const port = templateVars({ client, origin: ORIGIN });
    await expect(port.customerVars("not-a-uuid")).resolves.toBeNull();
    await expect(port.ownerVars("")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("uuid 구문 오류(22P02)를 DB 가 돌려줘도 null 이다 (없는 행을 DB 장애로 기록하면 원인을 잘못 읽게 된다)", async () => {
    const { client } = fakeClient({ reservationError: { code: "22P02" } });
    const port = templateVars({ client, origin: ORIGIN });
    await expect(port.customerVars(RID)).resolves.toBeNull();
    await expect(port.ownerVars(RID)).resolves.toBeNull();
  });

  test("DB 오류는 throw 한다 — 어댑터가 vars_load_failed(retryable) 로 받는다", async () => {
    const { client } = fakeClient({ reservationError: { code: "57014" } });
    const port = templateVars({ client, origin: ORIGIN });
    await expect(port.customerVars(RID)).rejects.toThrow(/57014/);
    await expect(port.ownerVars(RID)).rejects.toThrow(/57014/);
  });

  test("vehicles 조회 오류도 throw 한다", async () => {
    const { client } = fakeClient({ vehicleError: { code: "57014" } });
    await expect(templateVars({ client, origin: ORIGIN }).ownerVars(RID)).rejects.toThrow(/57014/);
  });

  test("vehicles 행이 없으면 slug 로 폴백한다 (라벨 하나 때문에 접수 알림을 막지 않는다)", async () => {
    const { client } = fakeClient({ vehicle: null });
    const v = await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
    expect(v?.vehicleLabel).toBe(ROW.vehicle_slug);
  });

  test("행의 컬럼이 비어 있으면 throw 한다 (반쯤 빈 문안을 보내지 않는다) — 오류 문구에 값은 담기지 않는다", async () => {
    const { client } = fakeClient({ reservation: { ...ROW, name: null } });
    await expect(templateVars({ client, origin: ORIGIN }).ownerVars(RID)).rejects.toThrow(/name/);
  });

  /**
   * **이 블록은 이빨을 갖도록 다시 지었다** (2026-09-15 독립 리뷰 경미-2).
   * 이전 판은 `depart_at: "not-a-date"` 하나만 태웠는데, 그 경로는 값을 받지 않는 고정 문구(kstWallClock)만 내므로
   * 「오류 문구에 개인정보 0」이 동어반복이었다 — 리뷰어가 `badColumn` 을 값까지 싣도록 비틀어도 54/54 green 이었다.
   *
   * 지금은 **화이트리스트의 모든 컬럼을 하나씩** 검사 실패 값으로 바꾼다. 바꿔 넣는 값은 그 컬럼의 타입 검사를 통과하지
   * 못하면서(→ 반드시 throw) 문자열화하면 개인정보처럼 보이는 표식을 드러내는 것이다(`["…"]` → `String()`·`JSON.stringify()`
   * 어느 쪽으로 찍어도 표식이 보인다). 오류 문구가 값을 한 조각이라도 싣기 시작하면 여기서 red 가 된다.
   */
  const throwingValueFor = (column: string): unknown =>
    // 숫자 컬럼에는 문자열을, 문자열 컬럼에는 배열을 넣는다 — 둘 다 타입 검사를 통과하지 못한다.
    column === "bus_count" || column === "passengers" ? `LEAK-${column}-${RAW_PII.phone}` : [`LEAK-${column}-${RAW_PII.name}`];

  test.each([...OWNER_VARS_COLUMNS])("ownerVars: %s 가 깨졌을 때 오류 문구에 그 값도, 행의 다른 개인정보도 없다", async (column) => {
    const sentinel = `LEAK-${column}`;
    const { client } = fakeClient({ reservation: { ...ROW, [column]: throwingValueFor(column) } });
    let message = "";
    try {
      await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
      throw new Error(`${column} 이 깨졌는데 throw 하지 않았다`);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    // 실패 경로인 것은 맞는가 — 컬럼 이름은 남아야 진단이 된다(그것만 남는다).
    expect(message).toContain(column);
    // 바꿔 넣은 값의 어떤 조각도 문구에 없다.
    expect(message.includes(sentinel), `${column}: 검사 실패 값이 오류 문구에 실렸다`).toBe(false);
    // 행에 있던 원문 개인정보도 없다.
    for (const [key, value] of Object.entries(RAW_PII)) {
      expect(message.includes(value), `${column}: ${key} 가 오류 문구에 실렸다`).toBe(false);
    }
    expect(message.includes(ROW.public_code)).toBe(false);
  });

  test("customerVars: public_code 가 깨졌을 때도 오류 문구에 값이 없다", async () => {
    const { client } = fakeClient({ reservation: { ...ROW, public_code: [`LEAK-public_code-${RAW_PII.name}`] } });
    let message = "";
    try {
      await templateVars({ client, origin: ORIGIN }).customerVars(RID);
      throw new Error("public_code 가 깨졌는데 throw 하지 않았다");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("public_code");
    expect(message.includes("LEAK-public_code")).toBe(false);
    for (const value of Object.values(RAW_PII)) expect(message.includes(value)).toBe(false);
  });

  test("KST 변환이 실패하는 행도 고정 문구만 낸다 (값을 받지 않는 경로 — 위 전수 검사의 보완)", async () => {
    const { client } = fakeClient({ reservation: { ...ROW, depart_at: "not-a-date" } });
    let message = "";
    try {
      await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
      throw new Error("depart_at 이 깨졌는데 throw 하지 않았다");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain("not-a-date");
    for (const value of Object.values(RAW_PII)) expect(message.includes(value)).toBe(false);
  });
});

// =============================================================================
// 5. KST — 서버 TZ 와 무관하게 같은 벽시계
// =============================================================================
describe.each([["UTC"], ["Asia/Seoul"]])("5. KST 벽시계 (process.env.TZ=%s)", (tz) => {
  let originalTz: string | undefined;
  beforeEach(() => {
    originalTz = process.env.TZ;
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test("UTC 23:30 → KST 다음 날 08:30 (날짜가 넘어간다)", async () => {
    const { client } = fakeClient();
    const v = await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
    expect(v?.departAtKst).toBe(DEPART_AT_KST);
  });

  test("UTC 자정 → KST 같은 날 09:00", async () => {
    const { client } = fakeClient({ reservation: { ...ROW, depart_at: "2026-10-01T00:00:00.000Z" } });
    const v = await templateVars({ client, origin: ORIGIN }).ownerVars(RID);
    expect(v?.departAtKst).toBe("2026-10-01 09:00");
  });
});

// =============================================================================
// 6. 로그 — reservationId·오류 코드·표 이름뿐
// =============================================================================
describe("6. 로그", () => {
  test("DB 오류 한 건에 로그 한 줄, 개인정보 0", async () => {
    const log = logSpy();
    const { client } = fakeClient({ reservationError: { code: "57014" } });
    await expect(templateVars({ client, origin: ORIGIN, log }).ownerVars(RID)).rejects.toThrow();
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toEqual({
      level: "error",
      event: "notify.vars_query_failed",
      reservationId: RID,
      audience: "owner",
      table: "reservations",
      code: "57014",
    });
    const line = JSON.stringify(log.entries);
    for (const [key, value] of Object.entries(RAW_PII)) {
      expect(line.includes(value), `${key} 가 로그에 새어 나왔다`).toBe(false);
    }
    expect(line.includes(ROW.public_code)).toBe(false);
  });

  test("정상 경로에서는 로그를 남기지 않는다 (성공을 경고로 찍으면 진짜 경고가 묻힌다)", async () => {
    const log = logSpy();
    const { client } = fakeClient();
    await templateVars({ client, origin: ORIGIN, log }).ownerVars(RID);
    await templateVars({ client, origin: ORIGIN, log }).customerVars(RID);
    expect(log.entries).toHaveLength(0);
  });

  test("부재에도 로그를 남기지 않는다 (어댑터가 reservation_not_found 로 한 줄 남긴다 — 두 번 찍지 않는다)", async () => {
    const log = logSpy();
    const { client } = fakeClient({ reservation: null });
    await templateVars({ client, origin: ORIGIN, log }).ownerVars(RID);
    expect(log.entries).toHaveLength(0);
  });

  test("22P02 는 오류가 아니라 부재다 — 로그 0", async () => {
    const log = logSpy();
    const { client } = fakeClient({ reservationError: { code: "22P02" } });
    await templateVars({ client, origin: ORIGIN, log }).ownerVars(RID);
    expect(log.entries).toHaveLength(0);
  });
});

// =============================================================================
// 7. 정적 경계 — lib/notify/** 규약(env 0 · server-only 0 · 네트워크 0)
// =============================================================================
describe("7. 정적 경계", () => {
  test("vars.ts — process.env 0 · 'use server' 0 · server-only import 0 · 전역 fetch 0", () => {
    expect(VARS_SRC).not.toMatch(/process\.env/);
    expect(VARS_SRC).not.toMatch(/["']use server["']/);
    expect(VARS_SRC).not.toMatch(/import\s+["']server-only["']/);
    expect(VARS_SRC).not.toMatch(/(^|[^.\w])fetch\s*\(/m);
  });

  test("vars.ts — createServiceClient 를 **호출**하지 않는다 (클라이언트는 route.ts 가 주입한다)", () => {
    expect(VARS_SRC).not.toMatch(/createServiceClient\s*\(/);
  });

  test("tests/queries.test.ts 에 lib/notify/vars.ts 가 사유와 함께 서비스 롤 예외로 등록돼 있다", () => {
    const queriesTest = readFileSync(path.join(ROOT, "tests", "queries.test.ts"), "utf-8");
    expect(queriesTest).toMatch(/file:\s*"lib\/notify\/vars\.ts",\s*\n\s*why:\s*"[^"]{20,}"/);
  });

  /**
   * **이 단언도 이빨을 갖도록 다시 지었다** (2026-09-15 독립 리뷰 경미-5).
   * 이전 판은 `expect(route).toMatch(/vars/)` 였는데 그 패턴은 `templateVars`·`TemplateVarsPort` 에 그대로 매치한다 —
   * 리뷰어가 `solapiSender({ … vars, })` 에서 `vars,` 만 지워도(= 배선 해제) green 이었다.
   * 지금은 **`solapiSender(...)` 호출 인자 안에서만** `vars` 프로퍼티를 찾는다(주석은 걷어내고 본다).
   *
   * 그래도 진짜 방어선은 여기가 아니라 통합 테스트다 — `tests/notify-solapi.test.ts` §8
   * 「문안 변수 포트가 배선됐으므로 키 3종이 있으면 claim 까지 간다」가 route.ts 의 GET 을 실제로 태워
   * `skipped:undefined` 와 `claim_pending_notifications` RPC 를 확인한다. 정적 검사는 그것의 보조다.
   */
  test("route.ts — templateVars 를 만들어 solapiSender 의 vars 로 넘긴다 (배선; 진짜 방어는 notify-solapi.test.ts §8)", () => {
    const route = readFileSync(path.join(ROOT, "app", "api", "cron", "notify", "route.ts"), "utf-8");
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    // ① 로더를 만든다 — 클라이언트 주입 + 원점은 siteOrigin()
    expect(stripComments(route)).toMatch(/templateVars\(\{[^}]*client[^}]*origin:\s*siteOrigin\(\)[^}]*\}\)/);

    // ② 그 포트가 solapiSender 호출 인자로 들어간다 — 호출 범위를 잘라 그 안에서만 찾는다
    const callStart = route.indexOf("solapiSender({");
    expect(callStart, "route.ts 에 solapiSender({ 호출이 없다").toBeGreaterThan(-1);
    const callArgs = stripComments(route.slice(callStart, route.indexOf("});", callStart)));
    expect(callArgs, "solapiSender 인자에 vars 프로퍼티가 없다 — 배선이 끊겼다").toMatch(/(^|[\s{,])vars\s*[,:]/);
  });
});

// =============================================================================
// 8. 어댑터 결합 — 포트가 있어야 configured 가 된다
// =============================================================================
describe("8. 어댑터 결합", () => {
  const senderDeps = (over: Partial<SolapiDeps> = {}): SolapiDeps => ({
    apiKey: "NCSTESTAPIKEY0001",
    apiSecret: "SECRETVALUEMUSTNEVERAPPEAR0001",
    from: "15666188",
    fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    now: () => new Date("2026-09-15T00:00:00.000Z"),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i),
    log: () => {},
    ...over,
  });

  test("vars 를 주면 configured=true (키가 전부 있을 때)", () => {
    const { client } = fakeClient();
    const s = solapiSender(senderDeps({ vars: templateVars({ client, origin: ORIGIN }) }));
    expect(s.configured).toBe(true);
    expect(s.missing).toEqual([]);
  });

  test("vars 가 없으면 여전히 configured=false 이고 missing 에 vars 가 있다", () => {
    const s = solapiSender(senderDeps());
    expect(s.configured).toBe(false);
    expect(s.missing).toContain("vars");
  });

  test("키가 비면 vars 가 있어도 configured=false (반쯤 채운 배포로 발송하지 않는다)", () => {
    const { client } = fakeClient();
    const s = solapiSender(senderDeps({ apiKey: "", vars: templateVars({ client, origin: ORIGIN }) }));
    expect(s.configured).toBe(false);
    expect(s.missing).toContain("apiKey");
  });

  test("템플릿 4종이 전부 로더의 결과로 렌더된다 (렌더가 요구하는 변수 목록 = 로더의 계약)", async () => {
    const { client } = fakeClient();
    const port = templateVars({ client, origin: ORIGIN });
    const owner = await port.ownerVars(RID);
    const customer = await port.customerVars(RID);
    expect(owner).not.toBeNull();
    expect(customer).not.toBeNull();
    for (const key of TEMPLATE_KEYS) {
      const rendered = key.includes(".owner.") ? renderTemplate(key, owner as OwnerVars) : renderTemplate(key, customer as CustomerVars);
      expect(rendered.text.length).toBeGreaterThan(0);
      expect(rendered.text).toContain(ROW.public_code);
    }
  });

  test("고객 문안 2종에는 이름·전화가 한 글자도 없다 (로더가 애초에 주지 않는다)", async () => {
    const { client } = fakeClient();
    const customer = (await templateVars({ client, origin: ORIGIN }).customerVars(RID)) as CustomerVars;
    for (const key of ["created.customer.sms", "confirmed.customer.sms"] as const) {
      const text = renderTemplate(key, customer).text;
      for (const value of Object.values(RAW_PII)) expect(text.includes(value)).toBe(false);
    }
  });
});

// =============================================================================
// 9. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (원격에는 어떤 쓰기도 하지 않는다)
//    notifications_log 는 건드리지 않으므로 db-lock 이 필요 없다 — reservations 에 자기 prefix 행만 넣고 즉시 지운다.
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[notify-vars.test] DB 실증 블록 skip — ${gate.reason}`);
}

test("원격 URL 이면 DB 실증 블록은 REQUIRE_DB_TESTS=1 이어도 skip 이다", () => {
  if (!isLocalStack()) {
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, REQUIRE_DB_TESTS: "1" }).allowed).toBe(false);
    expect(gate.allowed).toBe(false);
  } else {
    expect(gate.allowed).toBe(process.env.REQUIRE_DB_TESTS === "1");
  }
});

describe.skipIf(!gate.allowed || !env.hasServiceRole)("9. DB 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", () => {
  const TEST_PREFIX = "p42btest-";
  const serviceHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  let reservationId = "";

  async function rest(method: string, pathAndQuery: string, json?: unknown, prefer?: string, headers = serviceHeaders) {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    return { status: res.status, body };
  }

  beforeAll(async () => {
    const now = new Date();
    const row = {
      public_code: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
      name: RAW_PII.name,
      phone: RAW_PII.phone,
      email: RAW_PII.email,
      message: RAW_PII.message,
      vehicle_slug: ROW.vehicle_slug,
      purpose_code: "family",
      origin_code: ROW.origin_code,
      destination_code: ROW.destination_code,
      waypoint_codes: [],
      trip_type: "oneway",
      depart_at: DEPART_AT_UTC,
      return_at: null,
      nights: 0,
      bus_count: ROW.bus_count,
      passengers: ROW.passengers,
      locale: "ko",
      ...consentFields({ privacyConsent: true, marketingConsent: false }, now),
    };
    const r = await rest("POST", "/reservations", row, "return=representation");
    if (r.status !== 201 || !Array.isArray(r.body)) {
      throw new Error(`insert 실패 HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    }
    reservationId = (r.body as { id: string }[])[0].id;
  });

  afterAll(async () => {
    await rest("DELETE", `/reservations?public_code=like.${TEST_PREFIX}*`);
    const left = await rest("GET", `/reservations?select=id&public_code=like.${TEST_PREFIX}*`);
    expect(left.body).toEqual([]);
  });

  function serviceClient(): SupabaseClient {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, env.serviceRoleKey, { auth: { persistSession: false } });
  }

  test("ownerVars: 실제 행에서 접수번호·성명·연락처·차량 라벨·구간·운행일(KST)을 돌려준다", async () => {
    const v = await templateVars({ client: serviceClient(), origin: ORIGIN }).ownerVars(reservationId);
    expect(v).not.toBeNull();
    expect(v?.reservationId).toBe(reservationId);
    expect(v?.publicCode.startsWith(TEST_PREFIX)).toBe(true);
    expect(v?.name).toBe(RAW_PII.name);
    expect(v?.phone).toBe(RAW_PII.phone);
    expect(v?.departAtKst).toBe(DEPART_AT_KST);
    expect(v?.originLabel).toBe(locationLabelKo("SEL"));
    expect(v?.destinationLabel).toBe(locationLabelKo("BSN"));
    expect(v?.busCount).toBe(ROW.bus_count);
    expect(v?.passengers).toBe(ROW.passengers);
    // 차량 라벨은 vehicles.name_ko — slug 가 아니다(0001 시드가 채운 한국어 이름).
    expect(v?.vehicleLabel).not.toBe(ROW.vehicle_slug);
    expect((v?.vehicleLabel ?? "").length).toBeGreaterThan(0);
    // email·message 는 행에 실제로 있는데도 결과에 없다.
    const json = JSON.stringify(v);
    expect(json.includes(RAW_PII.email)).toBe(false);
    expect(json.includes(RAW_PII.message)).toBe(false);
  });

  test("customerVars: 실제 행에서 접수번호만 — 이름·전화·메일·메시지 0", async () => {
    const v = await templateVars({ client: serviceClient(), origin: ORIGIN }).customerVars(reservationId);
    expect(v).not.toBeNull();
    expect(Object.keys(v as object).sort()).toEqual([...CUSTOMER_VARS_KEYS].sort());
    const json = JSON.stringify(v);
    for (const [key, value] of Object.entries(RAW_PII)) {
      expect(json.includes(value), `${key} 가 고객 결과에 새어 나왔다`).toBe(false);
    }
  });

  test("없는 예약 id 는 null (파기된 뒤 큐에 남은 행)", async () => {
    const v = await templateVars({ client: serviceClient(), origin: ORIGIN }).ownerVars("00000000-0000-4000-8000-000000000000");
    expect(v).toBeNull();
  });

  test("anon 키로는 같은 조회가 0행이다 — reservations 는 RLS 정책이 없어 서비스 롤만 읽는다", async () => {
    const anonKey = env.anonKey;
    expect(anonKey, "anon 키가 없으면 이 단언을 할 수 없다").toBeTruthy();
    const anonHeaders = { apikey: anonKey as string, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
    const r = await rest("GET", `/reservations?select=${OWNER_VARS_SELECT}&id=eq.${reservationId}`, undefined, undefined, anonHeaders);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);

    const anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, anonKey as string, { auth: { persistSession: false } });
    expect(await templateVars({ client: anonClient, origin: ORIGIN }).ownerVars(reservationId)).toBeNull();
  });
});
