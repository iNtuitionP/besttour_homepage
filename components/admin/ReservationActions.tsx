"use client";
/**
 * 예약 상세의 처리 영역 — 확인 시트 · 메모 · 결과 토스트의 주인 (P5-3 → P5-19 확인 시트 → P5-22 상세 재배치).
 *
 * P5-22 — 시안 #detail 로 화면을 다시 놓으면서 이 부품이 **그리는 것**이 바뀌었다(하는 일은 그대로다):
 *   - 그리는 것: 메모 카드 · 확인 시트 · 결과 토스트 자리.
 *   - 진입 버튼(상담완료·문자 보내기·운행 완료)은 **여기 없다**. 데스크톱 오른쪽 처리 카드 · 휴대폰 아래 행동 바 · 맨 아래 칸에 떨어져 있고
 *     (components/admin/ReservationProcess.tsx · SheetTrigger.tsx), 그 사이에 서버가 그린 개인정보(번호·`tel:`·요청 사항)가 끼어 있어
 *     이 부품으로 감쌀 수 없다(감싸면 개인정보가 props 로 넘어온다). 그래서 진입 버튼은 채널(components/admin/reservation-panel.ts)로
 *     "이 시트를 열어 달라" 고만 하고, 이 부품이 채널에 붙어 받는다(`panelChannels.attach`). 받은 요청은 **존재하는 전이 · 처리 중 아님 ·
 *     시트가 닫혀 있음**일 때만 여는 데 쓴다(openSheet — 연 버튼을 기억하고 시트를 연다). 여는 것 말고는 하지 않는다.
 *   - 처리 중 여부를 채널에 알린다(레이아웃 효과) — 진입 버튼이 aria-disabled 로 막힌다(P5-21 PendingButton · 포커스 유지).
 *   - 성공 뒤 포커스는 **보이는 처리 영역**(데스크톱 처리 카드 · 휴대폰 행동 바 — data-process-region)으로 — 연 버튼은 새로고침에서 사라진다.
 *     없으면 메모 카드로. 처리 중에 시트를 닫은 뒤(15초 탈출) 늦게 온 결과가 연 버튼을 없애도 같은 자리로 구한다(수정 라운드 · 리뷰 P2-3 ·
 *     reservation-sheet.ts focusRescue) — 포커스가 <body> 로 빠지지 않게.
 *   - 사장님 요청 11(2026-10-10) — P5-22 의 간편 접수 "전화로 확인할 것" 점검표 카드(저장하지 않는 체크 4개)와, 그 수를 읽던
 *     확정 시트의 확인 경고를 지웠다. 통화로 정한 내용은 메모 카드에 적는다. 운행 카드의 미정 칸 "전화로 확인" 은 페이지가 그대로 그린다(결정 13).
 *   - [메모 저장]은 P5-21 PendingButton(disabled 대신 aria-disabled) — 키보드로 저장해도 포커스가 body 로 떨어지지 않는다(P5-19 리뷰 P2-6).
 *
 * OF3-R4(2026-10-22 · 0028):
 *   - [접수 취소] 진입과 취소 시트를 걷었다 — 상태는 접수 → 상담완료 두 단계다. 취소 서버액션·DB 함수는 남는다(이 파일이 부르지 않을 뿐).
 *   - 상담완료는 문자를 보내지 않는다. 상담완료·운행 완료 접수에 **[문자 보내기]** 시트(ConsultSmsSheet)를 연다 — 위 = 고칠 수 있는 문구,
 *     아래 = 서버가 원장에서 만든 계약 정보 블록(읽기 전용). [보내기]는 처리 중 표시 안에서 actions/admin/consultSms.ts 를 부르고(서버가 블록을
 *     다시 만든다), [보내지 않음](ESC · 바깥 누르기 포함)은 닫고 "대금·취소 규정은 다른 방법으로 꼭 안내해 주세요" 를 남긴다. 여러 번 보낼 수 있다.
 *
 * P5-19 에서 이어지는 것(바꾸지 않았다):
 *   - 되돌릴 수 없는 전이(상담완료·완료)는 **확인 시트를 거친다**. 서버액션을 부르는 길은 시트의 실행 버튼 하나다
 *     (reservation-sheet.ts panelController.commit — 시트가 열려 있지 않으면 아무것도 하지 않는다). 메모 저장은 되돌릴 수 있어 시트가 없다.
 *   - 상담완료·완료는 **고친 메모만** 함께 넘긴다(리뷰 P2-3).
 *   - "이미 처리된 접수" 를 받은 시트는 잠긴다(리뷰 P1-1). 응답이 SHEET_STUCK_MS 동안 오지 않으면 [닫기]가 되살아난다(리뷰 P2-1).
 *   - 성공은 토스트(role=status · 3초 · 링크가 있으면 5초), 실패는 시트를 닫지 않고 시트 안 배너(role=alert).
 *   - 마지막 판정은 언제나 DB 다(0010 의 `and status = 'new'` 등) — 이 화면의 버튼이 낡았으면 액션은 alreadyHandled(noop)를 돌려준다.
 *
 * props 에 고객 개인정보를 싣지 않는다(P3-5 리뷰 N-2 — dev 는 서버 컴포넌트 props 를 HTML 에 직렬화한다):
 * 여기 오는 것은 uuid·상태·라벨·사장님이 쓴 메모·운행 요약(구간·날짜·인원 — 식별 정보가 아니다)뿐이다.
 * 시트 제목의 **고객 이름**은 서버가 이미 화면에 그린 이름 칸(CUSTOMER_NAME_ELEMENT_ID — P5-22 부터 제목 "{이름} 님" 의 이름 부분)에서
 * 시트를 열 때 읽는다 — props 로 새 길을 내지 않는다. 읽지 못하면 이름 없는 제목으로 떨어진다.
 *
 * 개발용 우회 분기는 없다(P5-3 독립 리뷰). 이 컴포넌트가 화면에 있다는 것은 서버가 이미 관리자 세션을 확인했다는 뜻이고,
 * 버튼은 언제나 진짜 서버액션을 부른다 — 그 액션도 자기 자리에서 requireAdmin() 을 다시 통과해야 한다.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";

import { sendConsultSms } from "@/actions/admin/consultSms";
import { completeReservation, confirmReservation, saveReservationMemo } from "@/actions/admin/reservation";
import type { ConsultSmsResult } from "@/lib/admin/consultSms";
import { ADMIN_MEMO_MAX_CHARS } from "@/lib/admin/memo";
import type { ReservationStatus } from "@/lib/admin/reservations";

import { AdminBanner } from "./AdminBanner";
import { AdminSheet } from "./AdminSheet";
import { AdminToastRegion, type ShownToast } from "./AdminToast";
import { ConsultSmsSheet } from "./ConsultSmsSheet";
import { blockBeforeSend, consultSmsReducer, initialConsultSmsState, type ConsultSmsBanner } from "./consult-sms";
import { PendingButton } from "./PendingButton";
import { PROCESS_REGION_ATTR, firstVisible, panelChannels } from "./reservation-panel";
import {
  CUSTOMER_NAME_ELEMENT_ID,
  SHEET_STUCK_MS,
  bannerMessage,
  cleanCustomerName,
  fillTemplate,
  focusRescue,
  focusReturn,
  initialPanelState,
  panelController,
  panelReducer,
  sheetTitle,
  toastHasLink,
  type ConsultSmsLabels,
  type PanelActions,
  type PanelState,
  type ReservationActionLabels,
  type ReservationSummary,
  type SheetKind,
  type TriggerKind,
} from "./reservation-sheet";

import s from "./admin.module.css";

export type { ReservationActionLabels, ReservationSummary } from "./reservation-sheet";

/**
 * 서버액션 표 — 컨트롤러만 부른다(시트의 실행 버튼 · 메모 저장). 이 파일은 세 함수를 직접 부르지 않는다.
 * 취소(cancelReservation)는 OF3-R4 에서 화면 진입을 걷었다 — 이 표에도 없다(서버액션·DB 함수는 남는다).
 */
const ACTIONS: PanelActions = {
  confirm: confirmReservation,
  complete: completeReservation,
  memo: saveReservationMemo,
};

/** 상담완료 문자 결과를 믿지 않는다 — throw(네트워크)·모양이 다른 값은 실패로 읽는다(reservation-sheet.ts call 과 같은 규약). */
async function callSms(send: () => Promise<ConsultSmsResult>): Promise<ConsultSmsResult> {
  try {
    const result: unknown = await send();
    if (typeof result === "object" && result !== null && typeof (result as ConsultSmsResult).code === "string") return result as ConsultSmsResult;
  } catch {
    // 아래로
  }
  return { ok: false, code: "failed" };
}

/** 문자 시트 배너 문구. */
function smsBannerText(banner: ConsultSmsBanner | null, l: ConsultSmsLabels): string | null {
  if (banner === null) return null;
  switch (banner.kind) {
    case "empty":
      return l.empty;
    case "tooLong":
      return fillTemplate(l.tooLong, { bytes: banner.bytes.toLocaleString("ko-KR"), max: banner.max.toLocaleString("ko-KR") });
    case "notConsulted":
      return l.results.notConsulted;
    case "invalid":
      return l.results.invalid;
    case "failed":
      return l.results.failed;
  }
}

/** 서버가 그린 고객 이름 칸의 글자(시트 제목용). 없으면 "" — 이름 없는 제목으로 떨어진다. */
function readCustomerName(): string {
  return cleanCustomerName(document.getElementById(CUSTOMER_NAME_ELEMENT_ID)?.textContent);
}

/** 성공 뒤 포커스 자리 — 처리 영역 표식을 가진 것 중 지금 보이는 것(데스크톱 처리 카드 · 휴대폰 행동 바는 한 폭에서 하나만 그려진다). */
function visibleProcessRegion(): HTMLElement | null {
  return firstVisible([...document.querySelectorAll<HTMLElement>(`[${PROCESS_REGION_ATTR}]`)], (el) => el.getClientRects().length > 0);
}

/**
 * 상담완료 문자 시트에 내려 주는 두 조각(OF3-R4) — 서버(상세 페이지)가 원장으로 만든다. 상담완료가 아닌 접수(새 접수 · 옛 취소)는 null(시트를 열지 않는다).
 * 개인정보가 없다: 기본 문구는 사이트 주소·상담 전화(원장), 블록은 대금·환불 규정 문장(원장)뿐이다.
 */
export interface ConsultSmsDraft {
  defaultText: string;
  block: string;
}

export interface ReservationActionsProps {
  id: string;
  status: ReservationStatus;
  initialMemo: string;
  summary: ReservationSummary;
  labels: ReservationActionLabels;
  sms: ConsultSmsDraft | null;
}

export function ReservationActions({ id, status, initialMemo, summary, labels, sms }: ReservationActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, dispatch] = useReducer(panelReducer, initialMemo, initialPanelState);
  const [smsState, smsDispatch] = useReducer(consultSmsReducer, undefined, () => initialConsultSmsState(sms?.defaultText ?? "", sms?.block ?? ""));
  /** 문자 시트를 연 버튼 — 닫힌 뒤 포커스를 돌려준다(확인 시트의 openerRef 와 같은 일). */
  const smsOpenerRef = useRef<HTMLElement | null>(null);
  const smsWasOpenRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  /** 처리 중 여부(닫힘 효과가 읽는다 — 레이아웃 효과로 맞춘다). */
  const pendingRef = useRef(pending);
  /** 처리 중에 닫아(15초 탈출) 포커스를 돌려놓은 연 버튼 — 늦은 결과의 새로고침이 그 버튼을 없애면 포커스를 구한다(수정 라운드 · 리뷰 P2-3). */
  const heldOpenerRef = useRef<HTMLElement | null>(null);
  // 접수 id 로 만든 고정 id — useId 는 서버·브라우저 트리 위치가 어긋나 aria-labelledby 하이드레이션 불일치를 냈다(OF3-R4 컨트롤러 실측).
  const memoHintId = `admin-memo-hint-${id}`;
  const memoTitleId = `admin-memo-title-${id}`;
  /** 처리 중 SHEET_STUCK_MS 가 지났다(응답이 오지 않는다) — 시트의 [닫기]·ESC·바깥 누르기를 되살린다(리뷰 P2-1). */
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), SHEET_STUCK_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  // 새로고침이 새 메모를 내려 주면 — 사장님이 고치는 중이 아니면 그 값을 따른다(다른 탭의 저장을 덮어쓰지 않게).
  if (initialMemo !== state.propMemo) dispatch({ type: "propMemo", memo: initialMemo });
  // 문자 시트의 두 조각도 같다(OF3-R4) — 상담완료로 바뀐 뒤의 새로고침이 처음 내려 준다. 고치지 않은 문구는 새 기본값을 따른다.
  if (sms !== null && (sms.defaultText !== smsState.defaultText || sms.block !== smsState.block)) {
    smsDispatch({ type: "draft", defaultText: sms.defaultText, block: sms.block });
  }

  const controller = panelController({
    id,
    actions: ACTIONS,
    dispatch,
    refresh: () => router.refresh(),
    readCustomerName,
  });

  const openSheet = (sheet: SheetKind, opener: HTMLElement) => {
    openerRef.current = opener;
    controller.open(sheet);
  };
  const submit = () => startTransition(() => controller.commit(state));
  const saveMemo = () => startTransition(() => controller.saveMemo(state));
  const onToastDone = useCallback((toastId: number) => dispatch({ type: "toastDone", id: toastId }), []);

  // ── 상담완료 문자(OF3-R4) — 보내기는 처리 중 표시 안에서(두 번 누름 방지) · 보내지 않음은 닫고 안내를 남긴다
  const openSms = (opener: HTMLElement) => {
    smsOpenerRef.current = opener;
    smsDispatch({ type: "open", customerName: readCustomerName() });
  };
  const sendSms = () => {
    if (sms === null) return;
    const blocked = blockBeforeSend(smsState.text, sms.block);
    if (blocked !== null) {
      smsDispatch({ type: "blocked", banner: blocked });
      return;
    }
    const text = smsState.text;
    startTransition(async () => {
      const result = await callSms(() => sendConsultSms(id, text));
      smsDispatch({ type: "settled", result });
      if (result.ok) dispatch({ type: "smsQueued" });
      // 보냈으면 보낸 문자 기록을, 상담완료가 아니면 최신 상태를 다시 그린다
      if (result.ok || result.code === "notConsulted") router.refresh();
    });
  };
  const skipSms = useCallback(() => smsDispatch({ type: "skip" }), []);

  const canConfirm = status === "new";
  const canComplete = status === "confirmed";
  /** 상담완료 문자 — 상담완료(confirmed) · 운행 완료(done) 접수에 서버가 두 조각을 내렸을 때만(0028 함수와 같은 규칙 · 마지막 판정은 DB). */
  const canSms = sms !== null && (status === "confirmed" || status === "done");
  /** 존재하는 전이만 연다 — 새로고침 전의 낡은 진입 버튼이 보낸 요청도 여기서 걸린다(마지막 판정은 여전히 DB). 취소는 화면에서 열 수 없다(OF3-R4). */
  const canOpen = (kind: TriggerKind): boolean => (kind === "confirm" ? canConfirm : kind === "complete" ? canComplete : kind === "sms" ? canSms : false);

  // 진입 버튼(처리 카드 · 행동 바 · 맨 아래)의 요청은 채널로 온다 — 처리 중 · 시트가 열려 있음 · 없는 전이면 무시하고, 여는 것 말고는 하지 않는다.
  const channelOpen = useRef<(kind: TriggerKind, opener: HTMLElement | null) => void>(() => {});
  useLayoutEffect(() => {
    channelOpen.current = (kind: TriggerKind, opener: HTMLElement | null) => {
      if (pending || state.sheet !== null || smsState.open || opener === null || !canOpen(kind)) return;
      if (kind === "sms") openSms(opener);
      else openSheet(kind, opener);
    };
  });
  useEffect(() => panelChannels.attach(id, (kind, opener) => channelOpen.current(kind, opener)), [id]);
  // 처리 중을 진입 버튼들에 알린다 — 그리기 전에(눌리는 모양으로 한 프레임도 보이지 않게)
  useLayoutEffect(() => {
    panelChannels.setPending(id, pending);
  }, [id, pending]);
  useLayoutEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // 시트가 닫히면 포커스를 돌려놓는다 — 그냥 닫혔으면 연 버튼, 바뀌었으면 처리 영역(연 버튼은 새로고침에서 사라진다).
  useEffect(() => {
    if (state.sheet !== null) {
      wasOpenRef.current = true;
      heldOpenerRef.current = null;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    // 연 버튼이 사라졌거나(새로고침) 쓸 수 없으면 처리 영역으로 — 보이는 처리 카드·행동 바, 없으면 메모 카드.
    if (focusReturn(state.lastClose, opener !== null && opener.isConnected && !opener.matches(":disabled")) === "opener" && opener !== null) {
      opener.focus();
      // 처리 중에 닫았다(15초 탈출) — 늦은 결과의 새로고침이 이 버튼을 없앨 수 있다. 기억해 두었다가 아래 효과가 구한다(리뷰 P2-3)
      heldOpenerRef.current = pendingRef.current ? opener : null;
    } else {
      const region = visibleProcessRegion();
      if (region !== null) region.focus();
      else panelRef.current?.focus();
    }
  }, [state.sheet, state.lastClose]);

  // 문자 시트가 닫히면 — 연 버튼이 아직 있으면 그리로, 아니면 보이는 처리 영역(없으면 메모 카드)으로.
  useEffect(() => {
    if (smsState.open) {
      smsWasOpenRef.current = true;
      return;
    }
    if (!smsWasOpenRef.current) return;
    smsWasOpenRef.current = false;
    const opener = smsOpenerRef.current;
    smsOpenerRef.current = null;
    if (opener !== null && opener.isConnected) opener.focus();
    else (visibleProcessRegion() ?? panelRef.current)?.focus();
  }, [smsState.open]);

  // 늦은 결과 뒤 포커스 구하기(수정 라운드 · 리뷰 P2-3) — 새로고침으로 다시 그려질 때마다(의존성 없음) 본다. 기억한 연 버튼이 사라지고
  // 포커스가 body 로 빠졌으면 보이는 처리 영역(데스크톱 처리 카드 · 휴대폰 행동 바 — 새로고침에도 그대로인 자리)으로, 없으면 메모 카드로.
  useEffect(() => {
    const held = heldOpenerRef.current;
    if (held === null) return;
    const active = document.activeElement;
    const decision = focusRescue({ connected: held.isConnected, focused: active === held }, active === null || active === document.body);
    if (decision === "wait") return;
    heldOpenerRef.current = null;
    if (decision === "rescue") (visibleProcessRegion() ?? panelRef.current)?.focus();
  });

  return (
    <>
      {/* [보내지 않음]으로 닫은 뒤 남는 안내(요구 R4) — 다시 열거나 보내면 사라진다. 자리는 처음부터 있다(role=status · 비어 있으면 그리지 않는다). */}
      <div role="status" data-testid="admin-sms-skipped-region">
        {smsState.skipped ? (
          <p className={s.smsSkipped} data-testid="admin-sms-skipped">
            {labels.sms.skipped}
          </p>
        ) : null}
      </div>
      <section ref={panelRef} className={s.detailCard} aria-labelledby={memoTitleId} tabIndex={-1} data-testid="admin-memo-card">
        <h2 id={memoTitleId} className={s.detailCardTitle}>
          <label htmlFor="admin-memo">{labels.memoLabel}</label>
        </h2>
        <p className={s.hint} id={memoHintId}>
          {labels.memoHint}
        </p>
        <textarea
          id="admin-memo"
          className={s.textarea}
          aria-describedby={memoHintId}
          rows={4}
          maxLength={ADMIN_MEMO_MAX_CHARS}
          placeholder={labels.memoPlaceholder}
          value={state.memoText}
          disabled={pending}
          onChange={(e) => controller.editMemo(e.target.value)}
          data-testid="admin-memo"
        />
        <div className={s.memoFoot}>
          <PendingButton className={s.btnSecondary} pending={pending} onClick={saveMemo} testId="admin-memo-save">
            {labels.memoSave}
          </PendingButton>
        </div>
        <AdminBanner
          text={state.memoBanner === null ? null : bannerMessage(state.memoBanner, labels)}
          attempt={state.memoBannerSeq}
          testId="admin-memo-banner"
        />
      </section>

      {state.sheet === null ? null : (
        <ReservationSheet
          sheet={state.sheet}
          state={state}
          labels={labels}
          summary={summary}
          pending={pending}
          slow={slow}
          onClose={controller.close}
          onSubmit={submit}
        />
      )}

      {smsState.open && sms !== null ? (
        <ConsultSmsSheet
          labels={labels.sms}
          processing={labels.processing}
          slowNote={labels.sheet.slow}
          customerName={smsState.customerName}
          text={smsState.text}
          block={sms.block}
          banner={smsBannerText(smsState.banner, labels.sms)}
          bannerAttempt={smsState.bannerSeq}
          pending={pending}
          slow={slow}
          onText={(text) => smsDispatch({ type: "edit", text })}
          onClose={skipSms}
          onSubmit={sendSms}
        />
      ) : null}

      <ActionToast toast={state.toast} labels={labels} onDone={onToastDone} />
    </>
  );
}

/**
 * 시트 하나 — 종류별 문구·요약·사유를 AdminSheet 에 채운다. 상태는 부르는 쪽(ReservationActions)이 든다.
 * 잠긴 시트(이미 처리됨 — `state.sheetLocked`)는 실행 버튼과 사유 라디오를 막는다(리뷰 P1-1). 판정은 배너 모양이 아니라 잠금이다.
 * 설명(aria-describedby)은 결과 문장 하나다 — P5-22 의 점검표 확인 경고는 사장님 요청 11(2026-10-10)로 지웠다(요약 상자 → 본문).
 * 간편 접수의 요약 한 줄(quickNote)은 그대로다.
 */
export function ReservationSheet({
  sheet,
  state,
  labels,
  summary,
  pending,
  slow,
  onClose,
  onSubmit,
}: {
  sheet: SheetKind;
  state: PanelState;
  labels: ReservationActionLabels;
  summary: ReservationSummary;
  pending: boolean;
  /** 처리 중 SHEET_STUCK_MS 가 지났다 — [닫기]를 되살리고 늦음 안내를 보인다. */
  slow: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const copy = labels.sheet[sheet];
  const title = sheetTitle(copy.title, copy.titleNoName, state.customerName);
  const banner = state.sheetBanner === null ? null : bannerMessage(state.sheetBanner, labels);

  const before = (
    <p className={s.sheetSummary} data-testid="admin-sheet-summary">
      {summary.parts.join(" · ")}
      {sheet === "confirm" && summary.quick ? <span className={s.sheetSummaryNote}>{labels.sheet.quickNote}</span> : null}
    </p>
  );

  return (
    <AdminSheet
      name={sheet}
      title={title}
      before={before}
      description={copy.body}
      banner={banner}
      bannerAttempt={state.sheetBannerSeq}
      closeLabel={labels.sheet.close}
      submitLabel={copy.submit}
      processingLabel={labels.processing}
      submitVariant="primary"
      pending={pending}
      slow={slow}
      slowNote={labels.sheet.slow}
      submitDisabled={state.sheetLocked}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

/**
 * 결과 토스트 — P5-20 에서 부품을 관리자 전체로 넓혔다(components/admin/AdminToast.tsx AdminToastRegion). 동작은 그대로다:
 * role=status 자리는 처음부터 있고(비어 있음), 문구는 **한 번 늦게** 넣는다 — 시트가 닫히는 순간에는 배경(이 자리 포함)이 아직 inert 라
 * 같은 순간에 문구를 넣으면 스크린리더가 놓칠 수 있다(시트의 inert 해제가 먼저, 문구가 뒤에). 3초 · 링크가 있으면 5초 ·
 * 마우스·포커스가 있는 동안은 멈춘다. 시간은 토스트 번호로 잰다 — 새로고침으로 라벨이 다시 내려와도 시계가 처음부터 돌지 않는다.
 */
function ActionToast({ toast, labels, onDone }: { toast: PanelState["toast"]; labels: ReservationActionLabels; onDone: (id: number) => void }) {
  const shown = useMemo<ShownToast | null>(
    () =>
      toast === null
        ? null
        : {
            id: toast.id,
            code: toast.code,
            text: toast.code === "smsQueued" ? labels.sms.results.queued : labels.results[toast.code],
            link: toastHasLink(toast.code) ? labels.toastLink : null,
          },
    [toast, labels],
  );
  return <AdminToastRegion toast={shown} onDone={onDone} />;
}
