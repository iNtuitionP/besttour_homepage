/**
 * 관리자 팝업 읽기·쓰기 — SSR 세션 + RLS (플랜 v4 P5-4 · ADR-2·ADR-3).
 *
 * **읽기는 표에서, 쓰기는 definer 함수로** (P5-16 · 마이그레이션 0020 · known-defects **D10**).
 * 처음에는 definer 함수를 만들지 않았다 — 예약의 상태 전이는 경합(두 번 클릭)과 통지 큐가 얽혀 있어 0010 의
 * SQL 함수 안에서 원자적으로 끝나야 했지만 팝업은 그런 것이 하나도 없어서다(전이표 없음 · 통지 없음 · 전부 콘텐츠 컬럼).
 * **그 판단이 뒤집혔다.** 이유는 원자성이 아니라 **GRANT** 다: 세션 롤(`authenticated`)이 표에 UPDATE·DELETE 를
 * 가지면 PostgreSQL 은 그 롤에게 `ACCESS EXCLUSIVE` 잠금도 허용하고(`LockTableAclCheck`), 로그인만 한 사람이
 * 팝업 표를 잠가 공개 화면과 관리자 화면을 멈출 수 있었다. RLS 는 그것을 막지 못한다.
 * 0020 이 표 쓰기 권한을 회수했고, 아래 네 쓰기는 `admin_*_popup*` definer 함수를 부른다.
 * **읽기는 그대로 표에서** 한다 — `popups_admin_select`(0020)가 관리자에게 내린 팝업까지 보여 준다.
 *
 * 서비스 롤을 쓰지 않는다(ADR-2 · scripts/check-admin-no-service-role.sh 가 grep). 세션이 관리자가 아니면
 * 함수 첫 문장의 `is_admin()` 가드가 42501 로 거부하고, 아래 래퍼가 그것을 **바뀐 행 0** 으로 바꾼다
 * (lib/admin/adminRpc.ts 머리 주석) — 0020 이전의 "정책에 막혀 0행" 과 같은 결과다.
 * 그래서 아래 쓰기 함수들은 **바뀐 행이 실제로 돌아왔는지**로 성공을 판정한다(상태 코드가 아니라 결과로).
 *
 * 캐시를 모른다(ADR-3). 관리자 화면은 캐시하지 않는다 — 무효화는 액션이 태그로 한다.
 * 공개 노출 규칙은 lib/queries/popups.ts `isActiveOn` 하나뿐이다. 아래 popupState 는 그 함수를 **재사용**한다 —
 * 같은 판정을 두 벌 쓰면 관리자 화면과 방문자 화면이 갈린다.
 */
import "server-only";

import { cookies } from "next/headers";

import { isActiveOn } from "../queries/popups";
import { createSsrClient } from "../supabase/ssr";
import { isAdminGuardDenial, rpcChangedRows } from "./adminRpc";
import type { PopupValues } from "./popupInput";

export type AdminDbClient = ReturnType<typeof createSsrClient>;

export const POPUP_TABLE = "popups";

/** 쓰기 경로 — 0020 의 definer 함수 이름(lib/admin/notices.ts NOTICE_RPC 와 같은 규약). */
export const POPUP_RPC = {
  create: "admin_create_popup",
  update: "admin_update_popup",
  delete: "admin_delete_popup",
  setActive: "admin_set_popup_active",
} as const;

/** 관리자 화면 경로 — 무효화 대상과 탭의 링크가 갈리지 않게 한 곳에 둔다(components/admin/tabs.ts 가 이 값을 쓴다). */
export const ADMIN_POPUPS_PATH = "/admin/popups";

/** 목록 상한. 팝업은 한 번에 하나만 뜨는 물건이라 이보다 많이 쌓일 일이 없다(넘으면 오래된 것부터 지우면 된다). */
export const ADMIN_POPUP_LIST_LIMIT = 100;

/** select 화이트리스트 — `select('*')` 금지. 컬럼이 늘어도 화면이 모르는 값을 읽지 않는다. */
export const POPUP_ADMIN_COLUMNS = ["id", "title", "body", "image_path", "starts_at", "ends_at", "active", "created_at"] as const;
export const POPUP_ADMIN_SELECT: string = POPUP_ADMIN_COLUMNS.join(",");

export interface AdminPopupRow {
  id: number;
  title: string;
  body: string;
  image_path: string | null;
  starts_at: string;
  ends_at: string;
  active: boolean;
  created_at: string;
}

/** 화면의 상태 배지 — 활성 여부와 기간으로 네 가지. 판정의 본체는 isActiveOn 이다. */
export type PopupState = "live" | "scheduled" | "ended" | "off";

export function popupState(row: Pick<AdminPopupRow, "active" | "starts_at" | "ends_at">, kstDate: string): PopupState {
  if (!row.active) return "off";
  if (isActiveOn({ active: true, startsAt: row.starts_at, endsAt: row.ends_at }, kstDate)) return "live";
  return kstDate < row.starts_at ? "scheduled" : "ended";
}

/** 오류 문구에 행 내용을 싣지 않는다 — code·message 만(lib/admin/reservations.ts 와 같은 규약). */
function fail(op: string, error: { code?: string | null; message: string }): never {
  throw new Error(`adminPopups.${op}: [${error.code ?? "?"}] ${error.message}`);
}

async function sessionClient(): Promise<AdminDbClient> {
  return createSsrClient(await cookies());
}

/**
 * PopupValues → 0020 함수의 인자. 여기 말고 어디에서도 컬럼 이름을 조립하지 않는다.
 * 인자 이름이 곧 **컬럼 화이트리스트**다 — `id`·`created_at` 은 함수가 받지 않는다(0020 §2).
 */
function toArgs(values: PopupValues): Record<string, unknown> {
  return {
    p_title: values.title,
    p_body: values.body,
    p_image_path: values.imagePath,
    p_starts_at: values.startsAt,
    p_ends_at: values.endsAt,
    p_active: values.active,
  };
}

/** 목록 — 최신 시작일 순(동률은 id 최신). 비활성·기간이 지난 행도 보인다(관리자는 되살릴 수 있어야 한다). */
export async function listAdminPopups(client?: AdminDbClient): Promise<AdminPopupRow[]> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(POPUP_TABLE)
    .select(POPUP_ADMIN_SELECT)
    .order("starts_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ADMIN_POPUP_LIST_LIMIT)
    .overrideTypes<AdminPopupRow[], { merge: false }>();

  if (error) fail("list", error);
  return data ?? [];
}

/** 한 건. 없거나 정책에 가려지면 null. */
export async function getAdminPopup(id: number, client?: AdminDbClient): Promise<AdminPopupRow | null> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(POPUP_TABLE)
    .select(POPUP_ADMIN_SELECT)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<AdminPopupRow, { merge: false }>();

  if (error) fail("get", error);
  return data ?? null;
}

/**
 * 쓰기 한 번 — 0020 의 definer 함수를 세션 클라이언트로 부른다(lib/admin/notices.ts 와 같은 규약).
 * 가드 거부(명단 밖 세션)는 **바뀐 행 0** 으로, 그 밖의 오류는 던진다.
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

export async function insertPopup(values: PopupValues, client?: AdminDbClient): Promise<boolean> {
  return write("insert", POPUP_RPC.create, toArgs(values), client);
}

export async function updatePopupRow(id: number, values: PopupValues, client?: AdminDbClient): Promise<boolean> {
  return write("update", POPUP_RPC.update, { p_id: id, ...toArgs(values) }, client);
}

export async function deletePopupRow(id: number, client?: AdminDbClient): Promise<boolean> {
  return write("delete", POPUP_RPC.delete, { p_id: id }, client);
}

/** 노출/중지만 바꾼다 — 목록에서 한 번에 내리기 위한 좁은 쓰기(나머지 컬럼을 건드리지 않는다). */
export async function setPopupActive(id: number, active: boolean, client?: AdminDbClient): Promise<boolean> {
  return write("setActive", POPUP_RPC.setActive, { p_id: id, p_active: active }, client);
}
