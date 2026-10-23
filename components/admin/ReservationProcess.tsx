/**
 * 접수 상세의 처리 자리 — 진입 버튼과 안내 (P5-22 · 시안 #detail 처리 카드 · 제안서 ⑤-3 · ④ 원칙 3 "전화가 먼저, 확정은 엄지가 닿는 곳에").
 *
 * OF3-R4(사장님 요청 2026-10-22 · 0028): 상태는 접수 → 상담완료 두 단계다. [접수 취소] 진입(처리 카드의 글자 버튼 · 휴대폰 맨 아래)을 걷었고,
 * 상담완료는 문자를 보내지 않는다 — 상담완료 뒤 **[문자 보내기]**(시트 — 문구 + 기본으로 채워진 계약 정보(고칠 수 있다 — OF3-R4b))로 직접 보낸다.
 *
 * 두 모양(layout):
 *   - "card"   데스크톱(≥1024px) 오른쪽 열의 **처리 카드** — 제목 "처리" ·
 *              새 접수: [상담완료로 바꾸기](주 버튼) + "바꿔도 문자는 자동으로 가지 않아요 …" ·
 *              상담완료: [문자 보내기](주 버튼) + 안내 · 구분선 · [운행 완료로 바꾸기](보조 버튼) + 안내 ·
 *              운행 완료: [문자 보내기] + 한 줄 · 옛 취소 기록: 한 줄(누를 것 없음).
 *              이 카드는 **처리 영역**(성공 뒤 포커스를 돌려줄 자리 — role=group · tabindex=-1 · data-process-region)이다.
 *              1024px 미만에서는 숨는다 — 그 폭의 처리 자리는 아래 고정 행동 바(화면이 그린다 — 상담완료 · 문자 보내기)다.
 *   - "mobile" 휴대폰(<1024px) 본문 **맨 아래** — 상담완료 상태면 [운행 완료로 바꾸기]. 그 밖은 그리지 않는다. 1024px 이상에서는 숨는다.
 * 존재하는 전이만 그린다(P5-19 규약): 상담완료 = 새 접수 · 운행 완료 = 상담완료 · 문자 보내기 = 상담완료·운행 완료.
 * 진입 버튼은 시트를 **열기만** 한다(SheetTrigger).
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
  const canSms = status === "confirmed" || status === "done";
  const region = { [PROCESS_REGION_ATTR]: "" };

  if (layout === "mobile") {
    if (!canComplete) return null;
    return (
      <div className={s.mobileProcess} data-testid="admin-mobile-process">
        <div className={s.actionPrimary} data-zone="primary">
          <SheetTrigger id={id} kind="complete" label={labels.complete} variant="primary" testId="admin-complete-mobile" />
          {/* 문장마다 한 덩어리 — 끝 문장이 "…가지 / 않아요." 로 꺾이지 않는다(P5-23 라운드 2 C-15) */}
          <p className={s.hint}>{sentences(labels.completeHint)}</p>
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
      {canConfirm ? (
        <div className={s.actionPrimary} data-zone="primary">
          <SheetTrigger id={id} kind="confirm" label={labels.confirm} variant="primary" testId="admin-confirm" />
          <p className={s.hint}>{sentences(labels.confirmHint)}</p>
        </div>
      ) : null}
      {canSms ? (
        <div className={s.actionPrimary} data-zone="sms">
          <SheetTrigger id={id} kind="sms" label={labels.sms.open} variant="primary" testId="admin-sms-open" />
          <p className={s.hint}>{sentences(labels.sms.hint)}</p>
        </div>
      ) : null}
      {canComplete ? (
        <>
          <hr className={s.divider} />
          <div className={s.actionPrimary} data-zone="complete">
            <SheetTrigger id={id} kind="complete" label={labels.complete} variant="secondary" testId="admin-complete" />
            <p className={s.hint}>{sentences(labels.completeHint)}</p>
          </div>
        </>
      ) : null}
      {status === "done" ? <p className={s.processNote}>{labels.processDone}</p> : null}
      {status === "cancelled" ? <p className={s.processNote}>{labels.processCancelled}</p> : null}
    </section>
  );
}
