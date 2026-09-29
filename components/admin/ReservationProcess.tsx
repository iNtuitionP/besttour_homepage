/**
 * 접수 상세의 처리 자리 — 진입 버튼과 안내 (P5-22 · 시안 #detail 처리 카드 · 제안서 ⑤-3 · ④ 원칙 3 "전화가 먼저, 확정은 엄지가 닿는 곳에").
 *
 * 두 모양(layout):
 *   - "card"   데스크톱(≥1024px) 오른쪽 열의 **처리 카드** — 제목 "처리" · [확정하기](주 버튼) + "확정하면 고객에게 확정 안내 문자가 가요." ·
 *              구분선 · [× 이 접수 취소하기](글자 버튼) + "취소하면 고객에게 문자가 가지 않아요. 전화로 알려 주세요." · 확정 상태면 [운행 완료로 바꾸기].
 *              운행 완료·취소된 접수는 누를 것 없이 한 줄만. 이 카드는 **처리 영역**(성공 뒤 포커스를 돌려줄 자리 — role=group · tabindex=-1 ·
 *              data-process-region)이다. 1024px 미만에서는 숨는다 — 그 폭의 처리 자리는 아래 고정 행동 바(화면이 그린다)다.
 *   - "mobile" 휴대폰(<1024px) 본문 **맨 아래** — 확정 버튼과 멀리 둔 [× 이 접수 취소하기](시안 cancel-zone) · 확정 상태면 그 위에 [운행 완료로 바꾸기].
 *              확정하기는 여기 없다(아래 고정 행동 바가 맡는다). 1024px 이상에서는 숨는다.
 * 존재하는 전이만 그린다(P5-19 규약): 확정 = 새 접수 · 운행 완료 = 확정 · 취소 = 새 접수·확정. 진입 버튼은 시트를 **열기만** 한다(SheetTrigger).
 *
 * 서버 부품이다 — 훅·'use client' 없음. 받는 것은 uuid · 상태 · 카탈로그 라벨 · 모양뿐이다(개인정보 0 — 개발 모드가 서버 부품 props 를
 * HTML 에 실어도 새는 것이 없다). 문구는 부르는 쪽이 카탈로그에서 푼 것(한글 리터럴 0).
 */
import type { ReservationStatus } from "@/lib/reservation-check/view";

import { PROCESS_REGION_ATTR } from "./reservation-panel";
import type { ReservationActionLabels } from "./reservation-sheet";
import { sentences } from "./segments";
import { SheetTrigger } from "./SheetTrigger";

import s from "./admin.module.css";

/** 처리 카드 제목의 id — 한 화면에 카드는 하나다. 카드의 이름(aria-labelledby)이 된다. */
const TITLE_ID = "admin-process-title";

export function ReservationProcess({
  id,
  status,
  labels,
  layout,
}: {
  id: string;
  status: ReservationStatus;
  labels: ReservationActionLabels;
  layout: "card" | "mobile";
}) {
  const canConfirm = status === "new";
  const canComplete = status === "confirmed";
  const canCancel = status === "new" || status === "confirmed";
  const region = { [PROCESS_REGION_ATTR]: "" };

  if (layout === "mobile") {
    if (!canCancel) return null;
    return (
      <div className={s.mobileProcess} data-testid="admin-mobile-process">
        {canComplete ? (
          <>
            <div className={s.actionPrimary} data-zone="primary">
              <SheetTrigger id={id} kind="complete" label={labels.complete} variant="primary" testId="admin-complete-mobile" />
              <p className={s.hint}>{labels.completeHint}</p>
            </div>
            <hr className={s.divider} />
          </>
        ) : null}
        <div className={s.cancelZone} data-zone="cancel">
          <SheetTrigger id={id} kind="cancel" label={labels.cancel} variant="text" testId="admin-cancel-mobile" />
          {/* 문장마다 한 덩어리 — 끝 문장이 "…알려 / 주세요." 로 꺾이지 않는다(P5-23 라운드 2 C-15) */}
          <p className={s.hint}>{sentences(labels.cancelHint)}</p>
        </div>
      </div>
    );
  }

  return (
    <section
      className={`${s.detailCard} ${s.processCard}`}
      role="group"
      aria-labelledby={TITLE_ID}
      tabIndex={-1}
      {...region}
      data-testid="admin-reservation-actions"
    >
      <h2 id={TITLE_ID} className={s.detailCardTitle}>
        {labels.panel}
      </h2>
      {canConfirm || canComplete ? (
        <div className={s.actionPrimary} data-zone="primary">
          {canConfirm ? <SheetTrigger id={id} kind="confirm" label={labels.confirm} variant="primary" testId="admin-confirm" /> : null}
          {canComplete ? <SheetTrigger id={id} kind="complete" label={labels.complete} variant="primary" testId="admin-complete" /> : null}
          <p className={s.hint}>{canConfirm ? labels.confirmHint : labels.completeHint}</p>
        </div>
      ) : null}
      {canCancel ? (
        <>
          <hr className={s.divider} />
          <div className={s.cancelZone} data-zone="cancel">
            <SheetTrigger id={id} kind="cancel" label={labels.cancel} variant="text" testId="admin-cancel" />
            <p className={s.hint}>{sentences(labels.cancelHint)}</p>
          </div>
        </>
      ) : (
        <p className={s.processNote}>{status === "done" ? labels.processDone : labels.processCancelled}</p>
      )}
    </section>
  );
}
