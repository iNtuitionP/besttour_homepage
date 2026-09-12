/**
 * 예약확인 조회 — DB 포트 주입, 순수 (플랜 v4 P6-3a · ADR-4).
 *
 * 열거 방지의 핵심 규칙
 *   - `where public_code = :code` **1행**만 읽는다. 뒷 4자리 조건을 SQL 에 넣지 않는다 — 부재와 불일치가 같은 경로를 타게 하려고.
 *   - 뒷 4자리 비교는 서버 코드(phoneLast4Matches)에서, `phone` 의 숫자만 남긴 뒤 뒤 4자리를 XOR 누적으로 본다.
 *   - **부재와 불일치는 같은 결과** `{ found:false }` — 같은 리터럴, 같은 return 문. 부재일 때도 더미 비교를 한 번 해 경로 길이를 맞춘다(timing 완화 — 구조만).
 *   - 차량 라벨(vehicles.name_ko)은 **일치했을 때만** 읽는다 — 실패 경로는 DB 호출 1회로 동일하다.
 *   - status = cancelled·done 도 보여 준다(고객 본인 예약이다 — 취소됐다는 사실이 곧 확인 내용).
 *
 * select 화이트리스트(RESERVATION_CHECK_COLUMNS)는 이 파일이 단일 소스다 — db.ts 가 import 해 쓴다. email·message·admin_memo·id 는 읽지 않는다.
 */
import type { CheckInput } from "./guards";
import { toReservationView, type ReservationView } from "./view";

/** 0001 reservations 컬럼 중 예약확인이 읽는 것 전부. 여기 없는 컬럼은 서버 메모리에도 올라오지 않는다. */
export const RESERVATION_CHECK_COLUMNS = [
  "public_code",
  "name",
  "phone",
  "status",
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

/** select 결과 행(0001 컬럼 타입). timestamptz 는 ISO 문자열. */
export interface ReservationCheckRow {
  public_code: string;
  name: string;
  /** E.164(lib/reservations/phone.ts). 뷰 모델에는 마스킹된 값만 간다. */
  phone: string;
  status: string;
  trip_type: string | null;
  depart_at: string;
  return_at: string | null;
  vehicle_slug: string;
  origin_code: string;
  destination_code: string;
  bus_count: number;
  passengers: number | null;
  created_at: string;
}

/** DB 포트 — 서비스 롤 어댑터는 db.ts, 테스트는 mock. */
export interface ReservationCheckDb {
  /** `where public_code = :code` 1행. 없으면 null. */
  findByPublicCode(publicCode: string): Promise<ReservationCheckRow | null>;
  /** vehicles.name_ko. 없으면 null(뷰는 slug 로 폴백). */
  vehicleNameKo(slug: string): Promise<string | null>;
}

export type LookupOutcome = { found: true; view: ReservationView } | { found: false };

/** 부재일 때 비교 루틴에 넣는 더미 — 뒤 4자리가 어떤 입력과도 "일치"로 새지 않도록 결과는 phone 이 null 이면 무조건 false 다. */
const DUMMY_PHONE_DIGITS = "0000000000";

/**
 * `phone` 의 숫자만 남긴 뒤 뒤 4자리를 입력과 비교한다. 형식(E.164·하이픈·공백)과 무관.
 * 길이·문자를 XOR 로 누적해 이른 return 없이 끝까지 돈다. phone 이 null(부재)이어도 같은 루틴을 타되 결과는 false.
 */
export function phoneLast4Matches(phone: string | null, last4: string): boolean {
  const digits = (phone ?? DUMMY_PHONE_DIGITS).replace(/\D/g, "");
  const tail = digits.slice(-4);
  let diff = tail.length ^ last4.length;
  for (let i = 0; i < 4; i++) {
    diff |= (tail.charCodeAt(i) || 0) ^ (last4.charCodeAt(i) || 0);
  }
  return phone !== null && diff === 0;
}

export async function lookupReservation(input: CheckInput, deps: { db: ReservationCheckDb }): Promise<LookupOutcome> {
  const row = await deps.db.findByPublicCode(input.publicCode);
  const matched = phoneLast4Matches(row?.phone ?? null, input.phoneLast4);
  if (row === null || !matched) return { found: false };

  const vehicleNameKo = await deps.db.vehicleNameKo(row.vehicle_slug);
  return { found: true, view: toReservationView(row, vehicleNameKo) };
}
