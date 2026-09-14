/**
 * P5-4 Part 2 — 관리자 팝업 관리 탭 (플랜 v4 P5-4 · ADR-2·ADR-3·ADR-4 · CLAUDE.md §3·§7).
 *
 * 이 태스크가 지키는 것:
 *   1. **쓰기에도 definer 함수가 필요 없다.** popups 는 0009 가 `for all to authenticated using (is_admin()) with check (is_admin())`
 *      를 이미 걸었고 컬럼이 전부 콘텐츠다(개인정보·보유기간 없음). 예약처럼 원자적 전이·통지가 얽히지 않으므로
 *      SSR 세션 클라이언트 + RLS 로 곧장 CRUD 한다 — 마이그레이션 0건.
 *   2. **기간은 KST 벽시계 날짜다.** 폼은 `YYYY-MM-DD` 를 받고 서버는 그 문자열을 그대로 `date` 컬럼에 넣는다.
 *      노출 판정은 0004 의 정책(Asia/Seoul)과 lib/queries/popups.ts `isActiveOn` 이 한다 — 그 파일은 건드리지 않는다.
 *   3. **액션의 첫 문장은 게이트다.** scripts/check-admin-gate.sh 가 구조로 강제하고, 여기서는 거동으로 확인한다
 *      (requireAdmin 이 rpc·DB 호출보다 먼저 돈다 · 검증 실패면 DB 를 부르지 않는다).
 *
 * 브리프 §검증 1~6 을 그대로 단언한다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

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

import { createPopup, deletePopup, togglePopupActive, updatePopup } from "@/actions/admin/popup";
import {
  ADMIN_POPUPS_PATH,
  POPUP_ADMIN_COLUMNS,
  POPUP_ADMIN_SELECT,
  POPUP_TABLE,
  deletePopupRow,
  getAdminPopup,
  insertPopup,
  listAdminPopups,
  popupState,
  setPopupActive,
  updatePopupRow,
} from "@/lib/admin/popups";
import {
  POPUP_BODY_MAX,
  POPUP_FIELDS,
  POPUP_TITLE_MAX,
  parsePopupForm,
  parsePopupId,
  type PopupValues,
} from "@/lib/admin/popupInput";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";
import { createSsrClient } from "@/lib/supabase/ssr";

// =============================================================================
// 공통 헬퍼
// =============================================================================
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8");
const exists = (rel: string): boolean => existsSync(path.join(ROOT, rel));
const HANGUL = /[가-힣]/;

/** 주석·문자열 안의 내용은 검사에서 빼기 위한 최소 제거기(tests/admin-reservations.test.ts 와 같은 구현). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const ACTION = "actions/admin/popup.ts";
const LIB_INPUT = "lib/admin/popupInput.ts";
const LIB_DB = "lib/admin/popups.ts";
const LIST_PAGE = "app/admin/(protected)/popups/page.tsx";
const EDIT_PAGE = "app/admin/(protected)/popups/[id]/page.tsx";
const FORM_UI = "components/admin/PopupForm.tsx";
const TOGGLE_UI = "components/admin/PopupToggle.tsx";
const SAMPLE_UI = "components/admin/PopupSample.tsx";
const TABS_DEF = "components/admin/tabs.ts";

const VALUES: PopupValues = {
  title: "여름 성수기 예약 안내",
  body: "7월 20일부터 8월 31일까지는 예약이 몰립니다.",
  imagePath: "hero/bus-02.jpg",
  startsAt: "2026-08-08",
  endsAt: "2026-08-31",
  active: true,
};

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const validForm = (over: Record<string, string> = {}): FormData =>
  form({
    [POPUP_FIELDS.title]: VALUES.title,
    [POPUP_FIELDS.body]: VALUES.body,
    [POPUP_FIELDS.imagePath]: VALUES.imagePath as string,
    [POPUP_FIELDS.startsAt]: VALUES.startsAt,
    [POPUP_FIELDS.endsAt]: VALUES.endsAt,
    [POPUP_FIELDS.active]: "on",
    ...over,
  });

/** supabase 쿼리 빌더 흉내 — 체인 메서드는 자기 자신을, await 는 주어진 결과를 돌려준다. */
interface Chain {
  [method: string]: ReturnType<typeof vi.fn>;
}
function dbStub(result: { data: unknown; error: unknown }): { client: { from: ReturnType<typeof vi.fn> }; chain: Chain; from: ReturnType<typeof vi.fn> } {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "eq", "insert", "update", "delete", "maybeSingle", "overrideTypes"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  const from = vi.fn(() => chain);
  return { client: { from }, chain: chain as Chain, from };
}

const ROW = {
  id: 7,
  title: VALUES.title,
  body: VALUES.body,
  image_path: VALUES.imagePath,
  starts_at: VALUES.startsAt,
  ends_at: VALUES.endsAt,
  active: true,
  created_at: "2026-08-01T00:00:00.000Z",
};

// =============================================================================
// 1. 입력 검증 (lib/admin/popupInput.ts — 순수)
// =============================================================================
describe("1. 입력 검증", () => {
  test("정상 입력 — 값이 그대로 통과하고 이미지 경로는 문자열이다", () => {
    const parsed = parsePopupForm(validForm());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(VALUES);
  });

  test("제목 — 공백만이면 거부, 상한을 넘으면 거부", () => {
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.title]: "   " })).ok).toBe(false);
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.title]: "가".repeat(POPUP_TITLE_MAX) })).ok).toBe(true);
    const tooLong = parsePopupForm(validForm({ [POPUP_FIELDS.title]: "가".repeat(POPUP_TITLE_MAX + 1) }));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.result.fieldErrors?.title).toBe(true);
  });

  test("본문 — 비면 거부, 상한을 넘으면 거부, 줄바꿈은 살린다", () => {
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.body]: "" })).ok).toBe(false);
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.body]: "나".repeat(POPUP_BODY_MAX + 1) })).ok).toBe(false);
    const parsed = parsePopupForm(validForm({ [POPUP_FIELDS.body]: "첫 줄\n둘째 줄" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.body).toBe("첫 줄\n둘째 줄");
  });

  test("이미지 경로 — 빈 값은 null, 상대·로컬 경로는 허용, 그 밖의 형식은 거부", () => {
    const empty = parsePopupForm(validForm({ [POPUP_FIELDS.imagePath]: "  " }));
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.imagePath).toBeNull();

    for (const ok of ["hero/bus-02.jpg", "/hero/bus-02.jpg", "popups/2026-summer.png", "a/b/c/d.webp"]) {
      expect(parsePopupForm(validForm({ [POPUP_FIELDS.imagePath]: ok })).ok, ok).toBe(true);
    }
    for (const bad of [
      "https://example.com/x.jpg",
      "javascript:alert(1)",
      "../../etc/passwd.jpg",
      "hero/bus.exe",
      "hero/bus",
      "hero\\bus.jpg",
      "<script>.jpg",
    ]) {
      expect(parsePopupForm(validForm({ [POPUP_FIELDS.imagePath]: bad })).ok, bad).toBe(false);
    }
  });

  test("기간 — 형식·실존 날짜·시작 ≤ 종료", () => {
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.startsAt]: "2026-8-8" })).ok).toBe(false);
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.startsAt]: "2026-02-30" })).ok).toBe(false);
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.startsAt]: "2026-13-01" })).ok).toBe(false);
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.endsAt]: "" })).ok).toBe(false);

    // 같은 날 하루짜리는 허용(0001 의 check 제약과 같은 구간 규칙)
    expect(parsePopupForm(validForm({ [POPUP_FIELDS.startsAt]: "2026-08-08", [POPUP_FIELDS.endsAt]: "2026-08-08" })).ok).toBe(true);

    const reversed = parsePopupForm(validForm({ [POPUP_FIELDS.startsAt]: "2026-09-01", [POPUP_FIELDS.endsAt]: "2026-08-31" }));
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) expect(reversed.result.fieldErrors?.endsAt).toBe(true);
  });

  test("활성 토글 — 체크되지 않은 체크박스는 값 자체가 오지 않는다 → false", () => {
    const off = new FormData();
    off.set(POPUP_FIELDS.title, VALUES.title);
    off.set(POPUP_FIELDS.body, VALUES.body);
    off.set(POPUP_FIELDS.startsAt, VALUES.startsAt);
    off.set(POPUP_FIELDS.endsAt, VALUES.endsAt);
    const parsed = parsePopupForm(off);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.active).toBe(false);
  });

  test("id 파싱 — 양의 정수만, 그 밖에는 null (DB 를 부르지 않기 위한 관문)", () => {
    expect(parsePopupId("7")).toBe(7);
    for (const bad of ["0", "-1", "1.5", "7a", "", " ", "1e3", null, undefined, {}, Number.NaN]) {
      expect(parsePopupId(bad as unknown), String(bad)).toBeNull();
    }
  });

  test("노출 상태 — 활성·기간으로 네 가지 (판정은 lib/queries/popups.ts isActiveOn 하나)", () => {
    const row = { active: true, starts_at: "2026-08-08", ends_at: "2026-08-31" };
    expect(popupState(row, "2026-08-10")).toBe("live");
    expect(popupState(row, "2026-08-01")).toBe("scheduled");
    expect(popupState(row, "2026-09-01")).toBe("ended");
    expect(popupState({ ...row, active: false }, "2026-08-10")).toBe("off");
    // 경계 — 양 끝 포함
    expect(popupState(row, "2026-08-08")).toBe("live");
    expect(popupState(row, "2026-08-31")).toBe("live");
  });
});

// =============================================================================
// 2. 쿼리 계층 (lib/admin/popups.ts)
// =============================================================================
describe("2. 쿼리 계층", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("select 는 화이트리스트다 — * 가 없고 컬럼이 정확히 8개", () => {
    expect(POPUP_ADMIN_SELECT).toBe(POPUP_ADMIN_COLUMNS.join(","));
    expect(POPUP_ADMIN_SELECT).not.toContain("*");
    expect([...POPUP_ADMIN_COLUMNS]).toEqual(["id", "title", "body", "image_path", "starts_at", "ends_at", "active", "created_at"]);
  });

  test("목록 — 최신 시작일 순, 동률은 id 최신 순", async () => {
    const { client, chain, from } = dbStub({ data: [ROW], error: null });
    const rows = await listAdminPopups(client as never);
    expect(from).toHaveBeenCalledWith(POPUP_TABLE);
    expect(chain.select).toHaveBeenCalledWith(POPUP_ADMIN_SELECT);
    expect(chain.order.mock.calls).toEqual([
      ["starts_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(rows).toEqual([ROW]);
  });

  test("상세 — id 로 한 건, 없으면 null", async () => {
    const { client, chain } = dbStub({ data: null, error: null });
    expect(await getAdminPopup(7, client as never)).toBeNull();
    expect(chain.eq).toHaveBeenCalledWith("id", 7);
  });

  test("오류는 던진다 — 행 내용을 섞지 않고 code·message 만", async () => {
    const { client } = dbStub({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(listAdminPopups(client as never)).rejects.toThrow(/42501/);
  });

  test("insert — 컬럼 이름으로 바꿔 넣고, 돌아온 행이 없으면 changed=false (RLS 에 막힌 경우)", async () => {
    const ok = dbStub({ data: [{ id: 9 }], error: null });
    expect(await insertPopup(VALUES, ok.client as never)).toBe(true);
    expect(ok.chain.insert).toHaveBeenCalledWith({
      title: VALUES.title,
      body: VALUES.body,
      image_path: VALUES.imagePath,
      starts_at: VALUES.startsAt,
      ends_at: VALUES.endsAt,
      active: VALUES.active,
    });

    const blocked = dbStub({ data: [], error: null });
    expect(await insertPopup(VALUES, blocked.client as never)).toBe(false);
  });

  test("update · delete · 활성 토글 — id 로 거르고 바뀐 행이 있어야 true", async () => {
    const up = dbStub({ data: [{ id: 7 }], error: null });
    expect(await updatePopupRow(7, VALUES, up.client as never)).toBe(true);
    expect(up.chain.eq).toHaveBeenCalledWith("id", 7);

    const del = dbStub({ data: [{ id: 7 }], error: null });
    expect(await deletePopupRow(7, del.client as never)).toBe(true);
    expect(del.chain.delete).toHaveBeenCalled();

    const toggle = dbStub({ data: [{ id: 7 }], error: null });
    expect(await setPopupActive(7, false, toggle.client as never)).toBe(true);
    expect(toggle.chain.update).toHaveBeenCalledWith({ active: false });

    const gone = dbStub({ data: [], error: null });
    expect(await deletePopupRow(7, gone.client as never)).toBe(false);
  });
});

// =============================================================================
// 3. 서버액션 (actions/admin/popup.ts)
// =============================================================================
describe("3. 서버액션", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin-uuid", email: "owner@example.test" });
  });

  test("등록 — requireAdmin 이 DB 보다 먼저 돈다", async () => {
    const { client, from } = dbStub({ data: [{ id: 9 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    await createPopup(validForm());
    expect(vi.mocked(requireAdmin).mock.invocationCallOrder[0]).toBeLessThan(from.mock.invocationCallOrder[0]);
  });

  test("등록 — 성공하면 태그와 경로를 무효화한다", async () => {
    const { client } = dbStub({ data: [{ id: 9 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await createPopup(validForm());
    expect(result).toEqual({ ok: true, changed: true, code: "created" });
    expect(vi.mocked(revalidate).mock.calls.map((c) => c[0])).toEqual([QUERY_TAGS.popups]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(ADMIN_POPUPS_PATH);
  });

  test("등록 — 검증에 걸리면 DB 를 부르지 않는다", async () => {
    const { client, from } = dbStub({ data: [{ id: 9 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await createPopup(validForm({ [POPUP_FIELDS.title]: "" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("validation");
    expect(from).not.toHaveBeenCalled();
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  test("수정 — id 가 함께 와야 한다. 없거나 형식이 틀리면 DB 를 부르지 않는다", async () => {
    const { client, from } = dbStub({ data: [{ id: 7 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    expect((await updatePopup(validForm())).code).toBe("validation");
    expect((await updatePopup(validForm({ [POPUP_FIELDS.id]: "abc" }))).code).toBe("validation");
    expect(from).not.toHaveBeenCalled();

    const result = await updatePopup(validForm({ [POPUP_FIELDS.id]: "7" }));
    expect(result).toEqual({ ok: true, changed: true, code: "updated" });
    expect(vi.mocked(revalidate).mock.calls.map((c) => c[0])).toEqual([QUERY_TAGS.popups]);
  });

  test("수정 — 바뀐 행이 0이면 notFound 이고 무효화하지 않는다", async () => {
    const { client } = dbStub({ data: [], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    const result = await updatePopup(validForm({ [POPUP_FIELDS.id]: "7" }));
    expect(result).toEqual({ ok: false, changed: false, code: "notFound" });
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
  });

  test("삭제 · 활성 토글 — id 검증 뒤 한 번씩", async () => {
    const del = dbStub({ data: [{ id: 7 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(del.client as never);
    expect(await deletePopup(7)).toEqual({ ok: true, changed: true, code: "deleted" });
    expect(del.chain.delete).toHaveBeenCalled();

    vi.clearAllMocks();
    const on = dbStub({ data: [{ id: 7 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(on.client as never);
    expect(await togglePopupActive(7, true)).toEqual({ ok: true, changed: true, code: "activated" });

    vi.clearAllMocks();
    const off = dbStub({ data: [{ id: 7 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(off.client as never);
    expect(await togglePopupActive(7, false)).toEqual({ ok: true, changed: true, code: "deactivated" });

    vi.clearAllMocks();
    const bad = dbStub({ data: [{ id: 7 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(bad.client as never);
    expect((await deletePopup(-1)).code).toBe("validation");
    expect((await togglePopupActive(0, true)).code).toBe("validation");
    expect(bad.from).not.toHaveBeenCalled();
  });

  test("DB 오류 — 예외를 밖으로 던지지 않고 failed 로 닫는다", async () => {
    const { client } = dbStub({ data: null, error: { code: "42501", message: "permission denied" } });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    const result = await createPopup(validForm());
    expect(result).toEqual({ ok: false, changed: false, code: "failed" });
    expect(vi.mocked(revalidate)).not.toHaveBeenCalled();
  });

  test("requireAdmin 이 리다이렉트(throw)하면 DB 는 돌지 않는다", async () => {
    const { client, from } = dbStub({ data: [{ id: 9 }], error: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(createPopup(validForm())).rejects.toThrow("NEXT_REDIRECT");
    expect(from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 4. 정적 규약
// =============================================================================
describe("4. 정적 규약", () => {
  const TS_TARGETS = [ACTION, LIB_INPUT, LIB_DB, LIST_PAGE, EDIT_PAGE, FORM_UI, TOGGLE_UI, SAMPLE_UI];

  test("산출물 파일이 전부 있다", () => {
    for (const rel of TS_TARGETS) expect(exists(rel), rel).toBe(true);
  });

  test("액션 — 'use server' 첫 줄 · export 4개 · 전부 async · 첫 문장이 게이트", () => {
    const src = read(ACTION);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use server["'];?$/);
    const exports = [...stripComments(src).matchAll(/^export\s+.*$/gm)].map((m) => m[0]);
    expect(exports.length, "'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다 (ADR-3)").toBe(4);
    for (const e of exports) expect(e, e).toMatch(/^export async function/);
    for (const name of ["createPopup", "updatePopup", "deletePopup", "togglePopupActive"]) {
      const body = new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{\\s*await requireAdmin\\(\\);`);
      expect(stripComments(src), `${name} 의 첫 문장이 게이트가 아니다`).toMatch(body);
    }
  });

  test("서비스 롤 0 · unstable_cache 0 — 관리자 경로 규약 (ADR-2)", () => {
    for (const rel of TS_TARGETS) {
      expect(read(rel), rel).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
      expect(stripComments(read(rel)), rel).not.toMatch(/unstable_cache/);
    }
  });

  test("한글 리터럴 0 — 문구는 messages/ko.json admin.popups.* 에서만 온다", () => {
    for (const rel of TS_TARGETS) {
      const offenders = stripComments(read(rel))
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(offenders, rel).toEqual([]);
    }
  });

  test("금액·가격 0 (CLAUDE.md §3)", () => {
    const forbidden = new RegExp(["est" + "_price", "price" + "_state", "route" + "_prices", "estim" + "ate\\(", "PRICE" + "_DISPLAY_MODE"].join("|"));
    for (const rel of TS_TARGETS) expect(read(rel), rel).not.toMatch(forbidden);
  });

  test("공개 판정 함수를 재사용한다 — 판정 기준이 둘로 갈리지 않는다", () => {
    expect(stripComments(read(LIB_DB))).toMatch(/isActiveOn/);
    // lib/queries/popups.ts 는 이번 태스크가 고치지 않는다(브리프). 공개 규칙은 그 파일 하나다.
    expect(read("lib/queries/popups.ts")).toMatch(/export function isActiveOn/);
  });

  test("미리보기는 공개 팝업 컴포넌트를 그대로 쓴다 — 관리자 전용 사본이 없다", () => {
    expect(stripComments(read(EDIT_PAGE))).toMatch(/HomePopup/);
    expect(exists("components/admin/HomePopup.tsx"), "관리자 전용 사본을 만들지 않는다").toBe(false);
  });

  test("탭 — 팝업이 켜졌고 나머지 3개는 자리를 지킨다", async () => {
    const { ADMIN_TABS } = await import("@/components/admin/tabs");
    expect(ADMIN_TABS.filter((t) => t.ready).map((t) => t.href)).toEqual(["/admin/reservations", "/admin/popups"]);
    expect(ADMIN_TABS.find((t) => t.key === "popups")?.href).toBe(ADMIN_POPUPS_PATH);
    expect(read(TABS_DEF)).toContain("/admin/popups");
  });

  test("messages/ko.json — admin.popups 가 생겼고 기존 키는 그대로다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, Record<string, Record<string, unknown>>>;
    const keys = Object.keys(ko);
    expect(keys[keys.length - 1]).toBe("admin");
    const popups = ko.admin.popups as Record<string, unknown>;
    for (const k of ["title", "sub", "listLabel", "empty", "new", "edit", "back", "notFound", "create", "save", "delete", "processing", "notice"]) {
      expect(popups[k], `admin.popups.${k}`).toBeTruthy();
    }
    for (const k of ["title", "body", "imagePath", "startsAt", "endsAt", "active"]) {
      expect((popups.field as Record<string, string>)[k], `admin.popups.field.${k}`).toBeTruthy();
    }
    for (const k of ["live", "scheduled", "ended", "off"]) {
      expect((popups.state as Record<string, string>)[k], `admin.popups.state.${k}`).toBeTruthy();
    }
    for (const k of ["created", "updated", "deleted", "activated", "deactivated", "notFound", "validation", "failed"]) {
      expect((popups.result as Record<string, string>)[k], `admin.popups.result.${k}`).toBeTruthy();
    }
    // 예약 탭 키는 그대로
    expect((ko.admin.reservations as Record<string, unknown>).title).toBeTruthy();
    expect((ko.admin.detail as Record<string, unknown>).title).toBeTruthy();
    expect(JSON.parse(read("messages/en.json"))).toEqual({});
  });

  test("화면 — 두 페이지 모두 첫 문장이 게이트다", () => {
    for (const rel of [LIST_PAGE, EDIT_PAGE]) {
      expect(stripComments(read(rel)), rel).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    }
  });

  test("클라이언트 컴포넌트 3종은 'use client' 로 시작하고 개인정보를 받지 않는다", () => {
    for (const rel of [FORM_UI, TOGGLE_UI, SAMPLE_UI]) {
      expect(read(rel).split("\n")[0].trim(), rel).toMatch(/^["']use client["'];?$/);
    }
  });
});

// =============================================================================
// 5. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 에서만 (원격에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-popups.test] DB 실증 블록 skip — ${gate.reason}`);
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

describe.skipIf(!gate.allowed || !env.hasServiceRole)("5. DB — popups RLS 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", { timeout: 60_000 }, () => {
  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `p54-${randomUUID()}`;
  const emailFor = (who: string) => `p54-${RUN}-${who}@example.test`;

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

  const TITLE = `P54 ${RUN}`;
  let adminId = "";
  let plainId = "";
  let adminToken = "";
  let plainToken = "";
  let popupId = 0;

  test("준비 — 관리자 1명 · 일반 로그인 1명", async () => {
    const probe = await rest("GET", "/popups?select=id&limit=1");
    expect(probe.status, "0009 이전 마이그레이션이 적용되지 않았다").toBe(200);

    adminId = await createUser(emailFor("admin"));
    plainId = await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P5-4 test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
  });

  test("관리자 세션 — insert · update · delete 가 전부 통한다 (definer 함수 없이 정책만으로)", async () => {
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const ins = await asUser(
      adminToken,
      "POST",
      "/popups",
      { title: TITLE, body: "P5-4", image_path: null, starts_at: today, ends_at: today, active: true },
      "return=representation",
    );
    expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(201);
    popupId = (ins.body as { id: number }[])[0].id;

    const up = await asUser(adminToken, "PATCH", `/popups?id=eq.${popupId}`, { title: `${TITLE} edited` }, "return=representation");
    expect(up.status, JSON.stringify(up.body).slice(0, 300)).toBeLessThan(300);
    expect((up.body as { title: string }[])[0].title).toBe(`${TITLE} edited`);

    // 비활성으로 내렸다가 되살린다 — 관리자는 비활성 행도 보여야 한다(공개 정책은 active 만 본다)
    await asUser(adminToken, "PATCH", `/popups?id=eq.${popupId}`, { active: false });
    const hidden = await asUser(adminToken, "GET", `/popups?select=id,active&id=eq.${popupId}`);
    expect((hidden.body as { active: boolean }[])[0].active, "관리자가 비활성 행을 못 보면 되살릴 수 없다").toBe(false);
    await asUser(adminToken, "PATCH", `/popups?id=eq.${popupId}`, { active: true });
  });

  test("명단에 없는 로그인 세션 — insert·update·delete 전부 거부된다", async () => {
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const ins = await asUser(plainToken, "POST", "/popups", { title: `${TITLE} intruder`, body: "x", starts_at: today, ends_at: today });
    expect(ins.status, `insert 가 통과했다: ${JSON.stringify(ins.body).slice(0, 200)}`).toBeGreaterThanOrEqual(400);

    await asUser(plainToken, "PATCH", `/popups?id=eq.${popupId}`, { title: "hijacked" });
    await asUser(plainToken, "DELETE", `/popups?id=eq.${popupId}`);
    const still = await rest("GET", `/popups?select=title&id=eq.${popupId}`);
    expect((still.body as { title: string }[]).map((p) => p.title)).toEqual([`${TITLE} edited`]);
  });

  test("anon — 활성·기간 안의 행만 보인다 (공개 정책 회귀)", async () => {
    const visible = await asAnon(`/popups?select=id&id=eq.${popupId}`);
    expect(visible.status, JSON.stringify(visible.body).slice(0, 200)).toBe(200);
    expect((visible.body as unknown[]).length, "오늘 기간 안의 활성 팝업이 anon 에게 보이지 않는다").toBe(1);

    // 기간을 과거로 옮기면 같은 행이 anon 에게서 사라진다
    await rest("PATCH", `/popups?id=eq.${popupId}`, { starts_at: "2000-01-01", ends_at: "2000-01-02" });
    const past = await asAnon(`/popups?select=id&id=eq.${popupId}`);
    expect((past.body as unknown[]).length).toBe(0);

    // 비활성도 마찬가지
    await rest("PATCH", `/popups?id=eq.${popupId}`, { starts_at: "2000-01-01", ends_at: "2999-12-31", active: false });
    const off = await asAnon(`/popups?select=id&id=eq.${popupId}`);
    expect((off.body as unknown[]).length).toBe(0);
  });

  test("관리자 세션 — delete 로 자기가 만든 행을 지운다", async () => {
    const del = await asUser(adminToken, "DELETE", `/popups?id=eq.${popupId}`, undefined, "return=representation");
    expect(del.status, JSON.stringify(del.body).slice(0, 200)).toBeLessThan(300);
    const left = await rest("GET", `/popups?select=id&id=eq.${popupId}`);
    expect(left.body).toEqual([]);
  });

  test("정리 — 만든 것을 전부 지운다", async () => {
    await rest("DELETE", `/popups?title=like.${encodeURIComponent(`*${RUN}*`)}`);
    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    for (const id of [adminId, plainId]) {
      if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
    }
    const leftPopups = await rest("GET", `/popups?select=id&title=like.${encodeURIComponent(`*${RUN}*`)}`);
    expect(leftPopups.body).toEqual([]);
  });
});
