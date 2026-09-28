"use client";
/**
 * 실패 배너 하나 — 관리자 화면의 "그 자리 실패 알림"(P5-20 수정 라운드 · 리뷰 P1-1).
 *
 * 왜 부품 하나로 모았나: 휴대폰(<1024px)의 아래 탭 바는 화면에 고정돼 있다. 사장님이 버튼이 보일 만큼만 내린 뒤 누르면
 * 버튼 바로 아래에 새로 뜬 실패 배너가 **탭 바 밑**에 깔려 0px 보였다(리뷰 실측 375×812 · 390×664). 성공 토스트는 탭 바 위에 떠서
 * 보이는데 실패만 안 보이니, 저장이 안 된 공지·팝업·노선을 된 줄 알고 떠날 수 있었다. 배너를 그리던 10곳이 제각각이라
 * 한 곳에서 고치면 나머지가 남는다 — 그래서 부품 하나가 **나타날 때 한 번** 스스로 보이는 자리로 온다.
 *
 * 동작
 *   - 나타날 때(마운트) React 가 ref 콜백 `revealBanner` 를 부르고, 그것이 `scrollIntoView({ block: "nearest" })` 한다.
 *     가까운 쪽으로만 움직이므로 이미 보이면 가만히 있고, 문서의 scroll-padding(탭 바 높이 — admin.module.css
 *     `:global(html):has(.shell)`)을 따라 탭 바 **위**에 멈춘다. 표 스크롤 상자 안이면 가로로도 보이게 민다(inline: nearest).
 *   - 포커스는 옮기지 않는다 — role=alert 가 스크린리더에 읽히고, 키보드 사용자는 방금 누른 자리에서 다시 시도할 수 있다.
 *   - 문구가 바뀌면 새로 나타난 것으로 본다(`key` = 문구 → 다시 마운트 → 다시 스크롤).
 *   - **같은 문구가 다시 설 때**(같은 실패를 한 번 더 겪음 — 그 사이 사장님이 배너를 탭 바 밑으로 밀어 두었을 수 있다) 다시 스크롤하려면
 *     요소가 새로 붙어야 한다. 두 가지 길이 있고 부르는 쪽이 하나를 고른다(재리뷰 P2-R1 · tests/admin-banner.test.ts §4 가 둘 다 잠근다):
 *       ① 동작을 **시작할 때 배너를 비운다**(빈 문구 = 그리지 않음). 요청이 오간 뒤 문구가 서면 비움과 다른 렌더라 다시 붙는다 —
 *          공지·팝업·노선 폼과 전환, 사진 카드, 앨범이 이 길이다.
 *       ② 비우지 않는 곳은 **시도 번호**(`attempt`)를 넘긴다 — 실패마다 번호가 늘어 key 가 바뀐다. 예약 메모·시트(P5-19 상태 기계는
 *          저장을 시작할 때 배너를 비우지 않는다)와 업로더(같은 틱에 비우고 다시 쓰는 즉시 거절이 있다)가 이 길이다.
 *     예전 이 주석은 "부르는 쪽은 늘 비운다" 고 적었지만 사실이 아니었다(메모·시트가 비우지 않았다).
 *   - 저절로 닫히지 않는다(브리프 §C) — 다음 동작이 걷는다.
 *
 * 훅이 없다. 그래서 테스트가 함수를 직접 불러 돌려준 요소의 ref 를 확인할 수 있다(tests/admin-banner.test.ts — DOM 없는 vitest).
 * 문구는 부르는 쪽이 카탈로그에서 넘긴다(한글 리터럴 0).
 *
 * P5-21 — 배너 끝에 **다음 행동 링크 하나**를 둘 수 있다(`action` — 관리 홈의 "보내지 못한 문자 … [발송 기록 보기]"). 링크 글자와 주소만 받는다.
 * 서버 화면이 그리는 상태 배너(관리 홈)는 결과를 들고 있는 클라이언트 상태가 없어 시도 번호·비우기가 필요 없다 — tests/admin-banner.test.ts §4 가 그 경우만 뺀다.
 */
import Link from "next/link";

import s from "./admin.module.css";

/** 배너가 붙을 때 React 가 부른다. 떼어질 때(null)는 아무것도 하지 않는다. 모듈 수준 함수라 다시 그려도 다시 불리지 않는다. */
export function revealBanner(node: Pick<HTMLElement, "scrollIntoView"> | null): void {
  node?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function AdminBanner({
  text,
  variant = "block",
  attempt,
  testId,
  action,
}: {
  /** 비었거나 null 이면 아무것도 그리지 않는다. */
  text: string | null;
  /** block = 폼·카드 아래 넓은 배너 · inline = 표 칸 안의 줄 배너(노출 전환). */
  variant?: "block" | "inline";
  /** 시도 번호 — 동작 시작에 배너를 비우지 않는 자리가 실패마다 늘려 넘긴다(위 ②). 바뀌면 같은 문구라도 다시 붙고 다시 스크롤한다. */
  attempt?: number;
  testId?: string;
  /** 배너 끝의 다음 행동 링크(선택) — 글자와 주소만. */
  action?: { href: string; label: string };
}) {
  if (text === null || text === "") return null;
  return (
    <p
      key={attempt === undefined ? text : `${attempt}:${text}`}
      ref={revealBanner}
      className={variant === "inline" ? s.bannerInline : s.banner}
      role="alert"
      data-testid={testId}
    >
      {text}
      {action !== undefined ? (
        <>
          {" "}
          <Link className={s.bannerLink} href={action.href}>
            {action.label}
          </Link>
        </>
      ) : null}
    </p>
  );
}
