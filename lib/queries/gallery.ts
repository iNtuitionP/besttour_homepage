/**
 * 갤러리(gallery, 0001 + 0008) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3). P2-4 신설, P6-1 확장.
 *
 * image_path 는 저장 경로 문자열을 그대로 나른다(URL 해석은 components/home/image-url.ts 몫).
 * 행이 없으면 빈 배열 — 홈은 빈 배열이면 섹션 자체를 숨긴다(빈 그리드 금지).
 *
 * 0008 이 더한 관리자 전용 컬럼(사용량·비공개 버킷의 원본 경로)은 이 계층의 select 에 넣지 않는다 —
 * 여기서 읽히는 것은 곧 anon 에게 나가는 것이다. 관리자 화면은 자기 쿼리로 읽는다(P5·P6-2).
 */
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { GalleryItem } from "../types";

const SELECT = "id,image_path,caption,sort,active";
/** 앨범 페이지용 select — 0001 의 5컬럼 + 0008 의 album_id·width·height. 화이트리스트이지 `*` 가 아니다. */
const PAGE_SELECT = "id,image_path,caption,sort,active,album_id,width,height";

/** limit 을 주지 않았을 때의 상한. 홈 섹션은 8장, 목록 페이지(P4)는 필요한 만큼 넘긴다. */
export const DEFAULT_GALLERY_LIMIT = 8;
/** 한 번에 읽을 수 있는 최대 장수. 무한스크롤도 이 크기로 끊어 여러 번 부른다. */
export const MAX_GALLERY_PAGE_LIMIT = 60;
/** gallery_albums.id 는 serial(int4). */
const INT4_MAX = 2147483647;

export interface GalleryRow {
  id: number;
  image_path: string;
  caption: string | null;
  sort: number;
  active: boolean;
  /**
   * 0008 컬럼 — **선택**이다. getGallery 는 0001 의 5컬럼만 읽으므로 그 행에는 키가 없고,
   * getGalleryPage 가 읽은 행에만 있다(값이 null 이어도 키는 있다). 아래 매퍼가 그 차이를 그대로 보존한다.
   */
  album_id?: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * 행 → 뷰 (순수). 컬럼을 버리지 않는다.
 * 0008 컬럼은 행에 실제로 있을 때만 뷰에 키를 만든다 — 읽지 않은 컬럼을 `undefined` 키로 만들어 내보내면
 * "값이 없다(null)"와 "읽지 않았다"가 구분되지 않고, 기존 소비자(홈 GalleryGrid)의 키 집합도 바뀐다.
 */
export function mapGalleryRows(rows: readonly GalleryRow[]): GalleryItem[] {
  return rows.map((r) => {
    const item: GalleryItem = {
      id: r.id,
      imagePath: r.image_path,
      caption: r.caption,
      sort: r.sort,
      active: r.active,
    };
    if (r.album_id !== undefined) item.albumId = r.album_id;
    if (r.width !== undefined) item.width = r.width;
    if (r.height !== undefined) item.height = r.height;
    return item;
  });
}

/** 활성 갤러리 — sort 오름차순(동률은 id), 최대 `limit` 건. limit 은 1 이상의 정수. */
export async function getGallery(limit: number = DEFAULT_GALLERY_LIMIT, client?: AnonClient): Promise<GalleryItem[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`getGallery: limit 은 1 이상의 정수여야 합니다 (받은 값: ${limit})`);
  }
  const db = client ?? createAnonClient();
  const { data, error } = await db
    .from("gallery")
    .select(SELECT)
    .eq("active", true)
    .order("sort", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit)
    .overrideTypes<GalleryRow[], { merge: false }>();

  if (error) throw new Error(`getGallery: ${error.message}`);
  return mapGalleryRows(data);
}

/** getGalleryPage 인자. albumId 를 생략하면 앨범과 무관하게 전체(미분류 포함)를 읽는다. */
export interface GalleryPageParams {
  /** gallery_albums.id. 생략 = 전체. */
  albumId?: number;
  /** 1 ~ MAX_GALLERY_PAGE_LIMIT 사이의 정수. */
  limit: number;
  /** 0 이상의 정수. 기본 0. */
  offset?: number;
}

/** 한 페이지 + "다음이 있는가". 전체 장수는 돌려주지 않는다 — 아래 주석 참조. */
export interface GalleryPage {
  items: GalleryItem[];
  hasMore: boolean;
}

/**
 * 앨범별(또는 전체) 갤러리 한 페이지 — sort 오름차순(동률은 id), `offset` 부터 `limit` 장.
 *
 * hasMore 는 **limit + 1 장을 읽어** 판정한다. count 쿼리(`select=…&count=exact`)를 쓰지 않는 이유:
 *   - 비용 — 정확한 count 는 매 요청 테이블/인덱스를 훑는다. 화면에 필요한 것은 "다음 버튼을 보일까"뿐이다.
 *   - 정확도 — RLS 가 걸린 테이블의 count 는 어차피 읽을 수 있는 행만 센다. 그 수를 보여 줄 데도 없고,
 *     보여 주면 비활성 앨범 사진이 몇 장인지 같은 정보가 새는 방향으로만 쓰인다.
 * 여분의 1장은 items 에서 잘라 낸다.
 *
 * 비활성 앨범의 사진은 여기서 걸러지지 않는다 — 0008 의 gallery_select_active 가 DB 에서 0행으로 만든다.
 * 코드에서 한 번 더 거르지 않는 것은, 걸러 주는 척하면 정책이 빠졌을 때 아무도 모르기 때문이다(실증: 테스트 §8).
 */
export async function getGalleryPage(params: GalleryPageParams, client?: AnonClient): Promise<GalleryPage> {
  const { albumId, limit, offset = 0 } = params;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GALLERY_PAGE_LIMIT) {
    throw new Error(`getGalleryPage: limit 은 1 이상 ${MAX_GALLERY_PAGE_LIMIT} 이하의 정수여야 합니다 (받은 값: ${limit})`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`getGalleryPage: offset 은 0 이상의 정수여야 합니다 (받은 값: ${offset})`);
  }
  if (albumId !== undefined && albumId !== null && (!Number.isInteger(albumId) || albumId < 1 || albumId > INT4_MAX)) {
    throw new Error(`getGalleryPage: albumId 는 1 이상의 정수(serial)여야 합니다 (받은 값: ${albumId})`);
  }

  const db = client ?? createAnonClient();
  let query = db.from("gallery").select(PAGE_SELECT).eq("active", true);
  if (albumId !== undefined && albumId !== null) query = query.eq("album_id", albumId);

  // range 는 양끝 포함이다 — (offset, offset + limit) 은 limit + 1 장.
  const { data, error } = await query
    .order("sort", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit)
    .overrideTypes<GalleryRow[], { merge: false }>();

  if (error) {
    // 데이터 끝을 넘긴 offset 은 오류가 아니라 빈 페이지다 — 무한스크롤의 마지막 요청이 늘 그 모양이다.
    if (isRangeNotSatisfiable(error)) return EMPTY_PAGE;
    throw new Error(`getGalleryPage: ${error.message}`);
  }
  const rows = data ?? [];
  return { items: mapGalleryRows(rows.slice(0, limit)), hasMore: rows.length > limit };
}

const EMPTY_PAGE: GalleryPage = { items: [], hasMore: false };

/**
 * PostgREST 는 행 수를 넘긴 Range 요청에 416 Range Not Satisfiable + PGRST103 을 준다
 * ("An offset of N was requested, but there are only M rows"). 이것을 throw 로 올리면
 * 무한스크롤의 마지막 한 번이 빈 페이지가 아니라 500 으로 끝난다 — 정상적인 끝을 오류로 만들지 않는다.
 * 코드와 문구를 둘 다 보는 이유: PostgREST 버전에 따라 이 응답이 200 + 빈 배열로 바뀌기도 하고
 * (그 경우 여기 오지 않는다) 오류 코드가 비어 오기도 한다. 다른 오류는 그대로 throw 한다.
 */
function isRangeNotSatisfiable(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === "PGRST103" || /range not satisfiable/i.test(error.message ?? "");
}
