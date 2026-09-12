/**
 * 캐시 태그 이름 상수.
 *
 * 이 계층은 캐시를 모른다 — 감싸는 것은 호출부(RSC)의 몫이고, 무효화(revalidateTag 호출)는
 * admin 뮤테이션 쪽이다. 양쪽이 같은 문자열을 쓰도록 이름만 여기서 export 한다.
 */
export const QUERY_TAGS = {
  showcase: "showcase",
  places: "places",
  vehicles: "vehicles",
  notices: "notices",
  popups: "popups",
  gallery: "gallery",
} as const;

export type QueryTag = (typeof QUERY_TAGS)[keyof typeof QUERY_TAGS];
