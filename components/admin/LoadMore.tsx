"use client";
/**
 * 접수 목록 '20건 더 보기' (P5-21 · 시안 #list · 제안서 ⑤-2 "이전/다음 쌍 대신 더 보기 버튼 하나").
 *
 * 누르면 **주소만** 다음 쪽으로 바꾼다(`router.replace` · 스크롤 유지 — 뒤로 가기 기록을 쌓지 않는다). 서버가 첫 줄부터 쪽 × 20 건을 다시 그리고,
 * React 는 이미 있던 행을 그대로 두고 새 행을 뒤에 붙인다. 행(이름·번호)은 서버가 그린다 — 이 부품은 주소와 문구만 받는다(개인정보 0).
 *
 * 처리 중: 공용 부품(PendingButton) — disabled 대신 aria-disabled + 누름 무시라 포커스가 body 로 떨어지지 않는다(P5-20 ⑧-1).
 * 끝나면: 새로 붙은 쪽의 **첫 행**(data-row-index)으로 포커스를 옮긴다 — 키보드 사용자가 새 행을 버튼 위로 거슬러 찾지 않게, 그리고
 * 마지막 쪽이면 이 버튼이 사라지므로 포커스가 갈 곳이 있어야 한다. 이 부품은 버튼이 없을 때도 자리(null)를 지켜 그 일을 한다.
 * 포커스를 옮기면 브라우저가 그 행을 보이는 자리로 스크롤한다(문서의 scroll-padding 을 따라 위 제목줄·아래 탭 바에 가리지 않는다).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { PendingButton } from "./PendingButton";
import { firstRowIndexOfPage } from "./reservation-list";

import s from "./admin.module.css";

export function LoadMore({
  nextHref,
  page,
  listId,
  label,
  pendingLabel,
}: {
  /** 다음 쪽 주소(상태·쪽만). 더 없으면 null — 버튼을 그리지 않는다. */
  nextHref: string | null;
  /** 지금 그려진 쪽. */
  page: number;
  /** 행 목록을 감싼 요소의 id — 새 첫 행을 그 안에서 찾는다. */
  listId: string;
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const requested = useRef<number | null>(null);

  useEffect(() => {
    const want = requested.current;
    if (want === null) return;
    requested.current = null;
    // 다른 탭으로 옮겨 쪽이 줄었으면(요청한 쪽이 오지 않음) 포커스를 옮기지 않는다
    if (page < want) return;
    const target = document.getElementById(listId)?.querySelector<HTMLElement>(`[data-row-index="${firstRowIndexOfPage(want)}"]`);
    target?.focus();
  }, [page, listId]);

  if (nextHref === null) return null;

  const load = () => {
    requested.current = page + 1;
    startTransition(() => {
      router.replace(nextHref, { scroll: false });
    });
  };

  return (
    <PendingButton className={s.btnSecondary} pending={pending} onClick={load} testId="admin-list-more" data-next={nextHref}>
      {pending ? pendingLabel : label}
    </PendingButton>
  );
}
