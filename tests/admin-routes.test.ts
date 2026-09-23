/**
 * P5-6 — 관리자 대표 노선 관리 탭 (플랜 v4 P5-6 · ADR-2·ADR-3·ADR-4 · CLAUDE.md §3·§7).
 *
 * **가격이 여기 있다.** showcase_routes 는 홈 지도에 예시 가격을 표시하는 유일한 표다(스펙 §13.2).
 * CLAUDE.md §3 은 가격 *계산* 코드를 금지하고 정적 값 *표시*만 허용한다 — 그 경계를 이 파일이 잠근다:
 *   1. 사장님이 숫자 하나를 직접 넣는다. 어떤 코드도 그 값을 유도·변환·배율하지 않는다(산술 0).
 *   2. 표시 포맷은 홈이 쓰는 components/KrMap/format.ts `formatPriceKrw` **하나**다 — 관리자가 두 번째 포맷을 만들지 않는다.
 *   3. verbatim 고지("대표 노선 예시 견적 …")는 lib/legal/disclosures.ts 원장에서 import 한다. 다시 타이핑하면 실패한다.
 *   4. 빈 값은 "가격 없음"이고 홈은 라벨을 숨긴 채 노선·핀만 그린다(P2-2 폴백). 관리자 화면이 그 뜻을 알려 줘야 한다.
 *
 * **추가·삭제는 만들지 않는다.** 16개는 스펙 §13.2 가 고정한 집합이고 0002 의 FK 로 지도 핀과 짝을 이룬다.
 * 그래서 액션은 둘뿐이고(수정·노출토글), 쿼리 모듈에는 insert·delete 함수가 아예 없다 — 화면에서 지울 수 없는 것이 아니라
 * **코드에 그 경로가 없다.**
 *
 * 브리프 §검증 1~6 을 그대로 단언한다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { withShowcaseRoutesLock } from "./helpers/db-lock";
import { expectRaisedDenied, expectTablePrivilegeDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: vi.fn(async () => ({ userId: "admin-uuid", email: "owner@example.test" })),
}));
vi.mock("@/lib/ports/after", () => ({ runAfter: vi.fn((task: () => unknown) => void task()) }));
vi.mock("@/lib/ports/revalidate", () => ({ revalidate: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

import { revalidatePath } from "next/cache";

import { toggleRouteActive, updateRoute } from "@/actions/admin/route";
import {
  ROUTE_FIELDS,
  ROUTE_PLACE_CODES,
  ROUTE_PRICE_MAX,
  ROUTE_SORT_MAX,
  parseRouteForm,
  parseRouteId,
  type RouteValues,
} from "@/lib/admin/routeInput";
import {
  ADMIN_ROUTES_PATH,
  ROUTE_ADMIN_COLUMNS,
  ROUTE_ADMIN_SELECT,
  ROUTE_RPC,
  ROUTE_TABLE,
  getAdminRoute,
  listAdminRoutes,
  setRouteActive,
  updateRouteRow,
} from "@/lib/admin/routes";
import { PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE } from "@/lib/admin/publicRevalidate";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { LOCATION_CODES, PLACES, SHOWCASE_ROUTE_SEED } from "@/lib/codes";
import { VERBATIM } from "@/lib/legal/disclosures";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";
import { createSsrClient } from "@/lib/supabase/ssr";

import { stripComments } from "./helpers/strip-comments";

// =============================================================================
// 공통 헬퍼 (tests/admin-popups.test.ts 와 같은 구현)
// =============================================================================
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8");
const exists = (rel: string): boolean => existsSync(path.join(ROOT, rel));
const HANGUL = /[가-힣]/;

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

const ACTION = "actions/admin/route.ts";
const LIB_INPUT = "lib/admin/routeInput.ts";
const LIB_DB = "lib/admin/routes.ts";
const LIST_PAGE = "app/admin/(protected)/routes/page.tsx";
const EDIT_PAGE = "app/admin/(protected)/routes/[id]/page.tsx";
const FORM_UI = "components/admin/RouteForm.tsx";
const TOGGLE_UI = "components/admin/RouteToggle.tsx";
const TABS_DEF = "components/admin/tabs.ts";

const VALUES: RouteValues = {
  originCode: "SEL",
  destinationCode: "BSN",
  priceFrom: 1200000,
  sort: 2,
  active: true,
};

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const validForm = (over: Record<string, string> = {}): FormData =>
  form({
    [ROUTE_FIELDS.originCode]: VALUES.originCode,
    [ROUTE_FIELDS.destinationCode]: VALUES.destinationCode,
    [ROUTE_FIELDS.priceFrom]: String(VALUES.priceFrom),
    [ROUTE_FIELDS.sort]: String(VALUES.sort),
    [ROUTE_FIELDS.active]: "on",
    ...over,
  });

interface Chain {
  [method: string]: ReturnType<typeof vi.fn>;
}
function dbStub(result: { data: unknown; error: unknown }): {
  client: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
  chain: Chain;
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
} {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "eq", "insert", "update", "delete", "maybeSingle", "overrideTypes"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  const from = vi.fn(() => chain);
  // 0020(P5-16) 뒤 쓰기는 definer 함수 RPC 다 — 표 체인(from)은 읽기만 탄다.
  const rpc = vi.fn(async () => result);
  return { client: { from, rpc }, chain: chain as Chain, from, rpc };
}

const ROW = {
  id: 2,
  origin_code: VALUES.originCode,
  destination_code: VALUES.destinationCode,
  price_from: VALUES.priceFrom,
  highlight: false,
  sort: VALUES.sort,
  active: true,
};

// =============================================================================
// 1. 입력 검증 (lib/admin/routeInput.ts — 순수)
// =============================================================================
describe("1. 입력 검증", () => {
  test("정상 입력 — 값이 그대로 통과한다", () => {
    const parsed = parseRouteForm(validForm());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(VALUES);
  });

  test("장소 코드 — 저장하는 것은 코드다. 0002 의 FK 가 가리키는 places 코드만 받는다", () => {
    // 카탈로그와 정확히 같은 집합이어야 한다 — 여기 없는 코드를 저장하면 FK 위반으로 쓰기가 통째로 실패한다
    expect([...ROUTE_PLACE_CODES].sort()).toEqual(PLACES.map((p) => p.code).sort());
    // LOCATION_CODES(28개, 접수 폼용)의 부분집합이다 — 시도 코드(GG·GW 등)는 places 에 없어 노선이 될 수 없다
    for (const code of ROUTE_PLACE_CODES) expect(LOCATION_CODES, code).toContain(code);
    for (const outside of ["GG", "GW", "CN", "CB", "JN", "JJ"]) {
      expect(ROUTE_PLACE_CODES, outside).not.toContain(outside);
      expect(parseRouteForm(validForm({ [ROUTE_FIELDS.destinationCode]: outside })).ok, outside).toBe(false);
    }
    for (const bad of ["", "sel", "서울", "Seoul", "XXX", " SEL"]) {
      expect(parseRouteForm(validForm({ [ROUTE_FIELDS.originCode]: bad })).ok, bad).toBe(false);
    }
  });

  test("출발지와 도착지가 같으면 거부한다 (지도에 그릴 선이 없다)", () => {
    const parsed = parseRouteForm(validForm({ [ROUTE_FIELDS.destinationCode]: VALUES.originCode }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.result.fieldErrors?.destinationCode).toBe(true);
  });

  test("표시 가격 — 사장님이 넣은 정수 하나. 음수·0·소수·문자·상한 초과는 거부", () => {
    for (const bad of ["0", "-1", "-400000", "1.5", "40만", "abc", "1e5", "400,000", " 400000 x"]) {
      const parsed = parseRouteForm(validForm({ [ROUTE_FIELDS.priceFrom]: bad }));
      expect(parsed.ok, bad).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.result.fieldErrors?.priceFrom, bad).toBe(true);
    }
    expect(parseRouteForm(validForm({ [ROUTE_FIELDS.priceFrom]: String(ROUTE_PRICE_MAX + 1) })).ok).toBe(false);
    const max = parseRouteForm(validForm({ [ROUTE_FIELDS.priceFrom]: String(ROUTE_PRICE_MAX) }));
    expect(max.ok).toBe(true);
    if (!max.ok) return;
    // 값이 통과할 때 그 값은 **입력 그대로**다 — 어떤 변환도 없다
    expect(max.value.priceFrom).toBe(ROUTE_PRICE_MAX);
  });

  test("표시 가격 — 비우면 null 이고, 그것이 라벨 숨김 폴백의 입력이다 (CLAUDE.md §3)", () => {
    const parsed = parseRouteForm(validForm({ [ROUTE_FIELDS.priceFrom]: "" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.priceFrom).toBeNull();
  });

  test("정렬 — 0 이상 정수 또는 비움(null). 음수·소수는 거부", () => {
    expect(parseRouteForm(validForm({ [ROUTE_FIELDS.sort]: "" })).ok).toBe(true);
    const empty = parseRouteForm(validForm({ [ROUTE_FIELDS.sort]: "" }));
    if (empty.ok) expect(empty.value.sort).toBeNull();
    expect(parseRouteForm(validForm({ [ROUTE_FIELDS.sort]: "0" })).ok).toBe(true);
    expect(parseRouteForm(validForm({ [ROUTE_FIELDS.sort]: String(ROUTE_SORT_MAX) })).ok).toBe(true);
    for (const bad of ["-1", "1.5", "abc", String(ROUTE_SORT_MAX + 1)]) {
      expect(parseRouteForm(validForm({ [ROUTE_FIELDS.sort]: bad })).ok, bad).toBe(false);
    }
  });

  test("활성 — 체크되지 않은 체크박스는 값 자체가 오지 않는다 → false", () => {
    const fd = validForm();
    fd.delete(ROUTE_FIELDS.active);
    const parsed = parseRouteForm(fd);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.active).toBe(false);
  });

  test("id 파싱 — 양의 정수만, 그 밖에는 null (DB 를 부르지 않기 위한 관문)", () => {
    for (const ok of ["1", "16", 7]) expect(parseRouteId(ok), String(ok)).toBe(Number(ok));
    for (const bad of ["", "0", "-3", "1.5", "abc", "07", null, undefined, {}, 0, -1, 1.5]) {
      expect(parseRouteId(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  test("가격을 만드는 코드가 없다 — 입력 모듈에 산술 0 (CLAUDE.md §3)", () => {
    const src = codeOf(LIB_INPUT);
    // 배율·나눗셈·거리당 단가처럼 숫자를 **유도**하는 연산자가 없다. 상한 비교(<=)만 있다.
    expect(src, "가격을 곱하거나 나누는 코드").not.toMatch(/[*/%]\s*\d|\d\s*[*/%]/);
  });
});

// =============================================================================
// 2. 쿼리 계층 (lib/admin/routes.ts)
// =============================================================================
describe("2. 쿼리 계층", () => {
  beforeEach(() => vi.clearAllMocks());

  test("select 는 화이트리스트다 — * 가 없고 컬럼이 정확히 7개", () => {
    expect(ROUTE_ADMIN_COLUMNS).toEqual(["id", "origin_code", "destination_code", "price_from", "highlight", "sort", "active"]);
    expect(ROUTE_ADMIN_SELECT).toBe(ROUTE_ADMIN_COLUMNS.join(","));
    expect(ROUTE_ADMIN_SELECT).not.toContain("*");
    expect(ROUTE_TABLE).toBe("showcase_routes");
  });

  test("목록 — 홈과 같은 순서(sort 오름차순, null 은 뒤, 동률은 id). 비활성 행도 보인다", async () => {
    const { client, chain, from } = dbStub({ data: [ROW], error: null });
    const rows = await listAdminRoutes(client as never);
    expect(from).toHaveBeenCalledWith(ROUTE_TABLE);
    expect(chain.select).toHaveBeenCalledWith(ROUTE_ADMIN_SELECT);
    expect(chain.order.mock.calls).toEqual([
      ["sort", { ascending: true, nullsFirst: false }],
      ["id", { ascending: true }],
    ]);
    expect(chain.eq).not.toHaveBeenCalled();
    expect(rows).toEqual([ROW]);
  });

  test("상세 — id 로 한 건, 없으면 null", async () => {
    const { client, chain } = dbStub({ data: null, error: null });
    expect(await getAdminRoute(2, client as never)).toBeNull();
    expect(chain.eq).toHaveBeenCalledWith("id", 2);
    expect(chain.maybeSingle).toHaveBeenCalled();
  });

  test("수정 — 다섯 컬럼만 쓴다. highlight 는 스펙이 정한 값이라 건드리지 않는다", async () => {
    const up = dbStub({ data: [{ id: 2 }], error: null });
    expect(await updateRouteRow(2, VALUES, up.client as never)).toBe("changed");
    expect(ROUTE_RPC.update).toBe("admin_update_route");
    // 인자 = 컬럼 화이트리스트(0020 §5). highlight 는 함수가 받지도 않는다.
    expect(up.rpc.mock.calls).toEqual([
      [
        ROUTE_RPC.update,
        {
          p_id: 2,
          p_origin_code: VALUES.originCode,
          p_destination_code: VALUES.destinationCode,
          p_price_from: VALUES.priceFrom,
          p_sort: VALUES.sort,
          p_active: VALUES.active,
        },
      ],
    ]);
    expect(JSON.stringify(up.rpc.mock.calls)).not.toContain("highlight");
    expect(up.from, "표에 직접 쓴다 — 0020 뒤로 GRANT 가 없다").not.toHaveBeenCalled();
    // 함수 쪽도 highlight 를 받지 않는다
    const fnSrc = read("supabase/migrations/0020_admin_content_writes.sql");
    const sig = fnSrc.match(/create or replace function admin_update_route\(([^)]*)\)/)?.[1] ?? "";
    expect(sig, "admin_update_route 시그니처를 찾지 못했다").not.toBe("");
    expect(sig).not.toContain("highlight");
  });

  test("수정 — 바뀐 행이 0이면 unchanged (RLS 에 막혔거나 없는 id)", async () => {
    const none = dbStub({ data: [], error: null });
    expect(await updateRouteRow(2, VALUES, none.client as never)).toBe("unchanged");
  });

  test("수정 — 같은 출발·도착 쌍이 이미 있으면 duplicate (0001 의 unique 제약)", async () => {
    const dup = dbStub({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
    expect(await updateRouteRow(2, VALUES, dup.client as never)).toBe("duplicate");
  });

  test("그 밖의 DB 오류는 던진다 — 행 내용을 섞지 않고 code·message 만", async () => {
    const { client } = dbStub({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(updateRouteRow(2, VALUES, client as never)).rejects.toThrow(/42501.*permission denied/);
    // EXECUTE 거부도 같은 42501 이지만 가드 거부가 아니다 — 던진다(lib/admin/adminRpc.ts)
    const exec = dbStub({ data: null, error: { code: "42501", message: "permission denied for function admin_update_route" } });
    await expect(updateRouteRow(2, VALUES, exec.client as never)).rejects.toThrow(/permission denied for function/);
  });

  test("가드 거부(명단 밖 세션)는 unchanged — 0020 이전 정책에 가려 0행이던 것과 같은 결과", async () => {
    const guard = dbStub({ data: null, error: { code: "42501", message: "admin_update_route: 관리자 명단에 없는 호출자다" } });
    expect(await updateRouteRow(2, VALUES, guard.client as never)).toBe("unchanged");
    const guardToggle = dbStub({ data: null, error: { code: "42501", message: "admin_set_route_active: 관리자 명단에 없는 호출자다" } });
    expect(await setRouteActive(2, true, guardToggle.client as never)).toBe("unchanged");
  });

  test("노출 토글 — active 만 쓴다(가격·코드를 건드리지 않는다)", async () => {
    const off = dbStub({ data: [{ id: 2 }], error: null });
    expect(await setRouteActive(2, false, off.client as never)).toBe("changed");
    expect(off.rpc.mock.calls).toEqual([["admin_set_route_active", { p_id: 2, p_active: false }]]);
    expect(off.from).not.toHaveBeenCalled();
  });

  test("추가·삭제 경로가 아예 없다 — 16개는 고정 집합이다 (스펙 §13.2 · 0002 FK)", async () => {
    const mod = (await import("@/lib/admin/routes")) as Record<string, unknown>;
    const names = Object.keys(mod).filter((k) => typeof mod[k] === "function");
    expect(names.sort()).toEqual(["getAdminRoute", "listAdminRoutes", "setRouteActive", "updateRouteRow"]);
    const src = codeOf(LIB_DB);
    expect(src, "쿼리 모듈에 insert 가 있다").not.toMatch(/\.insert\(/);
    expect(src, "쿼리 모듈에 delete 가 있다").not.toMatch(/\.delete\(/);
    expect(src, "쿼리 모듈이 표에 직접 update 한다 — 0020 뒤로 GRANT 가 없다").not.toMatch(/\.update\(/);
    expect(SHOWCASE_ROUTE_SEED.length, "스펙 §13.2 대표 노선은 16개다").toBe(16);
    // 쓰기 함수도 둘뿐이다 — 0020 에 노선을 만들거나 지우는 함수가 없다
    expect(Object.values(ROUTE_RPC).sort()).toEqual(["admin_set_route_active", "admin_update_route"]);
    const mig = read("supabase/migrations/0020_admin_content_writes.sql");
    expect(mig, "0020 에 노선 추가 함수").not.toMatch(/function admin_(create|insert|add)_route/);
    expect(mig, "0020 에 노선 삭제 함수").not.toMatch(/function admin_(delete|remove)_route/);
  });
});

// =============================================================================
// 3. 서버액션 (actions/admin/route.ts)
// =============================================================================
describe("3. 서버액션", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" });
  });

  test("수정 — requireAdmin 이 DB 보다 먼저 돈다", async () => {
    const { client, rpc } = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2" }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requireAdmin).mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  test("수정 — 성공하면 홈 노선 태그와 관리자 경로를 무효화한다", async () => {
    const { client } = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2" }));
    expect(result).toEqual({ ok: true, changed: true, code: "updated" });
    expect(vi.mocked(revalidate).mock.calls.map((c) => c[0])).toEqual([QUERY_TAGS.showcase]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(ADMIN_ROUTES_PATH);
  });

  /**
   * 홈 지도·/fares 는 SSG + ISR(600초)이고, 그 읽기는 fetch 도 unstable_cache 도 아니라 태그로는 지울 수 없다.
   * 2026-09-15 실측(Next 15.5.24 + next-intl as-needed 프로브): 경로 패턴은 전부 무반응이고
   * `revalidatePath("/", "layout")` 만 홈·/fares·/notices 를 재생성했다. 이 단언이 그 형태를 잠근다.
   */
  test("수정 — 성공하면 홈·/fares 캐시를 루트 layout 으로 비운다", async () => {
    const { client } = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2" }));
    expect(PUBLIC_CACHE_PATH).toBe("/");
    expect(PUBLIC_CACHE_SCOPE).toBe("layout");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
  });

  test("중복·미변경이면 공개 화면을 비우지 않는다", async () => {
    const dup = dbStub({ data: null, error: { code: "23505", message: "duplicate key" } });
    vi.mocked(createSsrClient).mockReturnValue(dup.client as never);
    await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2" }));
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  test("수정 — id 가 없거나 형식이 틀리면 DB 를 부르지 않는다", async () => {
    const { client, from, rpc } = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect((await updateRoute(validForm())).code).toBe("validation");
    expect((await updateRoute(validForm({ [ROUTE_FIELDS.id]: "abc" }))).code).toBe("validation");
    // 0020 뒤 쓰기는 rpc 다 — from 만 보면 이 단언은 공허하게 통과한다
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  test("수정 — 검증에 걸리면 DB 를 부르지 않는다 (잘못된 가격·코드)", async () => {
    const { client, from, rpc } = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    expect((await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2", [ROUTE_FIELDS.priceFrom]: "-1" }))).code).toBe("validation");
    expect((await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2", [ROUTE_FIELDS.originCode]: "XXX" }))).code).toBe("validation");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
  });

  test("수정 — 바뀐 행이 0이면 notFound, 중복 쌍이면 duplicate. 둘 다 무효화하지 않는다", async () => {
    const none = dbStub({ data: [], error: null });
    vi.mocked(createSsrClient).mockReturnValue(none.client as never);
    expect(await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2" }))).toEqual({ ok: false, changed: false, code: "notFound" });
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const dup = dbStub({ data: null, error: { code: "23505", message: "duplicate key" } });
    vi.mocked(createSsrClient).mockReturnValue(dup.client as never);
    expect(await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2" }))).toEqual({ ok: false, changed: false, code: "duplicate" });
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
  });

  test("노출 토글 — id 검증 뒤 한 번씩", async () => {
    const on = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(on.client as never);
    expect(await toggleRouteActive(2, true)).toEqual({ ok: true, changed: true, code: "activated" });
    expect(on.rpc.mock.calls).toEqual([["admin_set_route_active", { p_id: 2, p_active: true }]]);

    vi.clearAllMocks();
    const off = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(off.client as never);
    expect(await toggleRouteActive(2, false)).toEqual({ ok: true, changed: true, code: "deactivated" });
    expect(off.rpc.mock.calls).toEqual([["admin_set_route_active", { p_id: 2, p_active: false }]]);
    expect(vi.mocked(revalidate).mock.calls.map((c) => c[0])).toEqual([QUERY_TAGS.showcase]);

    vi.clearAllMocks();
    const bad = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(bad.client as never);
    expect((await toggleRouteActive(0, true)).code).toBe("validation");
    expect(bad.from).not.toHaveBeenCalled();
    expect(bad.rpc).not.toHaveBeenCalled();
  });

  test("DB 오류 — 예외를 밖으로 던지지 않고 failed 로 닫는다", async () => {
    const { client } = dbStub({ data: null, error: { code: "42501", message: "permission denied" } });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect(await updateRoute(validForm({ [ROUTE_FIELDS.id]: "2" }))).toEqual({ ok: false, changed: false, code: "failed" });
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
  });

  test("requireAdmin 이 리다이렉트(throw)하면 DB 는 돌지 않는다", async () => {
    const { client, from, rpc } = dbStub({ data: [{ id: 2 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(updateRoute(validForm({ [ROUTE_FIELDS.id]: "2" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 4. 정적 규약
// =============================================================================
describe("4. 정적 규약", () => {
  const TS_TARGETS = [ACTION, LIB_INPUT, LIB_DB, LIST_PAGE, EDIT_PAGE, FORM_UI, TOGGLE_UI];

  test("산출물 파일이 전부 있다", () => {
    for (const rel of TS_TARGETS) expect(exists(rel), rel).toBe(true);
  });

  test("액션 — 'use server' 첫 줄 · export 2개뿐(추가·삭제 없음) · 전부 async · 첫 문장이 게이트", () => {
    const src = read(ACTION);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use server["'];?$/);
    const exports = [...codeOf(ACTION).matchAll(/^export\s+.*$/gm)].map((m) => m[0]);
    expect(exports.length, "'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다 (ADR-3)").toBe(2);
    for (const e of exports) expect(e, e).toMatch(/^export async function/);
    for (const name of ["updateRoute", "toggleRouteActive"]) {
      const body = new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{\\s*await requireAdmin\\(\\);`);
      expect(codeOf(ACTION), `${name} 의 첫 문장이 게이트가 아니다`).toMatch(body);
    }
    expect(src).toMatch(/import \{ requireAdmin \} from "@\/lib\/auth\/requireAdmin"/);
    expect(src).not.toMatch(/as requireAdmin/);
  });

  test("노선을 만들거나 지우는 엔드포인트가 없다 — 어떤 파일에도", () => {
    for (const rel of TS_TARGETS) {
      const src = codeOf(rel);
      expect(src, `${rel} 에 노선 추가 경로`).not.toMatch(/createRoute|insertRoute|addRoute/);
      expect(src, `${rel} 에 노선 삭제 경로`).not.toMatch(/deleteRoute|removeRoute/);
    }
  });

  test("서비스 롤 0 · unstable_cache 0 — 관리자 경로 규약 (ADR-2)", () => {
    for (const rel of TS_TARGETS) {
      expect(read(rel), rel).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
      expect(codeOf(rel), rel).not.toMatch(/unstable_cache/);
    }
  });

  test("한글 리터럴 0 — 문구는 messages/ko.json admin.routes.* 와 원장에서만 온다", () => {
    for (const rel of TS_TARGETS) {
      const offenders = codeOf(rel)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(offenders, rel).toEqual([]);
    }
  });

  test("가격 계산 심볼 0 (CLAUDE.md §3 · check:pricing 과 같은 패턴)", () => {
    const forbidden = new RegExp(["est" + "_price", "price" + "_state", "route" + "_prices", "estim" + "ate\\(", "PRICE" + "_DISPLAY_MODE"].join("|"));
    for (const rel of TS_TARGETS) expect(read(rel), rel).not.toMatch(forbidden);
  });

  test("가격에 산술이 없다 — 값은 사장님이 넣은 그대로 오가고, 표시 포맷은 홈과 같은 함수다", () => {
    for (const rel of TS_TARGETS) {
      const src = codeOf(rel);
      expect(src, `${rel} 에 숫자 산술이 있다 (가격을 유도하는 코드 금지)`).not.toMatch(/[*/%]\s*\d|\d\s*[*/%]/);
    }
    // 만원 단위 표기는 components/KrMap/format.ts 하나뿐이다 — 관리자가 두 번째 포맷을 만들지 않는다
    expect(codeOf(LIST_PAGE) + codeOf(EDIT_PAGE)).toMatch(/formatPriceKrw/);
    expect(read("components/KrMap/format.ts")).toMatch(/export function formatPriceKrw/);
    expect(exists("lib/pricing.ts"), "lib/pricing.ts 는 만들지 않는다").toBe(false);
  });

  test("verbatim 고지는 원장에서 import 한다 — 관리자 화면에 다시 타이핑하지 않는다", () => {
    const screens = `${read(LIST_PAGE)}${read(EDIT_PAGE)}`;
    expect(screens, "원장 import 가 없다").toMatch(/VERBATIM/);
    expect(screens).toMatch(/@\/lib\/legal\/disclosures/);
    for (const rel of [...TS_TARGETS, "messages/ko.json"]) {
      expect(read(rel).includes(VERBATIM.showcaseNotice), `${rel} 이 verbatim 문구를 다시 타이핑했다`).toBe(false);
    }
  });

  test("빈 값의 뜻을 화면이 알려 준다 — 가격을 비우면 홈은 라벨을 숨기고 핀만 그린다 (P2-2)", () => {
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, Record<string, Record<string, unknown>>>;
    const routes = ko.admin.routes as Record<string, unknown>;
    const hint = routes.hint as Record<string, string>;
    expect(hint.priceFrom, "admin.routes.hint.priceFrom — 비웠을 때 어떻게 보이는지").toBeTruthy();
    expect(hint.active, "admin.routes.hint.active — 내렸을 때 어떻게 보이는지").toBeTruthy();
    // 폼이 그 안내를 실제로 렌더한다
    expect(codeOf(FORM_UI)).toMatch(/hint\.priceFrom|hint:/);
  });

  test("공개 읽기 계층은 이 태스크가 고치지 않는다", () => {
    const pub = read("lib/queries/showcase.ts");
    expect(pub).toMatch(/export async function getShowcaseRoutes/);
    expect(pub).not.toMatch(/insert\(|update\(|delete\(/);
  });

  test("탭 — 대표 노선이 켜졌고 여섯 탭 전부 ready 다 (P6-2 갤러리 · P5-8 발송 내역)", async () => {
    const { ADMIN_TABS } = await import("@/components/admin/tabs");
    expect(ADMIN_TABS.filter((t) => t.ready).map((t) => t.href)).toEqual([
      "/admin/reservations",
      "/admin/popups",
      "/admin/notices",
      "/admin/gallery",
      "/admin/routes",
      "/admin/notifications",
      "/admin/stats",
    ]);
    expect(ADMIN_TABS.find((t) => t.key === "routes")?.href).toBe(ADMIN_ROUTES_PATH);
    expect(read(TABS_DEF)).toContain("/admin/routes");
  });

  test("messages/ko.json — admin.routes 가 생겼고 기존 키는 그대로다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, Record<string, Record<string, unknown>>>;
    const routes = ko.admin.routes as Record<string, unknown>;
    for (const k of ["title", "sub", "listLabel", "edit", "back", "notFound", "save", "processing"]) {
      expect(routes[k], `admin.routes.${k}`).toBeTruthy();
    }
    for (const k of ["originCode", "destinationCode", "priceFrom", "sort", "active"]) {
      expect((routes.field as Record<string, string>)[k], `admin.routes.field.${k}`).toBeTruthy();
    }
    for (const k of ["updated", "activated", "deactivated", "notFound", "duplicate", "validation", "failed"]) {
      expect((routes.result as Record<string, string>)[k], `admin.routes.result.${k}`).toBeTruthy();
    }
    // 추가·삭제 문구가 없다 — 화면에 그 동작이 없기 때문이다
    expect(routes.create).toBeUndefined();
    expect(routes.delete).toBeUndefined();
    expect((ko.admin.popups as Record<string, unknown>).title).toBeTruthy();
    expect((ko.admin.notices as Record<string, unknown>).title).toBeTruthy();
    // en 카탈로그에는 관리자 문구가 없다(관리자 화면은 로케일 밖 · 한국어 전용). P2-6 에서 en.json 이 공개 네임스페이스로 채워졌다.
    expect(JSON.parse(read("messages/en.json")).admin).toBeUndefined();
  });

  test("화면 — 두 페이지 모두 첫 문장이 게이트다", () => {
    for (const rel of [LIST_PAGE, EDIT_PAGE]) {
      expect(codeOf(rel), rel).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    }
  });

  test("클라이언트 컴포넌트 2종은 'use client' 로 시작한다", () => {
    for (const rel of [FORM_UI, TOGGLE_UI]) {
      expect(read(rel).split("\n")[0].trim(), rel).toMatch(/^["']use client["'];?$/);
    }
  });

  test("장소 라벨은 lib/codes.ts 에서 온다 — 번역 문자열을 저장하지 않는다 (CLAUDE.md §3)", () => {
    const screens = `${codeOf(LIST_PAGE)}${codeOf(EDIT_PAGE)}${codeOf(FORM_UI)}`;
    expect(screens).toMatch(/locationLabelKo|ROUTE_PLACE_CODES/);
    // 폼이 보내는 값은 코드다
    expect(codeOf(FORM_UI)).toMatch(/ROUTE_FIELDS\.originCode/);
  });
});

// =============================================================================
// 5. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 에서만 (원격에는 어떤 쓰기도 하지 않는다)
//    16행은 0002 가 시드한 고정 집합이라 **행을 만들지도 지우지도 않는다** — 값만 바꿨다가 되돌린다.
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-routes.test] DB 실증 블록 skip — ${gate.reason}`);
}

test("DB 쓰기 가드 — 원격 URL 이면 REQUIRE_DB_TESTS=1 을 강제해도 닫힌다", () => {
  const forced = dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, REQUIRE_DB_TESTS: "1" });
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|kong)(:|\/|$)/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    expect(forced.allowed).toBe(false);
    expect(gate.allowed).toBe(false);
  } else {
    expect(forced.allowed).toBe(true);
  }
});

describe.skipIf(!gate.allowed || !env.hasServiceRole)("5. DB — showcase_routes RLS 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", { timeout: 60_000 }, () => {
  // 이 블록은 마지막 시드 행(SEL→WJU)의 가격·정렬·노출을 바꿨다 되돌린다 — 그 사이 16행 전체를 대조하는 블록
  // (places·queries)이 되돌리기 전 값을 읽는다(P6-12 관측 · P6-13 재현). 같은 잠금으로 줄 세운다 (tests/helpers/db-lock.ts).
  withShowcaseRoutesLock();

  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `p56-${randomUUID()}`;
  const emailFor = (who: string) => `p56-${RUN}-${who}@example.test`;

  type Res = { status: number; body: unknown };
  async function call(method: string, url: string, hdrs: Record<string, string>, json?: unknown, prefer?: string): Promise<Res> {
    const res = await fetch(url, {
      method,
      headers: prefer ? { ...hdrs, Prefer: prefer } : hdrs,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body };
  }

  const rest = (method: string, pathAndQuery: string, json?: unknown, prefer?: string) =>
    call(method, `${env.restRoot}${pathAndQuery}`, serviceHeaders, json, prefer);

  const asUser = (token: string, method: string, pathAndQuery: string, json?: unknown, prefer?: string) =>
    call(
      method,
      `${env.restRoot}${pathAndQuery}`,
      { apikey: env.anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      json,
      prefer,
    );

  const asAnon = (pathAndQuery: string) =>
    call("GET", `${env.restRoot}${pathAndQuery}`, { apikey: env.anonKey as string, Authorization: `Bearer ${env.anonKey}` });

  interface RouteRow {
    id: number;
    origin_code: string;
    destination_code: string;
    price_from: number | null;
    highlight: boolean;
    sort: number | null;
    active: boolean;
  }

  let adminId = "";
  let plainId = "";
  let adminToken = "";
  let plainToken = "";
  let target: RouteRow | null = null;

  async function createUser(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, { email, password: PASSWORD, email_confirm: true });
    expect(r.status, `사용자 생성 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
    return (r.body as { id: string }).id;
  }

  async function signIn(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/token?grant_type=password`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, { email, password: PASSWORD });
    expect(r.status, `로그인 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
    return (r.body as { access_token: string }).access_token;
  }

  test("준비 — 16행이 있고, 관리자 1명 · 일반 로그인 1명", async () => {
    const all = await rest("GET", `/showcase_routes?select=${ROUTE_ADMIN_SELECT}&order=id.asc`);
    expect(all.status, "0002 이전 마이그레이션이 적용되지 않았다").toBe(200);
    const rows = all.body as RouteRow[];
    expect(rows.length, "0002 가 시드한 대표 노선 16행").toBe(16);
    target = rows[rows.length - 1];

    adminId = await createUser(emailFor("admin"));
    plainId = await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P5-6 test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
  });

  /** 0020 뒤 관리자 쓰기의 유일한 경로 — lib/admin/routes.ts 가 부르는 것과 같은 definer 함수 RPC. */
  const rpcAs = (token: string, fn: string, args: Record<string, unknown>) => asUser(token, "POST", `/rpc/${fn}`, args);
  /** 화면이 보내는 다섯 값 — 대상 행의 현재 값에서 시작해 바꿀 것만 덮어쓴다(화면의 저장과 같은 모양). */
  const routeArgs = (row: RouteRow, over: Record<string, unknown> = {}) => ({
    p_id: row.id,
    p_origin_code: row.origin_code,
    p_destination_code: row.destination_code,
    p_price_from: row.price_from,
    p_sort: row.sort,
    p_active: row.active,
    ...over,
  });

  test("관리자 세션 — 가격·정렬·노출을 고칠 수 있다 (0020 definer 함수 admin_update_route · admin_set_route_active)", async () => {
    const row = target as RouteRow;
    const up = await rpcAs(adminToken, ROUTE_RPC.update, routeArgs(row, { p_price_from: 123456, p_sort: 99 }));
    expect(up.status, JSON.stringify(up.body).slice(0, 300)).toBe(200);
    expect(up.body).toEqual([{ id: row.id }]);
    const mid = await rest("GET", `/showcase_routes?select=price_from,sort,highlight&id=eq.${row.id}`);
    expect((mid.body as RouteRow[])[0]).toEqual({ price_from: 123456, sort: 99, highlight: row.highlight });

    // 가격을 비우는 것(null)이 라벨 숨김 폴백의 입력이다
    const cleared = await rpcAs(adminToken, ROUTE_RPC.update, routeArgs(row, { p_price_from: null, p_sort: 99 }));
    expect(cleared.body).toEqual([{ id: row.id }]);
    const after = await rest("GET", `/showcase_routes?select=price_from&id=eq.${row.id}`);
    expect((after.body as RouteRow[])[0].price_from).toBeNull();

    // 비활성으로 내려도 관리자에게는 보인다(되살릴 수 있어야 한다 — 0020 showcase_routes_admin_select)
    const off = await rpcAs(adminToken, ROUTE_RPC.setActive, { p_id: row.id, p_active: false });
    expect(off.body).toEqual([{ id: row.id }]);
    const hidden = await asUser(adminToken, "GET", `/showcase_routes?select=id,active&id=eq.${row.id}`);
    expect((hidden.body as RouteRow[])[0]?.active, "관리자가 비활성 노선을 못 보면 되살릴 수 없다").toBe(false);
  });

  test("anon — 비활성 노선은 보이지 않는다 (공개 정책 회귀)", async () => {
    const row = target as RouteRow;
    const off = await asAnon(`/showcase_routes?select=id&id=eq.${row.id}`);
    expect(off.status, JSON.stringify(off.body).slice(0, 200)).toBe(200);
    expect((off.body as unknown[]).length, "비활성 노선이 anon 에게 보인다").toBe(0);

    const back = await rpcAs(adminToken, ROUTE_RPC.setActive, { p_id: row.id, p_active: true });
    expect(back.body).toEqual([{ id: row.id }]);
    const on = await asAnon(`/showcase_routes?select=id&id=eq.${row.id}`);
    expect((on.body as unknown[]).length).toBe(1);
  });

  test("명단에 없는 로그인 세션 — 표 직접 쓰기는 GRANT 층, 함수는 가드가 거부한다", async () => {
    const row = target as RouteRow;
    // 표 직접 쓰기 — 0020 이 authenticated 의 insert·update·delete 를 회수했다: 403 · 42501 · permission denied for table showcase_routes.
    expectTablePrivilegeDenied(await asUser(plainToken, "PATCH", `/showcase_routes?id=eq.${row.id}`, { price_from: 1 }), "showcase_routes", "명단 밖 세션의 showcase_routes UPDATE");
    expectTablePrivilegeDenied(
      await asUser(plainToken, "POST", "/showcase_routes", { origin_code: "SEL", destination_code: "PHG" }),
      "showcase_routes",
      "명단 밖 세션의 showcase_routes INSERT",
    );
    expectTablePrivilegeDenied(await asUser(plainToken, "DELETE", `/showcase_routes?id=eq.${row.id}`), "showcase_routes", "명단 밖 세션의 showcase_routes DELETE");

    // 함수 — 가드가 42501 로 막는다(메시지로 EXECUTE 거부와 갈린다)
    expectRaisedDenied(
      await rpcAs(plainToken, ROUTE_RPC.update, routeArgs(row, { p_price_from: 1, p_active: true })),
      "admin_update_route: 관리자 명단에 없는 호출자다",
      "명단 밖 세션의 admin_update_route",
    );
    expectRaisedDenied(
      await rpcAs(plainToken, ROUTE_RPC.setActive, { p_id: row.id, p_active: false }),
      "admin_set_route_active: 관리자 명단에 없는 호출자다",
      "명단 밖 세션의 admin_set_route_active",
    );

    const still = await rest("GET", `/showcase_routes?select=price_from,active&id=eq.${row.id}`);
    expect((still.body as RouteRow[])[0], "명단 밖 세션이 노선을 바꿨다").toEqual({ price_from: null, active: true });
    const all = await rest("GET", "/showcase_routes?select=id");
    expect((all.body as unknown[]).length, "명단 밖 세션이 노선을 만들거나 지웠다").toBe(16);
  });

  test("같은 쌍은 두 번 쓸 수 없다 — 23505 (앱이 duplicate 로 읽는 오류)", async () => {
    const all = await rest("GET", "/showcase_routes?select=id,origin_code,destination_code&order=id.asc");
    const rows = all.body as RouteRow[];
    const other = rows.find((r) => r.id !== (target as RouteRow).id) as RouteRow;
    // 화면과 같은 경로(definer 함수) — 함수는 23505 를 잡지 않고 그대로 올려 보낸다(0020 §5).
    const cur = await rest("GET", `/showcase_routes?select=${ROUTE_ADMIN_SELECT}&id=eq.${(target as RouteRow).id}`);
    const dup = await rpcAs(
      adminToken,
      ROUTE_RPC.update,
      routeArgs((cur.body as RouteRow[])[0], { p_origin_code: other.origin_code, p_destination_code: other.destination_code }),
    );
    // **권한 문제가 아니다** — 관리자는 이 행을 고칠 권한이 있고, 막는 것은 (origin_code, destination_code) unique 제약이다.
    // 그래서 권한 판정을 쓰지 않는다(쓰면 테스트의 뜻이 "관리자가 거부된다" 로 바뀐다).
    // P6-13 실측: 409 · 23505 · `duplicate key value violates unique constraint "showcase_routes_origin_code_destination_code_key"`.
    // 옛 단언은 상태를 `>= 400` 로만 보고 본문 어딘가에 "23505" 가 있으면 통과했다 — 500 의 설명문이 그 글자를 인용해도 통과한다.
    const body = dup.body as { code?: string; message?: string } | null;
    expect(dup.status, `중복이 409 가 아니다: ${JSON.stringify(dup.body).slice(0, 300)}`).toBe(409);
    expect(body?.code, "PostgreSQL unique_violation(23505) 이 아니다 — 앱은 이 코드로 duplicate 를 읽는다").toBe("23505");
    expect(body?.message, "막은 것이 (출발, 도착) unique 제약이 아니다").toContain("showcase_routes_origin_code_destination_code_key");
    // 대상 행은 그대로다 — 거절이 실제로 쓰기를 막았다
    const still = await rest("GET", `/showcase_routes?select=origin_code,destination_code&id=eq.${(target as RouteRow).id}`);
    expect((still.body as RouteRow[])[0]).toEqual({
      origin_code: (target as RouteRow).origin_code,
      destination_code: (target as RouteRow).destination_code,
    });
  });

  test("정리 — 고친 행을 원래 값으로 되돌리고 16행을 유지한다", async () => {
    const row = target as RouteRow;
    await rest("PATCH", `/showcase_routes?id=eq.${row.id}`, {
      origin_code: row.origin_code,
      destination_code: row.destination_code,
      price_from: row.price_from,
      highlight: row.highlight,
      sort: row.sort,
      active: row.active,
    });
    const back = await rest("GET", `/showcase_routes?select=${ROUTE_ADMIN_SELECT}&id=eq.${row.id}`);
    expect((back.body as RouteRow[])[0]).toEqual(row);

    const all = await rest("GET", "/showcase_routes?select=id");
    expect((all.body as unknown[]).length, "행이 늘거나 줄었다").toBe(16);

    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    for (const id of [adminId, plainId]) {
      if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
    }
  });
});
