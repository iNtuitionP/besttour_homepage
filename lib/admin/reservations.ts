/**
 * 관리자 예약 읽기 — SSR 세션 + RLS (플랜 v4 P5-3 · ADR-2·ADR-3).
 *
 * **서비스 롤을 쓰지 않는다.** 조회는 `createSsrClient(cookies())`(anon 키 + 관리자 쿠키 세션)로 하고, 0009 의
 * `reservations_admin_select` 정책이 DB 에서 한 번 더 거른다 — requireAdmin() 을 어느 화면에서 빠뜨려도 DB 가 0행을 준다.
 * 서비스 롤로 읽으면 방어선이 애플리케이션 호출 하나로 줄어든다(ADR-2). `check:admin` 게이트가 이 규약을 기계로 지킨다.
 *
 * 캐시를 모른다(ADR-3). 그리고 **관리자 화면은 캐시하지 않는다** — 호출부가 unstable_cache 로 감싸지 않는다.
 * 고객 개인정보가 실린 응답을 태그 캐시에 올리면 무효화 실수 하나가 그대로 노출이 된다.
 *
 * 마스킹하지 않는다: 사장님이 전화를 걸어야 한다. 대신 상세에 `privacy_consent_at`·`retention_until` 을 함께 읽어
 * "이 정보가 언제 파기되는지" 를 화면이 보여 줄 수 있게 한다(P1-5 파기 배치와 같은 값).
 *
 * select 는 화이트리스트다(`select('*')` 금지). 목록에는 상세용 컬럼(메일·메시지·메모·동의 기록)을 아예 읽지 않는다 —
 * 화면에 안 그리는 것과 메모리에 안 올리는 것은 다르다(P3-5 리뷰 N-2: dev 는 서버 컴포넌트 props 를 HTML 에 싣는다).
 *
 * 페이지네이션은 limit + 1 (count 쿼리 금지 — lib/queries/gallery.ts getGalleryPage 선례).
 */
import "server-only";

import { cookies } from "next/headers";

import { RESERVATION_STATUSES, type ReservationStatus } from "../reservation-check/view";
import { createSsrClient } from "../supabase/ssr";

export { RESERVATION_STATUSES, type ReservationStatus } from "../reservation-check/view";

/** 세션(쿠키) 클라이언트. 서비스 롤 클라이언트는 이 파일에 들어오지 않는다. */
export type AdminDbClient = ReturnType<typeof createSsrClient>;

const TABLE = "reservations";

export const DEFAULT_ADMIN_PAGE_SIZE = 20;
export const MAX_ADMIN_PAGE_SIZE = 100;

/**
 * 옛 6단계 위저드가 받던 연락·결제 방법 코드(P3-4 components/quote/options.ts — P3-8 에서 위저드와 함께 지웠다).
 * 위저드 접수분(intake='wizard')의 상세 화면이 라벨(admin.labels.contact·payment)을 찾을 때만 쓴다. 간편 접수는 이 칸이 null 이다.
 */
export const LEGACY_CONTACT_METHODS = ["mobile", "phone", "fax"] as const;
export const LEGACY_PAYMENT_METHODS = ["cash", "card", "tax_invoice"] as const;

/** 목록 필터 — `all` 은 필터 없음. */
export const STATUS_FILTERS = ["all", ...RESERVATION_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface ReservationListRow {
  id: string;
  public_code: string;
  status: ReservationStatus;
  /** 0023 — 접수 경로. quick(홈 간편 견적)은 차종·목적·대수·왕복 구분이 null 이고 운행일의 시각(00:00)은 자리값이다. */
  intake: "wizard" | "quick";
  name: string;
  phone: string;
  /** 간편 접수는 null — 사장님이 전화로 확인한다(0023). */
  vehicle_slug: string | null;
  origin_code: string;
  destination_code: string;
  trip_type: string | null;
  depart_at: string;
  return_at: string | null;
  /** 간편 접수는 null(0023). */
  bus_count: number | null;
  passengers: number | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface ReservationDetailRow extends ReservationListRow {
  email: string | null;
  /** 간편 접수는 null(0023). */
  purpose_code: string | null;
  waypoint_codes: unknown;
  contact_method: string | null;
  payment_method: string | null;
  parking_included: boolean | null;
  vat_included: boolean | null;
  message: string | null;
  admin_memo: string | null;
  privacy_consent_at: string;
  marketing_consent_at: string | null;
  retention_until: string;
  /** 청약철회 제한 확인 시각(0021 · P1-7). 0021 적용 순간에 있던 접수는 null — 화면은 "기록 없음(동의 기록 도입 전 접수)" 으로 보여 준다. */
  withdrawal_consent_at: string | null;
  /** 0021 적용 순간에 이미 있던 접수(동의 기록 도입 전) — 적용 때 한 번 정해지고 트리거가 바꾸지 못하게 한다(P1-7 R2). */
  withdrawal_consent_legacy: boolean;
}

/** 목록 화이트리스트 — 행을 식별하고 전화를 걸고 상태를 판단하는 데 필요한 것만. */
export const RESERVATION_LIST_COLUMNS = [
  "id",
  "public_code",
  "status",
  "intake",
  "name",
  "phone",
  "vehicle_slug",
  "origin_code",
  "destination_code",
  "trip_type",
  "depart_at",
  "return_at",
  "bus_count",
  "passengers",
  "created_at",
  "confirmed_at",
] as const satisfies readonly (keyof ReservationListRow)[];

/** 상세에서만 읽는 컬럼 — 목록에는 올라오지 않는다. */
export const RESERVATION_DETAIL_ONLY_COLUMNS = [
  "email",
  "purpose_code",
  "waypoint_codes",
  "contact_method",
  "payment_method",
  "parking_included",
  "vat_included",
  "message",
  "admin_memo",
  "privacy_consent_at",
  "marketing_consent_at",
  "retention_until",
  "withdrawal_consent_at",
  "withdrawal_consent_legacy",
] as const satisfies readonly (keyof ReservationDetailRow)[];

export const RESERVATION_DETAIL_COLUMNS = [...RESERVATION_LIST_COLUMNS, ...RESERVATION_DETAIL_ONLY_COLUMNS] as const;

/** PostgREST select 문자열 = 화이트리스트 join. 임베드·별칭 없음 — 다른 컬럼이 붙을 경로가 없다. */
export const RESERVATION_LIST_SELECT: string = RESERVATION_LIST_COLUMNS.join(",");
export const RESERVATION_DETAIL_SELECT: string = RESERVATION_DETAIL_COLUMNS.join(",");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 경로·서버액션 인자로 들어온 문자열이 uuid 인가. 아니면 DB 를 부르지 않는다. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * URL 의 `?status=` → 필터. 파서는 관대하다(모르는 값이면 전체) — 주소창에 오타가 났다고 관리자 화면이 500 이 되면 안 된다.
 * 쿼리 함수는 반대로 엄격하다: 아래 listReservations 는 목록 밖의 값을 받으면 DB 를 부르지 않고 throw 한다.
 */
export function parseStatusFilter(raw: unknown): StatusFilter {
  return typeof raw === "string" && (STATUS_FILTERS as readonly string[]).includes(raw) ? (raw as StatusFilter) : "all";
}

/** URL 의 `?cursor=` → offset. 정수가 아니거나 음수면 처음부터. */
export function parseCursor(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export interface ReservationListParams {
  status?: StatusFilter;
  /** offset. 0 이상의 정수. */
  cursor?: number;
  limit?: number;
}

export interface ReservationListPage {
  items: ReservationListRow[];
  hasMore: boolean;
  /** 다음 페이지의 cursor. 없으면 null — 화면이 "다음" 버튼을 그릴지 판단한다. */
  nextCursor: number | null;
}

const EMPTY_PAGE: ReservationListPage = { items: [], hasMore: false, nextCursor: null };

/**
 * PostgREST 는 행 수를 넘긴 Range 요청에 416 + PGRST103 을 준다. 오래된 cursor 로 다시 들어온 것은 오류가 아니라 빈 페이지다
 * (lib/queries/gallery.ts 와 같은 처리).
 */
function isRangeNotSatisfiable(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === "PGRST103" || /range not satisfiable/i.test(error.message ?? "");
}

async function sessionClient(): Promise<AdminDbClient> {
  return createSsrClient(await cookies());
}

/** 오류 문구에 행 내용을 싣지 않는다 — code·message 만(details·hint 제외, lib/reservation-check/db.ts 와 같은 규약). */
function fail(op: string, error: { code?: string | null; message: string }): never {
  throw new Error(`admin.${op}: [${error.code ?? "?"}] ${error.message}`);
}

/**
 * 목록 한 페이지 — 최신순(created_at desc, 동률은 id desc), `cursor` 부터 `limit` 건.
 * hasMore 는 limit + 1 건을 읽어 판정한다(count 쿼리 금지 — RLS 표의 count 는 비용만 들고 보여 줄 데도 없다).
 * `client` 는 테스트 주입용 — 운영 호출부는 넘기지 않는다.
 */
export async function listReservations(params: ReservationListParams, client?: AdminDbClient): Promise<ReservationListPage> {
  const { status = "all", cursor = 0, limit = DEFAULT_ADMIN_PAGE_SIZE } = params;
  if (!(STATUS_FILTERS as readonly unknown[]).includes(status)) {
    throw new Error("listReservations: 알 수 없는 status 필터다");
  }
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new Error("listReservations: cursor 는 0 이상의 정수여야 한다");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ADMIN_PAGE_SIZE) {
    throw new Error(`listReservations: limit 은 1 이상 ${MAX_ADMIN_PAGE_SIZE} 이하의 정수여야 한다`);
  }

  const db = client ?? (await sessionClient());
  let query = db.from(TABLE).select(RESERVATION_LIST_SELECT);
  if (status !== "all") query = query.eq("status", status);

  // range 는 양끝 포함이다 — (cursor, cursor + limit) 은 limit + 1 건.
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(cursor, cursor + limit)
    .overrideTypes<ReservationListRow[], { merge: false }>();

  if (error) {
    if (isRangeNotSatisfiable(error)) return EMPTY_PAGE;
    fail("listReservations", error);
  }
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit), hasMore, nextCursor: hasMore ? cursor + limit : null };
}

/**
 * 새 접수 건수 — `status='new'` 인 접수 전부(P5-20). **배지 정의는 이것 하나다**: 메뉴(사이드바·탭 바)가 이 값을 쓰고,
 * P5-21 의 홈 카드·목록 탭도 같은 함수를 부른다(같은 수를 화면마다 다르게 세지 않는다 — 제안서 ④ 원칙 2).
 * 0022 의 backlog.new_total 과 같은 정의다(기간 무관 · status='new').
 *
 * head 집계라 행은 오지 않는다(개인정보 0 — 숫자 하나). 위의 "count 쿼리 금지" 는 페이지 넘김 판정 얘기다(limit + 1 로 충분하다).
 * 세션 클라이언트 + 0009 RLS 로 센다(서비스 롤 금지 — ADR-2). 오류나 빈 count 를 0 으로 갈음하지 않고 throw 한다 —
 * "새 접수 없음" 과 "모름" 은 다르다. 부르는 쪽(레이아웃)이 모름을 배지 숨김으로 다룬다.
 */
export async function countNewReservations(client?: AdminDbClient): Promise<number> {
  const db = client ?? (await sessionClient());
  const { count, error } = await db.from(TABLE).select("id", { count: "exact", head: true }).eq("status", "new");
  if (error) fail("countNewReservations", error);
  if (typeof count !== "number") throw new Error("admin.countNewReservations: count 를 받지 못했다 — 0 으로 갈음하지 않는다");
  return count;
}

/** 상세 한 건. 없으면 null. uuid 가 아니면 DB 를 부르지 않고 throw 한다(경로에 들어온 쓰레기값). */
export async function getReservation(id: string, client?: AdminDbClient): Promise<ReservationDetailRow | null> {
  if (!isUuid(id)) throw new Error("getReservation: id 가 uuid 가 아니다");

  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(TABLE)
    .select(RESERVATION_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<ReservationDetailRow, { merge: false }>();

  if (error) fail("getReservation", error);
  return data ?? null;
}
