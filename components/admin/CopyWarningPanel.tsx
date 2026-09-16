"use client";
/**
 * 사장님 글 경고 패널 (P6-12 · known-defects D4). 공지·팝업·사진 설명·앨범 이름이 같은 패널을 쓴다.
 *
 * 서버가 `code: "copyWarning"` 으로 저장을 멈추면 이 패널이 **무엇이 · 왜** 문제인지 한 줄씩 보이고,
 * **그대로 저장하기** 버튼을 준다. 막지 않는다 — 누르면 저장된다(D4 결정). 흐름은 lib/admin/copyWarning.ts 헤더.
 *
 * 버튼 두 가지 모양:
 *   · 폼(공지·팝업) — `type="submit"` + `data-copy-ack`. 폼의 onSubmit 이 submitter 를 보고 확인 키를 붙인다.
 *     같은 폼·같은 입력으로 다시 보내므로 사장님이 칸을 고친 뒤 눌러도 **지금 칸의 글**이 대조된다.
 *   · 버튼(갤러리) — `onConfirm` 콜백. 카드는 폼이 아니라 객체로 액션을 부른다.
 *
 * 문구는 전부 props(messages/ko.json `admin.copyWarning.*`)다 — 사유 문장은 운영 매뉴얼 4장과 같은 말이다.
 * 공개 화면은 이 컴포넌트를 쓰지 않는다(관리자 전용). 목록 자체는 여기 없다 — 서버가 걸린 글자와 분류만 보낸다.
 * 순수 도우미(한 줄 채우기·확인 키 누적)는 lib/admin/copyWarning.ts 에 있다 — vitest 가 JSX 없이 검사한다.
 */
import { fillCopyWarningItem, mergeCopyAck, type CopyWarning, type CopyWarningLabels } from "@/lib/admin/copyWarning";

import s from "./admin.module.css";

export type { CopyWarningLabels };
export const mergeAck = mergeCopyAck;

/** submitter 가 이 패널의 확인 버튼인가 — 폼의 onSubmit 이 쓴다. */
const COPY_ACK_SUBMITTER_ATTR = "data-copy-ack";

export function isCopyAckSubmitter(submitter: EventTarget | null | undefined): boolean {
  return submitter instanceof HTMLElement && submitter.hasAttribute(COPY_ACK_SUBMITTER_ATTR);
}

export function CopyWarningPanel({
  warnings,
  labels,
  pending,
  onConfirm,
  idPrefix,
}: {
  warnings: readonly CopyWarning[];
  labels: CopyWarningLabels;
  pending: boolean;
  /** 없으면 submit 버튼으로 그린다(폼 안에서 쓸 때). */
  onConfirm?: () => void;
  idPrefix: string;
}) {
  if (warnings.length === 0) return null;
  const titleId = `${idPrefix}-copy-warning-title`;
  return (
    <div className={s.copyWarning} role="alert" aria-labelledby={titleId} data-testid="admin-copy-warning">
      <p className={s.copyWarningTitle} id={titleId}>
        {labels.title}
      </p>
      <p className={s.hint}>{labels.lead}</p>
      <ul className={s.copyWarningList}>
        {warnings.map((w) => (
          <li key={w.key} data-kind={w.kind}>
            {fillCopyWarningItem(labels, w)}
          </li>
        ))}
      </ul>
      {onConfirm ? (
        <button type="button" className={s.btnSecondary} disabled={pending} onClick={onConfirm} data-testid="admin-copy-warning-confirm">
          {labels.confirm}
        </button>
      ) : (
        <button type="submit" className={s.btnSecondary} disabled={pending} data-copy-ack="" data-testid="admin-copy-warning-confirm">
          {labels.confirm}
        </button>
      )}
    </div>
  );
}
