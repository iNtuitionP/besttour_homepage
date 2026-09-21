/**
 * P5-5 — 관리자 공지 관리 탭 (플랜 v4 P5-5 · ADR-2·ADR-3·ADR-4 · CLAUDE.md §3·§7).
 *
 * 팝업 탭(P5-4)이 세운 패턴을 그대로 한 번 더 쓴다 — 순수 입력 모듈 + server-only 쿼리 모듈 + 얇은 액션.
 *
 * 이 태스크가 지키는 것:
 *   1. ~~마이그레이션 0건 · definer 함수 없이 0009 `notices_admin_all` 정책만으로 CRUD~~ — **P5-16(0020)이 뒤집었다.**
 *      세션 롤이 표에 UPDATE·DELETE 를 가지면 로그인만 한 사람이 표를 ACCESS EXCLUSIVE 로 잠글 수 있어서(known-defects D10),
 *      0020 이 `authenticated` 의 표 쓰기를 회수하고 쓰기를 `admin_*_notice*` definer 함수 4개로 옮겼다.
 *      읽기는 그대로 표에서(0020 `notices_admin_select`). 여전히 SSR 세션 클라이언트다 — 서비스 롤 0(ADR-2).
 *   2. **게시일은 KST 달력 날짜다**(0004 가 default 를 `(now() at time zone 'Asia/Seoul')::date` 로 바꿨다).
 *      폼이 `YYYY-MM-DD` 를 주고 서버는 **그 문자열을 그대로** date 컬럼에 넣는다.
 *   3. **본문은 plain text 다.** P6-3 상세가 `splitParagraphs` 로 문단만 나눠 렌더한다 — HTML 을 해석하지 않는다.
 *      그래서 이 탭 어디에도 raw-HTML 주입 prop 이 없어야 한다.
 *   4. **삭제보다 비활성화가 먼저다.** 공개 상세 URL(/notices/{id})이 문자로 나갔을 수 있다 —
 *      비활성화는 되돌릴 수 있지만(같은 id·같은 URL) 삭제는 serial id 가 재사용되지 않아 링크가 영구히 죽는다.
 *      그래서 목록의 기본 동작은 노출 중지이고, 진짜 삭제는 **한 단계 더** 확인을 받는다.
 *   5. **액션의 첫 문장은 게이트다.** scripts/check-admin-gate.mjs 가 구조로 강제하고 여기서는 거동으로 확인한다.
 *
 * 브리프 §검증 1~6 을 그대로 단언한다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

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

import { createNotice, deleteNotice, toggleNoticeActive, updateNotice } from "@/actions/admin/notice";
import {
  NOTICE_BODY_MAX,
  NOTICE_CATEGORIES,
  NOTICE_FIELDS,
  NOTICE_TITLE_MAX,
  isNoticeCategory,
  parseAdminNoticeId,
  parseNoticeForm,
  type NoticeValues,
} from "@/lib/admin/noticeInput";
import {
  ADMIN_NOTICES_PATH,
  NOTICE_ADMIN_COLUMNS,
  NOTICE_ADMIN_SELECT,
  NOTICE_RPC,
  NOTICE_TABLE,
  deleteNoticeRow,
  getAdminNotice,
  insertNotice,
  listAdminNotices,
  setNoticeActive,
  updateNoticeRow,
} from "@/lib/admin/notices";
import { PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE } from "@/lib/admin/publicRevalidate";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { revalidate } from "@/lib/ports/revalidate";
import { parseNoticeId } from "@/lib/queries/notices";
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

const ACTION = "actions/admin/notice.ts";
const LIB_INPUT = "lib/admin/noticeInput.ts";
const LIB_DB = "lib/admin/notices.ts";
const LIST_PAGE = "app/admin/(protected)/notices/page.tsx";
const EDIT_PAGE = "app/admin/(protected)/notices/[id]/page.tsx";
const FORM_UI = "components/admin/NoticeForm.tsx";
const TOGGLE_UI = "components/admin/NoticeToggle.tsx";
const TABS_DEF = "components/admin/tabs.ts";

const VALUES: NoticeValues = {
  title: "추석 연휴 운행 안내",
  body: "추석 연휴에도 예약을 받습니다.\n\n연휴 기간에는 배차가 빨리 마감됩니다.",
  category: "notice",
  publishedAt: "2026-09-15",
  active: true,
};

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const validForm = (over: Record<string, string> = {}): FormData =>
  form({
    [NOTICE_FIELDS.title]: VALUES.title,
    [NOTICE_FIELDS.body]: VALUES.body,
    [NOTICE_FIELDS.category]: VALUES.category,
    [NOTICE_FIELDS.publishedAt]: VALUES.publishedAt,
    [NOTICE_FIELDS.active]: "on",
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
  // 0020(P5-16) 뒤 쓰기는 definer 함수 RPC 다 — 표 체인이 아니라 이쪽으로 간다.
  const rpc = vi.fn(async () => result);
  return { client: { from, rpc }, chain: chain as Chain, from, rpc };
}

const ROW = {
  id: 12,
  title: VALUES.title,
  body: VALUES.body,
  category: VALUES.category,
  published_at: VALUES.publishedAt,
  active: true,
};

// =============================================================================
// 1. 입력 검증 (lib/admin/noticeInput.ts — 순수)
// =============================================================================
describe("1. 입력 검증", () => {
  test("정상 입력 — 값이 그대로 통과한다", () => {
    const parsed = parseNoticeForm(validForm());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(VALUES);
  });

  test("제목 — 공백만이면 거부, 상한을 넘으면 거부", () => {
    expect(parseNoticeForm(validForm({ [NOTICE_FIELDS.title]: "   " })).ok).toBe(false);
    const tooLong = parseNoticeForm(validForm({ [NOTICE_FIELDS.title]: "가".repeat(NOTICE_TITLE_MAX + 1) }));
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.result.fieldErrors?.title).toBe(true);
  });

  test("본문 — 비면 거부, 상한을 넘으면 거부, 줄바꿈은 살린다 (plain text)", () => {
    expect(parseNoticeForm(validForm({ [NOTICE_FIELDS.body]: "" })).ok).toBe(false);
    expect(parseNoticeForm(validForm({ [NOTICE_FIELDS.body]: "가".repeat(NOTICE_BODY_MAX + 1) })).ok).toBe(false);
    const parsed = parseNoticeForm(validForm({ [NOTICE_FIELDS.body]: "첫 문단\n\n둘째 문단" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.body).toBe("첫 문단\n\n둘째 문단");
  });

  test("카테고리 — 코드 3종만. 그 밖의 값·번역 문자열은 거부한다 (CLAUDE.md §3)", () => {
    for (const c of NOTICE_CATEGORIES) {
      expect(parseNoticeForm(validForm({ [NOTICE_FIELDS.category]: c })).ok, c).toBe(true);
    }
    for (const bad of ["", "urgent", "INFO", "공지", " info"]) {
      const parsed = parseNoticeForm(validForm({ [NOTICE_FIELDS.category]: bad }));
      expect(parsed.ok, bad).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.result.fieldErrors?.category, bad).toBe(true);
    }
    expect(isNoticeCategory("info")).toBe(true);
    expect(isNoticeCategory("nope")).toBe(false);
  });

  test("카테고리 코드는 화면 라벨(home.notice.category)과 같은 집합이다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { home: { notice: { category: Record<string, string> } } };
    expect([...NOTICE_CATEGORIES].sort()).toEqual(Object.keys(ko.home.notice.category).sort());
  });

  test("게시일 — KST 달력 날짜 형식만, 실존하지 않는 날은 거부", () => {
    for (const bad of ["", "2026-9-15", "2026/09/15", "2026-02-30", "2026-13-01", "2026-09-15T00:00"]) {
      const parsed = parseNoticeForm(validForm({ [NOTICE_FIELDS.publishedAt]: bad }));
      expect(parsed.ok, bad).toBe(false);
    }
    const leap = parseNoticeForm(validForm({ [NOTICE_FIELDS.publishedAt]: "2028-02-29" }));
    expect(leap.ok).toBe(true);
    if (!leap.ok) return;
    // Date 로 바꾸지 않는다 — 문자열 그대로여야 KST 00:00~08:59 에 하루가 밀리지 않는다
    expect(leap.value.publishedAt).toBe("2028-02-29");
  });

  test("활성 — 체크되지 않은 체크박스는 값 자체가 오지 않는다 → false", () => {
    const fd = validForm();
    fd.delete(NOTICE_FIELDS.active);
    const parsed = parseNoticeForm(fd);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.active).toBe(false);
  });

  test("id 파싱 — 양의 정수만. 공개 파서(lib/queries/notices.ts)와 판정이 같다", () => {
    for (const ok of ["1", "12", 7]) expect(parseAdminNoticeId(ok), String(ok)).toBe(Number(ok));
    for (const bad of ["", " ", "0", "-3", "1.5", "abc", "07", null, undefined, {}, 0, -1, 1.5]) {
      expect(parseAdminNoticeId(bad), JSON.stringify(bad)).toBeNull();
    }
    // 같은 값에 같은 답 — 관리자 링크와 공개 상세가 같은 id 규칙을 쓴다
    for (const sample of ["1", "12", "0", "-3", "1.5", "abc", "07", "2147483648"]) {
      expect(parseAdminNoticeId(sample), sample).toBe(parseNoticeId(sample));
    }
  });
});

// =============================================================================
// 2. 쿼리 계층 (lib/admin/notices.ts)
// =============================================================================
describe("2. 쿼리 계층", () => {
  beforeEach(() => vi.clearAllMocks());

  test("select 는 화이트리스트다 — * 가 없고 컬럼이 정확히 6개", () => {
    expect(NOTICE_ADMIN_COLUMNS).toEqual(["id", "title", "body", "category", "published_at", "active"]);
    expect(NOTICE_ADMIN_SELECT).toBe(NOTICE_ADMIN_COLUMNS.join(","));
    expect(NOTICE_ADMIN_SELECT).not.toContain("*");
    expect(NOTICE_TABLE).toBe("notices");
  });

  test("목록 — 최신 게시일 순, 동률은 id 최신 순. 비활성 행도 보인다", async () => {
    const { client, chain, from } = dbStub({ data: [ROW], error: null });
    const rows = await listAdminNotices(client as never);
    expect(from).toHaveBeenCalledWith(NOTICE_TABLE);
    expect(chain.select).toHaveBeenCalledWith(NOTICE_ADMIN_SELECT);
    expect(chain.order.mock.calls).toEqual([
      ["published_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    // 관리자는 내린 공지도 봐야 되살릴 수 있다 — active 로 거르지 않는다
    expect(chain.eq).not.toHaveBeenCalled();
    expect(rows).toEqual([ROW]);
  });

  test("상세 — id 로 한 건, 없으면 null", async () => {
    const { client, chain } = dbStub({ data: null, error: null });
    expect(await getAdminNotice(12, client as never)).toBeNull();
    expect(chain.eq).toHaveBeenCalledWith("id", 12);
    expect(chain.maybeSingle).toHaveBeenCalled();
  });

  test("오류는 던진다 — 행 내용을 섞지 않고 code·message 만", async () => {
    const { client } = dbStub({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(listAdminNotices(client as never)).rejects.toThrow(/42501.*permission denied/);
  });

  test("insert — 0020 의 admin_create_notice 에 화이트리스트 인자만 넘기고, 돌아온 행이 없으면 changed=false", async () => {
    const ok = dbStub({ data: [{ id: 3 }], error: null });
    expect(await insertNotice(VALUES, ok.client as never)).toBe(true);
    // 인자 = 컬럼 화이트리스트. id·created_at 같은 것은 넘기지 않는다(0020 §1). 게시일은 문자열 그대로(KST 달력 날짜).
    expect(ok.rpc.mock.calls).toEqual([
      [
        NOTICE_RPC.create,
        { p_title: VALUES.title, p_body: VALUES.body, p_category: VALUES.category, p_published_at: VALUES.publishedAt, p_active: VALUES.active },
      ],
    ]);
    expect(NOTICE_RPC.create).toBe("admin_create_notice");
    // 표에 직접 쓰지 않는다 — 0020 이 authenticated 의 표 insert 를 회수했다(D10).
    expect(ok.from).not.toHaveBeenCalled();

    const blocked = dbStub({ data: [], error: null });
    expect(await insertNotice(VALUES, blocked.client as never)).toBe(false);
  });

  test("update · delete · 활성 토글 — id 를 인자로 넘기고 바뀐 행이 있어야 true", async () => {
    const up = dbStub({ data: [{ id: 12 }], error: null });
    expect(await updateNoticeRow(12, VALUES, up.client as never)).toBe(true);
    expect(up.rpc).toHaveBeenCalledWith(NOTICE_RPC.update, expect.objectContaining({ p_id: 12, p_published_at: VALUES.publishedAt }));
    expect(NOTICE_RPC.update).toBe("admin_update_notice");

    const del = dbStub({ data: [{ id: 12 }], error: null });
    expect(await deleteNoticeRow(12, del.client as never)).toBe(true);
    expect(del.rpc.mock.calls).toEqual([["admin_delete_notice", { p_id: 12 }]]);

    const off = dbStub({ data: [{ id: 12 }], error: null });
    expect(await setNoticeActive(12, false, off.client as never)).toBe(true);
    // 노출 토글은 active 만 — 나머지 컬럼을 인자로 싣지 않는다
    expect(off.rpc.mock.calls).toEqual([["admin_set_notice_active", { p_id: 12, p_active: false }]]);

    for (const s of [up, del, off]) expect(s.from).not.toHaveBeenCalled();

    const none = dbStub({ data: [], error: null });
    expect(await updateNoticeRow(12, VALUES, none.client as never)).toBe(false);
  });

  test("가드 거부(명단 밖 세션)는 changed=false · EXECUTE 거부와 그 밖의 오류는 던진다 (lib/admin/adminRpc.ts)", async () => {
    // 함수의 is_admin() 가드 — 0020 이전 "정책에 막혀 0행" 과 같은 결과로 돌려준다.
    const guard = dbStub({ data: null, error: { code: "42501", message: "admin_update_notice: 관리자 명단에 없는 호출자다" } });
    expect(await updateNoticeRow(12, VALUES, guard.client as never)).toBe(false);
    // 같은 42501 이라도 EXECUTE 거부는 배포·마이그레이션 사고다 — "행이 없다" 로 삼키지 않는다.
    const exec = dbStub({ data: null, error: { code: "42501", message: "permission denied for function admin_update_notice" } });
    await expect(updateNoticeRow(12, VALUES, exec.client as never)).rejects.toThrow(/42501.*permission denied for function/);
    // 함수가 없다(적용 전 배포) — 던진다
    const missing = dbStub({ data: null, error: { code: "PGRST202", message: "Could not find the function public.admin_update_notice" } });
    await expect(updateNoticeRow(12, VALUES, missing.client as never)).rejects.toThrow(/PGRST202/);
  });
});

// =============================================================================
// 3. 서버액션 (actions/admin/notice.ts)
// =============================================================================
describe("3. 서버액션", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" });
  });

  test("등록 — requireAdmin 이 DB 보다 먼저 돈다", async () => {
    const { client, rpc } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await createNotice(validForm());
    // 0020 뒤 DB 호출은 RPC 한 번이다 — 그것이 실제로 불렸고, 게이트가 그보다 먼저다.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requireAdmin).mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  test("등록 — 성공하면 태그와 경로를 무효화한다", async () => {
    const { client } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await createNotice(validForm());
    expect(result).toEqual({ ok: true, changed: true, code: "created" });
    expect(vi.mocked(revalidate).mock.calls.map((c) => c[0])).toEqual([QUERY_TAGS.notices]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(ADMIN_NOTICES_PATH);
  });

  /**
   * 공개 화면 반영 — 2026-09-15 실측으로 정한 **유일하게 동작하는 형태**.
   * Next 15.5.24 + next-intl(as-needed) 프로브에서 `/[locale]/notices`·`/notices`·`/ko/notices` 는 page·layout 어느 쪽으로도
   * 아무 일도 하지 않았고, `revalidatePath("/", "layout")` 만 홈·/fares·/notices 를 전부 재생성했다(after() 안에서도 동일).
   * 그래서 이 단언은 "무효화를 부른다" 가 아니라 **"되는 형태로 부른다"** 를 잠근다.
   */
  test("등록 — 공개 화면 캐시를 루트 layout 으로 비운다 (경로 패턴은 조용히 실패한다)", async () => {
    const { client } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    await createNotice(validForm());
    expect(PUBLIC_CACHE_PATH, "루트가 아니면 로케일 세그먼트 아래 항목에 닿지 못한다").toBe("/");
    expect(PUBLIC_CACHE_SCOPE, "'page' 로 바꾸면 조용히 아무 일도 하지 않는다").toBe("layout");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
  });

  test("바뀐 것이 없으면 공개 화면도 비우지 않는다", async () => {
    const { client } = dbStub({ data: [], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    await updateNotice(validForm({ [NOTICE_FIELDS.id]: "12" }));
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  test("등록 — 검증에 걸리면 DB 를 부르지 않는다", async () => {
    const { client, from, rpc } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await createNotice(validForm({ [NOTICE_FIELDS.category]: "urgent" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("validation");
    // 0020 뒤 쓰기는 rpc 다 — from 만 보면 이 단언은 공허하게 통과한다(쓰기가 from 을 부르지 않으므로)
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  test("수정 — id 가 함께 와야 한다. 없거나 형식이 틀리면 DB 를 부르지 않는다", async () => {
    const { client, from, rpc } = dbStub({ data: [{ id: 12 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    expect((await updateNotice(validForm())).code).toBe("validation");
    expect((await updateNotice(validForm({ [NOTICE_FIELDS.id]: "abc" }))).code).toBe("validation");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();

    const result = await updateNotice(validForm({ [NOTICE_FIELDS.id]: "12" }));
    expect(result).toEqual({ ok: true, changed: true, code: "updated" });
    expect(rpc).toHaveBeenCalledWith("admin_update_notice", expect.objectContaining({ p_id: 12 }));
    expect(vi.mocked(revalidate).mock.calls.map((c) => c[0])).toEqual([QUERY_TAGS.notices]);
  });

  test("수정 — 바뀐 행이 0이면 notFound 이고 무효화하지 않는다", async () => {
    const { client } = dbStub({ data: [], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await updateNotice(validForm({ [NOTICE_FIELDS.id]: "12" }));
    expect(result).toEqual({ ok: false, changed: false, code: "notFound" });
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
  });

  test("삭제 · 활성 토글 — id 검증 뒤 한 번씩", async () => {
    const del = dbStub({ data: [{ id: 12 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(del.client as never);
    expect(await deleteNotice(12)).toEqual({ ok: true, changed: true, code: "deleted" });
    expect(del.rpc.mock.calls).toEqual([["admin_delete_notice", { p_id: 12 }]]);

    vi.clearAllMocks();
    const on = dbStub({ data: [{ id: 12 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(on.client as never);
    expect(await toggleNoticeActive(12, true)).toEqual({ ok: true, changed: true, code: "activated" });
    expect(on.rpc.mock.calls).toEqual([["admin_set_notice_active", { p_id: 12, p_active: true }]]);

    vi.clearAllMocks();
    const off = dbStub({ data: [{ id: 12 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(off.client as never);
    expect(await toggleNoticeActive(12, false)).toEqual({ ok: true, changed: true, code: "deactivated" });
    expect(off.rpc.mock.calls).toEqual([["admin_set_notice_active", { p_id: 12, p_active: false }]]);

    vi.clearAllMocks();
    const bad = dbStub({ data: [{ id: 12 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(bad.client as never);
    expect((await deleteNotice(-1)).code).toBe("validation");
    expect((await toggleNoticeActive(0, true)).code).toBe("validation");
    expect(bad.from).not.toHaveBeenCalled();
    expect(bad.rpc).not.toHaveBeenCalled();
  });

  test("DB 오류 — 예외를 밖으로 던지지 않고 failed 로 닫는다", async () => {
    const { client } = dbStub({ data: null, error: { code: "42501", message: "permission denied" } });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const result = await createNotice(validForm());
    expect(result).toEqual({ ok: false, changed: false, code: "failed" });
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
  });

  test("requireAdmin 이 리다이렉트(throw)하면 DB 는 돌지 않는다", async () => {
    const { client, from, rpc } = dbStub({ data: [{ id: 3 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(createNotice(validForm())).rejects.toThrow("NEXT_REDIRECT");
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

  test("액션 — 'use server' 첫 줄 · export 4개 · 전부 async · 첫 문장이 게이트", () => {
    const src = read(ACTION);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use server["'];?$/);
    const exports = [...codeOf(ACTION).matchAll(/^export\s+.*$/gm)].map((m) => m[0]);
    expect(exports.length, "'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다 (ADR-3)").toBe(4);
    for (const e of exports) expect(e, e).toMatch(/^export async function/);
    for (const name of ["createNotice", "updateNotice", "deleteNotice", "toggleNoticeActive"]) {
      const body = new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{\\s*await requireAdmin\\(\\);`);
      expect(codeOf(ACTION), `${name} 의 첫 문장이 게이트가 아니다`).toMatch(body);
    }
    // 별칭 import 금지(P5-4 리뷰 M2 — 다른 함수를 게이트 이름에 끼우는 경로)
    expect(src).toMatch(/import \{ requireAdmin \} from "@\/lib\/auth\/requireAdmin"/);
    expect(src).not.toMatch(/as requireAdmin/);
  });

  test("표에 직접 쓰지 않는다 — 쓰기는 0020 의 definer 함수(rpc)뿐이다 (known-defects D10)", () => {
    const code = codeOf(LIB_DB);
    expect(code, "lib/admin/notices.ts 가 표에 직접 쓴다 — 0020 뒤로 GRANT 가 없어 42501 로 실패한다").not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(code).toMatch(/\.rpc\(/);
    for (const fn of Object.values(NOTICE_RPC)) {
      expect(read("supabase/migrations/0020_admin_content_writes.sql"), `${fn} 이 0020 에 없다`).toContain(`create or replace function ${fn}(`);
    }
  });

  test("서비스 롤 0 · unstable_cache 0 — 관리자 경로 규약 (ADR-2)", () => {
    for (const rel of TS_TARGETS) {
      expect(read(rel), rel).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
      expect(codeOf(rel), rel).not.toMatch(/unstable_cache/);
    }
  });

  test("한글 리터럴 0 — 문구는 messages/ko.json admin.notices.* 에서만 온다", () => {
    for (const rel of TS_TARGETS) {
      const offenders = codeOf(rel)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(offenders, rel).toEqual([]);
    }
  });

  test("금액·가격 0 (CLAUDE.md §3) — 공지 탭에 가격은 아예 없다", () => {
    const forbidden = new RegExp(["est" + "_price", "price" + "_state", "route" + "_prices", "estim" + "ate\\(", "PRICE" + "_DISPLAY_MODE"].join("|"));
    for (const rel of TS_TARGETS) {
      expect(read(rel), rel).not.toMatch(forbidden);
      expect(codeOf(rel), rel).not.toMatch(/price/i);
    }
  });

  test("본문은 plain text 다 — raw-HTML 주입 prop 0 (P6-3 상세가 문단으로만 렌더한다)", () => {
    for (const rel of TS_TARGETS) {
      expect(read(rel), rel).not.toMatch(/dangerously/i);
    }
    // 공개 상세는 splitParagraphs 로만 렌더한다 — 이 태스크는 그 파일을 바꾸지 않는다
    expect(read("app/[locale]/(site)/notices/[id]/page.tsx")).toMatch(/splitParagraphs/);
  });

  test("공개 읽기 계층은 이 태스크가 고치지 않는다", () => {
    const pub = read("lib/queries/notices.ts");
    expect(pub).toMatch(/export async function getNotices/);
    expect(pub).toMatch(/export async function getNotice/);
    expect(pub).toMatch(/export function parseNoticeId/);
    // 관리자 쪽은 별도 모듈이다 — 공개 파일에 관리자 쓰기가 섞이지 않았다
    expect(pub).not.toMatch(/insert\(|update\(|delete\(/);
  });

  // P6-2 가 갤러리를, P5-8 이 발송 내역을 켰다 — 지금은 여섯 탭이다.
  test("탭 — 공지·대표 노선이 켜졌고 여섯 탭 전부 ready 다", async () => {
    const { ADMIN_TABS } = await import("@/components/admin/tabs");
    expect(ADMIN_TABS.map((t) => t.key)).toEqual(["reservations", "popups", "notices", "gallery", "routes", "notifications"]);
    expect(ADMIN_TABS.filter((t) => t.ready).map((t) => t.href)).toEqual([
      "/admin/reservations",
      "/admin/popups",
      "/admin/notices",
      "/admin/gallery",
      "/admin/routes",
      "/admin/notifications",
    ]);
    expect(ADMIN_TABS.find((t) => t.key === "notices")?.href).toBe(ADMIN_NOTICES_PATH);
    expect(ADMIN_TABS.find((t) => t.key === "gallery")?.ready).toBe(true);
    expect(read(TABS_DEF)).toContain("/admin/notices");
  });

  test("messages/ko.json — admin.notices 가 생겼고 기존 키는 그대로다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, Record<string, Record<string, unknown>>>;
    const notices = ko.admin.notices as Record<string, unknown>;
    for (const k of ["title", "sub", "listLabel", "empty", "new", "edit", "back", "notFound", "create", "save", "delete", "processing"]) {
      expect(notices[k], `admin.notices.${k}`).toBeTruthy();
    }
    for (const k of ["title", "body", "category", "publishedAt", "active"]) {
      expect((notices.field as Record<string, string>)[k], `admin.notices.field.${k}`).toBeTruthy();
    }
    for (const k of ["created", "updated", "deleted", "activated", "deactivated", "notFound", "validation", "failed"]) {
      expect((notices.result as Record<string, string>)[k], `admin.notices.result.${k}`).toBeTruthy();
    }
    // 삭제는 비활성화보다 무겁다 — 확인 단계의 문구가 있어야 한다
    expect(notices.deleteConfirm, "admin.notices.deleteConfirm").toBeTruthy();
    expect(notices.deleteArm, "admin.notices.deleteArm — 삭제 전 한 단계 더").toBeTruthy();
    // 기존 탭 키는 그대로
    expect((ko.admin.reservations as Record<string, unknown>).title).toBeTruthy();
    expect((ko.admin.popups as Record<string, unknown>).title).toBeTruthy();
    expect((ko.home.notice as Record<string, unknown>).category).toBeTruthy();
    // en 카탈로그에는 관리자 문구가 없다(관리자 화면은 로케일 밖 · 한국어 전용). P2-6 에서 en.json 이 공개 네임스페이스로 채워졌다.
    expect(JSON.parse(read("messages/en.json")).admin).toBeUndefined();
  });

  test("화면 — 두 페이지 모두 첫 문장이 게이트다", () => {
    for (const rel of [LIST_PAGE, EDIT_PAGE]) {
      expect(codeOf(rel), rel).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    }
  });

  /**
   * 세 콘텐츠 탭이 **같은 한 가지 방법**으로 공개 화면을 새로 그린다(공지·팝업·대표 노선).
   * 경로별 무효화로 되돌리는 변경을 여기서 잡는다 — 그 형태는 실측상 조용히 실패하므로, 테스트가 없으면
   * "무효화를 부르고 있으니 되겠지" 인 채로 10분 지연이 되살아난다.
   */
  test("공개 화면 반영은 세 탭이 같은 상수를 쓴다 · 경로 패턴 무효화 0건", () => {
    const actions = ["actions/admin/notice.ts", "actions/admin/route.ts", "actions/admin/popup.ts"];
    for (const rel of actions) {
      const src = codeOf(rel);
      expect(src, `${rel} 이 공개 캐시를 비우지 않는다`).toMatch(/revalidatePath\(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE\)/);
      expect(src, `${rel} 이 상수 대신 리터럴을 적었다`).not.toMatch(/revalidatePath\("\/", ?"layout"\)/);
      // 실측상 아무 일도 하지 않는 형태들 — 되살아나면 실패한다
      expect(src, `${rel} 에 로케일 경로 패턴 무효화`).not.toMatch(/revalidatePath\(\s*["'`]\/\[locale\]/);
      expect(src, `${rel} 에 공개 URL 경로 무효화`).not.toMatch(/revalidatePath\(\s*["'`]\/(notices|fares)/);
    }
    expect(read("lib/admin/publicRevalidate.ts"), "실측 근거가 파일에 남아 있어야 한다").toMatch(/revalidatePath\("\/",\s*"layout"\)/);
  });

  test("클라이언트 컴포넌트 2종은 'use client' 로 시작한다", () => {
    for (const rel of [FORM_UI, TOGGLE_UI]) {
      expect(read(rel).split("\n")[0].trim(), rel).toMatch(/^["']use client["'];?$/);
    }
  });

  test("삭제는 비활성화 다음이다 — 목록에는 삭제가 없고, 수정 화면의 삭제는 한 단계 더 받는다", () => {
    // 목록에서 바로 지울 수 없다: 목록이 부르는 액션은 토글뿐이다
    expect(codeOf(TOGGLE_UI)).toMatch(/toggleNoticeActive/);
    expect(codeOf(TOGGLE_UI)).not.toMatch(/deleteNotice/);
    expect(codeOf(LIST_PAGE)).not.toMatch(/deleteNotice/);

    // 수정 화면의 삭제는 무장(체크) + 확인(confirm) 두 단계다
    const formSrc = codeOf(FORM_UI);
    expect(formSrc).toMatch(/deleteNotice/);
    expect(formSrc, "삭제 버튼은 무장하기 전에는 비활성이어야 한다").toMatch(/armed/);
    expect(formSrc).toMatch(/window\.confirm/);
  });
});

// =============================================================================
// 5. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 에서만 (원격에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-notices.test] DB 실증 블록 skip — ${gate.reason}`);
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

describe.skipIf(!gate.allowed || !env.hasServiceRole)("5. DB — notices RLS 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", { timeout: 60_000 }, () => {
  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `p55-${randomUUID()}`;
  const emailFor = (who: string) => `p55-${RUN}-${who}@example.test`;

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

  const TITLE = `P55 ${RUN}`;
  let adminId = "";
  let plainId = "";
  let adminToken = "";
  let plainToken = "";
  let noticeId = 0;

  test("준비 — 관리자 1명 · 일반 로그인 1명", async () => {
    const probe = await rest("GET", "/notices?select=id&limit=1");
    expect(probe.status, "0009 이전 마이그레이션이 적용되지 않았다").toBe(200);

    adminId = await createUser(emailFor("admin"));
    plainId = await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P5-5 test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
  });

  /** 0020 뒤 관리자 쓰기의 유일한 경로 — lib/admin/notices.ts 가 부르는 것과 같은 definer 함수 RPC. */
  const rpcAs = (token: string, fn: string, args: Record<string, unknown>) => asUser(token, "POST", `/rpc/${fn}`, args);
  const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const argsOf = (over: Record<string, unknown> = {}) => ({
    p_title: TITLE,
    p_body: "P5-5",
    p_category: "info",
    p_published_at: kstToday(),
    p_active: true,
    ...over,
  });

  test("관리자 세션 — 만들기 · 고치기 · 내리기 · 되살리기가 통하고 비활성 행도 보인다 (0020 definer 함수)", async () => {
    const ins = await rpcAs(adminToken, NOTICE_RPC.create, argsOf());
    expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(200);
    const made = ins.body as { id: number }[];
    expect(made.length, "만들기가 새 id 를 돌려주지 않았다").toBe(1);
    noticeId = made[0].id;

    const up = await rpcAs(adminToken, NOTICE_RPC.update, { p_id: noticeId, ...argsOf({ p_title: `${TITLE} edited` }) });
    expect(up.status, JSON.stringify(up.body).slice(0, 300)).toBe(200);
    expect(up.body, "고치기가 바뀐 행을 돌려주지 않았다").toEqual([{ id: noticeId }]);
    const edited = await rest("GET", `/notices?select=title&id=eq.${noticeId}`);
    expect((edited.body as { title: string }[])[0].title).toBe(`${TITLE} edited`);

    const off = await rpcAs(adminToken, NOTICE_RPC.setActive, { p_id: noticeId, p_active: false });
    expect(off.body, JSON.stringify(off.body).slice(0, 200)).toEqual([{ id: noticeId }]);
    // 비공개 행 읽기 — 0020 이 0009 `_admin_all` 을 좁힌 `notices_admin_select` 로 관리자 세션이 표에서 직접 읽는다.
    const hidden = await asUser(adminToken, "GET", `/notices?select=id,active&id=eq.${noticeId}`);
    expect((hidden.body as { active: boolean }[])[0]?.active, "관리자가 비활성 행을 못 보면 되살릴 수 없다").toBe(false);
    const back = await rpcAs(adminToken, NOTICE_RPC.setActive, { p_id: noticeId, p_active: true });
    expect(back.body, JSON.stringify(back.body).slice(0, 200)).toEqual([{ id: noticeId }]);

    // 없는 id — 오류가 아니라 0행(앱이 notFound 로 읽는다)
    const none = await rpcAs(adminToken, NOTICE_RPC.update, { p_id: 2147483646, ...argsOf() });
    expect(none.status, JSON.stringify(none.body).slice(0, 200)).toBe(200);
    expect(none.body).toEqual([]);
  });

  test("명단에 없는 로그인 세션 — 표 직접 쓰기는 GRANT 층, 함수는 가드가 거부한다", async () => {
    // 표 직접 쓰기 — 0020 이 authenticated 의 insert·update·delete 를 회수했다: 403 · 42501 · permission denied for table notices.
    expectTablePrivilegeDenied(
      await asUser(plainToken, "POST", "/notices", { title: `${TITLE} intruder`, body: "x", category: "info", published_at: kstToday() }),
      "notices",
      "명단 밖 세션의 notices INSERT",
    );
    expectTablePrivilegeDenied(await asUser(plainToken, "PATCH", `/notices?id=eq.${noticeId}`, { title: "hijacked" }), "notices", "명단 밖 세션의 notices UPDATE");
    expectTablePrivilegeDenied(await asUser(plainToken, "DELETE", `/notices?id=eq.${noticeId}`), "notices", "명단 밖 세션의 notices DELETE");

    // 함수 — EXECUTE 는 authenticated 에 있다. 첫 문장의 is_admin() 가드가 막는다(메시지로 EXECUTE 거부와 갈린다).
    for (const [fn, args] of [
      [NOTICE_RPC.create, argsOf({ p_title: `${TITLE} intruder` })],
      [NOTICE_RPC.update, { p_id: noticeId, ...argsOf({ p_title: "hijacked" }) }],
      [NOTICE_RPC.setActive, { p_id: noticeId, p_active: false }],
      [NOTICE_RPC.delete, { p_id: noticeId }],
    ] as const) {
      expectRaisedDenied(await rpcAs(plainToken, fn, args), `${fn}: 관리자 명단에 없는 호출자다`, `명단 밖 세션의 ${fn}`);
    }

    const still = await rest("GET", `/notices?select=title,active&id=eq.${noticeId}`);
    expect(still.body).toEqual([{ title: `${TITLE} edited`, active: true }]);
    const intruder = await rest("GET", `/notices?select=id&title=eq.${encodeURIComponent(`${TITLE} intruder`)}`);
    expect(intruder.body, "명단 밖 세션이 공지를 만들었다").toEqual([]);
  });

  test("anon — 활성 행만 보인다 (공개 정책 회귀)", async () => {
    const visible = await asAnon(`/notices?select=id&id=eq.${noticeId}`);
    expect(visible.status, JSON.stringify(visible.body).slice(0, 200)).toBe(200);
    expect((visible.body as unknown[]).length, "활성 공지가 anon 에게 보이지 않는다").toBe(1);

    await rest("PATCH", `/notices?id=eq.${noticeId}`, { active: false });
    const off = await asAnon(`/notices?select=id&id=eq.${noticeId}`);
    expect((off.body as unknown[]).length, "비활성 공지가 anon 에게 보인다").toBe(0);
    await rest("PATCH", `/notices?id=eq.${noticeId}`, { active: true });
  });

  /**
   * 0004 의 컬럼 default. 0020 뒤로 관리자 화면은 게시일을 **언제나 인자로 넘긴다**(폼의 필수 항목 · admin_create_notice 의 p_published_at) —
   * 그래서 이 default 를 타는 경로는 관리자 화면이 아니라 서비스 롤·시드다. 컬럼 default 자체를 확인하는 것이 이 테스트의 뜻이므로
   * 서비스 롤로 넣는다(서비스 롤의 표 권한은 0020 이 건드리지 않았다).
   */
  test("게시일 default 는 KST 다 (0004) — published_at 을 주지 않아도 서울 날짜가 찍힌다", async () => {
    const ins = await rest("POST", "/notices", { title: `${TITLE} kst`, body: "x", category: "info" }, "return=representation");
    expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(201);
    const row = (ins.body as { id: number; published_at: string }[])[0];
    expect(row.published_at).toBe(kstToday());
    await rest("DELETE", `/notices?id=eq.${row.id}`);
  });

  test("관리자 세션 — 자기가 만든 행을 지운다 · 두 번째 지우기는 0행이다", async () => {
    const del = await rpcAs(adminToken, NOTICE_RPC.delete, { p_id: noticeId });
    expect(del.status, JSON.stringify(del.body).slice(0, 200)).toBe(200);
    expect(del.body).toEqual([{ id: noticeId }]);
    const left = await rest("GET", `/notices?select=id&id=eq.${noticeId}`);
    expect(left.body).toEqual([]);
    const again = await rpcAs(adminToken, NOTICE_RPC.delete, { p_id: noticeId });
    expect(again.status).toBe(200);
    expect(again.body, "없는 id 의 삭제가 0행이 아니다").toEqual([]);
  });

  test("정리 — 만든 것을 전부 지운다", async () => {
    await rest("DELETE", `/notices?title=like.${encodeURIComponent(`*${RUN}*`)}`);
    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    for (const id of [adminId, plainId]) {
      if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
    }
    const leftNotices = await rest("GET", `/notices?select=id&title=like.${encodeURIComponent(`*${RUN}*`)}`);
    expect(leftNotices.body).toEqual([]);
  });
});
