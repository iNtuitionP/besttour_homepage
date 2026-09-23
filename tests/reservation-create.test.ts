/**
 * P3-2 — 접수 순수 함수 `createReservation` + `publicCode` + 포트 + supabase 어댑터 계약 테스트 (플랜 v4 · ADR-4 · ADR-7).
 *
 * 브리프 §검증 1~9 를 그대로 단언한다:
 *   1. generatePublicCode — 길이 8 · 알파벳 31자 밖 문자 0 · 0/O/1/I/L 0 · 1만 번 중복 0 · 같은 randomBytes → 같은 코드
 *   2. KST — departAtLocal '2026-09-13T08:00' → depart_at '2026-09-12T23:00:00.000Z'. **TZ=UTC / Asia/Seoul / America/New_York 3회 동일**.
 *      대조군: 같은 벽시계를 로컬 Date 생성자로 만들면 TZ 마다 다르다(= TZ 전환이 실제로 먹힌다는 증명). nights = nightsBetween, 편도 0
 *   3. phone — '010-1234-5678' → '+821012345678', phoneIntl 그대로. 원문 '010-…' 은 페이로드 어디에도 없다
 *   4. 동의 — privacy_consent_at = now, retention_until = retentionUntil(now), marketingConsent:false → null
 *   5. unique — insert 가 23505 를 2회 throw → 3번째 성공(코드 매번 다름) · 3회 → 4번째 성공 · 4회 연속 → throw(insert 정확히 4회)
 *   6. 통지 — 정상 enqueue 1회 · 행 수 = planNotifications · owner 없으면 1건 + warning · enqueue throw → notifyQueued:false + log 1회 + reservationId 반환
 *   7. 순서 — insert throw → enqueue 0회. insert 가 enqueue 보다 먼저
 *   8. 재검증 — zod 실패 input → throw(호출자 버그 메시지) · isLocationCode 재확인이 살아 있다(mock 으로 false → throw)
 *   9. 정적 — create.ts·publicCode.ts 에 'use server'·next/* import·process.env·new Date( 0. db.ts 에 server-only. 포트는 next 원시값을 감싼다
 *
 * 원격 DB 쓰기 없음 — DB·outbox·next 원시값은 전부 mock. 이 파일은 tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { LOCATION_CODES, isLocationCode } from "@/lib/codes";
import { nightsBetween, parseKst } from "@/lib/kst";
import { enqueue as outboxEnqueue, planNotifications } from "@/lib/notify/outbox";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { PRIVACY_POLICY_VERSION, retentionUntil } from "@/lib/reservations/consent";
import {
  PUBLIC_CODE_MAX_ATTEMPTS,
  ReservationDbError,
  UNIQUE_VIOLATION_CODE,
  createReservation,
  isUniqueViolation,
  type CreateReservationDeps,
  type CreateReservationLogEntry,
  type ReservationDb,
} from "@/lib/reservations/create";
import { supabaseReservationDb } from "@/lib/reservations/db";
import {
  PUBLIC_CODE_ALPHABET,
  PUBLIC_CODE_LENGTH,
  PUBLIC_CODE_PATTERN,
  generatePublicCode,
} from "@/lib/reservations/publicCode";
import type { NewOutboxRow, ReservationInput, ReservationInsert } from "@/lib/types";

// ── 모듈 mock (hoisted) ───────────────────────────────────────────────────
// server-only: db.ts·ports 는 서버 전용 마커를 import 한다. vitest(node) 에서는 빈 모듈로 대체 — purge.test.ts 와 같은 방식.
vi.mock("server-only", () => ({}));
// next 원시값: 포트가 얇은 위임인지만 본다. 실제 Next 요청 스코프는 없다.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
// outbox: planNotifications 는 실물, enqueue 만 spy — 어댑터가 (rows, client) 로 위임하는지 본다.
vi.mock("@/lib/notify/outbox", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/notify/outbox")>();
  return { ...mod, enqueue: vi.fn(mod.enqueue) };
});
// codes: isLocationCode 를 spy 로 감싼다(기본은 실물 통과). zod 는 LOCATION_CODES 배열을 쓰므로 이 spy 를 false 로 바꾸면
// "zod 는 통과했는데 재확인이 막는" 상황을 만들 수 있다 — 재확인이 죽은 코드가 아님을 증명한다.
vi.mock("@/lib/codes", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/codes")>();
  return { ...mod, isLocationCode: vi.fn(mod.isLocationCode) };
});

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (...rel: string[]) => readFileSync(path.join(ROOT, ...rel), "utf-8");

// 고정 "지금": UTC 2026-09-12 03:00 = KST 2026-09-12 12:00. Z 표기라 TZ 와 무관.
const NOW = new Date("2026-09-12T03:00:00.000Z");
const OWNER_PHONE = "+821000000000"; // 테스트 픽스처(형식만 맞춘 가짜 값) — 사장님 실번호 아님
const OWNER_EMAIL = "owner@example.com";

function validInput(overrides: Partial<ReservationInput> = {}): ReservationInput {
  return {
    name: "홍길동",
    phone: "010-1234-5678",
    vehicleSlug: "bus45",
    purposeCode: "family",
    originCode: "SEL",
    destinationCode: "BSN",
    waypointCodes: [],
    tripType: "round",
    departAtLocal: "2026-09-13T08:00",
    returnAtLocal: "2026-09-14T18:00",
    busCount: 1,
    locale: "ko",
    turnstileToken: "test-token",
    privacyConsent: true,
    marketingConsent: false,
    withdrawalConsent: true,
    ...overrides,
  };
}

/** PostgREST 가 unique 위반에 돌려주는 모양(code 23505). 어댑터는 이 code 를 보존한다(§어댑터). */
function uniqueViolation(): ReservationDbError {
  return new ReservationDbError('duplicate key value violates unique constraint "reservations_public_code_key"', {
    code: UNIQUE_VIOLATION_CODE,
  });
}

type Call = { kind: "insert"; row: ReservationInsert } | { kind: "enqueue"; rows: NewOutboxRow[] };

interface FakeDbOptions {
  /** insert 호출 순서대로 던질 오류. undefined 칸은 성공. */
  insertFailures?: (unknown | undefined)[];
  enqueueError?: unknown;
  /** enqueue 가 돌려줄 id 개수를 강제(기본 rows.length). */
  enqueueReturnCount?: number;
}

function fakeDb(opts: FakeDbOptions = {}) {
  const calls: Call[] = [];
  const failures = [...(opts.insertFailures ?? [])];
  let seq = 0;
  const db: ReservationDb = {
    insert: vi.fn(async (row: ReservationInsert) => {
      calls.push({ kind: "insert", row });
      const failure = failures.shift();
      if (failure !== undefined) throw failure;
      seq += 1;
      return { id: `res-${seq}` };
    }),
    enqueue: vi.fn(async (rows: NewOutboxRow[]) => {
      calls.push({ kind: "enqueue", rows });
      if (opts.enqueueError !== undefined) throw opts.enqueueError;
      const n = opts.enqueueReturnCount ?? rows.length;
      return Array.from({ length: n }, (_, i) => i + 1);
    }),
  };
  const inserts = () => calls.filter((c): c is Extract<Call, { kind: "insert" }> => c.kind === "insert").map((c) => c.row);
  const enqueues = () => calls.filter((c): c is Extract<Call, { kind: "enqueue" }> => c.kind === "enqueue").map((c) => c.rows);
  return { db, calls, inserts, enqueues };
}

function makeDeps(db: ReservationDb, overrides: Partial<CreateReservationDeps> = {}) {
  const logs: CreateReservationLogEntry[] = [];
  const deps: CreateReservationDeps = {
    db,
    now: () => NOW,
    randomBytes: (n) => nodeRandomBytes(n),
    ownerPhone: OWNER_PHONE,
    log: (entry) => {
      logs.push(entry);
    },
    ...overrides,
  };
  return { deps, logs };
}

// isLocationCode spy 는 테스트마다 실물 동작으로 되돌리고 호출 기록을 비운다(mock 모듈에서 LOCATION_CODES 는 실물이다).
const LOCATION_CODE_SET: ReadonlySet<string> = new Set(LOCATION_CODES);
const realIsLocationCode = (x: string) => LOCATION_CODE_SET.has(x);
beforeEach(() => {
  vi.mocked(isLocationCode).mockClear();
  vi.mocked(isLocationCode).mockImplementation(realIsLocationCode);
});

// =============================================================================
// 1. generatePublicCode — 순수
// =============================================================================
describe("generatePublicCode — 비순차·비추측·혼동문자 제외", () => {
  test("알파벳은 31자이고 0·O·1·I·L 이 없다", () => {
    expect(PUBLIC_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(PUBLIC_CODE_ALPHABET).size).toBe(31);
    for (const banned of ["0", "O", "1", "I", "L"]) expect(PUBLIC_CODE_ALPHABET).not.toContain(banned);
    expect(PUBLIC_CODE_LENGTH).toBe(8);
    expect(PUBLIC_CODE_ALPHABET).toBe("23456789ABCDEFGHJKMNPQRSTUVWXYZ");
  });

  test("길이 8, 알파벳 밖 문자 0, 패턴 일치 (1,000회)", () => {
    for (let i = 0; i < 1_000; i++) {
      const code = generatePublicCode(nodeRandomBytes);
      expect(code).toHaveLength(PUBLIC_CODE_LENGTH);
      expect(code).toMatch(PUBLIC_CODE_PATTERN);
      for (const ch of code) expect(PUBLIC_CODE_ALPHABET).toContain(ch);
    }
  });

  test("1만 번 생성 시 중복 0 (통계적), 31개 기호가 전부 등장한다", () => {
    const seen = new Set<string>();
    const symbols = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = generatePublicCode(nodeRandomBytes);
      seen.add(code);
      for (const ch of code) symbols.add(ch);
    }
    expect(seen.size).toBe(10_000);
    expect(symbols.size).toBe(31);
  });

  test("결정적 — 같은 randomBytes 면 같은 코드, 바이트→기호 매핑은 index % 31", () => {
    const fixed = () => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(generatePublicCode(fixed)).toBe("23456789");
    expect(generatePublicCode(fixed)).toBe(generatePublicCode(fixed));
    // 30 → 'Z'(마지막), 31 → '2'(되감김), 255 → 255 % 31 = 7 → '9'
    expect(generatePublicCode(() => Uint8Array.from([30, 31, 62, 255, 8, 9, 10, 11]))).toBe("Z22" + "9" + "ABCD");
  });

  test("randomBytes 가 8바이트 미만을 돌려주면 throw (조용히 짧은 코드를 만들지 않는다)", () => {
    expect(() => generatePublicCode(() => new Uint8Array(7))).toThrow(/randomBytes/);
  });

  test("randomBytes 는 정확히 PUBLIC_CODE_LENGTH 바이트를 요청한다", () => {
    const rb = vi.fn((n: number) => nodeRandomBytes(n));
    generatePublicCode(rb);
    expect(rb).toHaveBeenCalledTimes(1);
    expect(rb).toHaveBeenCalledWith(PUBLIC_CODE_LENGTH);
  });
});

// =============================================================================
// 2. KST — TZ 3회 동일
// =============================================================================
const TZ_CASES: { tz: string; localCtorInstant: string }[] = [
  // 같은 벽시계 (2026-09-13 08:00) 를 로컬 Date 생성자로 만들면 TZ 마다 인스턴트가 달라진다 — 대조군
  { tz: "UTC", localCtorInstant: "2026-09-13T08:00:00.000Z" },
  { tz: "Asia/Seoul", localCtorInstant: "2026-09-12T23:00:00.000Z" },
  { tz: "America/New_York", localCtorInstant: "2026-09-13T12:00:00.000Z" }, // 9월 = EDT(UTC-4)
];
const EXPECTED_DEPART = "2026-09-12T23:00:00.000Z"; // KST 2026-09-13 08:00

describe.each(TZ_CASES)("KST 해석 (process.env.TZ=$tz)", ({ tz, localCtorInstant }) => {
  let originalTz: string | undefined;
  beforeAll(() => {
    originalTz = process.env.TZ;
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test("대조군 — 로컬 Date 생성자는 이 TZ 에서 다른 인스턴트를 만든다 (TZ 전환이 실제로 적용됐다)", () => {
    expect(new Date(2026, 8, 13, 8, 0).toISOString()).toBe(localCtorInstant);
  });

  test("departAtLocal '2026-09-13T08:00' → depart_at '2026-09-12T23:00:00.000Z' (TZ 무관)", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await createReservation(validInput(), deps);
    const row = inserts()[0];
    expect(row.depart_at).toBe(EXPECTED_DEPART);
    expect(row.depart_at).toBe(parseKst("2026-09-13T08:00").toISOString());
    expect(row.return_at).toBe("2026-09-14T09:00:00.000Z");
    expect(row.nights).toBe(nightsBetween("2026-09-13T08:00", "2026-09-14T18:00"));
    expect(row.nights).toBe(1);
  });

  test("KST 자정 경계 — 23:00 출발 · 다음날 01:00 귀가는 UTC 로는 같은 날이지만 nights=1 (KST 달력)", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await createReservation(validInput({ departAtLocal: "2026-09-13T23:00", returnAtLocal: "2026-09-14T01:00" }), deps);
    const row = inserts()[0];
    expect(row.depart_at).toBe("2026-09-13T14:00:00.000Z");
    expect(row.return_at).toBe("2026-09-13T16:00:00.000Z");
    expect(row.nights).toBe(1);
  });

  test("편도 → return_at null, nights 0", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await createReservation(validInput({ tripType: "oneway", returnAtLocal: undefined }), deps);
    const row = inserts()[0];
    expect(row.trip_type).toBe("oneway");
    expect(row.return_at).toBeNull();
    expect(row.nights).toBe(0);
  });
});

describe("KST/일정 — 0001 제약을 insert 전에 막는다", () => {
  test("round 인데 returnAtLocal 없음 → throw, insert 0 (reservations_round_trip_return_ck)", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await expect(createReservation(validInput({ returnAtLocal: undefined }), deps)).rejects.toThrow(/returnAtLocal/);
    expect(inserts()).toHaveLength(0);
  });

  test("round 인데 귀가가 출발과 같거나 앞섬 → throw, insert 0 (return_at > depart_at)", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await expect(createReservation(validInput({ returnAtLocal: "2026-09-13T08:00" }), deps)).rejects.toThrow(/출발/);
    await expect(createReservation(validInput({ returnAtLocal: "2026-09-12T08:00" }), deps)).rejects.toThrow(/출발/);
    expect(inserts()).toHaveLength(0);
  });

  test("단순 편도(oneway) 에 returnAtLocal 이 오면 throw — 0006 후에도 oneway 는 return_at 금지", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await expect(createReservation(validInput({ tripType: "oneway" }), deps)).rejects.toThrow(/round_trip_return_ck/);
    expect(inserts()).toHaveLength(0);
  });

  test("편도·편도(oneway_oneway) 에 returnAtLocal 이 오면 저장한다 — 0006 이 허용, nights 는 두 운행 사이 KST 일수", async () => {
    // 목업 wizard-b 가 받는 귀가 일시. 0001 CHECK 는 왕복에만 허용해 P3-2 가 throw 했으나, 사장님 견적에 두 번째
    // 운행일이 필수라 0006 으로 CHECK 를 넓혔다(컨트롤러 결정 2026-09-13).
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await createReservation(
      validInput({ tripType: "oneway_oneway", departAtLocal: "2026-09-13T08:00", returnAtLocal: "2026-09-15T18:00" }),
      deps,
    );
    const row = inserts()[0];
    expect(row.trip_type).toBe("oneway_oneway");
    expect(row.return_at).toBe(new Date("2026-09-15T09:00:00.000Z").toISOString()); // 18:00 KST = 09:00Z
    expect(row.nights).toBe(2);
  });

  test("oneway_oneway 의 귀가 일시가 출발 이후가 아니면 throw (0001 return_at > depart_at)", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await expect(
      createReservation(
        validInput({ tripType: "oneway_oneway", departAtLocal: "2026-09-13T08:00", returnAtLocal: "2026-09-13T08:00" }),
        deps,
      ),
    ).rejects.toThrow(/출발/);
    expect(inserts()).toHaveLength(0);
  });

  test("oneway_oneway 에 returnAtLocal 이 없으면 정상 접수 (return_at null, nights 0) — 0006 은 허용이지 강제가 아니다", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await createReservation(validInput({ tripType: "oneway_oneway", returnAtLocal: undefined }), deps);
    expect(inserts()[0].trip_type).toBe("oneway_oneway");
    expect(inserts()[0].return_at).toBeNull();
    expect(inserts()[0].nights).toBe(0);
  });
});

// =============================================================================
// 3·4. 페이로드 — phone E.164 · 동의 4컬럼 · DB 컬럼명 그대로
// =============================================================================
describe("insert 페이로드 — ReservationInsert 컬럼명 그대로", () => {
  test("전체 행 — 국내 번호는 +82 E.164, 동의 4컬럼은 consentFields(now), 선택 필드는 null", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    const result = await createReservation(validInput(), deps);
    const row = inserts()[0];
    expect(row).toEqual({
      public_code: result.publicCode,
      name: "홍길동",
      phone: "+821012345678",
      email: null,
      vehicle_slug: "bus45",
      purpose_code: "family",
      origin_code: "SEL",
      destination_code: "BSN",
      waypoint_codes: [],
      trip_type: "round",
      depart_at: "2026-09-12T23:00:00.000Z",
      return_at: "2026-09-14T09:00:00.000Z",
      nights: 1,
      bus_count: 1,
      passengers: null,
      contact_method: null,
      payment_method: null,
      parking_included: null,
      vat_included: null,
      message: null,
      locale: "ko",
      privacy_consent_at: NOW.toISOString(),
      privacy_policy_version: PRIVACY_POLICY_VERSION,
      marketing_consent_at: null,
      retention_until: retentionUntil(NOW).toISOString(),
      withdrawal_consent_at: NOW.toISOString(),
    } satisfies ReservationInsert);
    expect(row.public_code).toMatch(PUBLIC_CODE_PATTERN);
  });

  test("원문 '010-1234-5678' 은 페이로드 어디에도 없다 (Solapi 는 E.164)", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await createReservation(validInput(), deps);
    const json = JSON.stringify(inserts()[0]);
    expect(json).not.toContain("010-1234-5678");
    expect(json).not.toContain("01012345678");
    expect(json).toContain("+821012345678");
  });

  test("phoneIntl '+14155550100' → 그대로, 고객 통지 행의 to 도 같은 값", async () => {
    const { db, inserts, enqueues } = fakeDb();
    const { deps } = makeDeps(db);
    await createReservation(validInput({ phone: undefined, phoneIntl: "+14155550100" }), deps);
    expect(inserts()[0].phone).toBe("+14155550100");
    const customerRow = enqueues()[0].find((r) => r.template === "created.customer.sms");
    expect(customerRow?.to).toBe("+14155550100");
  });

  test("선택 필드가 있으면 그대로, 경유지는 배열 복사, locale en", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    const waypoints: ReservationInput["waypointCodes"] = ["DJN", "DGU"];
    await createReservation(
      validInput({
        email: "a@example.com",
        waypointCodes: waypoints,
        busCount: 2,
        passengers: 80,
        contactMethod: "phone",
        paymentMethod: "transfer",
        parkingIncluded: true,
        vatIncluded: false,
        message: "메시지",
        locale: "en",
      }),
      deps,
    );
    const row = inserts()[0];
    expect(row.email).toBe("a@example.com");
    expect(row.waypoint_codes).toEqual(["DJN", "DGU"]);
    expect(row.waypoint_codes).not.toBe(waypoints);
    expect(row.bus_count).toBe(2);
    expect(row.passengers).toBe(80);
    expect(row.contact_method).toBe("phone");
    expect(row.payment_method).toBe("transfer");
    expect(row.parking_included).toBe(true);
    expect(row.vat_included).toBe(false);
    expect(row.message).toBe("메시지");
    expect(row.locale).toBe("en");
  });

  test("marketingConsent:true → marketing_consent_at = now", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await createReservation(validInput({ marketingConsent: true }), deps);
    expect(inserts()[0].marketing_consent_at).toBe(NOW.toISOString());
  });

  test("deps.now() 가 유효한 Date 가 아니면 throw, insert 0", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db, { now: () => new Date(Number.NaN) });
    await expect(createReservation(validInput(), deps)).rejects.toThrow(/now/);
    expect(inserts()).toHaveLength(0);
  });
});

// =============================================================================
// 5. public_code unique 충돌 — 최대 3회 재생성(총 4회 시도)
// =============================================================================
describe("public_code unique 충돌 재시도", () => {
  test("상수 — 1회 + 재생성 3회 = 총 4회", () => {
    expect(PUBLIC_CODE_MAX_ATTEMPTS).toBe(4);
  });

  test("isUniqueViolation — code '23505' 인 객체만 true", () => {
    expect(isUniqueViolation(uniqueViolation())).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23514" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  test("첫 2회 23505 → 3번째 성공. 코드는 매번 다르고 나머지 컬럼은 동일", async () => {
    const { db, inserts, enqueues } = fakeDb({ insertFailures: [uniqueViolation(), uniqueViolation()] });
    const { deps, logs } = makeDeps(db);
    const result = await createReservation(validInput(), deps);

    const rows = inserts();
    expect(rows).toHaveLength(3);
    const codes = rows.map((r) => r.public_code);
    expect(new Set(codes).size).toBe(3);
    expect(result.publicCode).toBe(codes[2]);
    expect(result.reservationId).toBe("res-1");
    // public_code 만 바뀐다
    const withoutCode = (r: ReservationInsert) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "public_code"));
    for (const r of rows) expect(withoutCode(r)).toEqual(withoutCode(rows[0]));
    expect(enqueues()).toHaveLength(1);
    expect(result.notifyQueued).toBe(true);
    expect(logs).toHaveLength(0);
  });

  test("3회 연속 23505 → 4번째 성공", async () => {
    const { db, inserts } = fakeDb({ insertFailures: [uniqueViolation(), uniqueViolation(), uniqueViolation()] });
    const { deps } = makeDeps(db);
    const result = await createReservation(validInput(), deps);
    expect(inserts()).toHaveLength(4);
    expect(result.publicCode).toBe(inserts()[3].public_code);
  });

  test("4회 연속 23505 → throw, insert 정확히 4회, enqueue 0", async () => {
    const { db, inserts, enqueues } = fakeDb({
      insertFailures: [uniqueViolation(), uniqueViolation(), uniqueViolation(), uniqueViolation()],
    });
    const { deps } = makeDeps(db);
    await expect(createReservation(validInput(), deps)).rejects.toThrow(/public_code.*4회/);
    expect(inserts()).toHaveLength(4);
    expect(enqueues()).toHaveLength(0);
  });

  test("23505 가 아닌 insert 오류는 재시도 없이 그대로 throw (원래 오류 객체 보존)", async () => {
    const boom = new ReservationDbError("connection reset", { code: "08006" });
    const { db, inserts, enqueues } = fakeDb({ insertFailures: [boom] });
    const { deps } = makeDeps(db);
    await expect(createReservation(validInput(), deps)).rejects.toBe(boom);
    expect(inserts()).toHaveLength(1);
    expect(enqueues()).toHaveLength(0);
  });

  test("어댑터가 id 를 돌려주지 않으면 throw (통지를 빈 id 로 만들지 않는다)", async () => {
    const db: ReservationDb = {
      insert: vi.fn(async () => ({ id: "" })),
      enqueue: vi.fn(async () => []),
    };
    const { deps } = makeDeps(db);
    await expect(createReservation(validInput(), deps)).rejects.toThrow(/id/);
    expect(db.enqueue).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 6·7. 통지 — 동기 enqueue, 실패해도 접수는 성공. 순서 insert → enqueue
// =============================================================================
describe("통지 enqueue — 동기, 실패해도 접수는 성공", () => {
  test("정상 — enqueue 1회, 행 = planNotifications(created) 와 동일(사장님 SMS + 고객 SMS), warnings 없음", async () => {
    const { db, calls, enqueues } = fakeDb();
    const { deps, logs } = makeDeps(db);
    const result = await createReservation(validInput(), deps);

    expect(enqueues()).toHaveLength(1);
    const expected = planNotifications({ id: result.reservationId }, "created", {
      ownerPhone: OWNER_PHONE,
      customerPhone: "+821012345678",
    });
    expect(enqueues()[0]).toEqual(expected.rows);
    expect(enqueues()[0]).toHaveLength(2);
    expect(enqueues()[0].map((r) => r.template)).toEqual(["created.owner.sms", "created.customer.sms"]);
    expect(calls.map((c) => c.kind)).toEqual(["insert", "enqueue"]);
    expect(result).toEqual({
      reservationId: "res-1",
      publicCode: result.publicCode,
      notifyQueued: true,
      warnings: [],
    });
    expect(logs).toHaveLength(0);
  });

  test("ownerPhone 없음 · ownerEmail 있음 → 사장님 email + 고객 SMS", async () => {
    const { db, enqueues } = fakeDb();
    const { deps } = makeDeps(db, { ownerPhone: undefined, ownerEmail: OWNER_EMAIL });
    const result = await createReservation(validInput(), deps);
    expect(enqueues()[0].map((r) => [r.channel, r.to, r.template])).toEqual([
      ["email", OWNER_EMAIL, "created.owner.email"],
      ["sms", "+821012345678", "created.customer.sms"],
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("ownerPhone·ownerEmail 둘 다 없음 → 고객 1건 + planNotifications warning 이 result 에 실린다, log 0", async () => {
    const { db, enqueues } = fakeDb();
    const { deps, logs } = makeDeps(db, { ownerPhone: undefined, ownerEmail: undefined });
    const result = await createReservation(validInput(), deps);
    expect(enqueues()[0]).toHaveLength(1);
    expect(enqueues()[0][0].template).toBe("created.customer.sms");
    const expected = planNotifications({ id: result.reservationId }, "created", { customerPhone: "+821012345678" });
    expect(result.warnings).toEqual(expected.warnings);
    expect(result.warnings).toHaveLength(1);
    expect(result.notifyQueued).toBe(true);
    expect(logs).toHaveLength(0);
  });

  test("enqueue throw → notifyQueued:false, log 1회(구조화·개인정보 없음), reservationId·publicCode 는 반환된다", async () => {
    const { db, inserts } = fakeDb({ enqueueError: new Error("outbox.enqueue.insert: [57P01] terminating connection") });
    const { deps, logs } = makeDeps(db);
    const result = await createReservation(validInput(), deps);

    expect(result.reservationId).toBe("res-1");
    expect(result.publicCode).toBe(inserts()[0].public_code);
    expect(result.notifyQueued).toBe(false);
    expect(result.warnings.some((w) => /enqueue failed/.test(w) && /57P01/.test(w))).toBe(true);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      level: "error",
      event: "reservation.notify_enqueue_failed",
      reservationId: "res-1",
      publicCode: result.publicCode,
      rows: 2,
      error: "outbox.enqueue.insert: [57P01] terminating connection",
    });
    const json = JSON.stringify(logs[0]);
    expect(json).not.toContain("홍길동");
    expect(json).not.toContain("1234");
    expect(json).not.toContain("+82");
  });

  test("enqueue 가 계획보다 적은 id 를 돌려주면 partial 로 기록 — notifyQueued:false, log 1회", async () => {
    const { db } = fakeDb({ enqueueReturnCount: 1 });
    const { deps, logs } = makeDeps(db);
    const result = await createReservation(validInput(), deps);
    expect(result.notifyQueued).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe("reservation.notify_enqueue_partial");
    expect(result.warnings.some((w) => /planned 2/.test(w) && /inserted 1/.test(w))).toBe(true);
  });

  test("insert 가 throw 하면 enqueue 는 0회 (예약 없이 통지 없음)", async () => {
    const { db, calls } = fakeDb({ insertFailures: [new Error("db down")] });
    const { deps, logs } = makeDeps(db);
    await expect(createReservation(validInput(), deps)).rejects.toThrow("db down");
    expect(calls.map((c) => c.kind)).toEqual(["insert"]);
    expect(logs).toHaveLength(0);
  });
});

// =============================================================================
// 8. 재검증 — zod 다시, isLocationCode 다시
// =============================================================================
describe("재검증 (방어 심층)", () => {
  test("privacyConsent 가 true 가 아니면 throw(호출자 버그 메시지), insert 0", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    const bad = { ...validInput(), privacyConsent: false } as unknown as ReservationInput;
    await expect(createReservation(bad, deps)).rejects.toThrow(/호출자 버그/);
    await expect(createReservation(bad, deps)).rejects.toThrow(/privacyConsent/);
    expect(inserts()).toHaveLength(0);
  });

  test("phone·phoneIntl 둘 다 없음 / 둘 다 있음 → throw, insert 0", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    await expect(createReservation(validInput({ phone: undefined }), deps)).rejects.toThrow(/호출자 버그/);
    await expect(createReservation(validInput({ phoneIntl: "+14155550100" }), deps)).rejects.toThrow(/호출자 버그/);
    expect(inserts()).toHaveLength(0);
  });

  test("LOCATION_CODES 밖 코드 → zod 에서 throw, insert 0", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    const bad = validInput({ originCode: "XXX" as ReservationInput["originCode"] });
    await expect(createReservation(bad, deps)).rejects.toThrow(/호출자 버그/);
    expect(inserts()).toHaveLength(0);
  });

  test("isLocationCode 재확인은 살아 있다 — zod 통과 후 재확인만 false 로 바꾸면 throw, insert 0", async () => {
    const { db, inserts } = fakeDb();
    const { deps } = makeDeps(db);
    vi.mocked(isLocationCode).mockReturnValue(false);
    await expect(createReservation(validInput({ waypointCodes: ["DJN"] }), deps)).rejects.toThrow(/LOCATION_CODES/);
    // origin·destination·waypoint 3개 전부 재확인했다
    expect(vi.mocked(isLocationCode).mock.calls.map((c) => c[0])).toEqual(["SEL", "BSN", "DJN"]);
    expect(inserts()).toHaveLength(0);
  });

  test("재확인은 한 코드만 틀려도 그 코드를 이름으로 지목한다", async () => {
    const { db } = fakeDb();
    const { deps } = makeDeps(db);
    vi.mocked(isLocationCode).mockImplementation((x: string) => x !== "DGU");
    await expect(createReservation(validInput({ destinationCode: "DGU" }), deps)).rejects.toThrow(/DGU/);
  });
});

// =============================================================================
// 9. 정적 — Next 원시값 금지 · server-only 위치 · 포트 위임
// =============================================================================
describe("정적 검사 — 계약 §5 (lib/<domain> 은 Next 원시값을 모른다)", () => {
  const PURE_FILES = ["lib/reservations/create.ts", "lib/reservations/publicCode.ts"] as const;

  test.each(PURE_FILES)("%s — 'use server' 0 · next/* import 0 · process.env 0 · new Date( 0 · server-only 0", (file) => {
    const src = read(...file.split("/"));
    expect(src).not.toMatch(/^\s*["']use server["'];?\s*$/m);
    expect(src).not.toMatch(/from\s+["']next\//);
    expect(src).not.toMatch(/import\s*\(\s*["']next\//);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/new Date\(/);
    expect(src).not.toMatch(/import\s+["']server-only["']/);
    expect(src).not.toMatch(/@supabase\/supabase-js/);
  });

  test("lib/reservations/db.ts — server-only import 존재, outbox.enqueue 위임, 'use server' 0", () => {
    const src = read("lib", "reservations", "db.ts");
    expect(src).toMatch(/import\s+["']server-only["']/);
    expect(src).toMatch(/from\s+["']\.\.\/notify\/outbox["']/);
    expect(src).not.toMatch(/^\s*["']use server["'];?\s*$/m);
    expect(src).not.toMatch(/process\.env/);
  });

  test("lib/ports/after.ts · revalidate.ts — next 원시값을 import 하는 유일한 자리, server-only", () => {
    const after = read("lib", "ports", "after.ts");
    expect(after).toMatch(/from\s+["']next\/server["']/);
    expect(after).toMatch(/import\s+["']server-only["']/);
    const reval = read("lib", "ports", "revalidate.ts");
    expect(reval).toMatch(/from\s+["']next\/cache["']/);
    expect(reval).toMatch(/import\s+["']server-only["']/);
  });

  test("create.ts 는 포트를 import 하지 않는다 (deps 로만 받는다)", () => {
    const src = read("lib", "reservations", "create.ts");
    // import 문만 본다 — 헤더 주석은 포트의 존재를 설명해도 된다.
    expect(src).not.toMatch(/from\s+["'][^"']*\/ports\//);
    expect(src).not.toMatch(/import\s*\(\s*["'][^"']*\/ports\//);
  });
});

describe("포트 — 얇은 위임", () => {
  test("runAfter(fn) → next/server after(fn) 1회", async () => {
    const { after } = await import("next/server");
    const task = () => undefined;
    runAfter(task);
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith(task);
  });

  test("revalidate(tag) → next/cache revalidateTag(tag) 1회", async () => {
    const { revalidateTag } = await import("next/cache");
    revalidate("recent-reservations");
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("recent-reservations");
  });
});

// =============================================================================
// 어댑터 — supabaseReservationDb (가짜 클라이언트, 원격 접속 없음)
// =============================================================================
describe("supabaseReservationDb — 어댑터", () => {
  type InsertResult = { data: unknown; error: { code: string; message: string; details?: string; hint?: string } | null };

  function fakeClient(result: InsertResult) {
    const insert = vi.fn();
    const select = vi.fn();
    const single = vi.fn(async () => result);
    const from = vi.fn((table: string) => {
      expect(table).toBe("reservations");
      return { insert: insert.mockReturnValue({ select: select.mockReturnValue({ single }) }) };
    });
    const client = { from } as unknown as SupabaseClient;
    return { client, from, insert, select, single };
  }

  const sampleRow: ReservationInsert = {
    public_code: "ABCD2345",
    name: "홍길동",
    phone: "+821012345678",
    email: null,
    vehicle_slug: "bus45",
    purpose_code: "family",
    origin_code: "SEL",
    destination_code: "BSN",
    waypoint_codes: [],
    trip_type: "oneway",
    depart_at: "2026-09-12T23:00:00.000Z",
    return_at: null,
    nights: 0,
    bus_count: 1,
    passengers: null,
    contact_method: null,
    payment_method: null,
    parking_included: null,
    vat_included: null,
    message: null,
    locale: "ko",
    privacy_consent_at: NOW.toISOString(),
    privacy_policy_version: PRIVACY_POLICY_VERSION,
    marketing_consent_at: null,
    retention_until: retentionUntil(NOW).toISOString(),
    withdrawal_consent_at: NOW.toISOString(),
  };

  test("insert 성공 → { id }. reservations 테이블에 행 그대로, select('id').single()", async () => {
    const { client, insert, select } = fakeClient({ data: { id: "11111111-1111-1111-1111-111111111111" }, error: null });
    const db = supabaseReservationDb(client);
    await expect(db.insert(sampleRow)).resolves.toEqual({ id: "11111111-1111-1111-1111-111111111111" });
    expect(insert).toHaveBeenCalledWith(sampleRow);
    expect(select).toHaveBeenCalledWith("id");
  });

  test("PostgREST 23505 → ReservationDbError(code '23505') — isUniqueViolation true (재시도 계약의 근거)", async () => {
    const { client } = fakeClient({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "reservations_public_code_key"',
        details: "Key (public_code)=(ABCD2345) already exists.",
      },
    });
    const db = supabaseReservationDb(client);
    const err = await db.insert(sampleRow).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReservationDbError);
    expect((err as ReservationDbError).code).toBe("23505");
    expect(isUniqueViolation(err)).toBe(true);
  });

  test("오류 메시지에 PostgREST details 는 넣지 않는다 (CHECK 위반의 'Failing row contains …' 는 이름·전화를 담는다)", async () => {
    const { client } = fakeClient({
      data: null,
      error: {
        code: "23514",
        message: 'new row for relation "reservations" violates check constraint "reservations_retention_after_created"',
        details: "Failing row contains (uuid, ABCD2345, 홍길동, +821012345678, ...).",
      },
    });
    const db = supabaseReservationDb(client);
    const err = (await db.insert(sampleRow).catch((e: unknown) => e)) as ReservationDbError;
    expect(err.code).toBe("23514");
    expect(isUniqueViolation(err)).toBe(false);
    const text = `${err.message} ${JSON.stringify(err)}`;
    expect(text).not.toContain("홍길동");
    expect(text).not.toContain("+821012345678");
    expect(text).toContain("23514");
  });

  test("data 에 id 가 없으면 throw", async () => {
    const { client } = fakeClient({ data: {}, error: null });
    const db = supabaseReservationDb(client);
    await expect(db.insert(sampleRow)).rejects.toThrow(/id/);
  });

  test("enqueue(rows) → outbox.enqueue(rows, client) 로 위임 (클라이언트를 닫아 둔다)", async () => {
    const { client } = fakeClient({ data: { id: "x" }, error: null });
    vi.mocked(outboxEnqueue).mockResolvedValueOnce([7, 8]);
    const db = supabaseReservationDb(client);
    const rows: NewOutboxRow[] = [
      { reservation_id: "r1", event: "created", channel: "sms", to: OWNER_PHONE, template: "created.owner.sms" },
      { reservation_id: "r1", event: "created", channel: "sms", to: "+821012345678", template: "created.customer.sms" },
    ];
    await expect(db.enqueue(rows)).resolves.toEqual([7, 8]);
    expect(outboxEnqueue).toHaveBeenCalledWith(rows, client);
  });
});
