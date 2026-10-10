/**
 * 예약 접수 입력 zod 스키마 및 관련 타입.
 *
 * 절대 규칙: 가격 필드 없음. 이 파일은 가격 계산/추정과 무관하며, 접수
 * 입력값의 형태(shape)만 검증한다. 장소는 lib/codes.ts의
 * canonical code(enum)로만 받는다 — 번역 문자열은 허용하지 않는다.
 */
import { z } from "zod";
import { LOCATION_CODES, type LocationCode, type PlaceKind } from "./codes";
import { toKstDateString } from "./kst";

/** 국내 휴대전화(01x, 하이픈 선택). lib/reservations/phone.ts contactPhone() 이 +82 E.164 로 정규화한다. */
export const PHONE_KR_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;
/** 국제 E.164(+국가번호, 7~15자리). 해외 번호 전용 — 로케일과 무관하게 받는다(M6). */
export const PHONE_INTL_PATTERN = /^\+[1-9]\d{6,14}$/;
/** 달력 날짜 `YYYY-MM-DD` (`<input type="date">` 값 그대로). 달력에 실제로 있는지는 superRefine 이 따로 본다. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 장소 코드 = LOCATION_CODES(도시 PlaceCode ∪ 시도 RegionCode, 28개 — REVIEW-FIX M5).
 * 시도 17개만 받던 옛 enum 은 홈 대표 노선 16개 중 11개(통영·포항·전주·여수·해남·세종·속초·강릉·태백·홍천·원주)를
 * 접수에서 거부했다. zod 만 넓혔다 — DB 컬럼은 CHECK 없는 text 라 마이그레이션이 없다.
 */
const LocationCodeEnum = z.enum(LOCATION_CODES as [LocationCode, ...LocationCode[]]);

/** 간편 견적의 이름 길이 상한 — 0001 CHECK `char_length(name) between 1 and 30` 과 같다. */
export const NAME_MAX_LENGTH = 30;
/** 탑승 인원 범위 — 0001 CHECK `passengers between 1 and 900` 과 같다. 간편 견적은 **필수**다. */
export const PASSENGERS_RANGE = { min: 1, max: 900 } as const;

/**
 * 간편 견적 입력의 **모양** (P3-8 — 공개 접수 경로는 이것 하나다). 날짜 규칙은 "오늘"이 필요해 아래 quickReservationSchema(now) 가 더한다.
 *
 * 받는 것: 이름 · 연락처(phone XOR phoneIntl) · 출발지 · 도착지 · 출발일 · 도착일 · 인원 · 로케일 · 동의 2종 + guard 필드.
 * 받지 않는 것(사장님이 전화로 확인): 차종 · 여행 목적 · 출발 시각 · 왕복 구분 · 대수 — 그리고 메일·경유지·요청사항.
 * 선택 동의(광고성 정보 수신)는 받지 않는다 — 서버가 marketing_consent_at 을 null 로 둔다(원장 고지와 같은 범위).
 * 계약 밖 키는 zod 가 버린다(strip) — 옛 위저드 필드(vehicleSlug 등)를 보내도 저장 경로로 가지 않는다.
 */
export const QuickReservationShape = z.object({
  name: z.string().min(1).max(NAME_MAX_LENGTH),
  // 연락처는 phone(국내) XOR phoneIntl(해외 E.164) — 정확히 하나(아래 superRefine). 로케일로 강제하지 않는다:
  // 한국 SIM 을 쓰는 외국인은 phone, 해외 번호는 phoneIntl. 빈 문자열은 "없음"이 아니라 형식 위반이다(폼은 빈 칸을 빼서 보낸다).
  phone: z.string().regex(PHONE_KR_PATTERN).optional(),
  phoneIntl: z.string().regex(PHONE_INTL_PATTERN).optional(),
  originCode: LocationCodeEnum,
  destinationCode: LocationCodeEnum,
  departDate: z.string().regex(ISO_DATE_PATTERN),
  returnDate: z.string().regex(ISO_DATE_PATTERN),
  passengers: z.number().int().min(PASSENGERS_RANGE.min).max(PASSENGERS_RANGE.max),
  locale: z.enum(["ko", "en"]).default("ko"),
  turnstileToken: z.string(),
  // 허니팟: 사람 방문자에게는 보이지 않아야 하는 필드. 값이 채워지면(길이>0) 봇으로 간주한다(guard 가 zod 전에 떼어 조용한 성공으로 돌린다).
  website: z.string().max(0).optional(),
  // 동의 (ADR-6 · 0003). 필수 동의는 literal(true) — false·누락·"true" 문자열이면 파싱 자체가 실패한다.
  // 사전 선택 금지는 UI 책임. 동의 시각·방침 버전은 서버가 lib/reservations/consent.ts consentFields() 로 찍는다.
  privacyConsent: z.literal(true),
  // 청약철회 제한 확인 (P1-7 · 전자상거래법 §17⑥ · 0021). 필수 — 체크박스만 막으면 공개 POST 로 우회되므로 서버가 거부한다.
  withdrawalConsent: z.literal(true),
});

export type QuickReservationInput = z.infer<typeof QuickReservationShape>;

/** `YYYY-MM-DD` 가 달력에 실제로 있는가(02-30 · 비윤년 02-29 거부). 서버 TZ 와 무관(UTC 로만 계산). */
export function isCalendarDate(iso: string): boolean {
  if (!ISO_DATE_PATTERN.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const rt = new Date(Date.UTC(y, m - 1, d));
  return rt.getUTCFullYear() === y && rt.getUTCMonth() === m - 1 && rt.getUTCDate() === d;
}

/**
 * 간편 견적 스키마 — `now` 는 서버 시계(guard 의 deps.now · create 의 deps.now). 날짜 규칙:
 *   규칙 0  형식(regex)은 맞지만 달력에 없는 날짜 → 그 필드에 issue(regex 가 이미 실패했으면 더하지 않는다).
 *   규칙 1  출발일 ≥ **KST 오늘**(now 의 KST 달력 날짜). 옛 위저드의 날짜 하한(`min = toKstDateString(new Date())`)을 서버로 올렸다 —
 *           전에는 브라우저 min 속성뿐이라 공개 POST 로 과거 날짜가 들어왔다. 상한은 옛 위저드에도 없었다(보고서 §판단).
 *   규칙 2  도착일 ≥ 출발일(같은 날 = 당일). 문자열 비교는 같은 자릿수 형식이라 달력 순서와 같다.
 * 비교는 둘 다 달력에 있을 때만 한다 — 이미 issue 가 있는 필드에 두 번째 issue 를 만들지 않는다.
 */
export function quickReservationSchema(now: Date) {
  return QuickReservationShape.superRefine((data, ctx) => {
    if (Boolean(data.phone) === Boolean(data.phoneIntl)) {
      ctx.addIssue({
        code: "custom",
        message: "phone(국내 휴대전화) 또는 phoneIntl(국제 E.164) 중 정확히 하나가 필요합니다.",
        path: ["phone"],
      });
    }

    const departOk = isCalendarDate(data.departDate);
    const returnOk = isCalendarDate(data.returnDate);
    if (ISO_DATE_PATTERN.test(data.departDate) && !departOk) {
      ctx.addIssue({ code: "custom", message: "달력에 없는 날짜입니다 (departDate)", path: ["departDate"] });
    }
    if (ISO_DATE_PATTERN.test(data.returnDate) && !returnOk) {
      ctx.addIssue({ code: "custom", message: "달력에 없는 날짜입니다 (returnDate)", path: ["returnDate"] });
    }
    if (departOk && data.departDate < toKstDateString(now)) {
      ctx.addIssue({ code: "custom", message: "출발일은 오늘(KST) 이후여야 합니다 (departDate)", path: ["departDate"] });
    }
    if (departOk && returnOk && data.returnDate < data.departDate) {
      ctx.addIssue({ code: "custom", message: "도착일은 출발일과 같거나 뒤여야 합니다 (returnDate)", path: ["returnDate"] });
    }
  });
}

/**
 * 동의 기록 컬럼 — 0003_consent.sql 의 4개 + 0021_withdrawal_consent.sql 의 1개. lib/reservations/consent.ts consentFields() 가 만든다.
 * timestamptz 값은 ISO 8601 UTC 인스턴트 문자열. DB 에 default 가 없으므로 insert 는 이 5개를 반드시 포함한다
 * (0021 이후 접수는 withdrawal_consent_at 이 없으면 reservations_withdrawal_consent_required 가 거부한다).
 */
export interface ReservationConsentColumns {
  /** 청약철회 제한 확인 시각(서버 수신 인스턴트 — 0021). 필수 동의와 같은 인스턴트다. */
  withdrawal_consent_at: string;
  /** 필수 동의 시각(서버 수신 인스턴트). */
  privacy_consent_at: string;
  /** 동의 당시 방침 버전 (consent.ts PRIVACY_POLICY_VERSION, 'YYYY-MM-DD'). */
  privacy_policy_version: string;
  /** 선택 동의(광고성 정보 수신) 시각. null = 미동의. */
  marketing_consent_at: string | null;
  /** 파기 예정 시각 = 접수 시각 + 원장 보유기간. P1-5 배치가 읽는다. */
  retention_until: string;
}

/** 0023 reservations.intake — 접수 경로. 기본값이 없어 insert 가 반드시 적는다. */
export const RESERVATION_INTAKES = ["wizard", "quick"] as const;
export type ReservationIntake = (typeof RESERVATION_INTAKES)[number];

/**
 * reservations insert 페이로드 — 서비스 롤 서버 코드(공개 접수 액션) 전용. snake_case = 0001·0003·0021·0023 컬럼명.
 * DB 가 채우는 id·created_at·status 와 admin 이 채우는 confirmed_at·admin_memo 는 없다.
 *
 * 공개 접수는 **간편 견적 하나**다(P3-8) — 그래서 이 타입은 간편 행의 모양으로 좁혀져 있다:
 * intake 는 'quick' 리터럴, 손님이 고르지 않은 차종·목적·대수·왕복 구분은 **null 리터럴**이다(지어내지 않는다 — 0023 헤더).
 * 날짜만 받으므로 depart_at = 출발일 00:00 KST 의 인스턴트, return_at = 도착일 00:00 KST(같은 날이면 null)다.
 * 이메일·경유지·요청사항·연락/결제 방법·주차·부가세 칸은 보내지 않는다(DB 기본값·null 그대로 — 받은 적 없는 값이다).
 */
export interface ReservationInsert extends ReservationConsentColumns {
  public_code: string;
  intake: "quick";
  name: string;
  /** 정규화된 연락처 하나 — lib/reservations/phone.ts contactPhone(input).e164 (국내 010… 도 +82 E.164 로). */
  phone: string;
  vehicle_slug: null;
  purpose_code: null;
  trip_type: null;
  bus_count: null;
  origin_code: string;
  destination_code: string;
  /** 출발일 00:00 KST 의 UTC 인스턴트(ISO). 시각은 의미가 없다 — 표시면은 intake='quick' 이면 날짜만 보인다. */
  depart_at: string;
  /** 도착일 00:00 KST(도착일이 출발일보다 뒤일 때만). 같은 날이면 null. */
  return_at: string | null;
  /** 도착일 − 출발일(KST 달력 일수). */
  nights: number;
  passengers: number;
  locale: QuickReservationInput["locale"];
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
  /** 간편 접수(0023 intake='quick')는 차종을 받지 않는다 — null. */
  vehicleSlug: string | null;
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
  /**
   * 비순차 코드(8자) — 관리자 화면·발송 기록용 내부 식별자. T2-5(결정 5)부터 손님 화면·손님 문자에는 보이지 않는다
   * (예약확인은 휴대폰 번호 + 예약자 이름). 서버액션 결과(submitResult)에는 남아 있으나 완료 화면이 표시하지 않는다.
   */
  publicCode: string;
  /** 통지 아웃박스에 계획한 행이 전부 들어갔는가. false = 예약은 저장됐으나 통지 기록이 없거나 모자란다(구조화 로그 남김). */
  notifyQueued: boolean;
  /** 생략·실패 사유(사장님 연락처 없음, enqueue 실패 등). 빈 배열이 정상. 래퍼가 로그로 남긴다. */
  warnings: string[];
}
