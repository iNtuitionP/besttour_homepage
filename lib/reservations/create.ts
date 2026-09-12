/**
 * 접수 순수 함수 (플랜 v4 P3-2 · ADR-4 · ADR-7).
 *
 * 서버액션(actions/reservation.ts, P3-3)의 본체다. 이 파일은 Next 를 모른다 — 서버액션 지시어 없음, `next/*` import 없음,
 * 환경변수를 읽지 않음, 시계를 직접 만들지 않음(시각은 deps.now()·parseKst 로만). DB·시계·난수·사장님 연락처·로그는 전부
 * `deps` 로 받는다. 그래서 vitest 가 mock deps 로 모든 경로(재시도·통지 실패·순서)를 돈다(tests/reservation-create.test.ts 가
 * 이 금지 목록을 정적 grep 으로 잠근다). `after()`·`revalidateTag()` 는 lib/ports/* 에 있고 래퍼(P3-3)가 쓴다.
 *
 * 흐름
 *   0. ReservationInput.safeParse 를 **다시** 한다(방어 심층). P3-1 runGuards 가 이미 통과시켰지만, 실패하면 호출자 버그라 throw.
 *   1. origin/destination/waypoint 코드를 isLocationCode 로 재확인 — 이 컬럼들엔 DB CHECK 가 없다(0001, 리뷰 M5).
 *   2. KST 벽시계(`YYYY-MM-DDTHH:mm`) → parseKst 로 인스턴트. 서버 TZ 와 무관(CLAUDE.md §3). nights = nightsBetween(round) / 0.
 *   3. phone ← contactPhone(input).e164 (`+82…`). 동의 4컬럼 ← consentFields(input, now).
 *   4. reservations insert. public_code 는 randomBytes → 31자 알파벳 8자(publicCode.ts). unique 충돌(23505)이면 최대 3회 재생성.
 *   5. planNotifications(created) → db.enqueue. **동기**다(아래).
 *
 * 통지 enqueue 를 after() 가 아니라 동기로 하는 이유
 *   after() 안에서 enqueue 가 실패하면 "예약은 있는데 통지 기록이 없다" — 아웃박스(ADR-7)가 막으려던 바로 그 구멍이 형태만 바꿔
 *   살아난다. 동기로 하면 실패가 응답 전에 드러나고(notifyQueued:false + 구조화 로그), 예약은 그대로 성공한다.
 *
 * 왜 단일 트랜잭션(SQL 함수)이 아닌가 — 트레이드오프
 *   insert + enqueue 를 한 트랜잭션에 넣으면 원자적이다. 그러나 마이그레이션(0006)이 필요하고 번호가 또 밀린다.
 *   지금은 "예약이 먼저, 통지는 최선 노력 + 실패 시 큰 소리(로그 + result)" 로 간다. 통지 없는 예약은 admin 목록에는 보이므로
 *   사장님이 놓치는 것이 아니라 늦게 보는 것이다. P4 발송기가 실제로 돌 때 이 격차(enqueue 실패 빈도)가 보이면 SQL 함수로 승격한다.
 *
 * 로그·결과에는 이름·전화가 들어가지 않는다 — reservationId·publicCode·행 수·오류 문자열뿐.
 */
import { isLocationCode } from "../codes";
import { nightsBetween, parseKst } from "../kst";
import { planNotifications } from "../notify/outbox";
import { ReservationInput, type CreateReservationResult, type NewOutboxRow, type ReservationInsert } from "../types";
import { consentFields } from "./consent";
import { contactPhone } from "./phone";
import { generatePublicCode, type RandomBytes } from "./publicCode";

// =============================================================================
// 포트 — DB 어댑터 인터페이스 (구현: lib/reservations/db.ts supabaseReservationDb, 테스트: mock)
// =============================================================================

/**
 * reservations 쓰기 + 아웃박스 enqueue. 서비스 롤 클라이언트는 어댑터가 닫아 둔다 — 이 함수는 클라이언트를 모른다.
 * `enqueue` 는 lib/notify/outbox.ts enqueue 와 같은 계약(입력 순서대로 새 id, 중복 키는 건너뜀)에서 client 인자만 뺀 것이다.
 * `insert` 는 public_code unique 충돌 시 `code === '23505'` 를 가진 오류를 throw 해야 한다(ReservationDbError) — 재시도의 근거.
 */
export interface ReservationDb {
  insert(row: ReservationInsert): Promise<{ id: string }>;
  enqueue(rows: NewOutboxRow[]): Promise<number[]>;
}

/** 어댑터가 던지는 오류. `code` 는 Postgres SQLSTATE(PostgREST error.code). details/hint 는 싣지 않는다 — 행 내용(개인정보)이 섞인다. */
export class ReservationDbError extends Error {
  readonly code: string | undefined;

  constructor(message: string, opts: { code?: string } = {}) {
    super(message);
    this.name = "ReservationDbError";
    this.code = opts.code;
  }
}

/** Postgres unique_violation. reservations 의 unique 는 public_code 하나(pk 는 gen_random_uuid) — 23505 = 코드 충돌. */
export const UNIQUE_VIOLATION_CODE = "23505";

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === UNIQUE_VIOLATION_CODE;
}

/** public_code 생성 시도 상한 = 첫 시도 1회 + 재생성 3회. 31^8 공간이라 실제로는 1회에 끝난다. */
export const PUBLIC_CODE_MAX_ATTEMPTS = 4;

// =============================================================================
// deps · 로그 · 결과
// =============================================================================

/** 구조화 로그 1건 — 개인정보 없음. 래퍼(P3-3)가 console.error 등으로 내보낸다. */
export interface CreateReservationLogEntry {
  level: "error";
  /** failed = enqueue 가 throw · partial = throw 는 없었으나 계획한 행 수보다 적게 들어감 */
  event: "reservation.notify_enqueue_failed" | "reservation.notify_enqueue_partial";
  reservationId: string;
  publicCode: string;
  /** 계획한 통지 행 수 */
  rows: number;
  error: string;
}

export interface CreateReservationDeps {
  db: ReservationDb;
  /** 서버가 접수 요청을 받은 인스턴트 — 동의 시각·retention 기산점. */
  now: () => Date;
  /** 암호학적 난수(node:crypto randomBytes). public_code 용. */
  randomBytes: RandomBytes;
  /** 사장님 수신 번호(env → 래퍼가 넘긴다). 없으면 ownerEmail 폴백, 둘 다 없으면 사장님 건 생략 + warning. */
  ownerPhone?: string;
  ownerEmail?: string;
  log: (entry: CreateReservationLogEntry) => void;
}

// =============================================================================
// 본체
// =============================================================================

function callerBug(detail: string): Error {
  return new Error(`createReservation: ${detail} — 호출자 버그 (P3-1 runGuards 가 ReservationInput 을 먼저 통과시켜야 한다)`);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 운행 일시 — KST 벽시계 → 인스턴트 + nights. 0001 의 두 제약(round ⇔ return_at, return_at > depart_at)을 insert 전에 막는다. */
function scheduleColumns(data: ReservationInput): Pick<ReservationInsert, "depart_at" | "return_at" | "nights"> {
  const departAt = parseKst(data.departAtLocal);

  if (data.tripType === "round") {
    if (data.returnAtLocal === undefined) {
      throw callerBug("tripType=round 인데 returnAtLocal 이 없다 (0001 reservations_round_trip_return_ck)");
    }
    const returnAt = parseKst(data.returnAtLocal);
    if (returnAt.getTime() <= departAt.getTime()) {
      throw callerBug(
        `귀가 일시(${data.returnAtLocal})가 출발 일시(${data.departAtLocal}) 이후가 아니다 (0001 return_at > depart_at)`,
      );
    }
    return {
      depart_at: departAt.toISOString(),
      return_at: returnAt.toISOString(),
      nights: nightsBetween(data.departAtLocal, data.returnAtLocal),
    };
  }

  if (data.tripType === "oneway_oneway" && data.returnAtLocal !== undefined) {
    // 편도·편도 — 두 번째 운행(귀가) 일시. 0006_trip_return_check 가 이 조합의 return_at 을 허용한다.
    // 사장님이 견적을 내려면 두 번째 운행일이 필요하므로 저장한다. nights 는 두 운행 사이의 KST 달력 일수.
    const returnAt = parseKst(data.returnAtLocal);
    if (returnAt.getTime() <= departAt.getTime()) {
      throw callerBug(
        `귀가 일시(${data.returnAtLocal})가 출발 일시(${data.departAtLocal}) 이후가 아니다 (0001 return_at > depart_at)`,
      );
    }
    return {
      depart_at: departAt.toISOString(),
      return_at: returnAt.toISOString(),
      nights: nightsBetween(data.departAtLocal, data.returnAtLocal),
    };
  }

  if (data.returnAtLocal !== undefined) {
    // 단순 편도(oneway)에 귀가 일시가 온 것은 호출자 버그다. 0006 후에도 oneway 는 return_at 금지.
    throw callerBug(
      `tripType=${data.tripType} 에 returnAtLocal 이 왔다 — reservations_round_trip_return_ck(0006) 는 oneway 의 return_at 을 금지한다`,
    );
  }
  return { depart_at: departAt.toISOString(), return_at: null, nights: 0 };
}

/** public_code 를 새로 뽑아 insert. 23505 면 재생성, 상한에 닿으면 throw. 다른 오류는 그대로 throw(재시도 없음). */
async function insertWithFreshCode(
  base: Omit<ReservationInsert, "public_code">,
  deps: Pick<CreateReservationDeps, "db" | "randomBytes">,
): Promise<{ id: string; publicCode: string }> {
  for (let attempt = 1; attempt <= PUBLIC_CODE_MAX_ATTEMPTS; attempt++) {
    const publicCode = generatePublicCode(deps.randomBytes);
    try {
      const inserted = await deps.db.insert({ ...base, public_code: publicCode });
      if (typeof inserted.id !== "string" || inserted.id.length === 0) {
        throw new Error("createReservation: db.insert 가 id 를 돌려주지 않았다 — 어댑터 계약 위반");
      }
      return { id: inserted.id, publicCode };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (attempt === PUBLIC_CODE_MAX_ATTEMPTS) {
        throw new Error(
          `createReservation: public_code 가 ${attempt}회 연속 충돌했다 (31^8 공간에서 통계적으로 불가능 — ` +
            `randomBytes 주입값이나 DB 상태를 의심할 것): ${errorMessage(e)}`,
        );
      }
    }
  }
  // for 루프는 return 또는 throw 로만 끝난다.
  throw new Error("createReservation: unreachable");
}

/**
 * 접수. 성공 = reservations 행이 있다. 통지 enqueue 실패는 접수 실패가 아니다(notifyQueued:false + log).
 * insert 가 실패하면 throw 하고 enqueue 는 호출되지 않는다.
 */
export async function createReservation(
  input: ReservationInput,
  deps: CreateReservationDeps,
): Promise<CreateReservationResult> {
  // 0. 재검증
  const parsed = ReservationInput.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw callerBug(`입력이 ReservationInput 을 통과하지 못했다 [${issues}]`);
  }
  const data = parsed.data;

  const now = deps.now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("createReservation: deps.now() 가 유효한 Date 가 아니다");
  }

  // 1. 장소 코드 재확인 (DB CHECK 없음)
  const codes = [data.originCode, data.destinationCode, ...data.waypointCodes];
  const unknownCodes = codes.filter((c) => !isLocationCode(c));
  if (unknownCodes.length > 0) {
    throw callerBug(`장소 코드가 LOCATION_CODES 에 없다: ${unknownCodes.join(", ")} (이 컬럼엔 DB CHECK 가 없어 여기서 막는다)`);
  }

  // 2~3. 페이로드 — DB 컬럼명 그대로 (ReservationInsert)
  const schedule = scheduleColumns(data);
  const phone = contactPhone(data);
  const consent = consentFields(data, now);
  const base: Omit<ReservationInsert, "public_code"> = {
    name: data.name,
    phone: phone.e164,
    email: data.email ?? null,
    vehicle_slug: data.vehicleSlug,
    purpose_code: data.purposeCode,
    origin_code: data.originCode,
    destination_code: data.destinationCode,
    waypoint_codes: [...data.waypointCodes],
    trip_type: data.tripType,
    depart_at: schedule.depart_at,
    return_at: schedule.return_at,
    nights: schedule.nights,
    bus_count: data.busCount,
    passengers: data.passengers ?? null,
    contact_method: data.contactMethod ?? null,
    payment_method: data.paymentMethod ?? null,
    parking_included: data.parkingIncluded ?? null,
    vat_included: data.vatIncluded ?? null,
    message: data.message ?? null,
    locale: data.locale,
    ...consent,
  };

  // 4. insert (public_code 재시도 포함). 실패 = throw, 접수 없음, 통지 없음.
  const { id: reservationId, publicCode } = await insertWithFreshCode(base, deps);

  // 5. 통지 — 동기 enqueue. 실패해도 접수는 성공 (헤더의 트레이드오프).
  const plan = planNotifications(
    { id: reservationId },
    "created",
    { ownerPhone: deps.ownerPhone, ownerEmail: deps.ownerEmail, customerPhone: phone.e164 },
  );
  const warnings = [...plan.warnings];
  let notifyQueued = false;
  try {
    const ids = await deps.db.enqueue(plan.rows);
    if (ids.length === plan.rows.length) {
      notifyQueued = true;
    } else {
      const error = `notification enqueue partial: planned ${plan.rows.length}, inserted ${ids.length}`;
      deps.log({ level: "error", event: "reservation.notify_enqueue_partial", reservationId, publicCode, rows: plan.rows.length, error });
      warnings.push(error);
    }
  } catch (e) {
    const error = errorMessage(e);
    deps.log({ level: "error", event: "reservation.notify_enqueue_failed", reservationId, publicCode, rows: plan.rows.length, error });
    warnings.push(`notification enqueue failed: ${error}`);
  }

  return { reservationId, publicCode, notifyQueued, warnings };
}
