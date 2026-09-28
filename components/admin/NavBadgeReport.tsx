"use client";
/**
 * 메뉴 배지 보고 — 숫자를 그리는 화면이 자기가 센 "새 접수" 수를 메뉴에 알린다 (P5-21 · 리뷰 P2-10 "두 숫자 금지").
 *
 * 왜: 레이아웃(메뉴)은 탭 사이 이동에서 다시 렌더되지 않는다. 관리 홈 카드와 접수 목록 탭은 이동마다 새로 센다.
 * 그사이 접수가 들어오면 같은 화면에 사이드바 "3" 과 카드 "4" 가 함께 보인다.
 * 고른 길(브리프 B-2 의 (나)): 화면이 센 값으로 **메뉴 배지를 덮는다** — 클라이언트 상태이고 서버 왕복이 없다.
 *   - 메뉴(AdminTabs)가 보고를 받는 자리(context)를 열고, 레이아웃 값과 보고 중 **더 새로 센 쪽**을 그린다(tabs.ts pickNavBadge).
 *     화면을 떠나도 보고는 남는다(더 새 수이므로). 레이아웃이 다시 세면(새로고침 · 처리 뒤 revalidate) 그쪽이 더 새것이 되어 이긴다.
 *   - `useLayoutEffect` — 브라우저가 그리기 **전에** 맞춘다. 한 프레임도 두 숫자가 보이지 않는다(useEffect 면 한 번 그린 뒤 바뀐다).
 *   - 첫 로드처럼 레이아웃과 화면이 **같은 요청**에서 세면, lib/admin/reservations.ts countNewReservations 의 요청 범위 memo(React cache)로
 *     애초에 같은 값이다(서버 HTML 에서도 두 숫자가 나오지 않는다).
 *   - 화면이 세지 못했으면(조회 실패) 보고하지 않는다 — 모르는 수로 배지를 덮지 않는다. 0건은 보고한다(배지를 숨긴다).
 * (가) router.refresh() 로 레이아웃을 다시 세게 하는 길은 버렸다: 새로고침이 끝날 때까지(수백 ms) 두 숫자가 보이고, 화면 전체의 조회를 한 번 더 돈다.
 *
 * 개인정보 없음 — 숫자와 카탈로그 문장("새 접수 N건")과 센 시각뿐이다. 아무것도 그리지 않는다.
 */
import { createContext, useContext, useLayoutEffect } from "react";

import type { TimedNavBadge } from "./tabs";

/** 메뉴(AdminTabs)가 여는 보고 자리 — 값은 보고를 받는 함수(useState 의 setter). 메뉴 밖에서는 null 이라 보고가 아무 일도 하지 않는다. */
export const NavBadgeReportContext = createContext<((value: TimedNavBadge) => void) | null>(null);

export function NavBadgeReport({ badge, at }: TimedNavBadge) {
  const report = useContext(NavBadgeReportContext);
  const visible = badge?.visible ?? null;
  const label = badge?.label ?? null;
  useLayoutEffect(() => {
    report?.({ badge: visible === null || label === null ? null : { visible, label }, at });
  }, [report, visible, label, at]);
  return null;
}
