/**
 * 오버레이(휴대폰 메뉴 · 팝업 · 간편 견적 모달)가 열려 있는 동안 배경 스크롤 잠금 (P7-4).
 *
 * 왜 <html> 인가: 문서의 스크롤은 뷰포트가 맡는다. app/globals.css 가 html 에 overflow-x 를 주므로(clip — P7-4) body 의 overflow 는
 * 뷰포트로 옮겨지지 않는다(CSS Overflow 3 — 루트가 visible 일 때만 body 값을 뷰포트에 쓴다). 그래서 예전처럼 body 에 overflow: hidden
 * 을 걸면 ① 잠그지 못하고(감사 실측: 팝업·견적 모달 뒤 페이지가 휠에 그대로 움직였다) ② body 가 다시 스크롤 상자가 되어 붙어 있던
 * 머리글이 문서 맨 위로 떨어진다(실측: scrollY 1500 에서 휴대폰 메뉴를 열면 머리글·패널이 화면 밖 −1733px).
 * 루트에 걸면 뷰포트가 잠기고 body 는 스크롤 상자가 되지 않는다 — 머리글은 붙은 채, 스크롤 위치는 그대로다.
 *
 * scrollbar-gutter: stable — 잠그는 동안 스크롤바 자리를 비워 둔다. 없으면 스크롤바가 있는 PC(Windows)에서 스크롤바가 사라지며
 * 화면이 오른쪽으로 밀린다. 단 **지금 자리를 차지하는 스크롤바가 있을 때만**(창 폭 > 문서 폭) 남긴다 — 스크롤바가 없는 짧은 화면
 * (관리자 목록 등)에서 늘 남기면 없던 자리가 생겨 화면이 그 폭만큼 옆으로 밀린다(P7-4 후속 ③). 겹치는 스크롤바(휴대폰·macOS)는
 * 폭이 0 이라 남길 것이 없다. 잠금이 풀리면 원래 값으로 돌린다(전역 규칙을 바꾸지 않는다).
 *
 * 겹쳐 열릴 수 있다(팝업 위에서 메뉴 등) — 몇 개가 잠갔는지 세고, **마지막 하나가 풀 때만** 원래 값으로 돌린다. 돌려준 해제 함수는
 * 두 번 불러도 한 번만 센다(React StrictMode 의 정리 두 번 · 언마운트와 닫기가 겹치는 경우).
 * 브라우저 전용(useEffect 안에서만 부른다). 한글 리터럴 없음.
 */

let depth = 0;
let saved: { overflow: string; gutter: string } | null = null;

export function lockDocumentScroll(): () => void {
  const root = document.documentElement;
  const style = root.style;
  if (depth === 0) {
    saved = { overflow: style.overflow, gutter: style.scrollbarGutter };
    // 잠그기 전에 잰다 — 잠그면(overflow hidden) 스크롤바가 사라져 두 폭이 같아진다
    const scrollbarTakesSpace = (globalThis.innerWidth ?? 0) > root.clientWidth;
    style.overflow = "hidden";
    if (scrollbarTakesSpace) style.scrollbarGutter = "stable";
  }
  depth += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0 && saved) {
      style.overflow = saved.overflow;
      style.scrollbarGutter = saved.gutter;
      saved = null;
    }
  };
}
