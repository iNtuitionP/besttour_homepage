/**
 * Canonical 코드 테이블 — 장소(REGIONS·PLACES)·여행구분(PURPOSES).
 *
 * 절대 규칙: 장소·여행구분은 이 canonical code로만 저장한다. 번역 문자열
 * ("서울", "Seoul" 등)을 DB에 저장하지 않는다. 화면 표시용 한글/영문 라벨은
 * 별도의 표시 레이어(i18n 메시지 등)에서 이 code를 키로 매핑한다.
 *
 * REGIONS: ICN(인천공항 특수코드) + 16개 시도. 목록·순서는 스펙 그대로 고정.
 * PLACES:  도시 단위 장소 카탈로그(스펙 §13.2, 플랜 v4 P1-2). DB `places` 테이블과
 *          `supabase/migrations/0002_places.sql` 시드의 단일 소스 — tests/places.test.ts 가
 *          SQL 텍스트를 파싱해 이 배열과 1:1 일치함을 단언한다.
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

// =============================================================================
// PLACES — 도시 단위 장소 카탈로그
// =============================================================================

export type PlaceKind = "airport" | "city";

export interface Place {
  /** 3글자 대문자. 기존 REGIONS 와 겹치는 것은 도시로 확정된 6개(ICN·SEL·BSN·DGU·GWJ·DJN)뿐. */
  readonly code: string;
  readonly nameKo: string;
  readonly nameEn: string;
  readonly kind: PlaceKind;
  /** 시도 단위 집계용 — REGIONS 코드. */
  readonly regionCode: RegionCode;
  /** 시청(군청)·공항 터미널 기준 위경도, 소수 4자리(≈10 m). 출처는 각 행 주석. */
  readonly lat: number;
  readonly lng: number;
  /** 표시 순서. ICN=1, SEL=2, 이후 스펙 §13.2 도착지 순서. */
  readonly sort: number;
}

/**
 * 위경도 출처 (2026-09-11 조회, 두 출처가 있으면 둘 다 기재 — 서로 0.0005° 이내로 일치)
 *   WD  = Wikidata P625 (항목 Q-id)
 *   OSM = OpenStreetMap 요소 중심점 (Overpass `out center` / Nominatim centroid)
 * 세종의 regionCode 는 'CN' 이다: REGIONS 17개에 세종 코드가 없고(스펙 고정 목록),
 * 이 컬럼의 용도가 시도 단위 집계뿐이라 2012년 분리 승격 전 소속(충남 연기군)에 귀속시켰다.
 * 세종을 독립 시도로 집계해야 하는 요구가 생기면 REGIONS 개정과 함께 바꾼다.
 */
export const PLACES = [
  // --- 출발지 ---
  // ICN: 인천국제공항 제1여객터미널 청사 중심 — OSM relation 3917466 (Nominatim centroid 37.4495715, 126.4521194)
  { code: "ICN", nameKo: "인천공항", nameEn: "Incheon Airport", kind: "airport", regionCode: "INC", lat: 37.4496, lng: 126.4521, sort: 1 },
  // SEL: 서울특별시청사 — WD Q623908 (37.56640556, 126.97782222) · OSM way 198561926 (37.5667, 126.9784)
  { code: "SEL", nameKo: "서울", nameEn: "Seoul", kind: "city", regionCode: "SEL", lat: 37.5664, lng: 126.9778, sort: 2 },

  // --- 도착지 (스펙 §13.2 순서) ---
  // BSN: 부산광역시청 — WD Q16097618 (35.179816, 129.075022) · OSM way 468977727 (35.1799, 129.0752)
  { code: "BSN", nameKo: "부산", nameEn: "Busan", kind: "city", regionCode: "BSN", lat: 35.1798, lng: 129.075, sort: 3 },
  // DGU: 대구광역시청 — WD Q16095354 (35.871333, 128.60175) · OSM node 1903901577 (35.8715, 128.6019)
  { code: "DGU", nameKo: "대구", nameEn: "Daegu", kind: "city", regionCode: "DGU", lat: 35.8713, lng: 128.6018, sort: 4 },
  // TYG: 통영시청 — OSM way 902158701 (34.8540927, 128.433259)
  { code: "TYG", nameKo: "통영", nameEn: "Tongyeong", kind: "city", regionCode: "GN", lat: 34.8541, lng: 128.4333, sort: 5 },
  // PHG: 포항시청 (시청로 1) — OSM way 469052482 (36.0189917, 129.3433779)
  { code: "PHG", nameKo: "포항", nameEn: "Pohang", kind: "city", regionCode: "GB", lat: 36.019, lng: 129.3434, sort: 6 },
  // JJU: 전주시청 — OSM way 36811470 (35.8245536, 127.1478069)
  { code: "JJU", nameKo: "전주", nameEn: "Jeonju", kind: "city", regionCode: "JB", lat: 35.8246, lng: 127.1478, sort: 7 },
  // GWJ: 광주광역시청 — WD Q12585108 (35.159611, 126.852353)
  { code: "GWJ", nameKo: "광주", nameEn: "Gwangju", kind: "city", regionCode: "GWJ", lat: 35.1596, lng: 126.8524, sort: 8 },
  // YSU: 여수시청 본청 (시청로 1) — OSM way 1347908410 (34.7605262, 127.6622572) · WD Q42125 여수시 (34.760689, 127.662163)
  { code: "YSU", nameKo: "여수", nameEn: "Yeosu", kind: "city", regionCode: "JN", lat: 34.7605, lng: 127.6623, sort: 9 },
  // HNM: 해남군청 — OSM way 1167420318 (34.5739262, 126.5995786) · OSM node 5424418656 (34.573952, 126.5995116)
  { code: "HNM", nameKo: "해남", nameEn: "Haenam", kind: "city", regionCode: "JN", lat: 34.5739, lng: 126.5996, sort: 10 },
  // DJN: 대전광역시청 — WD Q16095517 (36.350382, 127.384742) · OSM node 1904388026 (36.350442, 127.3847353)
  { code: "DJN", nameKo: "대전", nameEn: "Daejeon", kind: "city", regionCode: "DJN", lat: 36.3504, lng: 127.3847, sort: 11 },
  // SJG: 세종특별자치시청 — WD Q16097915 (36.480071, 127.289009) · OSM way 544441301 (36.4800775, 127.2889036)
  { code: "SJG", nameKo: "세종", nameEn: "Sejong", kind: "city", regionCode: "CN", lat: 36.4801, lng: 127.289, sort: 12 },
  // SCH: 속초시청 (중앙로 183) — OSM way 1306387140 (38.2073397, 128.5920234)
  { code: "SCH", nameKo: "속초", nameEn: "Sokcho", kind: "city", regionCode: "GW", lat: 38.2073, lng: 128.592, sort: 13 },
  // GNG: 강릉시청 — OSM node 11687596361 (37.7519368, 128.8758645) · OSM way 356865465 (37.7519299, 128.8758634)
  { code: "GNG", nameKo: "강릉", nameEn: "Gangneung", kind: "city", regionCode: "GW", lat: 37.7519, lng: 128.8759, sort: 14 },
  // TBK: 태백시청 — OSM way 641480313 (37.1640984, 128.9857632)
  { code: "TBK", nameKo: "태백", nameEn: "Taebaek", kind: "city", regionCode: "GW", lat: 37.1641, lng: 128.9858, sort: 15 },
  // HCN: 홍천군청 — OSM node 358896996 (37.6972227, 127.8887607)
  { code: "HCN", nameKo: "홍천", nameEn: "Hongcheon", kind: "city", regionCode: "GW", lat: 37.6972, lng: 127.8888, sort: 16 },
  // WJU: 원주시청 (시청로 1) — OSM node 358015312 (37.3419675, 127.9196252)
  { code: "WJU", nameKo: "원주", nameEn: "Wonju", kind: "city", regionCode: "GW", lat: 37.342, lng: 127.9196, sort: 17 },
] as const satisfies readonly Place[];

export type PlaceCode = (typeof PLACES)[number]["code"];

// =============================================================================
// SHOWCASE_ROUTE_SEED — 홈 대표 노선 16개 (스펙 §13.2 확정값, 사장님 제공)
// =============================================================================

export interface ShowcaseRouteSeed {
  readonly originCode: PlaceCode;
  readonly destinationCode: PlaceCode;
  /** 정적 표시값(원). 스펙 §13.2 리터럴 그대로 — 계산·변환·배율 금지. */
  readonly priceFrom: number;
  /** 강조 표시. 인천공항→서울 하나뿐. */
  readonly highlight: boolean;
  readonly sort: number;
}

/**
 * 스펙 §13.2: "인천공항→서울 40만 / 서울→부산 120만 / 서울→대구 100만 / 서울→통영 130만 /
 * 서울→포항 120만 / 서울→전주 80만 / 서울→광주 100만 / 서울→여수 120만 / 서울→해남 120만 /
 * 서울→대전 70만 / 서울→세종 70만 / 서울→속초 80만 / 서울→강릉 80만 / 서울→태백 90만 /
 * 서울→홍천 70만 / 서울→원주 70만" — 인천공항→서울만 강조.
 */
export const SHOWCASE_ROUTE_SEED: readonly ShowcaseRouteSeed[] = [
  { originCode: "ICN", destinationCode: "SEL", priceFrom: 400000, highlight: true, sort: 1 },
  { originCode: "SEL", destinationCode: "BSN", priceFrom: 1200000, highlight: false, sort: 2 },
  { originCode: "SEL", destinationCode: "DGU", priceFrom: 1000000, highlight: false, sort: 3 },
  { originCode: "SEL", destinationCode: "TYG", priceFrom: 1300000, highlight: false, sort: 4 },
  { originCode: "SEL", destinationCode: "PHG", priceFrom: 1200000, highlight: false, sort: 5 },
  { originCode: "SEL", destinationCode: "JJU", priceFrom: 800000, highlight: false, sort: 6 },
  { originCode: "SEL", destinationCode: "GWJ", priceFrom: 1000000, highlight: false, sort: 7 },
  { originCode: "SEL", destinationCode: "YSU", priceFrom: 1200000, highlight: false, sort: 8 },
  { originCode: "SEL", destinationCode: "HNM", priceFrom: 1200000, highlight: false, sort: 9 },
  { originCode: "SEL", destinationCode: "DJN", priceFrom: 700000, highlight: false, sort: 10 },
  { originCode: "SEL", destinationCode: "SJG", priceFrom: 700000, highlight: false, sort: 11 },
  { originCode: "SEL", destinationCode: "SCH", priceFrom: 800000, highlight: false, sort: 12 },
  { originCode: "SEL", destinationCode: "GNG", priceFrom: 800000, highlight: false, sort: 13 },
  { originCode: "SEL", destinationCode: "TBK", priceFrom: 900000, highlight: false, sort: 14 },
  { originCode: "SEL", destinationCode: "HCN", priceFrom: 700000, highlight: false, sort: 15 },
  { originCode: "SEL", destinationCode: "WJU", priceFrom: 700000, highlight: false, sort: 16 },
];
