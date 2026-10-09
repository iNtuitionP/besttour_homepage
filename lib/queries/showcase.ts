/**
 * 홈 대표 노선(showcase_routes) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3).
 *
 * price_from 은 정적 표시값이다. 여기서는 정수(또는 null)를 그대로 나를 뿐, 계산·변환·포맷은
 * 어떤 형태로도 하지 않는다(CLAUDE.md §3). 표시 포맷은 컴포넌트 몫이고, null 이면 라벨 숨김 폴백.
 */
import type { PlaceKind } from "../codes";
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { PlacePin, ShowcaseRouteView } from "../types";

/** 임베드 컬럼 — 지도 핀·라벨에 필요한 것만. */
const PIN_COLUMNS = "code,name_ko,name_en,kind,svg_x,svg_y";

/** PostgREST 임베드. 같은 places 를 두 번 조인하므로 0002 의 FK 이름으로 출발·도착을 구분한다. */
const SELECT = [
  "id",
  "origin_code",
  "destination_code",
  "price_from",
  "highlight",
  "sort",
  "active",
  `origin:places!showcase_routes_origin_code_fkey(${PIN_COLUMNS})`,
  `destination:places!showcase_routes_destination_code_fkey(${PIN_COLUMNS})`,
].join(",");

export interface PlacePinRow {
  code: string;
  name_ko: string;
  name_en: string;
  kind: PlaceKind;
  svg_x: number;
  svg_y: number;
}

export interface ShowcaseRouteRow {
  id: number;
  origin_code: string;
  destination_code: string;
  price_from: number | null;
  highlight: boolean;
  sort: number | null;
  active: boolean;
  /** 끝점 place 가 비활성이면 places 의 RLS 가 임베드를 가려 null 이 온다. */
  origin: PlacePinRow | null;
  destination: PlacePinRow | null;
}

function toPin(r: PlacePinRow): PlacePin {
  return { code: r.code, nameKo: r.name_ko, nameEn: r.name_en, kind: r.kind, svgX: r.svg_x, svgY: r.svg_y };
}

/**
 * 행 → 뷰 (순수). 모든 컬럼을 옮기고 price_from 은 손대지 않는다.
 * 끝점 place 가 null 인 노선은 양 끝이 공개가 아니므로 공개 노선으로 치지 않는다 — 제외하고 경고를 남긴다
 * (조용히 버리지 않는다). 홈 전체를 죽이는 대신 그 노선 하나만 빠진다.
 */
export function mapShowcaseRouteRows(rows: readonly ShowcaseRouteRow[]): ShowcaseRouteView[] {
  const views: ShowcaseRouteView[] = [];
  for (const r of rows) {
    if (!r.origin || !r.destination) {
      console.warn(
        `[queries/showcase] route id=${r.id} ${r.origin_code}→${r.destination_code}: ` +
          "끝점 place 가 공개 조회에 없어 제외한다 (비활성 place 를 가리키는지 확인).",
      );
      continue;
    }
    views.push({
      id: r.id,
      originCode: r.origin_code,
      destinationCode: r.destination_code,
      priceFrom: r.price_from,
      highlight: r.highlight,
      sort: r.sort,
      active: r.active,
      origin: toPin(r.origin),
      destination: toPin(r.destination),
    });
  }
  return views;
}

/**
 * 활성 대표 노선 전부 — sort 오름차순(null 은 뒤, 동률은 id), 양 끝 place 조인.
 * `.eq("active", true)` 는 RLS 와 같은 조건을 쿼리에도 명시한 것이다(정책이 바뀌어도 의도가 남게).
 */
export async function getShowcaseRoutes(client?: AnonClient): Promise<ShowcaseRouteView[]> {
  const db = client ?? createAnonClient();
  const { data, error } = await db
    .from("showcase_routes")
    .select(SELECT)
    .eq("active", true)
    .order("sort", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .overrideTypes<ShowcaseRouteRow[], { merge: false }>();

  if (error) throw new Error(`getShowcaseRoutes: ${error.message}`);
  return mapShowcaseRouteRows(data);
}
