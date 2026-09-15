/**
 * 예약확인 뷰 모델 — 순수 매퍼 (플랜 v4 P6-3a · P3-5 리뷰 N-2).
 *
 * 화면이 받는 것은 **그 예약의 상태 확인에 필요한 최소**다. 원문 name·phone 은 타입에 없다 — 본인이라도 마스킹(문자 링크를 어깨너머로 보는 경우).
 * 아래 두 상수(RESERVATION_VIEW_KEYS_EXHAUSTIVE · RESERVATION_VIEW_HAS_NO_RAW_PII)가 `keyof` 로 잠근다: 원문 키를 추가하면 컴파일이 깨진다.
 *
 * 일시는 UTC 인스턴트(timestamptz ISO 문자열) → KST 벽시계 `YYYY-MM-DD HH:mm`. 서버 TZ 와 무관하게 lib/kst.ts 와 같은 고정 +09:00 계산이다.
 * 장소 라벨은 lib/codes.ts locationLabelKo(표시 전용), 차량 라벨은 vehicles.name_ko(없으면 slug 폴백). 금액·가격 필드 0.
 */
import { isLocationCode, locationLabelKo } from "../codes";
import { toKstDateString } from "../kst";
import { maskName, maskStoredPhone } from "../mask";
import type { ReservationCheckRow } from "./lookup";

/** 0001 reservation_status enum 그대로. */
export const RESERVATION_STATUSES = ["new", "confirmed", "done", "cancelled"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** 0001 trip_type CHECK 그대로. */
export const TRIP_TYPES = ["round", "oneway", "oneway_oneway"] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export interface ReservationView {
  publicCode: string;
  status: ReservationStatus;
  /** messages/ko.json 라벨 키 — UI 가 t(statusKey) 로 푼다. */
  statusKey: `reservationCheck.status.${ReservationStatus}`;
  tripType: TripType | null;
  tripTypeKey: `reservationCheck.tripType.${TripType}` | null;
  /** KST 벽시계 `YYYY-MM-DD HH:mm`. */
  departAtKst: string;
  returnAtKst: string | null;
  vehicleLabel: string;
  originLabel: string;
  destinationLabel: string;
  busCount: number;
  passengers: number | null;
  /** lib/mask.ts maskName — 첫 글자 + `*` 1~2개. */
  maskedName: string;
  /** lib/mask.ts maskStoredPhone — `+82` 휴대전화만 가운데 자리 `****`, 그 밖은 `***`. */
  maskedPhone: string;
  createdAtKst: string;
}

/** 뷰 모델 키 전부 — 테스트가 결과 객체의 키 집합과 대조한다. 아래 타입 잠금이 누락·원문 키를 컴파일에서 막는다. */
export const RESERVATION_VIEW_KEYS = [
  "publicCode",
  "status",
  "statusKey",
  "tripType",
  "tripTypeKey",
  "departAtKst",
  "returnAtKst",
  "vehicleLabel",
  "originLabel",
  "destinationLabel",
  "busCount",
  "passengers",
  "maskedName",
  "maskedPhone",
  "createdAtKst",
] as const satisfies readonly (keyof ReservationView)[];

type MissingViewKey = Exclude<keyof ReservationView, (typeof RESERVATION_VIEW_KEYS)[number]>;
/** keyof 잠금 1 — RESERVATION_VIEW_KEYS 가 ReservationView 의 모든 키를 담는다(빠지면 컴파일 실패). */
export const RESERVATION_VIEW_KEYS_EXHAUSTIVE: MissingViewKey extends never ? true : never = true;

type RawPiiKey = "name" | "phone" | "email" | "message" | "adminMemo" | "admin_memo" | "id";
/** keyof 잠금 2 — 뷰 모델에 원문 개인정보 키가 없다(추가하면 컴파일 실패). */
export const RESERVATION_VIEW_HAS_NO_RAW_PII: Extract<keyof ReservationView, RawPiiKey> extends never ? true : never = true;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC 인스턴트 문자열 → KST 벽시계 `YYYY-MM-DD HH:mm`. 날짜는 lib/kst.ts toKstDateString, 시각은 같은 고정 오프셋. 유효하지 않으면 throw. */
export function kstWallClock(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("kstWallClock: 유효하지 않은 일시 문자열이다");
  }
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return `${toKstDateString(instant)} ${shifted.toISOString().slice(11, 16)}`;
}

function asStatus(value: string): ReservationStatus {
  if ((RESERVATION_STATUSES as readonly string[]).includes(value)) return value as ReservationStatus;
  throw new Error("toReservationView: 알 수 없는 status 다 (0001 reservation_status 밖)");
}

function asTripType(value: string | null): TripType | null {
  return value !== null && (TRIP_TYPES as readonly string[]).includes(value) ? (value as TripType) : null;
}

/** 표시용 라벨 — canonical code 면 한글 라벨, 아니면 코드 그대로(저장값을 바꾸지 않는다). */
function labelOf(code: string): string {
  return isLocationCode(code) ? locationLabelKo(code) : code;
}

/**
 * 저장형(E.164) 전화 마스킹은 lib/mask.ts maskStoredPhone 이다 — 판정(+82 휴대전화만, 그 밖은 fail-closed `***`)은
 * 리뷰 M-1 때와 한 글자도 같고, 구현만 공용 모듈로 옮겼다(P5-8 발송 내역이 같은 변환을 써야 했다 — 사본을 두면
 * 한쪽만 조여지고 다른 쪽이 계속 샌다).
 */

export function toReservationView(row: ReservationCheckRow, vehicleNameKo: string | null): ReservationView {
  const status = asStatus(row.status);
  const tripType = asTripType(row.trip_type);
  return {
    publicCode: row.public_code,
    status,
    statusKey: `reservationCheck.status.${status}`,
    tripType,
    tripTypeKey: tripType === null ? null : `reservationCheck.tripType.${tripType}`,
    departAtKst: kstWallClock(row.depart_at),
    returnAtKst: row.return_at === null ? null : kstWallClock(row.return_at),
    vehicleLabel: vehicleNameKo ?? row.vehicle_slug,
    originLabel: labelOf(row.origin_code),
    destinationLabel: labelOf(row.destination_code),
    busCount: row.bus_count,
    passengers: row.passengers ?? null,
    maskedName: maskName(row.name),
    maskedPhone: maskStoredPhone(row.phone),
    createdAtKst: kstWallClock(row.created_at),
  };
}
