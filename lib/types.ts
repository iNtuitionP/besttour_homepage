/**
 * 예약 접수 입력 zod 스키마 및 관련 타입.
 *
 * 절대 규칙: 가격 필드 없음. 이 파일은 가격 계산/추정과 무관하며, 접수
 * 입력값의 형태(shape)만 검증한다. 장소·여행구분은 lib/codes.ts의
 * canonical code(enum)로만 받는다 — 번역 문자열은 허용하지 않는다.
 */
import { z } from "zod";
import { PURPOSES, REGIONS, type PlaceKind } from "./codes";

const PHONE_KR_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;
const PHONE_INTL_PATTERN = /^\+[1-9]\d{6,14}$/;
const KST_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const ReservationInput = z
  .object({
    name: z.string().min(1).max(30),
    phone: z.string().regex(PHONE_KR_PATTERN),
    phoneIntl: z.string().regex(PHONE_INTL_PATTERN).optional(),
    email: z.string().email().optional(),
    vehicleSlug: z.enum(["bus45", "bus35", "limo28", "bus25", "bus16"]),
    purposeCode: z.enum(PURPOSES),
    originCode: z.enum(REGIONS),
    destinationCode: z.enum(REGIONS),
    waypointCodes: z.array(z.enum(REGIONS)).max(5).default([]),
    tripType: z.enum(["round", "oneway", "oneway_oneway"]),
    departAtLocal: z.string().regex(KST_LOCAL_PATTERN),
    returnAtLocal: z.string().regex(KST_LOCAL_PATTERN).optional(),
    busCount: z.number().int().min(1).max(20).default(1),
    passengers: z.number().int().min(1).max(900).optional(),
    contactMethod: z.string().optional(),
    paymentMethod: z.string().optional(),
    parkingIncluded: z.boolean().optional(),
    vatIncluded: z.boolean().optional(),
    message: z.string().max(1000).optional(),
    locale: z.enum(["ko", "en"]).default("ko"),
    turnstileToken: z.string(),
    // 허니팟: 사람 방문자에게는 보이지 않아야 하는 필드. 값이 채워지면(길이>0)
    // 봇으로 간주해 검증 단계에서 거부한다.
    website: z.string().max(0).optional(),
  })
  .refine((data) => data.locale !== "en" || Boolean(data.phone || data.phoneIntl), {
    message: "locale이 'en'이면 phone 또는 phoneIntl 중 하나가 필요합니다.",
    path: ["phoneIntl"],
  });

export type ReservationInput = z.infer<typeof ReservationInput>;

/** 홈 Top-5 예시 견적(showcase_routes) 표시용 타입. 가격 필드는 정적 표시값(null 가능)뿐. */
export interface ShowcaseRoute {
  id: number;
  originCode: string;
  destinationCode: string;
  priceFrom: number | null;
  highlight: boolean;
  /** 0001: `sort int` — NOT NULL 이 아니다. 정렬은 DB 가 하고(null 은 뒤) 여기서는 값만 나른다. */
  sort: number | null;
}

// =============================================================================
// 읽기 쿼리 계층(lib/queries/*) 반환 타입 — DB 행을 camelCase 로 옮긴 뷰. 컬럼을 버리지 않는다.
// =============================================================================

/**
 * places 행(0002). lib/codes.ts 의 `Place`(TS 카탈로그 상수 `PLACES` 용)와 이름·모양이 비슷하지만
 * 이쪽은 DB 에서 읽은 행이다 — 지도 좌표(svg_x/svg_y)·active 가 더 있고, code/regionCode 는
 * DB 가 제약 없는 text 라 리터럴 유니온이 아니다. kind 만 CHECK 제약이 있어 유니온을 유지한다.
 */
export interface Place {
  code: string;
  nameKo: string;
  nameEn: string;
  kind: PlaceKind;
  /** 시도 단위 집계용 — lib/codes.ts REGIONS 코드(DB 제약 없음). */
  regionCode: string;
  lat: number;
  lng: number;
  /** mockups/assets/kr-map.svg viewBox 0 0 524 560 좌표. */
  svgX: number;
  svgY: number;
  sort: number;
  active: boolean;
}

/** showcase 조인용 place 부분집합 — 지도 핀·라벨을 그리는 데 필요한 것만. */
export type PlacePin = Pick<Place, "code" | "nameKo" | "nameEn" | "kind" | "svgX" | "svgY">;

/** showcase_routes ⋈ places. 컴포넌트가 코드→이름 매핑을 다시 하지 않도록 양 끝 place 를 붙인다. */
export interface ShowcaseRouteView extends ShowcaseRoute {
  active: boolean;
  origin: PlacePin;
  destination: PlacePin;
}

/** vehicles 행(0001). 가격 컬럼 없음. */
export interface Vehicle {
  id: number;
  slug: string;
  nameKo: string;
  nameEn: string;
  capacity: number;
  sort: number;
  active: boolean;
}

/** notices 행(0001). */
export interface Notice {
  id: number;
  title: string;
  body: string;
  category: string;
  /** date 컬럼 → "YYYY-MM-DD". */
  publishedAt: string;
  active: boolean;
}

/** popups 행(0001). 노출 기간은 KST 달력 날짜로 해석한다(lib/queries/popups.ts). */
export interface Popup {
  id: number;
  title: string;
  body: string;
  imagePath: string | null;
  /** date 컬럼 → "YYYY-MM-DD". */
  startsAt: string;
  /** date 컬럼 → "YYYY-MM-DD" (포함). */
  endsAt: string;
  active: boolean;
  /** timestamptz → ISO 8601 문자열. */
  createdAt: string;
}

/** 방문자에게 공개되는 예약 상태 조회용 타입. 가격 필드 없음. */
export interface ReservationPublic {
  publicCode: string;
  status: "new" | "confirmed" | "done" | "cancelled";
  vehicleSlug: string;
  originCode: string;
  destinationCode: string;
  departAt: string;
}
