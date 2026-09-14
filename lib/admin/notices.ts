/**
 * 관리자 공지 읽기·쓰기 — SSR 세션 + RLS (플랜 v4 P5-5 · ADR-2·ADR-3).
 *
 * **definer 함수를 만들지 않은 이유.** 팝업(lib/admin/popups.ts)과 같다 —
 *   · 컬럼이 전부 콘텐츠다(개인정보·보유기간·동의 기록이 없다)
 *   · 상태 전이표가 없다. 마지막 저장이 이기면 그만이다
 *   · 쓰기가 통지를 만들지 않는다
 * 그래서 0009 의 `notices_admin_all`(`for all to authenticated using (is_admin()) with check (is_admin())`)
 * 한 줄이 곧 방어선이고, 여기서는 **세션 클라이언트로 곧장 CRUD** 한다. 마이그레이션 0건.
 *
 * 서비스 롤을 쓰지 않는다(ADR-2 · scripts/check-admin-no-service-role.sh 가 grep). 세션이 관리자가 아니면
 * insert 는 `with check` 에 걸려 오류가 되고, update·delete 는 `using` 이 행을 아예 보여주지 않아 0행이 된다 —
 * 그래서 아래 쓰기 함수들은 **바뀐 행이 실제로 돌아왔는지**로 성공을 판정한다.
 *
 * 캐시를 모른다(ADR-3). 관리자 화면은 캐시하지 않는다 — 무효화는 액션이 태그로 한다.
 * 공개 노출 규칙은 `active` 하나뿐이고 그 판정은 0001 의 `notices_select_active` 정책이 한다
 * (lib/queries/notices.ts 는 같은 조건을 쿼리에도 적는다). 여기서는 **거르지 않는다** — 관리자는 내린 공지를
 * 되살릴 수 있어야 하고, 되살리려면 먼저 보여야 한다.
 */
import "server-only";

import { cookies } from "next/headers";

import { createSsrClient } from "../supabase/ssr";
import type { NoticeValues } from "./noticeInput";

export type AdminDbClient = ReturnType<typeof createSsrClient>;

export const NOTICE_TABLE = "notices";

/** 관리자 화면 경로 — 무효화 대상과 탭의 링크가 갈리지 않게 한 곳에 둔다(components/admin/tabs.ts 가 이 값을 쓴다). */
export const ADMIN_NOTICES_PATH = "/admin/notices";

/** 목록 상한. 공지는 쌓이지만 한 화면에서 다루는 것은 최근 것들이다. */
export const ADMIN_NOTICE_LIST_LIMIT = 200;

/** select 화이트리스트 — `select('*')` 금지. 컬럼이 늘어도 화면이 모르는 값을 읽지 않는다. */
export const NOTICE_ADMIN_COLUMNS = ["id", "title", "body", "category", "published_at", "active"] as const;
export const NOTICE_ADMIN_SELECT: string = NOTICE_ADMIN_COLUMNS.join(",");

export interface AdminNoticeRow {
  id: number;
  title: string;
  body: string;
  category: string;
  published_at: string;
  active: boolean;
}

/** 오류 문구에 행 내용을 싣지 않는다 — code·message 만(lib/admin/popups.ts 와 같은 규약). */
function fail(op: string, error: { code?: string | null; message: string }): never {
  throw new Error(`adminNotices.${op}: [${error.code ?? "?"}] ${error.message}`);
}

async function sessionClient(): Promise<AdminDbClient> {
  return createSsrClient(await cookies());
}

/** NoticeValues → 컬럼. 여기 말고 어디에서도 컬럼 이름을 조립하지 않는다. */
function toRow(values: NoticeValues): Record<string, unknown> {
  return {
    title: values.title,
    body: values.body,
    category: values.category,
    // KST 달력 날짜 문자열 그대로 — Date 로 바꾸지 않는다(0004 · CLAUDE.md §3)
    published_at: values.publishedAt,
    active: values.active,
  };
}

/** 목록 — 최신 게시일 순(동률은 id 최신). 공개 목록과 같은 순서라 사장님이 보는 차례가 방문자와 같다. */
export async function listAdminNotices(client?: AdminDbClient): Promise<AdminNoticeRow[]> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(NOTICE_TABLE)
    .select(NOTICE_ADMIN_SELECT)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ADMIN_NOTICE_LIST_LIMIT)
    .overrideTypes<AdminNoticeRow[], { merge: false }>();

  if (error) fail("list", error);
  return data ?? [];
}

/** 한 건. 없거나 정책에 가려지면 null. */
export async function getAdminNotice(id: number, client?: AdminDbClient): Promise<AdminNoticeRow | null> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(NOTICE_TABLE)
    .select(NOTICE_ADMIN_SELECT)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<AdminNoticeRow, { merge: false }>();

  if (error) fail("get", error);
  return data ?? null;
}

/** 돌아온 행이 하나라도 있으면 실제로 바뀐 것이다. 0행 = 정책에 막혔거나 그런 행이 없다. */
function changedRows(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0;
}

export async function insertNotice(values: NoticeValues, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(NOTICE_TABLE).insert(toRow(values)).select("id");
  if (error) fail("insert", error);
  return changedRows(data);
}

export async function updateNoticeRow(id: number, values: NoticeValues, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(NOTICE_TABLE).update(toRow(values)).eq("id", id).select("id");
  if (error) fail("update", error);
  return changedRows(data);
}

/**
 * 진짜 삭제. 화면은 이 경로를 쉽게 열어 주지 않는다(components/admin/NoticeForm.tsx 가 두 단계로 받는다) —
 * 공개 상세 URL 이 문자로 나갔을 수 있고, serial id 는 재사용되지 않아 한 번 지우면 그 링크는 영구히 죽는다.
 * 감추는 것으로 충분한 경우가 대부분이고, 그때는 setNoticeActive 가 맞는 도구다.
 */
export async function deleteNoticeRow(id: number, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(NOTICE_TABLE).delete().eq("id", id).select("id");
  if (error) fail("delete", error);
  return changedRows(data);
}

/** 노출/중지만 바꾼다 — 목록에서 한 번에 내리기 위한 좁은 쓰기(나머지 컬럼을 건드리지 않는다). */
export async function setNoticeActive(id: number, active: boolean, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(NOTICE_TABLE).update({ active }).eq("id", id).select("id");
  if (error) fail("setActive", error);
  return changedRows(data);
}
