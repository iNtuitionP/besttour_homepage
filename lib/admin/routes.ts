/**
 * 관리자 대표 노선 읽기·쓰기 — SSR 세션 + RLS (플랜 v4 P5-6 · ADR-2·ADR-3).
 *
 * **definer 함수를 만들지 않은 이유.** 팝업·공지와 같다 — 컬럼이 전부 콘텐츠이고(개인정보·보유기간 없음),
 * 상태 전이표가 없으며, 쓰기가 통지를 만들지 않는다. 0009 의 `showcase_routes_admin_all`
 * (`for all to authenticated using (is_admin()) with check (is_admin())`) 한 줄이 곧 방어선이고,
 * 여기서는 세션 클라이언트로 곧장 읽고 고친다. 마이그레이션 0건.
 *
 * **이 모듈에는 행을 만들거나 지우는 함수가 없다.** 화면에서 감춘 것이 아니라 코드에 경로가 없다.
 * 대표 노선 16개는 스펙 §13.2 가 고정한 집합이고, 0002 가 그 행들을 시드하면서 출발·도착을 `places(code)` 에
 * FK 로 묶었다 — 지도 핀(lib/map-coords.ts PLACE_POINTS)과 짝을 이루는 구조다. 새 행을 만들 수 있게 하면
 * 사장님이 그 짝을 모른 채 핀 없는 노선을 만들 수 있고, 지울 수 있게 하면 16개가 15개가 된 것을 아무도 모른다.
 * 고칠 것은 값(가격·정렬·노출·양 끝 도시)뿐이므로 update 두 개면 충분하다.
 *
 * **가격은 나르기만 한다.** price_from 은 정적 표시값이고 이 파일은 그것을 읽고 쓰는 것 외에 아무것도 하지 않는다 —
 * 계산·변환·포맷 0(CLAUDE.md §3). 표시 포맷은 홈과 같은 components/KrMap/format.ts 가 한다.
 *
 * 서비스 롤을 쓰지 않는다(ADR-2). 명단 밖 세션에는 `using` 이 행을 보여주지 않아 update 가 0행이 된다 —
 * 그래서 성공 판정은 상태 코드가 아니라 **돌아온 행**이다.
 * 캐시를 모른다(ADR-3). 무효화는 액션이 태그로 한다.
 */
import "server-only";

import { cookies } from "next/headers";

import { createSsrClient } from "../supabase/ssr";
import type { RouteValues } from "./routeInput";

export type AdminDbClient = ReturnType<typeof createSsrClient>;

export const ROUTE_TABLE = "showcase_routes";

/** 관리자 화면 경로 — 무효화 대상과 탭의 링크가 갈리지 않게 한 곳에 둔다. */
export const ADMIN_ROUTES_PATH = "/admin/routes";

/** select 화이트리스트 — `select('*')` 금지. highlight 는 **읽기만** 한다(스펙이 정한 값이라 화면이 고치지 않는다). */
export const ROUTE_ADMIN_COLUMNS = ["id", "origin_code", "destination_code", "price_from", "highlight", "sort", "active"] as const;
export const ROUTE_ADMIN_SELECT: string = ROUTE_ADMIN_COLUMNS.join(",");

export interface AdminRouteRow {
  id: number;
  origin_code: string;
  destination_code: string;
  /** 정적 표시값(원). null 이면 홈이 금액 라벨을 숨긴다(P2-2 폴백). */
  price_from: number | null;
  highlight: boolean;
  sort: number | null;
  active: boolean;
}

/**
 * 쓰기 결과 셋.
 *   changed   — 행이 실제로 바뀌었다
 *   unchanged — 0행(그런 id 가 없거나 정책에 가려졌다)
 *   duplicate — 같은 출발·도착 쌍이 이미 있다(0001 의 unique 제약). 사장님이 고칠 수 있는 오류라 실패와 구분한다
 */
export type RouteWriteOutcome = "changed" | "unchanged" | "duplicate";

/** Postgres unique_violation. PostgREST 가 error.code 로 그대로 넘겨준다. */
const UNIQUE_VIOLATION = "23505";

/** 오류 문구에 행 내용을 싣지 않는다 — code·message 만. */
function fail(op: string, error: { code?: string | null; message: string }): never {
  throw new Error(`adminRoutes.${op}: [${error.code ?? "?"}] ${error.message}`);
}

async function sessionClient(): Promise<AdminDbClient> {
  return createSsrClient(await cookies());
}

/**
 * RouteValues → 컬럼. 여기 말고 어디에서도 컬럼 이름을 조립하지 않는다.
 * highlight 는 없다 — 스펙 §13.2 가 인천공항→서울 하나로 정한 값이라 관리 화면이 덮어쓰지 않는다.
 */
function toRow(values: RouteValues): Record<string, unknown> {
  return {
    origin_code: values.originCode,
    destination_code: values.destinationCode,
    price_from: values.priceFrom,
    sort: values.sort,
    active: values.active,
  };
}

function outcomeOf(data: unknown): RouteWriteOutcome {
  return Array.isArray(data) && data.length > 0 ? "changed" : "unchanged";
}

/**
 * 목록 — 홈과 같은 순서(sort 오름차순, null 은 뒤, 동률은 id).
 * 비활성 행도 보인다: 내린 노선을 되살리려면 먼저 보여야 한다(공개 정책은 active 만 본다).
 * 16행 고정이라 상한을 따로 두지 않는다.
 */
export async function listAdminRoutes(client?: AdminDbClient): Promise<AdminRouteRow[]> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(ROUTE_TABLE)
    .select(ROUTE_ADMIN_SELECT)
    .order("sort", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .overrideTypes<AdminRouteRow[], { merge: false }>();

  if (error) fail("list", error);
  return data ?? [];
}

/** 한 건. 없거나 정책에 가려지면 null. */
export async function getAdminRoute(id: number, client?: AdminDbClient): Promise<AdminRouteRow | null> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(ROUTE_TABLE)
    .select(ROUTE_ADMIN_SELECT)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<AdminRouteRow, { merge: false }>();

  if (error) fail("get", error);
  return data ?? null;
}

/** 값 덮어쓰기. 같은 쌍이 이미 있으면 duplicate 로 돌려준다(던지지 않는다 — 사장님이 고칠 수 있는 오류다). */
export async function updateRouteRow(id: number, values: RouteValues, client?: AdminDbClient): Promise<RouteWriteOutcome> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(ROUTE_TABLE).update(toRow(values)).eq("id", id).select("id");
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return "duplicate";
    fail("update", error);
  }
  return outcomeOf(data);
}

/** 노출/중지만 바꾼다 — 목록에서 한 번에 내리기 위한 좁은 쓰기(가격·코드를 건드리지 않는다). */
export async function setRouteActive(id: number, active: boolean, client?: AdminDbClient): Promise<RouteWriteOutcome> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(ROUTE_TABLE).update({ active }).eq("id", id).select("id");
  if (error) fail("setActive", error);
  return outcomeOf(data);
}
