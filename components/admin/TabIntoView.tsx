"use client";
/**
 * 상태 탭 줄에서 **지금 탭**을 보이는 자리로 (P5-21 수정 라운드 · 리뷰 P2-5).
 *
 * 375px 에서 탭 줄(약 491px)은 화면(343px)보다 넓어 자기 안에서만 가로로 밀린다. 그래서 '취소'·'전체' 탭에 있으면 그 탭이 오른쪽 밖에 있어
 * 어느 탭인지(보라 글자 · 밑줄)가 첫 화면에 보이지 않았다 — 안내 한 줄도 운행 완료·취소·전체가 같아 단서가 없었다.
 * 지금 탭(aria-current="true")을 **가장 가까운 자리**로만 민다(inline: "nearest") — 이미 보이면 움직이지 않는다. 세로도 가장 가까운 자리라
 * 탭 줄이 보이는 첫 화면에서는 문서가 움직이지 않는다(block: "nearest").
 *
 * 아무것도 그리지 않는다 · 받는 것은 탭 줄의 id 와 지금 탭 이름뿐(개인정보·문구 0 · 한글 리터럴 0).
 */
import { useEffect } from "react";

export function TabIntoView({ navId, current }: { navId: string; current: string }) {
  useEffect(() => {
    const tab = document.getElementById(navId)?.querySelector<HTMLElement>('[aria-current="true"]');
    tab?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [navId, current]);
  return null;
}
