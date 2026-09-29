"use client";
/**
 * 상태 탭 줄에서 **지금 탭**을 보이는 자리로 (P5-21 수정 라운드 · 리뷰 P2-5).
 *
 * 375px 에서 탭 줄(약 491px)은 화면(343px)보다 넓어 자기 안에서만 가로로 밀린다. 그래서 '취소'·'전체' 탭에 있으면 그 탭이 오른쪽 밖에 있어
 * 어느 탭인지(보라 글자 · 밑줄)가 첫 화면에 보이지 않았다 — 안내 한 줄도 운행 완료·취소·전체가 같아 단서가 없었다.
 * 지금 탭(aria-current="true")을 **가장 가까운 자리**로만 민다(inline: "nearest") — 이미 보이면 움직이지 않는다. 세로도 가장 가까운 자리라
 * 탭 줄이 보이는 첫 화면에서는 문서가 움직이지 않는다(block: "nearest").
 *
 * P5-23 라운드 2(컨트롤러 C-16) — 탭 줄이 밀릴 수 있을 때 **가려진 쪽 끝을 옅게** 한다(더 있다는 표시). 여기서는 판정만 한다:
 * 탭 줄(nav)에 data-fade-start · data-fade-end 를 "true"/"false" 로 달고(스크롤·창 크기가 바뀔 때마다 다시), 모양은 CSS(admin.module.css
 * `.statusTabs[data-fade-…]` 의 mask)가 그린다. 밀리지 않는 폭(넓은 화면)에서는 둘 다 "false" 라 아무것도 옅어지지 않는다.
 *
 * P5-23 리뷰 P2-2 — 지금 탭·키보드 포커스 탭이 그 옅은 띠 밑에 서지 않게: 탭 줄의 scroll-padding-inline(CSS · 띠 폭)을 따라 밀고,
 * 포커스는 focusin 에서 같은 방식으로 민다(브라우저의 포커스 스크롤은 반쯤 보이는 탭을 밀지 않는다). 단 **키보드 포커스(:focus-visible)만** —
 * 마우스·터치로 누르는 중에 밀면 click 이 탭을 놓친다(재검토 P1-A).
 *
 * 아무것도 그리지 않는다 · 받는 것은 탭 줄의 id 와 지금 탭 이름뿐(개인정보·문구 0 · 한글 리터럴 0).
 */
import { useEffect } from "react";

/** 끝에서 이만큼(px) 안이면 "끝에 닿았다" 로 본다 — 소수점 스크롤 위치에서 옅음이 깜박이지 않게. */
const EDGE_SLACK_PX = 2;

/**
 * 포커스를 받은 대상을 탭 줄 안에서 밀어 보일지 — **키보드 포커스(:focus-visible)일 때만**(P5-23 재검토 P1-A). 순수 판정(DOM 없이 테스트한다).
 * 마우스·터치 포커스에서 밀면 안 된다: 크롬은 링크를 mousedown 에서 포커스하므로, 누르는 사이에 탭 줄이 밀려 click 이 링크가 아니라
 * 공통 조상 `<ul>` 에 떨어졌다 — 반쯤 가려진 탭('취소')을 눌러도 탭이 바뀌지 않았다. focusin 안에서 :focus-visible 은 마우스·터치 false · 키보드 true 다.
 */
export function revealsOnFocus(target: EventTarget | null): target is HTMLElement {
  const el = target as Partial<HTMLElement> | null;
  return el !== null && typeof el.scrollIntoView === "function" && typeof el.matches === "function" && el.matches(":focus-visible");
}

export function TabIntoView({ navId, current }: { navId: string; current: string }) {
  useEffect(() => {
    const nav = document.getElementById(navId);
    const tab = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    tab?.scrollIntoView({ inline: "nearest", block: "nearest" });
    if (!nav) return;
    const update = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      nav.dataset.fadeStart = String(max > EDGE_SLACK_PX && nav.scrollLeft > EDGE_SLACK_PX);
      nav.dataset.fadeEnd = String(max > EDGE_SLACK_PX && nav.scrollLeft < max - EDGE_SLACK_PX);
    };
    update();
    // 키보드 포커스 탭도 지금 탭처럼 가장 가까운 자리로(P5-23 리뷰 P2-2) — 브라우저의 포커스 스크롤은 반쯤 보이는 탭을 밀지 않아
    // 끝이 줄 밖에 걸친 채 옅은 띠 밑에 남았다(크롬 실측). 탭 줄의 scroll-padding-inline(띠 폭)을 따라 띠 안쪽에 선다.
    // 키보드 포커스일 때만(재검토 P1-A — 누름에서 밀면 click 이 탭을 놓친다 · revealsOnFocus).
    const reveal = (e: FocusEvent) => {
      if (revealsOnFocus(e.target)) e.target.scrollIntoView({ inline: "nearest", block: "nearest" });
    };
    nav.addEventListener("scroll", update, { passive: true });
    nav.addEventListener("focusin", reveal);
    window.addEventListener("resize", update);
    return () => {
      nav.removeEventListener("scroll", update);
      nav.removeEventListener("focusin", reveal);
      window.removeEventListener("resize", update);
    };
  }, [navId, current]);
  return null;
}
