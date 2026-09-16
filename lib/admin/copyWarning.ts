/**
 * 사장님 글 경고 — 결과 모양 · 확인(ack) 규약. **순수 모듈, 클라이언트가 import 해도 된다** (P6-12 · known-defects D4).
 *
 * 목록(lib/copy/rules.ts)은 여기서 **import 하지 않는다** — 이 파일은 클라이언트 폼이 가져가므로,
 * 값을 끌어오면 목록이 브라우저 번들에 실린다. 분류 이름은 낱말이 없는 lib/copy/kinds.ts 에서 받는다.
 * 대조는 lib/admin/copyCheck.ts(server-only)가 한다.
 *
 * 흐름 — **저장 전 확인**(P5-11 삭제 2단계와 같은 결):
 *   1. 저장을 누르면 서버가 글을 대조한다. 걸린 것이 있고 사장님이 아직 확인하지 않았으면 **저장하지 않고** 경고를 돌려준다
 *      (`code: "copyWarning"`, `ok: true` — 오류가 아니다).
 *   2. 화면이 경고 목록과 **그대로 저장하기** 버튼을 보인다. 그 버튼을 누르면 같은 입력에 확인 키(`copyAck`)를 붙여 다시 보낸다.
 *   3. 서버는 지금 걸린 표현이 **전부** 확인 키에 있으면 저장한다. 사장님이 글을 고쳐 **새 표현**이 걸리면 다시 묻는다.
 * 막지 않는다 — 한 번 더 누르면 언제나 저장된다(D4 결정: 차단이 아니라 경고).
 *
 * 확인 키는 `필드:걸린 글자` 다. 규칙 라벨(개발자용)이나 규칙 번호를 브라우저로 보내지 않는다 — 사장님이 이미 가진 글자뿐이다.
 * 사용자에게 보일 문구는 여기 없다(한글 리터럴 0). 문구는 messages/ko.json `admin.copyWarning.*`.
 */
import { z } from "zod";

import type { OwnerCopyKind } from "@/lib/copy/kinds";

/** 검사하는 자유 텍스트 칸 — 공지·팝업 제목/내용, 사진 설명, 앨범 이름. 화면 라벨은 `admin.copyWarning.field.*`. */
export const COPY_FIELDS = ["title", "body", "caption", "albumTitle"] as const;
export type CopyField = (typeof COPY_FIELDS)[number];

export type CopyWarningKind = OwnerCopyKind;

export interface CopyWarning {
  /** 확인 키 — `${field}:${text}`. 화면이 그대로 돌려보낸다. */
  key: string;
  field: CopyField;
  kind: CopyWarningKind;
  /** 사장님 글에서 걸린 글자 그대로(짧다). */
  text: string;
}

/** 폼 필드 이름(FormData) · 객체 입력의 키(갤러리 액션). */
export const COPY_ACK_FIELD = "copyAck";

/** 한 번에 보여 줄 경고 상한. 넘으면 앞의 것만 — 긴 목록은 읽히지 않는다. */
export const COPY_WARNING_MAX = 20;
/** 확인 키 하나의 상한. 걸린 글자는 규칙 모양상 짧다(가장 긴 것이 투명성 규칙의 20자 남짓). */
const COPY_ACK_KEY_MAX = 200;

export const copyWarningKey = (field: CopyField, text: string): string => `${field}:${text}`;

const AckList = z.array(z.string().max(COPY_ACK_KEY_MAX)).max(COPY_WARNING_MAX * 4);

/** FormData 의 확인 키들. 형식이 틀리면 빈 집합 — **확인하지 않은 것으로 본다**(다시 묻는 쪽이 안전하다). */
export function readCopyAckForm(formData: FormData): ReadonlySet<string> {
  const raw = formData.getAll(COPY_ACK_FIELD).filter((v): v is string => typeof v === "string");
  const parsed = AckList.safeParse(raw);
  return new Set(parsed.success ? parsed.data : []);
}

/** 객체 입력(갤러리 액션)의 `copyAck`. 없거나 형식이 틀리면 빈 집합. 입력의 나머지 키는 보지 않는다. */
export function readCopyAckValue(input: unknown): ReadonlySet<string> {
  if (typeof input !== "object" || input === null) return new Set();
  const parsed = AckList.safeParse((input as Record<string, unknown>)[COPY_ACK_FIELD]);
  return new Set(parsed.success ? parsed.data : []);
}

/** 경고 패널 문구(messages/ko.json `admin.copyWarning.*`) — components/admin/CopyWarningPanel.tsx 가 쓴다. */
export interface CopyWarningLabels {
  title: string;
  lead: string;
  confirm: string;
  /** `{field}` `{text}` `{reason}` 자리를 채운다. */
  item: string;
  field: Record<CopyField, string>;
  kind: Record<CopyWarningKind, string>;
}

/**
 * 한 줄 문구. **한 번에** 채운다 — 사장님 글자에 `{reason}` 같은 모양이나 `$&` 가 들어 있어도
 * 두 번째 치환이 그것을 다시 건드리지 않는다(함수 치환이라 `$` 특수 패턴도 해당 없다).
 */
export function fillCopyWarningItem(labels: Pick<CopyWarningLabels, "item" | "field" | "kind">, w: CopyWarning): string {
  const values: Record<string, string> = { field: labels.field[w.field], text: w.text, reason: labels.kind[w.kind] };
  return labels.item.replace(/\{(field|text|reason)\}/g, (_, k: string) => values[k]);
}

/** 이미 확인한 키에 새로 보인 키를 더한다(화면 상한 뒤에 숨은 표현이 있어도 몇 번 누르면 끝난다). */
export function mergeCopyAck(prev: readonly string[], warnings: readonly CopyWarning[]): string[] {
  return [...new Set([...prev, ...warnings.map((w) => w.key)])];
}

/** 확인을 기다리는 결과 — 세 탭(공지·팝업·갤러리)의 결과 타입이 모두 이 모양을 받는다. 저장하지 않았으므로 changed=false. */
export interface CopyHoldResult {
  ok: true;
  changed: false;
  code: "copyWarning";
  copyWarnings: CopyWarning[];
}

export const copyHold = (copyWarnings: CopyWarning[]): CopyHoldResult => ({
  ok: true,
  changed: false,
  code: "copyWarning",
  copyWarnings,
});
