/**
 * 도시 카탈로그(places, 0002) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3).
 * showcase 조인 외에 지도 라벨·위저드 선택지 등 "모든 공개 장소"가 필요한 곳에서 쓴다.
 */
import type { PlaceKind } from "../codes";
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { Place } from "../types";

const SELECT = "code,name_ko,name_en,kind,region_code,lat,lng,svg_x,svg_y,sort,active";

export interface PlaceRow {
  code: string;
  name_ko: string;
  name_en: string;
  kind: PlaceKind;
  region_code: string;
  lat: number;
  lng: number;
  svg_x: number;
  svg_y: number;
  sort: number;
  active: boolean;
}

function toPlace(r: PlaceRow): Place {
  return {
    code: r.code,
    nameKo: r.name_ko,
    nameEn: r.name_en,
    kind: r.kind,
    regionCode: r.region_code,
    lat: r.lat,
    lng: r.lng,
    svgX: r.svg_x,
    svgY: r.svg_y,
    sort: r.sort,
    active: r.active,
  };
}

/** 활성 장소 전부 — sort 오름차순(동률은 code). */
export async function getPlaces(client?: AnonClient): Promise<Place[]> {
  const db = client ?? createAnonClient();
  const { data, error } = await db
    .from("places")
    .select(SELECT)
    .eq("active", true)
    .order("sort", { ascending: true })
    .order("code", { ascending: true })
    .overrideTypes<PlaceRow[], { merge: false }>();

  if (error) throw new Error(`getPlaces: ${error.message}`);
  return data.map(toPlace);
}
