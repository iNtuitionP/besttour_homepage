/**
 * Canonical 코드 테이블 — 장소(REGIONS)·여행구분(PURPOSES).
 *
 * 절대 규칙: 장소·여행구분은 이 canonical code로만 저장한다. 번역 문자열
 * ("서울", "Seoul" 등)을 DB에 저장하지 않는다. 화면 표시용 한글/영문 라벨은
 * 별도의 표시 레이어(i18n 메시지 등)에서 이 code를 키로 매핑한다.
 *
 * REGIONS: ICN(인천공항 특수코드) + 16개 시도. 목록·순서는 스펙 그대로 고정.
 */
export const REGIONS = [
  "ICN",
  "SEL",
  "BSN",
  "INC",
  "DGU",
  "GWJ",
  "DJN",
  "ULS",
  "GG",
  "GW",
  "CN",
  "CB",
  "GB",
  "GN",
  "JN",
  "JB",
  "JJ",
] as const;

export type RegionCode = (typeof REGIONS)[number];

export const PURPOSES = [
  "airport_pickup",
  "family",
  "ceremony",
  "workshop",
  "social",
  "religious",
  "univ_mt",
  "field_trip",
  "foreign_vip",
  "etc",
] as const;

export type PurposeCode = (typeof PURPOSES)[number];

/** ICN(인천공항)인지 여부 — 공항 픽업·샌딩 분기 등에 사용. */
export const isAirport = (c: RegionCode) => c === "ICN";
