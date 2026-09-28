"use client";
/**
 * 처리 중에도 포커스를 잃지 않는 버튼 — 관리자 공용 (P5-21 · P5-20 수정 라운드 보고 ⑧-1).
 *
 * 문제: 관리자 버튼은 처리 중 `disabled` 가 되었다(두 번 누름 방지의 첫 층). 그런데 포커스가 있던 버튼이 disabled 가 되면 브라우저가
 * 포커스를 `body` 로 떨어뜨린다(P5-20 실측 `focus: "body"`) — 키보드 사용자는 다음 Tab 이 문서 처음부터다.
 *
 * 공통 처리(정한 것): **disabled 대신 `aria-disabled="true"` + 누름 무시.**
 *   - 버튼은 초점을 그대로 가진다 — 처리가 끝나면 그 자리에서 이어서 누르거나 옮겨 갈 수 있다.
 *   - 스크린리더는 "사용할 수 없음" 으로 읽는다(aria-disabled). 모양은 CSS 가 disabled 와 같게 그린다(admin.module.css `[aria-disabled="true"]`).
 *   - 처리 중 누름(클릭 · Enter · Space — 모두 click 사건이다)은 `ignoreWhilePending` 이 막는다 — 두 번 보내지 않는다.
 *     진짜 방어선은 여전히 서버다(예: 0010 의 `and status = 'new'`).
 *   - "끝난 뒤 결과 자리로 포커스를 옮기는" 쪽은 버튼이 사라지는 경우에만 쓴다(예: '20건 더 보기' 가 마지막 쪽에서 사라지면 새로 붙은 첫 행으로 —
 *     components/admin/LoadMore.tsx). 버튼이 남는 곳은 포커스를 옮기지 않는다(스크린리더가 두 번 읽고 마우스 사용자에게 초점이 튄다).
 *
 * 쓰는 곳: 접수 목록 '20건 더 보기'(LoadMore) · 공지·팝업·노선 목록의 노출 전환(NoticeToggle · PopupToggle · RouteToggle).
 * 폼의 제출 버튼과 확인 시트(P5-19)는 그대로 disabled 다 — 폼은 입력칸의 Enter 가 제출을 다시 부르므로 제출 막기를 따로 둬야 하고,
 * 시트는 처리 중 포커스를 [닫기]·처리 영역으로 직접 옮긴다(상세 재배치 P5-22 에서 함께 본다).
 *
 * 훅이 없다 — 테스트가 함수로 불러 돌려준 요소를 본다(tests/admin-list.test.ts §5). 문구는 부르는 쪽이 넘긴다(한글 리터럴 0).
 */
import type { MouseEvent, ReactNode } from "react";

/** 처리 중이면 누름을 무시한다(기본 동작도 막는다 — 폼 안의 submit 이어도 다시 보내지 않게). */
export function ignoreWhilePending<E extends { preventDefault(): void }>(pending: boolean, event: E, handler?: (event: E) => void): void {
  if (pending) {
    event.preventDefault();
    return;
  }
  handler?.(event);
}

export function PendingButton({
  pending,
  onClick,
  className,
  children,
  testId,
  ...data
}: {
  pending: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
  testId?: string;
  [key: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-disabled={pending ? true : undefined}
      data-pending={pending ? "true" : undefined}
      onClick={(event) => ignoreWhilePending(pending, event, onClick)}
      data-testid={testId}
      {...data}
    >
      {children}
    </button>
  );
}
