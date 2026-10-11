/**
 * 차량 입력 검증 · 결과 타입 · 사진 경로 — 순수 모듈 (OWNER-FEEDBACK T4-1 · 결정 9·11 · 마이그레이션 0024).
 *
 * Next 도 Supabase 도 모른다. 서버액션(actions/admin/vehicle.ts)이 FormData 를 주면 값을 돌려주고,
 * 클라이언트 폼(components/admin/VehicleForm.tsx)은 필드 이름·상한·결과 타입만 가져간다.
 *
 * 규칙
 *   1. 받는 칸: 한글 이름 · 영문 이름(필수) · 정원(1~60, 0001 CHECK) · 한글 설명(≤300, 0024 CHECK) · 사진 경로. **영문 설명 칸은 없다**(결정 11).
 *   2. 사진 경로는 0024 의 CHECK 와 **같은 두 형식**만 받는다 — `gallery/vehicles/<uuid v4>-1600.webp`(관리자 화면이 올린 공개본)
 *      또는 `/hero/bus-0[1-6].jpg`(저장소 사진). DB 도 같은 규칙으로 거부한다(이중 잠금).
 *   3. 결과에 개인정보가 없다. 문구는 messages/ko.json `admin.fleet.*` 몫이다(한글 리터럴 0).
 */
import { z } from "zod";

import { GALLERY_BUCKET, GALLERY_PUBLIC_EXTENSION, GALLERY_PUBLIC_SUFFIX, GALLERY_UUID_RE } from "./galleryInput";

import type { CopyWarning } from "./copyWarning";

export const VEHICLE_FIELDS = {
  id: "id",
  nameKo: "nameKo",
  nameEn: "nameEn",
  capacity: "capacity",
  descriptionKo: "descriptionKo",
  imagePath: "imagePath",
  active: "active",
} as const;
export type VehicleField = keyof typeof VEHICLE_FIELDS;

export const VEHICLE_NAME_KO_MAX = 40;
export const VEHICLE_NAME_EN_MAX = 60;
export const VEHICLE_DESCRIPTION_MAX = 300;
export const VEHICLE_CAPACITY_MIN = 1;
export const VEHICLE_CAPACITY_MAX = 60;
/** 순서 저장 한 번에 받는 차량 수 상한 — 폭주 방지선. */
export const VEHICLE_REORDER_MAX = 200;

/** gallery 버킷 안의 차량 사진 접두어(결정 9 — 새 버킷 없이 0011 정책 재사용). */
export const VEHICLE_IMAGE_PREFIX = "vehicles";

const UPLOADED = /^gallery\/vehicles\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-1600\.webp$/;
const BUNDLED = /^\/hero\/bus-0[1-6]\.jpg$/;

/** 0024 CHECK `vehicles_image_path_format` 과 같은 판정. */
export function isVehicleImagePath(value: string): boolean {
  return UPLOADED.test(value) || BUNDLED.test(value);
}

export interface VehicleImagePath {
  bucket: typeof GALLERY_BUCKET;
  key: string;
  /** vehicles.image_path 에 넣을 값 — "gallery/vehicles/<uuid>-1600.webp" */
  imagePath: string;
}

/** 새로 올릴 사진의 저장 위치. 날짜 폴더를 두지 않는다 — DB CHECK 가 접두어 바로 아래 파일 이름만 받는다. */
export function buildVehicleImagePath(uuid: string): VehicleImagePath {
  if (!GALLERY_UUID_RE.test(uuid)) throw new Error("buildVehicleImagePath: uuid must be a v4 uuid");
  const key = `${VEHICLE_IMAGE_PREFIX}/${uuid}${GALLERY_PUBLIC_SUFFIX}.${GALLERY_PUBLIC_EXTENSION}`;
  return { bucket: GALLERY_BUCKET, key, imagePath: `${GALLERY_BUCKET}/${key}` };
}

export interface VehicleValues {
  nameKo: string;
  nameEn: string;
  capacity: number;
  /** 비우면 null(설명 없이 이름·정원만 보인다). */
  descriptionKo: string | null;
  /** 비우면 null(사진 없이 보인다). */
  imagePath: string | null;
  active: boolean;
}

export const VehicleInput = z
  .object({
    nameKo: z.string().trim().min(1).max(VEHICLE_NAME_KO_MAX),
    nameEn: z.string().trim().min(1).max(VEHICLE_NAME_EN_MAX),
    capacity: z.number().int().min(VEHICLE_CAPACITY_MIN).max(VEHICLE_CAPACITY_MAX),
    descriptionKo: z.string().trim().max(VEHICLE_DESCRIPTION_MAX).nullable(),
    imagePath: z.string().trim().nullable(),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.imagePath !== null && !isVehicleImagePath(v.imagePath)) {
      ctx.addIssue({ code: "custom", path: ["imagePath"], message: "image path must be gallery/vehicles/<uuid>-1600.webp or /hero/bus-0N.jpg" });
    }
  });

export const VehicleReorderInput = z.array(z.number().int().positive()).min(1).max(VEHICLE_REORDER_MAX);

/** 화면이 문구 키로 쓰는 결과 어휘 — messages/ko.json `admin.fleet.result.*`. */
export type VehicleActionCode =
  | "created"
  | "updated"
  | "deleted"
  | "activated"
  | "deactivated"
  | "reordered"
  | "notFound"
  /** 접수 기록이 있어 이름·정원을 바꿀 수 없다(0024 admin_update_vehicle) — 아무것도 저장하지 않았다. */
  | "locked"
  /** 접수 기록이 있어 지울 수 없다(FK 23503 → 0024 admin_delete_vehicle) — 숨기기만 된다. */
  | "referenced"
  | "validation"
  | "failed"
  | "copyWarning";

export interface VehicleActionResult {
  ok: boolean;
  changed: boolean;
  code: VehicleActionCode;
  fieldErrors?: Partial<Record<VehicleField, true>>;
  copyWarnings?: CopyWarning[];
}

export const VEHICLE_FAILED: VehicleActionResult = { ok: false, changed: false, code: "failed" };
export const VEHICLE_NOT_FOUND: VehicleActionResult = { ok: false, changed: false, code: "notFound" };
export const VEHICLE_LOCKED: VehicleActionResult = { ok: false, changed: false, code: "locked" };
export const VEHICLE_REFERENCED: VehicleActionResult = { ok: false, changed: false, code: "referenced" };

export const vehicleChanged = (code: VehicleActionCode): VehicleActionResult => ({ ok: true, changed: true, code });

export function vehicleValidationFailed(fieldErrors: Partial<Record<VehicleField, true>>): VehicleActionResult {
  return { ok: false, changed: false, code: "validation", fieldErrors };
}

function isChecked(raw: FormDataEntryValue | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

const text = (raw: FormDataEntryValue | null): string => (typeof raw === "string" ? raw : "");

/** 숫자 칸 — 자연수 문자열만 숫자로, 아니면 NaN(zod 가 거부한다). */
function toInt(raw: string): number {
  const t = raw.trim();
  return /^[0-9]{1,3}$/.test(t) ? Number(t) : Number.NaN;
}

export type ParsedVehicleForm = { ok: true; value: VehicleValues } | { ok: false; result: VehicleActionResult };

export function parseVehicleForm(formData: FormData): ParsedVehicleForm {
  const rawImage = text(formData.get(VEHICLE_FIELDS.imagePath)).trim();
  const rawDescription = text(formData.get(VEHICLE_FIELDS.descriptionKo)).trim();
  const parsed = VehicleInput.safeParse({
    nameKo: text(formData.get(VEHICLE_FIELDS.nameKo)),
    nameEn: text(formData.get(VEHICLE_FIELDS.nameEn)),
    capacity: toInt(text(formData.get(VEHICLE_FIELDS.capacity))),
    descriptionKo: rawDescription === "" ? null : rawDescription,
    imagePath: rawImage === "" ? null : rawImage,
    active: isChecked(formData.get(VEHICLE_FIELDS.active)),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<VehicleField, true>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && field in VEHICLE_FIELDS) fieldErrors[field as VehicleField] = true;
    }
    return { ok: false, result: vehicleValidationFailed(fieldErrors) };
  }
  return { ok: true, value: parsed.data };
}

export function parseVehicleId(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
