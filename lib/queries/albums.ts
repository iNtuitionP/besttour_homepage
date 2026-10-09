/**
 * 갤러리 앨범(gallery_albums, 0008) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3). P6-1 신설.
 *
 * 비활성 앨범은 RLS(gallery_albums_select_active)가 0행으로 만든다. 쿼리에도 `active = true` 를 함께 적는 것은
 * 정책이 바뀌어도 의도가 코드에 남게 하기 위해서다(notices.ts 와 같은 규약).
 * 행이 없으면 빈 배열 — 호출부가 섹션을 숨긴다(빈 목록 그리드 금지).
 */
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { GalleryAlbum } from "../types";

const SELECT = "id,slug,title,description,sort,active,created_at";

export interface AlbumRow {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  sort: number;
  active: boolean;
  created_at: string;
}

/**
 * 0008 gallery_albums_slug_ck 와 같은 규칙 — 소문자·숫자·하이픈, 하이픈으로 시작/끝나거나 연달아 오지 않는다.
 * slug 는 URL 세그먼트(/gallery/<slug>)로 그대로 들어오므로 `../`·대문자·공백·인코딩된 점을 여기서 먼저 자른다.
 */
export const ALBUM_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ALBUM_SLUG_MAX_LENGTH = 40;

/**
 * 라우트 파라미터(문자열) 검증 — 형식이 맞으면 그 slug 를, 아니면 null. 호출부는 null 이면 DB 에 가지 않고
 * 404 로 보낸다(notices.ts parseNoticeId 선례). DB CHECK 와 같은 규칙이므로, 여기를 통과한 값은 DB 도 통과한다.
 */
export function parseAlbumSlug(raw: string): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length < 1 || raw.length > ALBUM_SLUG_MAX_LENGTH) return null;
  return ALBUM_SLUG_PATTERN.test(raw) ? raw : null;
}

/** 행 → 뷰 (순수). 컬럼을 버리지 않는다. */
function toAlbum(r: AlbumRow): GalleryAlbum {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    sort: r.sort,
    active: r.active,
    createdAt: r.created_at,
  };
}

/** 활성 앨범 목록 — sort 오름차순(동률은 id). */
export async function getAlbums(client?: AnonClient): Promise<GalleryAlbum[]> {
  const db = client ?? createAnonClient();
  const { data, error } = await db
    .from("gallery_albums")
    .select(SELECT)
    .eq("active", true)
    .order("sort", { ascending: true })
    .order("id", { ascending: true })
    .overrideTypes<AlbumRow[], { merge: false }>();

  if (error) throw new Error(`getAlbums: ${error.message}`);
  return (data ?? []).map(toAlbum);
}

/**
 * 활성 앨범 한 건 — slug 형식이 틀리면 DB 에 가지 않고 null, 부재·비활성도 null.
 * DB 오류는 삼키지 않고 throw 한다(404 로 위장하지 않는다).
 */
export async function getAlbumBySlug(rawSlug: string, client?: AnonClient): Promise<GalleryAlbum | null> {
  const slug = parseAlbumSlug(rawSlug);
  if (slug === null) return null;
  const db = client ?? createAnonClient();
  const { data, error } = await db
    .from("gallery_albums")
    .select(SELECT)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle()
    .overrideTypes<AlbumRow | null, { merge: false }>();

  if (error) throw new Error(`getAlbumBySlug: ${error.message}`);
  return data ? toAlbum(data) : null;
}
