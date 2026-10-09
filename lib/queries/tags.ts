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
  /** 갤러리 앨범 목록(gallery_albums, 0008 · P6-1). admin 이 앨범을 추가·수정·숨기면 무효화한다. */
  albums: "albums",
  /** 홈 "접수 현황" 피드(P3-5). 접수 서버액션(actions/reservation.ts, P3-3)이 성공 뒤 runAfter 로 무효화한다. */
  recent: "recent",
  /**
   * 관리자 예약 목록·상세(P5-3). 확정·취소·메모 액션이 **실제로 바꾼 뒤에만** 무효화한다.
   * 관리자 화면 자체는 캐시를 걸지 않지만(force-dynamic · 태그 캐시 금지 — 개인정보가 실린 응답이다),
   * 예약 상태를 읽는 다른 캐시가 붙으면 이 태그를 쓴다 — 무효화 지점을 액션 한 곳으로 모아 둔다.
   */
  reservations: "reservations",
} as const;

export type QueryTag = (typeof QUERY_TAGS)[keyof typeof QUERY_TAGS];
