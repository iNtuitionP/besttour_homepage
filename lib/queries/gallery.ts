/**
 * 갤러리(gallery, 0001) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3). P2-4 신설.
 *
 * image_path 는 저장 경로 문자열을 그대로 나른다(URL 해석은 components/home/image-url.ts 몫).
 * 행이 없으면 빈 배열 — 홈은 빈 배열이면 섹션 자체를 숨긴다(빈 그리드 금지).
 */
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { GalleryItem } from "../types";

const SELECT = "id,image_path,caption,sort,active";

/** limit 을 주지 않았을 때의 상한. 홈 섹션은 8장, 목록 페이지(P4)는 필요한 만큼 넘긴다. */
export const DEFAULT_GALLERY_LIMIT = 8;

export interface GalleryRow {
  id: number;
  image_path: string;
  caption: string | null;
  sort: number;
  active: boolean;
}

/** 행 → 뷰 (순수). 컬럼을 버리지 않는다. */
export function mapGalleryRows(rows: readonly GalleryRow[]): GalleryItem[] {
  return rows.map((r) => ({
    id: r.id,
    imagePath: r.image_path,
    caption: r.caption,
    sort: r.sort,
    active: r.active,
  }));
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
