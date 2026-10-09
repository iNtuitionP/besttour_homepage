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
 * 건수는 head 집계로만 센다(행이 오지 않는다 — 개인정보 0): 메뉴 배지·관리 홈 카드·목록 탭(P5-20 · P5-21). 오류나 빈 count 는 0 으로 갈음하지 않고 던진다.
 *
 * P5-21 — 목록 정렬은 탭마다 다르다(LIST_ORDER): 새 접수 = 오래 기다린 것부터 · 확정 = 출발이 가까운 것부터 · 운행 완료·취소·전체 = 최근 것부터.
 * 확정 탭(수정 라운드 · 리뷰 P1-1)은 쪽으로 넘기는 목록이 **다가오는 운행만**이다(`departFrom` = KST 오늘 00:00 · `depart_at >= `) —
 * 운행일이 지난 확정은 listConfirmedPast 가 따로(최근 것부터 몇 건 + 전체 수) 읽는다. 한 쿼리였을 때는 지난 확정이 쪽 1 을 다 차지했다.
 * 인덱스: 0001 의 `reservations_status_created_at_idx (status, created_at desc)` 가 새 접수(역방향으로 읽는다)·운행 완료·취소를 받친다.
 * 확정의 출발 순(`depart_at` — 다가오는 쪽·지난 쪽 둘 다)·전체 탭의 최근 순·관리 홈의 이번 주 운행(`status='confirmed' and depart_at …`)을
 * 받치는 인덱스는 **없다** — 마이그레이션 금지 범위라 만들지 않았다(보고서 ⑥ — 지금 표 크기에서는 정렬 비용이 작다 · 권고 `(status, depart_at)`).
 */
import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { RESERVATION_STATUSES, type ReservationStatus } from "../reservation-check/view";
import { createSsrClient } from "../supabase/ssr";

export { RESERVATION_STATUSES, type ReservationStatus } from "../reservation-check/view";

/** 세션(쿠키) 클라이언트. 서비스 롤 클라이언트는 이 파일에 들어오지 않는다. */
export type AdminDbClient = ReturnType<typeof createSsrClient>;

const TABLE = "reservations";

export const DEFAULT_ADMIN_PAGE_SIZE = 20;
/**
 * 한 번에 읽는 행의 상한. P5-21 의 '20건 더 보기'는 첫 줄부터 쪽 × 20 건을 한 번에 읽는다 —
 * 쪽의 상한(components/admin/reservation-list.ts MAX_LIST_PAGES = 10)까지 받는다(tests/admin-list.test.ts 가 둘을 맞춰 본다).
 */
export const MAX_ADMIN_PAGE_SIZE = 200;

/**
 * 옛 6단계 위저드가 받던 연락·결제 방법 코드(P3-4 components/quote/options.ts — P3-8 에서 위저드와 함께 지웠다).
 * 위저드 접수분(intake='wizard')의 상세 화면이 라벨(admin.labels.contact·payment)을 찾을 때만 쓴다. 간편 접수는 이 칸이 null 이다.
 */
export const LEGACY_CONTACT_METHODS = ["mobile", "phone", "fax"] as const;
export const LEGACY_PAYMENT_METHODS = ["cash", "card", "tax_invoice"] as const;

/** 목록 필터 — `all` 은 필터 없음. 화면의 탭(순서·기본 탭 = 새 접수)은 components/admin/reservation-list.ts LIST_TABS 다. */
export const STATUS_FILTERS = ["all", ...RESERVATION_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface ListOrderKey {
  column: "created_at" | "depart_at" | "id";
  ascending: boolean;
}

/**
 * 탭별 정렬(P5-21 · 브리프 §B · 제안서 ⑤-2). 마지막 칸은 늘 id — 같은 시각의 행이 쪽마다 뒤섞이지 않게(offset 흔들림 방지).
 *   새 접수   오래 기다린 것부터(네이버 주문 "가장 빨리 접수된 것부터") — 72시간 넘은 건이 저절로 맨 위에 모인다
 *   확정      출발이 가까운 것부터(배차 준비 순서) — 화면은 `departFrom`(KST 오늘 00:00)을 함께 넘겨 다가오는 운행만 읽는다
 *             (운행일이 지난 확정은 listConfirmedPast · 최근 것부터)
 *   나머지    최근에 들어온 것부터
 */
export const LIST_ORDER: Readonly<Record<StatusFilter, readonly ListOrderKey[]>> = {
  new: [
    { column: "created_at", ascending: true },
    { column: "id", ascending: true },
  ],
  confirmed: [
    { column: "depart_at", ascending: true },
    { column: "id", ascending: true },
  ],
  done: [
    { column: "created_at", ascending: false },
    { column: "id", ascending: false },
  ],
  cancelled: [
    { column: "created_at", ascending: false },
    { column: "id", ascending: false },
  ],
  all: [
    { column: "created_at", ascending: false },
    { column: "id", ascending: false },
  ],
};

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

/*
 * URL 의 `?status=` 파서는 P5-21 부터 components/admin/reservation-list.ts parseListTab 이다(기본 탭 = 새 접수 · 관대한 파서).
 * 쿼리 함수는 반대로 엄격하다: 아래 listReservations 는 목록 밖의 값을 받으면 DB 를 부르지 않고 throw 한다.
 */

/** URL 의 `?cursor=` → offset. 정수가 아니거나 음수면 처음부터. (발송 기록 화면이 lib/admin/notifications.ts 를 거쳐 쓴다) */
export function parseCursor(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export interface ReservationListParams {
  status?: StatusFilter;
  /** offset. 0 이상의 정수. */
  cursor?: number;
  limit?: number;
  /**
   * 확정 탭 전용 — 출발이 이 인스턴트(ISO) **이후(포함)** 인 것만(P5-21 수정 라운드 · 리뷰 P1-1). 화면은 KST 오늘 00:00 을 넘긴다
   * (components/admin/reservation-list.ts kstTodayStart). 확정이 아닌 상태에 주거나 날짜가 아니면 DB 를 부르지 않고 던진다.
   */
  departFrom?: string;
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

/** 조회 경계로 들어온 값이 인스턴트(ISO)인가 — 아니면 DB 를 부르지 않고 던진다(화면이 kstTodayStart 등으로 만들어 넘긴다). */
function assertInstant(op: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${op}: 인스턴트(ISO)가 아니다`);
  }
}

/**
 * 목록 한 페이지 — 탭별 정렬(LIST_ORDER · 동률은 id), `cursor` 부터 `limit` 건.
 * hasMore 는 limit + 1 건을 읽어 판정한다(쪽 넘김에 count 쿼리를 쓰지 않는다).
 * `client` 는 테스트 주입용 — 운영 호출부는 넘기지 않는다.
 */
export async function listReservations(params: ReservationListParams, client?: AdminDbClient): Promise<ReservationListPage> {
  const { status = "all", cursor = 0, limit = DEFAULT_ADMIN_PAGE_SIZE, departFrom } = params;
  if (!(STATUS_FILTERS as readonly unknown[]).includes(status)) {
    throw new Error("listReservations: 알 수 없는 status 필터다");
  }
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new Error("listReservations: cursor 는 0 이상의 정수여야 한다");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ADMIN_PAGE_SIZE) {
    throw new Error(`listReservations: limit 은 1 이상 ${MAX_ADMIN_PAGE_SIZE} 이하의 정수여야 한다`);
  }
  if (departFrom !== undefined) {
    if (status !== "confirmed") throw new Error("listReservations: departFrom 은 확정 목록에만 쓴다");
    assertInstant("listReservations.departFrom", departFrom);
  }

  const db = client ?? (await sessionClient());
  let query = db.from(TABLE).select(RESERVATION_LIST_SELECT);
  if (status !== "all") query = query.eq("status", status);
  if (departFrom !== undefined) query = query.gte("depart_at", departFrom);

  for (const key of LIST_ORDER[status]) query = query.order(key.column, { ascending: key.ascending });

  // range 는 양끝 포함이다 — (cursor, cursor + limit) 은 limit + 1 건.
  const { data, error } = await query.range(cursor, cursor + limit).overrideTypes<ReservationListRow[], { merge: false }>();

  if (error) {
    if (isRangeNotSatisfiable(error)) return EMPTY_PAGE;
    fail("listReservations", error);
  }
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit), hasMore, nextCursor: hasMore ? cursor + limit : null };
}

/** head 집계 응답 — 실제 행은 오지 않고 count 만 온다. */
interface HeadCountResponse {
  count: number | null;
  error: { code?: string | null; message: string } | null;
}

const HEAD = { count: "exact", head: true } as const;

/** head 집계 하나를 기다려 수를 꺼낸다. 오류·빈 count 는 0 으로 갈음하지 않고 던진다 — "없음" 과 "모름" 은 다르다. */
async function headCount(op: string, query: PromiseLike<HeadCountResponse>): Promise<number> {
  const { count, error } = await query;
  if (error) fail(op, error);
  if (typeof count !== "number") throw new Error(`admin.${op}: count 를 받지 못했다 — 0 으로 갈음하지 않는다`);
  return count;
}

/**
 * 새 접수 건수 — `status='new'` 인 접수 전부(P5-20). **배지 정의는 이것 하나다**: 메뉴(사이드바·탭 바)가 이 값을 쓰고,
 * P5-21 의 관리 홈 카드·목록 탭도 같은 함수를 부른다(같은 수를 화면마다 다르게 세지 않는다 — 제안서 ④ 원칙 2).
 * 0022 의 backlog.new_total 과 같은 정의다(기간 무관 · status='new').
 *
 * head 집계라 행은 오지 않는다(개인정보 0 — 숫자 하나). 위의 "count 쿼리 금지" 는 페이지 넘김 판정 얘기다(limit + 1 로 충분하다).
 * 세션 클라이언트 + 0009 RLS 로 센다(서비스 롤 금지 — ADR-2). 오류나 빈 count 를 0 으로 갈음하지 않고 throw 한다 —
 * "새 접수 없음" 과 "모름" 은 다르다. 부르는 쪽(레이아웃)이 모름을 배지 숨김으로 다룬다.
 *
 * **요청 범위 memo(React cache)** — P5-21 · 리뷰 P2-10. 첫 로드·새로고침처럼 레이아웃(배지)과 화면(홈 카드·목록 탭)이 **한 요청**에서 세면
 * 같은 약속(promise)을 받아 같은 수가 나온다(서버 HTML 에서도 두 숫자가 없다). lib/auth/requireAdmin.ts 와 같은 방식이다:
 * 저장소는 RSC 렌더 요청마다 새로 생기고 요청을 넘지 않는다(데이터 캐시·unstable_cache 가 아니다). 테스트(vitest)는 React 기본 빌드라 memo 없이 그대로 부른다.
 * 인자 목록이 memo 의 열쇠라 운영 호출부는 **인자 없이** 부른다(`countNewReservations(undefined)` 는 다른 열쇠다).
 */
export const countNewReservations = cache(async function countNewReservations(client?: AdminDbClient): Promise<number> {
  const db = client ?? (await sessionClient());
  return headCount("countNewReservations", db.from(TABLE).select("id", HEAD).eq("status", "new"));
});

/**
 * 목록 탭 건수(P5-21) — 상태 넷을 head 집계로 동시에. 새 접수는 배지와 **같은 함수**(countNewReservations)다.
 * "전체" 는 화면이 넷을 더한다(따로 세면 두 집계 사이에 어긋날 수 있다 — 더한 값은 탭 숫자들과 늘 맞는다).
 * 하나라도 모르면 던진다 — 화면은 알약을 모두 숨긴다(모르는 수를 0 으로 그리지 않는다).
 */
export async function countReservationsByStatus(client?: AdminDbClient): Promise<Record<ReservationStatus, number>> {
  const db = client ?? (await sessionClient());
  const [fresh, confirmed, done, cancelled] = await Promise.all([
    client === undefined ? countNewReservations() : countNewReservations(client),
    headCount("countReservationsByStatus.confirmed", db.from(TABLE).select("id", HEAD).eq("status", "confirmed")),
    headCount("countReservationsByStatus.done", db.from(TABLE).select("id", HEAD).eq("status", "done")),
    headCount("countReservationsByStatus.cancelled", db.from(TABLE).select("id", HEAD).eq("status", "cancelled")),
  ]);
  return { new: fresh, confirmed, done, cancelled };
}

/** 새 접수 중 간편·상세 건수(관리 홈 카드 보조 줄 · P5-21). 둘의 합이 새 접수 수와 다르면 화면이 줄을 숨긴다(components/admin/dashboard.ts newSplit). */
export async function countNewByIntake(client?: AdminDbClient): Promise<{ quick: number; wizard: number }> {
  const db = client ?? (await sessionClient());
  const [quick, wizard] = await Promise.all([
    headCount("countNewByIntake.quick", db.from(TABLE).select("id", HEAD).eq("status", "new").eq("intake", "quick")),
    headCount("countNewByIntake.wizard", db.from(TABLE).select("id", HEAD).eq("status", "new").eq("intake", "wizard")),
  ]);
  return { quick, wizard };
}

/**
 * 답이 늦은 접수 — 새 접수 중 `created_at < cutoff`(cutoff = 지금 − 72시간 · components/admin/dashboard.ts overdueCutoff).
 * 상태 배지의 isOverdue · 0022 backlog(`created_at < now() - 72h`)와 같은 쪽의 경계다(딱 72시간은 아직 아니다 — `lt`).
 */
export async function countOverdueNew(cutoff: string, client?: AdminDbClient): Promise<number> {
  const db = client ?? (await sessionClient());
  return headCount("countOverdueNew", db.from(TABLE).select("id", HEAD).eq("status", "new").lt("created_at", cutoff));
}

/** 인스턴트 두 개(ISO) — `from` 포함 · `to` 제외. 화면이 KST 달력으로 만들어 넘긴다(components/admin/dashboard.ts). */
export interface InstantRange {
  from: string;
  to: string;
}

/** 이번 주 운행 건수 — 확정 중 출발이 [from, to). */
export async function countConfirmedDeparting(range: InstantRange, client?: AdminDbClient): Promise<number> {
  const db = client ?? (await sessionClient());
  return headCount(
    "countConfirmedDeparting",
    db.from(TABLE).select("id", HEAD).eq("status", "confirmed").gte("depart_at", range.from).lt("depart_at", range.to),
  );
}

/**
 * 운행일이 지난 확정(P5-21 수정 라운드 · 리뷰 P1-1) — 확정 중 출발이 `before`(KST 오늘 00:00) **앞**인 것을 **최근 것부터** `limit` 건 +
 * 그 전체 수. 확정 탭 위의 짧은 칸이 쓴다("운행이 끝났으면 운행 완료로 바꿔 주세요"). 쪽으로 넘기는 목록(listReservations + departFrom)과 경계가 같아
 * 한 행이 두 곳에 나오지 않는다. 행과 수를 **한 번의 요청**으로 받는다(count exact — 같은 순간의 값이라 "N건 중 5건" 이 어긋나지 않는다).
 * 수를 받지 못하면 0 으로 갈음하지 않고 던진다(화면은 그 칸만 "불러오지 못했어요").
 */
export async function listConfirmedPast(before: string, limit: number, client?: AdminDbClient): Promise<{ items: ReservationListRow[]; total: number }> {
  assertInstant("listConfirmedPast.before", before);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ADMIN_PAGE_SIZE) {
    throw new Error(`listConfirmedPast: limit 은 1 이상 ${MAX_ADMIN_PAGE_SIZE} 이하의 정수여야 한다`);
  }
  const db = client ?? (await sessionClient());
  const { data, error, count } = await db
    .from(TABLE)
    .select(RESERVATION_LIST_SELECT, { count: "exact" })
    .eq("status", "confirmed")
    .lt("depart_at", before)
    .order("depart_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
    .overrideTypes<ReservationListRow[], { merge: false }>();
  if (error) fail("listConfirmedPast", error);
  if (typeof count !== "number") throw new Error("admin.listConfirmedPast: count 를 받지 못했다 — 0 으로 갈음하지 않는다");
  return { items: data ?? [], total: count };
}

/**
 * 이번 주 운행 카드의 날짜 줄이 읽는 출발 시각의 상한 — 넘치면 날짜 줄을 그리지 않는다(모자란 날 수를 지어내지 않는다).
 * 넘침은 **상한 + 1 건**을 읽어 가른다. 그 읽는 수(999)는 PostgREST 의 한 번 응답 상한 `max_rows`(1000 — supabase/config.toml · 호스팅 기본값도 같다)보다
 * **작아야** 한다(P5-22 · P5-21 재검토 신규 P2-2): 전에는 1000 + 1 = 1001 을 읽었는데 응답이 1000 에서 잘려 1001번째가 오지 않아 넘침을 알아챌 수 없었다.
 * tests/admin-dashboard.test.ts 가 config.toml 의 max_rows 를 읽어 대조한다.
 */
export const TRIP_DATES_CAP = 998;

/**
 * 이번 주 운행 카드의 날짜 줄(리뷰 P2-2) — 확정 중 출발이 [from, to) 인 **모든** 행의 출발 시각만(depart_at 한 칸 · 이름·번호 0).
 * 전에는 패널의 앞 20건에서 날짜를 만들어, 7일 안 운행이 20건을 넘으면 카드에서 날짜가 빠졌다. 상한 + 1 건을 읽어 넘치면 `capped`.
 */
export async function listConfirmedDepartDates(range: InstantRange, client?: AdminDbClient): Promise<{ departAts: string[]; capped: boolean }> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(TABLE)
    .select("depart_at")
    .eq("status", "confirmed")
    .gte("depart_at", range.from)
    .lt("depart_at", range.to)
    .order("depart_at", { ascending: true })
    .limit(TRIP_DATES_CAP + 1)
    .overrideTypes<{ depart_at: string }[], { merge: false }>();
  if (error) fail("listConfirmedDepartDates", error);
  const rows = data ?? [];
  return { departAts: rows.slice(0, TRIP_DATES_CAP).map((r) => r.depart_at), capped: rows.length > TRIP_DATES_CAP };
}

/** 다가오는 운행 — 확정 중 출발이 [from, to) 인 행을 출발 순으로 `limit` 건(목록과 같은 화이트리스트 — 메일·메시지·메모는 읽지 않는다). */
export async function listConfirmedDeparting(range: InstantRange, limit: number, client?: AdminDbClient): Promise<ReservationListRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ADMIN_PAGE_SIZE) {
    throw new Error(`listConfirmedDeparting: limit 은 1 이상 ${MAX_ADMIN_PAGE_SIZE} 이하의 정수여야 한다`);
  }
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(TABLE)
    .select(RESERVATION_LIST_SELECT)
    .eq("status", "confirmed")
    .gte("depart_at", range.from)
    .lt("depart_at", range.to)
    .order("depart_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit)
    .overrideTypes<ReservationListRow[], { merge: false }>();
  if (error) fail("listConfirmedDeparting", error);
  return data ?? [];
}

/**
 * 기간 안에 들어온 접수 수와 그중 확정된 수(관리 홈 "이번 달 접수·확정" · P5-21).
 * 통계 화면(0022 admin_stats)의 intake.total · confirmation.confirmed 와 **같은 정의**다 — created_at 이 기간 안 · 확정 = confirmed_at 이 있는 것
 * ("한 번이라도 확정" — 확정 뒤 취소 포함). 무거운 0022 집계를 부르지 않고 head 집계 둘로 센다.
 */
export async function countCreatedBetween(range: InstantRange, client?: AdminDbClient): Promise<{ total: number; confirmed: number }> {
  const db = client ?? (await sessionClient());
  const [total, confirmed] = await Promise.all([
    headCount("countCreatedBetween.total", db.from(TABLE).select("id", HEAD).gte("created_at", range.from).lt("created_at", range.to)),
    headCount(
      "countCreatedBetween.confirmed",
      db.from(TABLE).select("id", HEAD).gte("created_at", range.from).lt("created_at", range.to).not("confirmed_at", "is", null),
    ),
  ]);
  return { total, confirmed };
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
