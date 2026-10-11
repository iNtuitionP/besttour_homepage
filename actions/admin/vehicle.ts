"use server";
/**
 * 관리자 차량 서버액션 — 얇은 래퍼 (OWNER-FEEDBACK T4-1 · ADR-3·ADR-4 · 마이그레이션 0024).
 *
 * 순서: requireAdmin() → zod → (문구 확인) → DB 한 번 → 바뀌었으면 무효화. 로직은 lib/admin/vehicleInput.ts(순수)와
 * lib/admin/vehicles.ts(세션 클라이언트 + 0024 definer 함수)에 있다.
 *   - export 는 async 함수뿐이고 **전부 본문 첫 문장이 `await requireAdmin();`** 이다(scripts/check-admin-gate).
 *   - 한글 이름·설명은 저장 전에 카피 목록과 대조한다(공지·팝업과 같게 — 경고 후 저장, 결정 11). 영문 이름은 대조하지 않는다.
 *   - 로그에는 차량 id 와 결과 코드만 남긴다.
 */
import { revalidatePath } from "next/cache";

import { holdForCopy } from "@/lib/admin/copyCheck";
import { readCopyAckForm } from "@/lib/admin/copyWarning";
import { PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE } from "@/lib/admin/publicRevalidate";
import {
  VEHICLE_FAILED,
  VEHICLE_FIELDS,
  VEHICLE_LOCKED,
  VEHICLE_NOT_FOUND,
  VEHICLE_REFERENCED,
  VehicleReorderInput,
  parseVehicleForm,
  parseVehicleId,
  vehicleChanged,
  vehicleValidationFailed,
  type VehicleActionCode,
  type VehicleActionResult,
} from "@/lib/admin/vehicleInput";
import {
  ADMIN_FLEET_PATH,
  deleteVehicleRow,
  insertVehicle,
  reorderVehicleRows,
  setVehicleActive,
  updateVehicleRow,
  type VehicleWriteOutcome,
} from "@/lib/admin/vehicles";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";

interface AdminVehicleLogEntry extends StructuredLogEntry {
  id: number | null;
  outcome: VehicleActionCode;
}

type VehicleAction = "create" | "update" | "delete" | "toggle" | "reorder";

function report(action: VehicleAction, id: number | null, result: VehicleActionResult): VehicleActionResult {
  const entry: AdminVehicleLogEntry = { level: result.ok ? "info" : "error", event: `admin.vehicle.${action}`, id, outcome: result.code };
  structuredLog(entry);
  return result;
}

function invalidate(): void {
  runAfter(() => {
    // 홈 차량 섹션과 /fleet 을 새로 그리는 것은 이 한 줄이다(lib/admin/publicRevalidate.ts).
    revalidatePath(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
    revalidate(QUERY_TAGS.vehicles);
    revalidatePath(ADMIN_FLEET_PATH);
  });
}

async function apply(action: VehicleAction, id: number | null, code: VehicleActionCode, write: () => Promise<VehicleWriteOutcome | boolean>): Promise<VehicleActionResult> {
  let outcome: VehicleWriteOutcome | boolean;
  try {
    outcome = await write();
  } catch {
    return report(action, id, VEHICLE_FAILED);
  }
  if (outcome === "locked") return report(action, id, VEHICLE_LOCKED);
  if (outcome === "referenced") return report(action, id, VEHICLE_REFERENCED);
  if (outcome === false || outcome === "unchanged") return report(action, id, id === null ? VEHICLE_FAILED : VEHICLE_NOT_FOUND);
  invalidate();
  return report(action, id, vehicleChanged(code));
}

/** 새 차량. 맨 뒤 순서로 들어간다. */
export async function createVehicle(formData: FormData): Promise<VehicleActionResult> {
  await requireAdmin();
  const parsed = parseVehicleForm(formData);
  if (!parsed.ok) return report("create", null, parsed.result);
  const held = holdForCopy({ vehicleName: parsed.value.nameKo, vehicleDescription: parsed.value.descriptionKo }, readCopyAckForm(formData));
  if (held) return report("create", null, held);
  return apply("create", null, "created", () => insertVehicle(parsed.value));
}

/** 고치기. 접수 기록이 있는 차량의 이름·정원 변경은 DB 가 'locked' 로 거부한다. */
export async function updateVehicle(formData: FormData): Promise<VehicleActionResult> {
  await requireAdmin();
  const id = parseVehicleId(formData.get(VEHICLE_FIELDS.id));
  if (id === null) return report("update", null, vehicleValidationFailed({ id: true }));
  const parsed = parseVehicleForm(formData);
  if (!parsed.ok) return report("update", id, parsed.result);
  const held = holdForCopy({ vehicleName: parsed.value.nameKo, vehicleDescription: parsed.value.descriptionKo }, readCopyAckForm(formData));
  if (held) return report("update", id, held);
  return apply("update", id, "updated", () => updateVehicleRow(id, parsed.value));
}

/** 지우기. 접수 기록이 있으면 'referenced'(숨기기만 된다). 사진 파일은 지우지 않는다(고아 파일 허용 — 결정 9). */
export async function deleteVehicle(id: number): Promise<VehicleActionResult> {
  await requireAdmin();
  const vehicleId = parseVehicleId(id);
  if (vehicleId === null) return report("delete", null, vehicleValidationFailed({ id: true }));
  return apply("delete", vehicleId, "deleted", () => deleteVehicleRow(vehicleId));
}

/** 목록에서 숨기기·다시 보이기. */
export async function toggleVehicleActive(id: number, active: boolean): Promise<VehicleActionResult> {
  await requireAdmin();
  const vehicleId = parseVehicleId(id);
  if (vehicleId === null) return report("toggle", null, vehicleValidationFailed({ id: true }));
  return apply("toggle", vehicleId, active ? "activated" : "deactivated", () => setVehicleActive(vehicleId, active));
}

/** 순서 저장 — 한 번에 원자적으로(0024 admin_reorder_vehicles). */
export async function reorderVehicles(ids: unknown): Promise<VehicleActionResult> {
  await requireAdmin();
  const parsed = VehicleReorderInput.safeParse(ids);
  if (!parsed.success) return report("reorder", null, vehicleValidationFailed({}));
  return apply("reorder", null, "reordered", () => reorderVehicleRows(parsed.data));
}
