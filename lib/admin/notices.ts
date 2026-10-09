/**
 * 관리자 공지 읽기·쓰기 — SSR 세션 + RLS (플랜 v4 P5-5 · ADR-2·ADR-3).
 *
 * **읽기는 표에서, 쓰기는 definer 함수로** (P5-16 · 마이그레이션 0020 · known-defects **D10**).
 * 처음에는 definer 함수를 만들지 않았다 — 컬럼이 전부 콘텐츠이고, 상태 전이표가 없고, 쓰기가 통지를 만들지 않아서
 * 0009 의 `notices_admin_all` 한 줄이면 충분하다고 봤다. **그 판단이 뒤집혔다.**
 * 이유는 정책이 부족해서가 아니라 **GRANT** 때문이다: 세션 롤(`authenticated`)이 표에 UPDATE·DELETE 를 가지면
 * PostgreSQL 은 그 롤에게 `ACCESS EXCLUSIVE` 잠금도 허용한다(`LockTableAclCheck`) — 로그인만 한 사람이
 * 공지 표를 잠가 공개 화면과 관리자 화면을 멈출 수 있었다. RLS 는 그것을 막지 못한다.
 * 0020 이 표 쓰기 권한을 회수했고, 아래 네 쓰기는 `admin_*_notice*` definer 함수를 부른다(0010 이 예약에 한 방식).
 * **읽기는 그대로 표에서** 한다 — `notices_admin_select`(0020, 0009 의 `_admin_all` 을 좁힌 것)가 관리자에게 내린 공지까지 보여 준다.
 *
 * 서비스 롤을 쓰지 않는다(ADR-2 · scripts/check-admin-no-service-role.sh 가 grep). 세션이 관리자가 아니면
 * 함수 첫 문장의 `is_admin()` 가드가 42501 로 거부하고, 아래 래퍼가 그것을 **바뀐 행 0** 으로 바꾼다 —
 * 0020 이전의 "정책에 막혀 0행" 과 같은 결과다(lib/admin/adminRpc.ts 머리 주석).
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
import { isAdminGuardDenial, rpcChangedRows } from "./adminRpc";
import type { NoticeValues } from "./noticeInput";

export type AdminDbClient = ReturnType<typeof createSsrClient>;

export const NOTICE_TABLE = "notices";

/**
 * 쓰기 경로 — 0020 의 definer 함수 이름. **표 이름이 아니라 이 이름들이 쓰기의 주소다.**
 * 한 곳에 모아 두는 이유는 select 화이트리스트와 같다: 이름이 바뀌면 여기 한 줄만 바뀐다.
 */
export const NOTICE_RPC = {
  create: "admin_create_notice",
  update: "admin_update_notice",
  delete: "admin_delete_notice",
  setActive: "admin_set_notice_active",
} as const;

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

/**
 * NoticeValues → 0020 함수의 인자. 여기 말고 어디에서도 컬럼 이름을 조립하지 않는다.
 * 인자 이름은 곧 **컬럼 화이트리스트**다 — `id`·`created_at` 같은 것은 함수가 받지 않는다(0020 §1).
 */
function toArgs(values: NoticeValues): Record<string, unknown> {
  return {
    p_title: values.title,
    p_body: values.body,
    p_category: values.category,
    // KST 달력 날짜 문자열 그대로 — Date 로 바꾸지 않는다(0004 · CLAUDE.md §3)
    p_published_at: values.publishedAt,
    p_active: values.active,
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

/**
 * 쓰기 한 번 — 0020 의 definer 함수를 세션 클라이언트로 부른다.
 * 가드 거부(명단 밖 세션)는 **바뀐 행 0** 으로 돌려준다: 0020 이전 정책에 막혔을 때와 같은 결과이고,
 * 호출부(actions/admin/notice.ts)의 notFound·failed 분기를 그대로 살린다. 그 밖의 오류는 던진다.
 */
async function write(op: string, fn: string, args: Record<string, unknown>, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (isAdminGuardDenial(error, fn)) return false;
    fail(op, error);
  }
  return rpcChangedRows(data);
}

export async function insertNotice(values: NoticeValues, client?: AdminDbClient): Promise<boolean> {
  return write("insert", NOTICE_RPC.create, toArgs(values), client);
}

export async function updateNoticeRow(id: number, values: NoticeValues, client?: AdminDbClient): Promise<boolean> {
  return write("update", NOTICE_RPC.update, { p_id: id, ...toArgs(values) }, client);
}

/**
 * 진짜 삭제. 화면은 이 경로를 쉽게 열어 주지 않는다(components/admin/NoticeForm.tsx 가 두 단계로 받는다) —
 * 공개 상세 URL 이 문자로 나갔을 수 있고, serial id 는 재사용되지 않아 한 번 지우면 그 링크는 영구히 죽는다.
 * 감추는 것으로 충분한 경우가 대부분이고, 그때는 setNoticeActive 가 맞는 도구다.
 */
export async function deleteNoticeRow(id: number, client?: AdminDbClient): Promise<boolean> {
  return write("delete", NOTICE_RPC.delete, { p_id: id }, client);
}

/** 노출/중지만 바꾼다 — 목록에서 한 번에 내리기 위한 좁은 쓰기(나머지 컬럼을 건드리지 않는다). */
export async function setNoticeActive(id: number, active: boolean, client?: AdminDbClient): Promise<boolean> {
  return write("setActive", NOTICE_RPC.setActive, { p_id: id, p_active: active }, client);
}
