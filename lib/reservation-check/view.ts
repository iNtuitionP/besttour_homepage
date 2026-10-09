/**
 * 예약확인 뷰 모델 — 순수 매퍼 (플랜 v4 P6-3a · P3-5 리뷰 N-2).
 *
 * 화면이 받는 것은 **그 예약의 상태 확인에 필요한 최소**다. 원문 name·phone 은 타입에 없다 — 본인이라도 마스킹(문자 링크를 어깨너머로 보는 경우).
 * 아래 두 상수(RESERVATION_VIEW_KEYS_EXHAUSTIVE · RESERVATION_VIEW_HAS_NO_RAW_PII)가 `keyof` 로 잠근다: 원문 키를 추가하면 컴파일이 깨진다.
 *
 * 일시는 UTC 인스턴트(timestamptz ISO 문자열) → KST 벽시계 `YYYY-MM-DD HH:mm`. 서버 TZ 와 무관하게 lib/kst.ts 와 같은 고정 +09:00 계산이다.
 * (화면의 보이는 날짜는 카드가 lib/public-date.ts 로 바꿔 보인다 — 뷰는 KST 벽시계 원문을 그대로 실어 나른다. 문자 통지(lib/notify)도 이 원문을 쓴다.)
 * 장소 라벨은 lib/codes.ts locationLabel(code, locale)(표시 전용 — en 은 영문 지명), 차량 라벨은 vehicles.name_ko · name_en
 * (en 은 name_en, 비면 name_ko, 차량 행이 없으면 slug 폴백 — P7-4). 금액·가격 필드 0.
 */
import { isLocationCode, locationLabel } from "../codes";
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
  /** 0023 접수 경로. quick(홈 간편 견적)이면 운행일은 날짜만이고 차종·대수 줄은 없다. */
  intake: "wizard" | "quick";
  /** KST 벽시계 `YYYY-MM-DD HH:mm` — 간편 접수는 `YYYY-MM-DD`(시각은 받지 않았다 · 00:00 은 자리값). */
  departAtKst: string;
  returnAtKst: string | null;
  /** 차량 라벨 — 간편 접수(차종 미정)는 null → 카드가 그 줄을 숨긴다. */
  vehicleLabel: string | null;
  originLabel: string;
  destinationLabel: string;
  /** 간편 접수는 null → 카드가 그 줄을 숨긴다. */
  busCount: number | null;
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
  "intake",
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

/** UTC 인스턴트 문자열 → KST 달력 날짜 `YYYY-MM-DD`. 유효하지 않으면 throw. 간편 접수의 운행일 표시용(P3-8). */
export function kstDate(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("kstDate: 유효하지 않은 일시 문자열이다");
  }
  return toKstDateString(instant);
}

/**
 * 운행일 표시 — **간편 접수(0023 intake='quick')는 날짜만**. 손님은 시각을 고르지 않았고 저장된 00:00 은 자리값이다
 * (시각을 보이면 "자정 출발" 로 읽힌다). 위저드 접수는 KST 벽시계 일시 그대로. 관리자 화면·예약확인·통지 문안이 같은 판정을 쓴다.
 */
export function tripDateText(iso: string, intake: string | null | undefined): string {
  return intake === "quick" ? kstDate(iso) : kstWallClock(iso);
}

/** 0023 intake 값 — 모르는 값·누락은 wizard 로 본다(0023 이전 코드 경로의 행 모양). */
export function asIntake(value: unknown): "wizard" | "quick" {
  return value === "quick" ? "quick" : "wizard";
}

function asStatus(value: string): ReservationStatus {
  if ((RESERVATION_STATUSES as readonly string[]).includes(value)) return value as ReservationStatus;
  throw new Error("toReservationView: 알 수 없는 status 다 (0001 reservation_status 밖)");
}

function asTripType(value: string | null): TripType | null {
  return value !== null && (TRIP_TYPES as readonly string[]).includes(value) ? (value as TripType) : null;
}

/** 표시용 라벨 — canonical code 면 로케일 라벨(ko 한글 · en 영문), 아니면 코드 그대로(저장값을 바꾸지 않는다). */
function labelOf(code: string, locale: string): string {
  return isLocationCode(code) ? locationLabel(code, locale) : code;
}

/** vehicles.name_ko · name_en 한 쌍 (P7-4). DB 어댑터(db.ts)가 name_en 이 문자열이 아니면 "" 로 채운다. */
export interface VehicleNames {
  ko: string;
  en: string;
}

/** 차량 라벨 — en 은 name_en(비면 name_ko), 그 밖은 name_ko. 차량 행이 없으면 slug(저장값) 그대로. */
function vehicleLabelOf(slug: string, names: VehicleNames | null, locale: string): string {
  if (names === null) return slug;
  const pick = locale === "en" && names.en.trim() !== "" ? names.en : names.ko;
  return pick.trim() !== "" ? pick : slug;
}

/**
 * 저장형(E.164) 전화 마스킹은 lib/mask.ts maskStoredPhone 이다 — 판정(+82 휴대전화만, 그 밖은 fail-closed `***`)은
 * 리뷰 M-1 때와 한 글자도 같고, 구현만 공용 모듈로 옮겼다(P5-8 발송 내역이 같은 변환을 써야 했다 — 사본을 두면
 * 한쪽만 조여지고 다른 쪽이 계속 샌다).
 */

export function toReservationView(row: ReservationCheckRow, vehicleNames: VehicleNames | null, locale: string = "ko"): ReservationView {
  const status = asStatus(row.status);
  const tripType = asTripType(row.trip_type);
  const intake = asIntake(row.intake);
  return {
    publicCode: row.public_code,
    status,
    statusKey: `reservationCheck.status.${status}`,
    tripType,
    tripTypeKey: tripType === null ? null : `reservationCheck.tripType.${tripType}`,
    intake,
    departAtKst: tripDateText(row.depart_at, intake),
    returnAtKst: row.return_at === null ? null : tripDateText(row.return_at, intake),
    vehicleLabel: row.vehicle_slug === null ? null : vehicleLabelOf(row.vehicle_slug, vehicleNames, locale),
    originLabel: labelOf(row.origin_code, locale),
    destinationLabel: labelOf(row.destination_code, locale),
    busCount: row.bus_count ?? null,
    passengers: row.passengers ?? null,
    maskedName: maskName(row.name),
    maskedPhone: maskStoredPhone(row.phone),
    createdAtKst: kstWallClock(row.created_at),
  };
}
