/**
 * 공개 앨범 화면(P6-3b)의 순수 규칙 — 카드 조립 + 페이지 번호 정규화.
 *
 * 여기서는 조회하지 않는다(components/pages 규약: 쿼리 계층을 import 하지 않는다 — tests/pages.test.ts §1).
 * 호출부(RSC)가 읽어 온 행을 넘기면 이 파일은 그것을 화면이 쓸 모양으로 바꾸기만 한다. 한글 리터럴 0.
 */
import { resolveImageUrl } from "@/components/home/image-url";
import type { GalleryAlbum, GalleryItem } from "@/lib/types";

/**
 * 표지 사진 = 행 + 해석된 URL. `components/home/GalleryGrid.tsx` 의 `Picture` 와 같은 모양이지만
 * 그 모듈을 여기서 import 하지 않는다 — 그쪽은 JSX 라 node 환경의 단위 테스트가 불러올 수 없다.
 * 구조가 같으므로 `<Image src={cover.src}>` 에 그대로 쓰인다.
 */
export type AlbumCover = GalleryItem & { src: string };

/**
 * 앨범 상세 한 페이지의 장수.
 *
 * `lib/queries` 의 `MAX_GALLERY_PAGE_LIMIT`(60)을 여기서 import 하지 않는 이유는 위의 규약 때문이다.
 * 대신 `tests/gallery-albums-public.test.ts` §7 이 두 상수를 함께 읽어 `ALBUM_PAGE_SIZE <= MAX_GALLERY_PAGE_LIMIT`
 * 를 단언한다 — 상한을 넘기면 쿼리 계층이 조회 전에 throw 하므로, 그 사고를 테스트가 왼쪽에서 막는다.
 */
export const ALBUM_PAGE_SIZE = 24;

/**
 * 받아들이는 최대 페이지 번호. 이보다 큰 값은 첫 페이지로 본다.
 * 공개 URL 의 `?page=` 는 누구나 손으로 고친다 — 상한이 없으면 `offset` 이 int4 를 넘거나 안전 정수를 벗어나
 * 쿼리 계층이 throw 하고 방문자가 500 을 본다. 여기서 잘라 내면 그 경로가 아예 생기지 않는다.
 */
export const MAX_ALBUM_PAGE = 1000;

export interface AlbumCard {
  slug: string;
  title: string;
  description: string | null;
  /** 표지 — 그 앨범의 첫 사진(sort 순) 중 URL 을 해석할 수 있는 것. 없으면 null. */
  cover: AlbumCover | null;
  /**
   * 사진이 한 장이라도 있는가.
   * `cover` 가 null 이어도(저장 경로를 URL 로 풀 수 없는 행) true 일 수 있다 — "사진 준비 중" 표시는
   * 이 값으로만 판정한다. 해석 실패를 "사진이 없다"로 바꿔 말하면 사장님이 원인을 영영 못 찾는다.
   */
  hasPhotos: boolean;
}

/**
 * 앨범 + 그 앨범의 첫 페이지 사진 → 카드.
 * `firstItems[i]` 는 `albums[i]` 의 사진이다(같은 길이·같은 순서). 순서는 받은 그대로 유지한다 —
 * 정렬은 `getAlbums`(sort, id)의 몫이고 여기서 다시 정렬하면 두 곳이 규칙을 나눠 갖게 된다.
 * 사진이 없는 앨범도 **카드를 만든다**: 감추면 사장님이 앨범을 만들고도 안 보이는 이유를 알 수 없다.
 */
export function buildAlbumCards(
  albums: readonly GalleryAlbum[],
  firstItems: readonly (readonly GalleryItem[])[],
): AlbumCard[] {
  return albums.map((a, i) => {
    const items = firstItems[i] ?? [];
    const covers = items
      .map((g) => ({ ...g, src: resolveImageUrl(g.imagePath) }))
      .filter((g): g is AlbumCover => g.src !== null);
    return {
      slug: a.slug,
      title: a.title,
      description: a.description,
      cover: covers[0] ?? null,
      hasPhotos: items.length > 0,
    };
  });
}

/**
 * `?page=` → 1 이상 MAX_ALBUM_PAGE 이하의 정수. **던지지 않는다.**
 * 공개 URL 이므로 음수·소수·지수 표기·16진수·다른 문자 체계의 숫자·거대값이 그대로 들어온다.
 * 십진 숫자만으로 이루어진 문자열만 받아들이고, 나머지는 전부 첫 페이지로 본다
 * (`Number("1e3")`·`Number("0x10")`·`Number("٣")` 는 값을 내므로 `Number` 판정만으로는 부족하다).
 * 배열(같은 키가 여러 번 온 쿼리)은 첫 값만 본다.
 */
export function normalizeAlbumPage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return 1;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return 1;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_ALBUM_PAGE) return 1;
  return n;
}

/** 페이지 번호 → `getGalleryPage` 의 offset. */
export function albumPageOffset(page: number): number {
  return (page - 1) * ALBUM_PAGE_SIZE;
}
