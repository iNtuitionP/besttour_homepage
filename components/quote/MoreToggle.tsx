"use client";

/**
 * "자세히 보기 / 접기" 토글 — 간편 견적 모달의 두 동의 블록(개인정보 · 청약철회)이 함께 쓴다 (P7-3, 사용자 지시 2026-09-27).
 *
 * 핵심만 보이고 전문은 눌러야 펼쳐진다. 기본은 접힘이다.
 *   - `button` + `aria-expanded` + `aria-controls` — 스크린리더가 상태("접힘/펼침")와 대상을 읽는다.
 *   - 펼칠 본문은 `hidden` 속성으로 숨는다 — 화면에서도, 스크린리더·찾기에서도 빠진다. 펼치면 보인다.
 *     본문 클래스(.moreBody)는 display 를 주지 않는다 — 주면 hidden 을 덮어 버린다(tests/quote-disclosure.test.ts §6).
 *   - 모달에 이 버튼이 둘이다 — `describedBy` 로 블록 제목을 이어 어느 블록의 "자세히 보기" 인지 읽게 한다.
 *   - 펼치지 않아도 체크박스는 누를 수 있다(흔한 관행 — 브리프 §②). 이 컴포넌트는 체크박스를 모른다.
 *
 * 경계: 법정 문구를 모른다(원장 import 0). 본문은 부르는 쪽이 children 으로 넘긴다 —
 *   · 개인정보 블록(ConsentBlock)은 클라이언트 트리 안에서 props 로 받은 문구를,
 *   · 청약철회 블록(WithdrawalNotice)은 **서버 컴포넌트**가 원장에서 읽어 만든 노드를 넘긴다.
 * 토글 문구는 messages quote.more(ko·en). 한글 리터럴 없음.
 */
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import s from "./quote.module.css";

export function MoreToggle({
  children,
  testId,
  describedBy,
  defaultOpen = false,
}: {
  /** 펼칠 본문(전문). 선택 인자로 둔 것은 createElement(MoreToggle, props, 본문) 형태의 타입 검사 때문이다 — 실사용은 늘 넘긴다. */
  children?: ReactNode;
  /** 버튼은 `${testId}-toggle`, 본문은 `${testId}-body`. */
  testId: string;
  /** 블록 제목의 id — 버튼 설명으로 잇는다. */
  describedBy?: string;
  /** 처음부터 펼쳐 둘지. 기본 접힘(브리프 §②). */
  defaultOpen?: boolean;
}) {
  const t = useTranslations("quote.more");
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <>
      <button
        type="button"
        className={s.moreBtn}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-describedby={describedBy}
        onClick={() => setOpen((v) => !v)}
        data-testid={`${testId}-toggle`}
      >
        <span>{open ? t("hide") : t("show")}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      <div id={bodyId} className={s.moreBody} hidden={!open} data-testid={`${testId}-body`}>
        {children}
      </div>
    </>
  );
}
