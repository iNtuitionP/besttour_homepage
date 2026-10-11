/**
 * 차량(vehicles, 0001 · 0024) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3). 가격 컬럼은 스키마에 없다.
 *
 * 0024 — 설명(description_ko)·사진(image_path)도 DB 에서 읽는다(사장님이 관리자 화면에서 고친다 · T4-1).
 * 🔴 0024 가 원격에 적용되기 **전에** 이 코드가 나가면 새 칸 SELECT 가 실패해 홈과 /fleet 이 에러다 — 배포 순서는 DB → 코드.
 *
 * `includeInactive` — 관리자 화면의 차량 이름표(숨긴 차량으로 들어온 접수도 이름으로 보이게). anon 정책은 활성 행만 주므로
 * 그때만 관리자 세션 클라이언트(쿠키 · `vehicles_admin_select`, 0020)로 읽는다. 서비스 롤이 아니다.
 */
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { Vehicle } from "../types";

const SELECT = "id,slug,name_ko,name_en,capacity,sort,active,description_ko,image_path";

export interface VehicleRow {
  id: number;
  slug: string;
  name_ko: string;
  name_en: string;
  capacity: number;
  sort: number;
  active: boolean;
  description_ko: string | null;
  image_path: string | null;
}

function toVehicle(r: VehicleRow): Vehicle {
  return {
    id: r.id,
    slug: r.slug,
    nameKo: r.name_ko,
    nameEn: r.name_en,
    capacity: r.capacity,
    sort: r.sort,
    active: r.active,
    descriptionKo: r.description_ko,
    imagePath: r.image_path,
  };
}

async function adminSessionClient(): Promise<AnonClient> {
  const [{ cookies }, { createSsrClient }] = await Promise.all([import("next/headers"), import("../supabase/ssr")]);
  return createSsrClient(await cookies()) as unknown as AnonClient;
}

/** 활성 차량 전부 — sort 오름차순(동률은 id). `includeInactive` 는 관리자 화면 전용(머리 주석). */
export async function getVehicles(client?: AnonClient, opts?: { includeInactive?: boolean }): Promise<Vehicle[]> {
  const all = opts?.includeInactive === true;
  const db = client ?? (all ? await adminSessionClient() : createAnonClient());
  let query = db.from("vehicles").select(SELECT);
  if (!all) query = query.eq("active", true);
  const { data, error } = await query
    .order("sort", { ascending: true })
    .order("id", { ascending: true })
    .overrideTypes<VehicleRow[], { merge: false }>();

  if (error) throw new Error(`getVehicles: ${error.message}`);
  return data.map(toVehicle);
}
