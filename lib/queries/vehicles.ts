/**
 * 차량(vehicles, 0001) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3). 가격 컬럼은 스키마에 없다.
 */
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { Vehicle } from "../types";

const SELECT = "id,slug,name_ko,name_en,capacity,sort,active";

export interface VehicleRow {
  id: number;
  slug: string;
  name_ko: string;
  name_en: string;
  capacity: number;
  sort: number;
  active: boolean;
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
  };
}

/** 활성 차량 전부 — sort 오름차순(동률은 id). */
export async function getVehicles(client?: AnonClient): Promise<Vehicle[]> {
  const db = client ?? createAnonClient();
  const { data, error } = await db
    .from("vehicles")
    .select(SELECT)
    .eq("active", true)
    .order("sort", { ascending: true })
    .order("id", { ascending: true })
    .overrideTypes<VehicleRow[], { merge: false }>();

  if (error) throw new Error(`getVehicles: ${error.message}`);
  return data.map(toVehicle);
}
