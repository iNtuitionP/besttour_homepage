/**
 * 관리자 차량 읽기·쓰기 — SSR 세션 (OWNER-FEEDBACK T4-1 · 마이그레이션 0024).
 *
 * **읽기는 표에서, 쓰기는 0024 의 definer 함수로** — lib/admin/popups.ts 와 같은 규약(0020 · known-defects D10).
 * 서비스 롤을 쓰지 않는다(ADR-2). 세션이 명단 밖이면 함수 첫 문장의 `is_admin()` 가드가 42501 로 거부하고,
 * 아래 래퍼가 그것을 "바뀐 것 없음" 으로 바꾼다(lib/admin/adminRpc.ts).
 *
 * 접수 기록 여부(`bookings`)는 화면 안내용이다 — 막는 것은 DB 다(이름·정원 변경 'locked', 삭제 'referenced').
 */
import "server-only";

import { cookies } from "next/headers";

import { createSsrClient } from "../supabase/ssr";
import { isAdminGuardDenial, rpcChangedRows } from "./adminRpc";
import type { VehicleValues } from "./vehicleInput";

export type AdminDbClient = ReturnType<typeof createSsrClient>;

export const VEHICLE_TABLE = "vehicles";
export const ADMIN_FLEET_PATH = "/admin/fleet";

export const VEHICLE_RPC = {
  create: "admin_create_vehicle",
  update: "admin_update_vehicle",
  delete: "admin_delete_vehicle",
  setActive: "admin_set_vehicle_active",
  reorder: "admin_reorder_vehicles",
} as const;

export const VEHICLE_ADMIN_COLUMNS = ["id", "slug", "name_ko", "name_en", "capacity", "description_ko", "image_path", "sort", "active"] as const;
export const VEHICLE_ADMIN_SELECT: string = VEHICLE_ADMIN_COLUMNS.join(",");

export interface AdminVehicleRow {
  id: number;
  slug: string;
  name_ko: string;
  name_en: string;
  capacity: number;
  description_ko: string | null;
  image_path: string | null;
  sort: number;
  active: boolean;
}

/** 쓰기 결과 — update·delete 는 함수가 이유를 돌려준다. */
export type VehicleWriteOutcome = "changed" | "unchanged" | "locked" | "referenced";

function fail(op: string, error: { code?: string | null; message: string }): never {
  throw new Error(`adminVehicles.${op}: [${error.code ?? "?"}] ${error.message}`);
}

async function sessionClient(): Promise<AdminDbClient> {
  return createSsrClient(await cookies());
}

/** 목록 — 공개 화면과 같은 순서(sort → id). 숨긴 차량도 보인다. */
export async function listAdminVehicles(client?: AdminDbClient): Promise<AdminVehicleRow[]> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(VEHICLE_TABLE)
    .select(VEHICLE_ADMIN_SELECT)
    .order("sort", { ascending: true })
    .order("id", { ascending: true })
    .overrideTypes<AdminVehicleRow[], { merge: false }>();
  if (error) fail("list", error);
  return data ?? [];
}

export async function getAdminVehicle(id: number, client?: AdminDbClient): Promise<AdminVehicleRow | null> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db
    .from(VEHICLE_TABLE)
    .select(VEHICLE_ADMIN_SELECT)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<AdminVehicleRow, { merge: false }>();
  if (error) fail("get", error);
  return data ?? null;
}

/** 이 차량으로 들어온 접수가 있는가 — 건수만(행 내용·개인정보를 읽지 않는다). */
export async function vehicleHasBookings(slug: string, client?: AdminDbClient): Promise<boolean> {
  const db = client ?? (await sessionClient());
  const { count, error } = await db.from("reservations").select("id", { count: "exact", head: true }).eq("vehicle_slug", slug);
  if (error) fail("bookings", error);
  return (count ?? 0) > 0;
}

async function rpc(op: string, fn: string, args: Record<string, unknown>, client?: AdminDbClient): Promise<{ denied: boolean; data: unknown }> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (isAdminGuardDenial(error, fn)) return { denied: true, data: null };
    fail(op, error);
  }
  return { denied: false, data };
}

export async function insertVehicle(values: VehicleValues, client?: AdminDbClient): Promise<boolean> {
  const r = await rpc(
    "insert",
    VEHICLE_RPC.create,
    {
      p_name_ko: values.nameKo,
      p_name_en: values.nameEn,
      p_capacity: values.capacity,
      p_description_ko: values.descriptionKo,
      p_image_path: values.imagePath,
      p_active: values.active,
    },
    client,
  );
  return !r.denied && rpcChangedRows(r.data);
}

/** 'updated' → changed · 'locked' → locked · 'not_found'·가드 거부 → unchanged. 활성 여부는 바꾸지 않는다(목록의 토글 몫). */
export async function updateVehicleRow(id: number, values: VehicleValues, client?: AdminDbClient): Promise<VehicleWriteOutcome> {
  const r = await rpc(
    "update",
    VEHICLE_RPC.update,
    {
      p_id: id,
      p_name_ko: values.nameKo,
      p_name_en: values.nameEn,
      p_capacity: values.capacity,
      p_description_ko: values.descriptionKo,
      p_image_path: values.imagePath,
    },
    client,
  );
  if (r.denied) return "unchanged";
  if (r.data === "updated") return "changed";
  if (r.data === "locked") return "locked";
  return "unchanged";
}

/** 'deleted' → changed · 'referenced' → referenced · 'not_found'·가드 거부 → unchanged. */
export async function deleteVehicleRow(id: number, client?: AdminDbClient): Promise<VehicleWriteOutcome> {
  const r = await rpc("delete", VEHICLE_RPC.delete, { p_id: id }, client);
  if (r.denied) return "unchanged";
  if (r.data === "deleted") return "changed";
  if (r.data === "referenced") return "referenced";
  return "unchanged";
}

export async function setVehicleActive(id: number, active: boolean, client?: AdminDbClient): Promise<boolean> {
  const r = await rpc("setActive", VEHICLE_RPC.setActive, { p_id: id, p_active: active }, client);
  return !r.denied && rpcChangedRows(r.data);
}

/** 원자적 순서 저장 — 지금 표의 id 전부를 원하는 순서로. 어긋나면 DB 가 22023 으로 거부한다(던진다). */
export async function reorderVehicleRows(ids: readonly number[], client?: AdminDbClient): Promise<boolean> {
  const r = await rpc("reorder", VEHICLE_RPC.reorder, { p_ids: ids }, client);
  return !r.denied && rpcChangedRows(r.data);
}
