/**
 * 홈 팝업이 어떻게 보이는지에 관한 규칙 — 순수 모듈 (OF3-R2: 상시 · 사진만 · 여러 창).
 *
 * 관리자 폼(components/admin/PopupForm.tsx)·관리자 목록·홈 쿼리(lib/queries/popups.ts)·홈 팝업(components/home/HomePopup.tsx)이
 * **같은 상수와 같은 판정 함수**를 쓴다. 각자 "9999-12-31" 이나 "본문이 비었으면" 을 따로 적으면 사장님이 보는 화면과 방문자가 보는 화면이 갈린다.
 * Next 도 Supabase 도 모른다. 사용자에게 보일 문구는 여기 없다(한글 리터럴 0).
 */

/**
 * "상시 게시" 의 종료일. DB 칼럼(popups.ends_at)은 not null 이라 종료일 없음을 이 값으로 적는다 — 마이그레이션 없이 간다.
 * 제로패딩 ISO 날짜라 사전순 비교가 곧 날짜 비교이고(isActiveOn), 실존하는 날이라 date 칼럼에도 들어간다.
 */
export const POPUP_ALWAYS_ENDS_AT = "9999-12-31";

/** 홈에 한꺼번에 뜨는 팝업 수의 상한. 넘으면 정렬 순서(상시 먼저 → 시작일 최신)로 잘라 버린다. */
export const POPUP_HOME_LIMIT = 4;

/** 종료일이 상시 값인가. */
export function isAlwaysEndsAt(endsAt: string): boolean {
  return endsAt === POPUP_ALWAYS_ENDS_AT;
}

/**
 * 사진만 보이는 팝업인가 — 본문이 (공백 제외) 비어 있고 사진이 있다.
 * 별도 칼럼을 두지 않고 이 판정 하나로 정한다(관리자 미리보기 · 홈 · 폼의 초기 체크가 같은 함수).
 */
export function isImageOnlyPopup(popup: { body: string; imagePath: string | null }): boolean {
  return popup.body.trim() === "" && popup.imagePath !== null && popup.imagePath !== "";
}

/**
 * 홈에 뜨는 순서 — 상시(종료일 9999-12-31)가 맨 앞, 그다음 시작일 최신, 같으면 id 최신.
 * 새 배열을 돌려준다(입력을 바꾸지 않는다). 상한은 자르지 않는다 — 자르는 것은 호출자(POPUP_HOME_LIMIT)의 일이다.
 */
export function sortHomePopups<T extends { id: number; startsAt: string; endsAt: string }>(popups: readonly T[]): T[] {
  return [...popups].sort((a, b) => {
    const aAlways = isAlwaysEndsAt(a.endsAt) ? 0 : 1;
    const bAlways = isAlwaysEndsAt(b.endsAt) ? 0 : 1;
    if (aAlways !== bAlways) return aAlways - bAlways;
    if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? 1 : -1;
    return b.id - a.id;
  });
}
