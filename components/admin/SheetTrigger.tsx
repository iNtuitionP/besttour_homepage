"use client";
/**
 * 확인 시트 진입 버튼 — 접수 상세의 떨어진 자리들에서 쓴다 (P5-22 · 시안 #detail).
 *
 * 자리: 데스크톱 오른쪽 처리 카드(확정 · 운행 완료 · 취소) · 휴대폰 아래 고정 행동 바(확정) · 휴대폰 위 제목줄 ⋯(취소) · 휴대폰 맨 아래(취소 · 운행 완료).
 * 누르면 **시트를 열어 달라고만** 한다 — 채널(components/admin/reservation-panel.ts)로 처리 영역(ReservationActions)에 종류와 누른 버튼을 넘긴다.
 * 서버액션을 부르지 않는다 — 되돌릴 수 없는 동작은 여전히 시트의 실행 버튼 하나로만 간다(P5-19).
 *
 * 처리 중(처리 영역이 알린다)에는 disabled 대신 aria-disabled + 누름 무시(P5-21 PendingButton) — 포커스가 body 로 떨어지지 않는다(브리프 §C).
 * 서버 렌더에서는 늘 한가하다(IDLE_SNAPSHOT) — 채널 표는 브라우저에서만 채워진다.
 *
 * 받는 것은 uuid · 시트 종류 · 문구 · 모양 · testid 뿐이다(개인정보 0 — 서버 화면이 문구를 카탈로그에서 풀어 넘긴다 · 한글 리터럴 0).
 */
import { useCallback, useSyncExternalStore } from "react";

import { PendingButton } from "./PendingButton";
import { IDLE_SNAPSHOT, panelChannels } from "./reservation-panel";
import type { SheetKind } from "./reservation-sheet";

import s from "./admin.module.css";

/** primary = 주 버튼(확정 · 운행 완료) · text = 글자 버튼(× 이 접수 취소하기) · icon = 위 제목줄 ⋯(이름은 스크린리더에만). */
export type SheetTriggerVariant = "primary" | "text" | "icon";

const CLASS: Readonly<Record<SheetTriggerVariant, string>> = {
  primary: s.btnPrimary,
  text: s.btnText,
  icon: s.detailIconBtn,
};

export function SheetTrigger({
  id,
  kind,
  label,
  variant,
  testId,
}: {
  id: string;
  kind: SheetKind;
  label: string;
  variant: SheetTriggerVariant;
  testId: string;
}) {
  const subscribe = useCallback((listener: () => void) => panelChannels.subscribe(id, listener), [id]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => panelChannels.snapshot(id),
    () => IDLE_SNAPSHOT,
  );
  return (
    <PendingButton
      className={CLASS[variant]}
      pending={snapshot.pending}
      onClick={(event) => panelChannels.requestSheet(id, kind, event.currentTarget)}
      testId={testId}
      data-variant={variant}
      data-sheet={kind}
    >
      {variant === "text" ? (
        <svg className={s.btnTextIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      ) : null}
      {variant === "icon" ? (
        <>
          <svg className={s.moreIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12h.01M12 12h.01M19 12h.01" />
          </svg>
          <span className={s.srOnly}>{label}</span>
        </>
      ) : (
        label
      )}
    </PendingButton>
  );
}
