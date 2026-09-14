/**
 * 관리자 팝업 읽기·쓰기 — SSR 세션 + RLS (플랜 v4 P5-4 · ADR-2·ADR-3).
 *
 * **definer 함수를 만들지 않은 이유.** 예약의 상태 전이는 경합(두 번 클릭)과 통지 큐가 얽혀 있어 0010 의
 * SQL 함수 안에서 원자적으로 끝나야 했다. 팝업은 그런 것이 하나도 없다 —
 *   · 컬럼이 전부 콘텐츠다(개인정보·보유기간·동의 기록이 없다)
 *   · 전이표가 없다(어떤 값에서 어떤 값으로만 간다는 규칙이 없다). 마지막 저장이 이기면 그만이다
 *   · 쓰기가 통지를 만들지 않는다
 * 그래서 0009 의 `popups_admin_all`(`for all to authenticated using (is_admin()) with check (is_admin())`)
 * 한 줄이 곧 방어선이고, 여기서는 **세션 클라이언트로 곧장 CRUD** 한다. 마이그레이션 0건.
 *
 * 서비스 롤을 쓰지 않는다(ADR-2 · scripts/check-admin-no-service-role.sh 가 grep). 세션이 관리자가 아니면
 * insert 는 `with check` 에 걸려 오류가 되고, update·delete 는 `using` 이 행을 아예 보여주지 않아 0행이 된다 —
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
import type { PopupValues } from "./popupInput";

export type AdminDbClient = ReturnType<typeof createSsrClient>;

export const POPUP_TABLE = "popups";

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

/** PopupValues → 컬럼. 여기 말고 어디에서도 컬럼 이름을 조립하지 않는다. */
function toRow(values: PopupValues): Record<string, unknown> {
  return {
    title: values.title,
    body: values.body,
    image_path: values.imagePath,
    starts_at: values.startsAt,
    ends_at: values.endsAt,
    active: values.active,
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

/** 돌아온 행이 하나라도 있으면 실제로 바뀐 것이다. 0행 = 정책에 막혔거나 그런 행이 없다. */
function changedRows(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0;
}

export async function insertPopup(values: PopupValues, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(POPUP_TABLE).insert(toRow(values)).select("id");
  if (error) fail("insert", error);
  return changedRows(data);
}

export async function updatePopupRow(id: number, values: PopupValues, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(POPUP_TABLE).update(toRow(values)).eq("id", id).select("id");
  if (error) fail("update", error);
  return changedRows(data);
}

export async function deletePopupRow(id: number, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(POPUP_TABLE).delete().eq("id", id).select("id");
  if (error) fail("delete", error);
  return changedRows(data);
}

/** 노출/중지만 바꾼다 — 목록에서 한 번에 내리기 위한 좁은 쓰기(나머지 컬럼을 건드리지 않는다). */
export async function setPopupActive(id: number, active: boolean, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.from(POPUP_TABLE).update({ active }).eq("id", id).select("id");
  if (error) fail("setActive", error);
  return changedRows(data);
}
