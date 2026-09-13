/**
 * 예약 접수 입력 zod 스키마 및 관련 타입.
 *
 * 절대 규칙: 가격 필드 없음. 이 파일은 가격 계산/추정과 무관하며, 접수
 * 입력값의 형태(shape)만 검증한다. 장소·여행구분은 lib/codes.ts의
 * canonical code(enum)로만 받는다 — 번역 문자열은 허용하지 않는다.
 */
import { z } from "zod";
import { LOCATION_CODES, PURPOSES, type LocationCode, type PlaceKind } from "./codes";
import { parseKst } from "./kst";

/** 국내 휴대전화(01x, 하이픈 선택). lib/reservations/phone.ts contactPhone() 이 +82 E.164 로 정규화한다. */
export const PHONE_KR_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;
/** 국제 E.164(+국가번호, 7~15자리). 해외 번호 전용 — 로케일과 무관하게 받는다(M6). */
export const PHONE_INTL_PATTERN = /^\+[1-9]\d{6,14}$/;
const KST_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * 장소 코드 = LOCATION_CODES(도시 PlaceCode ∪ 시도 RegionCode, 28개 — REVIEW-FIX M5).
 * 시도 17개만 받던 옛 enum 은 홈 대표 노선 16개 중 11개(통영·포항·전주·여수·해남·세종·속초·강릉·태백·홍천·원주)를
 * 접수에서 거부했다. zod 만 넓혔다 — DB 컬럼은 CHECK 없는 text 라 마이그레이션이 없다.
 */
const LocationCodeEnum = z.enum(LOCATION_CODES as [LocationCode, ...LocationCode[]]);

export const ReservationInput = z
  .object({
    name: z.string().min(1).max(30),
    // 연락처는 phone(국내) XOR phoneIntl(해외 E.164) — 정확히 하나(아래 superRefine). 로케일로 강제하지 않는다:
    // 한국 SIM 을 쓰는 외국인은 phone, 해외 번호는 phoneIntl. 빈 문자열은 "없음"이 아니라 형식 위반이다(폼은 빈 칸을 빼서 보낸다).
    phone: z.string().regex(PHONE_KR_PATTERN).optional(),
    phoneIntl: z.string().regex(PHONE_INTL_PATTERN).optional(),
    email: z.string().email().optional(),
    vehicleSlug: z.enum(["bus45", "bus35", "limo28", "bus25", "bus16"]),
    purposeCode: z.enum(PURPOSES),
    originCode: LocationCodeEnum,
    destinationCode: LocationCodeEnum,
    waypointCodes: z.array(LocationCodeEnum).max(5).default([]),
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
    // 동의 (ADR-6 · 0003). 필수 동의는 literal(true) — false·누락·"true" 문자열이면 파싱 자체가 실패한다.
    // 사전 선택 금지는 UI(P3) 책임. 동의 시각·방침 버전은 서버가 lib/reservations/consent.ts consentFields() 로 찍는다.
    privacyConsent: z.literal(true),
    marketingConsent: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    // REVIEW-FIX M6: 예전 refine(locale 이 en 일 때만 phone||phoneIntl)은 phone 이 필수라 절대 거짓이 될 수 없었다(죽은 코드).
    if (Boolean(data.phone) === Boolean(data.phoneIntl)) {
      ctx.addIssue({
        code: "custom",
        message: "phone(국내 휴대전화) 또는 phoneIntl(국제 E.164) 중 정확히 하나가 필요합니다.",
        path: ["phone"],
      });
    }

    // P3-3-FIX M1: 운행 일시 규칙 3개를 zod 단계로 올린다. 전에는 lib/reservations/create.ts scheduleColumns 의 throw 만 잡아
    // 사용자에게 `server`(일시적 오류 문구)가 나가고 시도마다 error 스택 로그가 남았다 — 사람이 흔히 내는 입력(왕복인데 귀가 비움, 귀가 ≤ 출발)이다.
    // 여기서 잡으면 `validation` + fieldErrors.returnAtLocal 로 내려간다. create.ts 의 throw 는 방어선으로 그대로 둔다(0001·0006 CHECK 와 같은 결과).
    // message 의 토큰(returnAtLocal · 출발 · round_trip_return_ck)은 tests/reservation-create.test.ts 가 재검증 throw 를 정규식으로 잠근 것과
    // 맞춘 것이다 — createReservation 은 step 0 에서 safeParse 를 다시 돌리고 issue 문자열을 담아 throw 하므로, message 를 바꾸면 그쪽이 깨진다.
    // 규칙 0 (컨트롤러 결정 2026-09-13): 형식(regex)은 통과했지만 달력에 없는 일시(2026-02-30T08:00 · …T24:00 · 비윤년 02-29)는 그 필드에 issue.
    // 전에는 이 값이 zod 를 지나 create.ts:113 의 parseKst 에서 throw → `server`. regex 가 이미 실패한 값에는 두 번째 issue 를 내지 않는다.
    // `<input type="datetime-local">` 은 이런 값을 만들지 않으므로 사람 경로가 아니라 조작 요청이 대상이다 — 그래도 500·server 가 아니라 validation.
    const departAt = kstInstant(data.departAtLocal);
    if (departAt.state === "not-a-date") {
      ctx.addIssue({ code: "custom", message: "존재하지 않는 일시입니다 — 달력에 없는 날짜이거나 시·분 범위 밖 (departAtLocal)", path: ["departAtLocal"] });
    }
    const returnAt = data.returnAtLocal === undefined ? undefined : kstInstant(data.returnAtLocal);
    if (returnAt?.state === "not-a-date") {
      ctx.addIssue({ code: "custom", message: "존재하지 않는 일시입니다 — 달력에 없는 날짜이거나 시·분 범위 밖 (returnAtLocal)", path: ["returnAtLocal"] });
    }

    if (data.tripType === "round" && data.returnAtLocal === undefined) {
      ctx.addIssue({ code: "custom", message: "round trip requires returnAtLocal", path: ["returnAtLocal"] });
    }
    if (data.tripType === "oneway" && data.returnAtLocal !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "oneway 에는 returnAtLocal 을 보낼 수 없습니다 (0006 reservations_round_trip_return_ck — oneway 의 return_at 은 null)",
        path: ["returnAtLocal"],
      });
    }
    // 규칙 2: 문자열 비교가 아니라 parseKst 인스턴트 비교. 둘 중 하나라도 인스턴트가 없으면(regex 실패 또는 규칙 0) 건너뛴다 —
    // 그 필드에는 이미 issue 가 있으므로 이중 issue 를 만들지 않는다.
    if (departAt.state === "ok" && returnAt?.state === "ok" && returnAt.ms <= departAt.ms) {
      ctx.addIssue({
        code: "custom",
        message: "귀가 일시는 출발 일시 이후여야 합니다 (0001 return_at > depart_at)",
        path: ["returnAtLocal"],
      });
    }
  });

/**
 * KST 벽시계 문자열 → 인스턴트(ms) 3상태.
 *   ok          — 형식·달력 모두 유효
 *   bad-format  — regex 불일치. zod 의 regex 가 이미 issue 를 냈으므로 superRefine 은 아무것도 더하지 않는다
 *   not-a-date  — regex 는 통과했으나 parseKst 가 거부(달력에 없는 날짜, 시 > 23, 분 > 59). superRefine 규칙 0 이 issue 를 낸다
 */
function kstInstant(local: string): { state: "ok"; ms: number } | { state: "bad-format" } | { state: "not-a-date" } {
  if (!KST_LOCAL_PATTERN.test(local)) return { state: "bad-format" };
  try {
    return { state: "ok", ms: parseKst(local).getTime() };
  } catch {
    return { state: "not-a-date" };
  }
}

export type ReservationInput = z.infer<typeof ReservationInput>;

/**
 * 0003_consent.sql 의 동의 기록 컬럼 4개 — lib/reservations/consent.ts consentFields() 가 만든다.
 * timestamptz 값은 ISO 8601 UTC 인스턴트 문자열. DB 에 default 가 없으므로 insert 는 이 4개를 반드시 포함한다.
 */
export interface ReservationConsentColumns {
  /** 필수 동의 시각(서버 수신 인스턴트). */
  privacy_consent_at: string;
  /** 동의 당시 방침 버전 (consent.ts PRIVACY_POLICY_VERSION, 'YYYY-MM-DD'). */
  privacy_policy_version: string;
  /** 선택 동의(광고성 정보 수신) 시각. null = 미동의. */
  marketing_consent_at: string | null;
  /** 파기 예정 시각 = 접수 시각 + 원장 보유기간. P1-5 배치가 읽는다. */
  retention_until: string;
}

/**
 * reservations insert 페이로드 — 서비스 롤 서버 코드(P3 접수 액션) 전용. snake_case = 0001·0003 컬럼명.
 * DB 가 채우는 id·created_at·status 와 admin 이 채우는 confirmed_at·admin_memo 는 없다.
 * 운행 일시(depart_at·return_at)는 lib/kst.ts parseKst 로 KST 벽시계를 해석한 인스턴트의 ISO 문자열이다.
 */
export interface ReservationInsert extends ReservationConsentColumns {
  public_code: string;
  name: string;
  /** 정규화된 연락처 하나 — lib/reservations/phone.ts contactPhone(input).e164 (국내 010… 도 +82 E.164 로). */
  phone: string;
  email?: string | null;
  vehicle_slug: ReservationInput["vehicleSlug"];
  purpose_code: string;
  origin_code: string;
  destination_code: string;
  waypoint_codes: string[];
  trip_type: ReservationInput["tripType"];
  depart_at: string;
  /** 0001 제약: trip_type = 'round' 일 때만 not null. */
  return_at: string | null;
  nights: number;
  bus_count: number;
  passengers?: number | null;
  contact_method?: string | null;
  payment_method?: string | null;
  parking_included?: boolean | null;
  vat_included?: boolean | null;
  message?: string | null;
  locale: ReservationInput["locale"];
}

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

/**
 * gallery 행(0001 + 0008). imagePath 는 저장 경로 그대로 — URL 해석은 표시 계층(components/home/image-url.ts) 몫.
 *
 * 0008 이 더한 세 필드는 **선택**이다: 기존 getGallery(홈·목록 페이지)는 0001 의 5컬럼만 읽으므로 그 결과에는
 * 키 자체가 없고, getGalleryPage 가 읽은 결과에만 실린다(값이 null 이어도 키는 있다).
 * bytes·originalPath 는 여기 없다 — 사용량·비공개 버킷 경로는 관리자 전용 정보이고, 공개 읽기 타입에 두면
 * select 화이트리스트에 섞여 들어갈 여지가 생긴다(tests/gallery-albums.test.ts §6 이 컴파일 타임에 막는다).
 */
export interface GalleryItem {
  id: number;
  imagePath: string;
  caption: string | null;
  sort: number;
  active: boolean;
  /** 0008. null = 미분류. */
  albumId?: number | null;
  /** 0008. 레이아웃 시프트(CLS) 방지용 — 업로드 전 행은 null. */
  width?: number | null;
  height?: number | null;
}

/** gallery_albums 행(0008). slug 는 URL 세그먼트(/gallery/<slug>)로 그대로 쓰인다. */
export interface GalleryAlbum {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  sort: number;
  active: boolean;
  /** timestamptz → ISO 8601 문자열. */
  createdAt: string;
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

// =============================================================================
// 통지 아웃박스 (0005_outbox.sql · lib/notify/outbox.ts · ADR-7). 이 블록은 P1-4 가 파일 끝에 덧붙였다.
// =============================================================================

/** notifications_log.event (0001 CHECK). */
export type NotifyEvent = "created" | "confirmed";
/** notifications_log.channel (0005 CHECK — email 은 사장님 번호 미설정 시 폴백 메일). */
export type NotifyChannel = "sms" | "alimtalk" | "email";
/** notifications_log.status (0005 CHECK). pending = 아직 보낼 것(백오프 대기 포함) · sent · failed = 종착. */
export type OutboxStatus = "pending" | "sent" | "failed";

/**
 * enqueue 에 넘기는 새 아웃박스 행. `to` 는 DB 의 to_phone 컬럼에 저장된다(email 채널이면 메일 주소).
 * `template` 은 문안이 아니라 템플릿 키(예: 'created.owner.sms') — 문안은 P4-3 이 키로 찾는다.
 */
export interface NewOutboxRow {
  reservation_id: string;
  event: NotifyEvent;
  channel: NotifyChannel;
  to: string;
  template: string;
}

/** claim 이 돌려주는 아웃박스 행 — 발송기(P4)가 보고 mark 로 되돌린다. timestamptz 는 ISO 문자열. */
export interface OutboxRow extends NewOutboxRow {
  id: number;
  status: OutboxStatus;
  /** claim 된 횟수(= 발송 시도 횟수). */
  attempts: number;
  last_error: string | null;
  /** 이 시각 이후에만 claim 대상. 실패 시 백오프, claim 시 lease. */
  next_attempt_at: string;
  updated_at: string;
}

// =============================================================================
// 접수 결과 (lib/reservations/create.ts · P3-2 · ADR-4). 이 블록은 P3-2 가 파일 끝에 덧붙였다.
// =============================================================================

/** createReservation 의 반환. 예약 행이 있어야만 돌아온다(insert 실패는 throw). */
export interface CreateReservationResult {
  /** reservations.id (uuid). */
  reservationId: string;
  /** 방문자에게 보여 주는 비순차 코드(8자). 예약확인(P6-3a)은 이것 + 휴대폰 뒷4자리로 조회한다. */
  publicCode: string;
  /** 통지 아웃박스에 계획한 행이 전부 들어갔는가. false = 예약은 저장됐으나 통지 기록이 없거나 모자란다(구조화 로그 남김). */
  notifyQueued: boolean;
  /** 생략·실패 사유(사장님 연락처 없음, enqueue 실패 등). 빈 배열이 정상. 래퍼가 로그로 남긴다. */
  warnings: string[];
}
