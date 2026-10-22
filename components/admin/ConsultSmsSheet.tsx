"use client";
/**
 * 상담완료 문자 시트 — [문자 보내기] (OF3-R4 · 마이그레이션 0028 · OF3-requirements R4 10번).
 *
 * 모양(AdminSheet — 확인 시트와 같은 틀 · 접근성 · 무장 지연 · 배경 inert):
 *   제목 "{이름} 님께 문자 보내기"
 *   위  = 보낼 문구(편집 칸 — 기본값은 옛 확정 문자의 인사·안내 부분 · verbatim 없음) + 최종 본문의 바이트 수(90바이트를 넘으면 "장문 문자로 보내져요")
 *   설명 = 아래 블록이 늘 붙는다는 한 줄
 *   아래 = 계약 정보 블록(■ 대금 · ■ 취소·환불 · 계약 주체 — 서버가 원장에서 만든 글자) **읽기 전용 미리보기**
 *   [보내지 않음] [보내기]
 * [보내지 않음]·ESC·바깥 누르기는 모두 "보내지 않음" 이다 — 부르는 쪽(ReservationActions)이 시트를 닫고 안내 한 줄을 남긴다.
 *
 * 상태는 부르는 쪽이 든다(consult-sms.ts 의 상태 기계). 이 부품은 그리고 누름을 넘길 뿐이다 — 서버액션을 부르지 않는다.
 * 받는 것에 고객 개인정보가 없다(이름은 부르는 쪽이 서버가 그린 칸에서 읽어 넘긴다 — 확인 시트와 같은 규약). 문구는 props(한글 리터럴 0).
 */
import { useId } from "react";

import { CONSULT_FREE_TEXT_MAX_CHARS, CONSULT_SMS_MAX_BYTES, joinConsultSms } from "@/lib/notify/consult-text";

import { AdminSheet } from "./AdminSheet";
import { checkConsultSms, smsByteLength } from "./consult-sms";
import { fillTemplate, sheetTitle, type ConsultSmsLabels } from "./reservation-sheet";

import s from "./admin.module.css";

export interface ConsultSmsSheetProps {
  labels: ConsultSmsLabels;
  processing: string;
  slowNote: string;
  customerName: string;
  text: string;
  block: string;
  banner: string | null;
  bannerAttempt: number;
  pending: boolean;
  slow: boolean;
  onText: (text: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const formatCount = (n: number): string => n.toLocaleString("ko-KR");

export function ConsultSmsSheet({
  labels,
  processing,
  slowNote,
  customerName,
  text,
  block,
  banner,
  bannerAttempt,
  pending,
  slow,
  onText,
  onClose,
  onSubmit,
}: ConsultSmsSheetProps) {
  const textId = useId();
  const bytesId = useId();
  const blockTitleId = useId();
  const check = checkConsultSms(text, block);
  const bytes = smsByteLength(joinConsultSms(text, block));
  const over = bytes > CONSULT_SMS_MAX_BYTES;

  const before = (
    <div className={s.smsField}>
      <label className={s.smsLabel} htmlFor={textId}>
        {labels.textLabel}
      </label>
      <textarea
        id={textId}
        className={s.textarea}
        rows={9}
        maxLength={CONSULT_FREE_TEXT_MAX_CHARS}
        value={text}
        disabled={pending}
        aria-describedby={bytesId}
        onChange={(e) => onText(e.target.value)}
        data-testid="admin-sms-text"
      />
      <p id={bytesId} className={s.smsBytes} aria-live="polite" data-over={over ? "true" : "false"} data-testid="admin-sms-bytes">
        {fillTemplate(labels.bytes, { bytes: formatCount(bytes), max: formatCount(CONSULT_SMS_MAX_BYTES) })}
        {check.kind === "ok" && check.long ? ` · ${labels.long}` : null}
        {over ? ` · ${fillTemplate(labels.tooLong, { bytes: formatCount(bytes), max: formatCount(CONSULT_SMS_MAX_BYTES) })}` : null}
      </p>
    </div>
  );

  const after = (
    <section className={s.smsBlock} aria-labelledby={blockTitleId}>
      <h3 id={blockTitleId} className={s.smsLabel}>
        {labels.blockLabel}
      </h3>
      <pre className={s.smsBlockText} data-testid="admin-sms-block">
        {block}
      </pre>
    </section>
  );

  return (
    <AdminSheet
      name="sms"
      title={sheetTitle(labels.title, labels.titleNoName, customerName)}
      before={before}
      description={labels.body}
      after={after}
      banner={banner}
      bannerAttempt={bannerAttempt}
      closeLabel={labels.skip}
      submitLabel={labels.submit}
      processingLabel={processing}
      submitVariant="primary"
      pending={pending}
      slow={slow}
      slowNote={slowNote}
      submitDisabled={false}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
