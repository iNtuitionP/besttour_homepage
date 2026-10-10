/**
 * 예약확인 조회 — DB 포트 주입, 순수 (플랜 v4 P6-3a · T2-5 · ADR-4).
 *
 * T2-5(사장님 요청 1 · 결정 5 B안, 2026-10-10): 조회 키 = **휴대폰 번호 + 예약자 이름**.
 *
 * 존재 비노출의 핵심 규칙
 *   - SQL 조건은 **전화번호 하나**다(`phone in (정규형, '+820' 옛 저장형)` — lib/reservation-check/phone.ts). 이름·상태·날짜 조건을
 *     SQL 에 넣지 않는다 — 없음·이름 불일치·범위 밖이 같은 경로(질의 1회 → 서버 비교)를 타게 하려고.
 *   - 이름 비교는 서버 코드에서 **상수 시간**으로 한다(namesMatch): 양쪽을 NFC · 공백 전부 제거 · 소문자로 맞춘 뒤 sha256 으로
 *     길이를 같게 만들어 timingSafeEqual. **행마다 한 번씩 끝까지** 비교한다(먼저 맞은 행이 있어도 멈추지 않는다).
 *     행이 하나도 없으면 더미 비교를 한 번 해 경로 길이를 맞춘다(결과는 언제나 false).
 *   - 결과 범위(결정 5 기본값): **운행일이 오늘(KST) 이후이고 취소가 아닌 건**만(isUpcoming). 운행일은 도착일이 있으면 도착일
 *     (어제 출발해 내일 돌아오는 운행 중 건은 보인다). 지난 일정·취소 건은 보이지 않는다 — 화면의 not_found 문구가 그 사실을 알린다.
 *   - 없음·불일치·범위 밖은 **같은 결과** `{ found:false }` — 같은 리터럴, 같은 return 문.
 *   - 차량 라벨(vehicles.name_ko · name_en — P7-4)은 **보일 행이 있을 때만**, slug 마다 한 번 읽는다 — 실패 경로는 DB 호출 1회로 같다.
 *
 * select 화이트리스트(RESERVATION_CHECK_COLUMNS)는 이 파일이 단일 소스다 — db.ts 가 import 해 쓴다.
 * public_code(내부 식별자 — 손님 화면에 보이지 않는다)·email·message·admin_memo·id 는 읽지 않는다.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { toKstDateString } from "../kst";
import type { CheckInput } from "./guards";
import { storedPhoneCandidates } from "./phone";
import { kstDate, toReservationView, type ReservationView, type VehicleNames } from "./view";

/** 0001 reservations 컬럼 중 예약확인이 읽는 것 전부. 여기 없는 컬럼은 서버 메모리에도 올라오지 않는다. */
export const RESERVATION_CHECK_COLUMNS = [
  "name",
  "phone",
  "status",
  "intake",
  "trip_type",
  "depart_at",
  "return_at",
  "vehicle_slug",
  "origin_code",
  "destination_code",
  "bus_count",
  "passengers",
  "created_at",
] as const;

/** PostgREST select 문자열 — 화이트리스트를 쉼표로 이은 것. `*` 없음. */
export const RESERVATION_CHECK_SELECT: string = RESERVATION_CHECK_COLUMNS.join(",");

/**
 * 한 번호로 읽는 행의 상한. 출발이 늦은 순으로 이만큼만 읽는다(db.ts) — 앞으로의 운행이 먼저 들어오므로 오래된 행이 잘린다.
 * 번호 하나에 이보다 많은 접수가 쌓이는 경우는 업무상 없다고 보고, 있어도 앞으로의 일정은 빠지지 않는다.
 */
export const CHECK_MAX_ROWS = 50;

/** select 결과 행(0001 컬럼 타입). timestamptz 는 ISO 문자열. */
export interface ReservationCheckRow {
  /** 원문 — 이름 비교에만 쓴다. 뷰 모델에는 마스킹된 값만 간다. */
  name: string;
  /** E.164(lib/reservations/phone.ts). 뷰 모델에는 마스킹된 값만 간다. */
  phone: string;
  status: string;
  /** 0023 — quick(홈 간편 견적)이면 날짜만 보이고 차종·대수 줄이 없다. */
  intake: string;
  trip_type: string | null;
  depart_at: string;
  return_at: string | null;
  /** 간편 접수는 null(0023). */
  vehicle_slug: string | null;
  origin_code: string;
  destination_code: string;
  /** 간편 접수는 null(0023). */
  bus_count: number | null;
  passengers: number | null;
  created_at: string;
}

/** DB 포트 — 서비스 롤 어댑터는 db.ts, 테스트는 mock. */
export interface ReservationCheckDb {
  /** `where phone in (:phones)` — 출발 늦은 순, CHECK_MAX_ROWS 행까지. 없으면 []. **다른 조건은 없다.** */
  findByPhones(phones: readonly string[]): Promise<ReservationCheckRow[]>;
  /** vehicles.name_ko · name_en(P7-4 — 영문 화면은 name_en). 없으면 null(뷰는 slug 로 폴백). */
  vehicleNames(slug: string): Promise<VehicleNames | null>;
}

export type LookupOutcome = { found: true; views: ReservationView[] } | { found: false };

/** 비교용 이름 — NFC · 공백(띄어쓰기·탭·줄바꿈·전각 공백) 전부 제거 · 소문자. 저장값과 입력값 양쪽에 같은 함수를 쓴다. */
export function normalizeName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, "").toLowerCase();
}

/** 부재 행의 더미 이름 — 정규화 뒤 빈 문자열이 되지 않는 값(어떤 입력과도 같아지지 않게 결과는 null 이면 무조건 false). */
const DUMMY_NAME = "\u0000";

const digestOf = (value: string): Buffer => createHash("sha256").update(normalizeName(value), "utf8").digest();

/**
 * 저장 이름과 입력 이름이 같은 사람인가 — 상수 시간 비교. 해시로 길이를 맞춘 뒤 timingSafeEqual(이른 return·=== 없음).
 * stored 가 null(행 없음)이어도 같은 루틴을 타되 결과는 false.
 */
export function namesMatch(stored: string | null, typed: string): boolean {
  const equal = timingSafeEqual(digestOf(stored ?? DUMMY_NAME), digestOf(typed));
  return stored !== null && equal;
}

/**
 * 손님에게 보일 범위인가 — 취소가 아니고, 운행의 마지막 날(도착일, 없으면 출발일)이 오늘(KST 달력) 이후.
 * todayKst 는 `YYYY-MM-DD`. 날짜 문자열 비교는 같은 형식이라 사전순 = 시간순이다.
 */
export function isUpcoming(row: Pick<ReservationCheckRow, "status" | "depart_at" | "return_at">, todayKst: string): boolean {
  if (row.status === "cancelled") return false;
  const lastDay = [kstDate(row.depart_at), row.return_at === null ? null : kstDate(row.return_at)]
    .filter((d): d is string => d !== null)
    .sort()
    .pop() as string;
  return lastDay >= todayKst;
}

const byDepartAsc = (a: ReservationCheckRow, b: ReservationCheckRow): number => Date.parse(a.depart_at) - Date.parse(b.depart_at);

/**
 * `deps.now` — guard 가 한 번 읽은 시각(runCheckGuards 의 now). "오늘(KST)" 은 여기서 정한다.
 * `deps.locale` (P7-4) — 결과 카드의 지명·차종을 고를 화면 언어. 조회 조건·비교에는 쓰지 않는다.
 */
export async function lookupReservation(input: CheckInput, deps: { db: ReservationCheckDb; now: Date; locale?: string }): Promise<LookupOutcome> {
  const rows = await deps.db.findByPhones(storedPhoneCandidates(input.phone));
  const todayKst = toKstDateString(deps.now);

  // 행마다 이름을 끝까지 비교한다(먼저 맞은 행이 있어도 멈추지 않는다). 행이 없으면 더미 한 번.
  const matched: ReservationCheckRow[] = [];
  const pool: (ReservationCheckRow | null)[] = rows.length > 0 ? rows : [null];
  for (const row of pool) {
    const nameOk = namesMatch(row === null || typeof row.name !== "string" ? null : row.name, input.name);
    if (row !== null && nameOk && isUpcoming(row, todayKst)) matched.push(row);
  }
  if (matched.length === 0) return { found: false };

  matched.sort(byDepartAsc);
  const locale = deps.locale ?? "ko";
  const vehicleCache = new Map<string, VehicleNames | null>();
  const views: ReservationView[] = [];
  for (const row of matched) {
    // 간편 접수(차종 미정)는 차량 라벨을 읽지 않는다 — 읽을 slug 가 없다.
    let names: VehicleNames | null = null;
    if (row.vehicle_slug !== null) {
      if (!vehicleCache.has(row.vehicle_slug)) vehicleCache.set(row.vehicle_slug, await deps.db.vehicleNames(row.vehicle_slug));
      names = vehicleCache.get(row.vehicle_slug) ?? null;
    }
    views.push(toReservationView(row, names, locale));
  }
  return { found: true, views };
}
