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
 * ── 확인 키 (GPT 검증 후속, 2026-09-17) ──────────────────────────────────────────────
 * 모양: `칸:글16:표현16` — 정규화한 **그 칸 전체 글**의 해시 16자리 + 정규화한 **걸린 표현**의 해시 16자리.
 * 서버(lib/admin/copyCheck.ts `copyAckKey`)만 만들고, 화면은 받은 키를 그대로 돌려보낸다.
 *   · **길이가 고정**(최대 44자)이다. 예전에는 걸린 글자를 통째로 넣어서, `업계` + 공백 201개 + `1위` 처럼 긴 일치는
 *     키가 파서 상한(200자)을 넘어 "그대로 저장하기" 를 눌러도 영영 경고만 돌았다(Codex 재현).
 *   · **글에 묶인다.** A 글에 대해 받은 확인은 글이 바뀌면 무효다 — 확인한 뒤 새 주장을 덧붙인 글이 옛 확인으로
 *     통과하지 못한다(첫 일치만 모으던 결함과 겹치는 방어). 공백·보이지 않는 문자만 다른 글은 정규화 뒤 같은 글이라 확인이 유지된다.
 *   · 규칙 라벨(개발자용)이나 규칙 번호는 브라우저로 보내지 않는다.
 *
 * ── 무엇을 막고 무엇을 막지 않나 (컨트롤러 판단 P2, 2026-09-17) ─────────────────────────
 * 막는 것: 사장님이 **보지 못한 표현**이 저장되는 것. 걸린 표현은 전부 화면에 떴고, 그 글 그대로에 대해 확인했을 때만 저장된다.
 * 막지 않는 것: **확인 위조.** 키 계산법은 비밀이 아니므로, 경고를 받지 않고도 첫 요청에 올바른 키를 실어 보내면 저장된다.
 *   이 경로를 부를 수 있는 것은 `requireAdmin()` 을 통과한 관리자뿐이고, 이 경고는 **권한 통제가 아니라 실수 방지 장치**다
 *   (D4 — 차단하지 않고 경고한다). 요청을 일부러 조작하는 관리자는 어차피 그 글을 쓸 권한이 있다.
 *   서버 발급 토큰·세션 상태는 만들지 않는다 — 복잡도에 비해 위협 모델 밖이다.
 *   tests/admin-copy-warning.test.ts §11 이 이 한계를 **있는 그대로** 고정한다(바뀌면 이 문단도 바꿔라).
 *
 * 사용자에게 보일 문구는 여기 없다(한글 리터럴 0). 문구는 messages/ko.json `admin.copyWarning.*`.
 */
import { z } from "zod";

import type { OwnerCopyKind } from "@/lib/copy/kinds";

/** 검사하는 자유 텍스트 칸 — 공지·팝업 제목/내용, 사진 설명, 앨범 이름. 화면 라벨은 `admin.copyWarning.field.*`. */
export const COPY_FIELDS = ["title", "body", "caption", "albumTitle"] as const;
export type CopyField = (typeof COPY_FIELDS)[number];

export type CopyWarningKind = OwnerCopyKind;

export interface CopyWarning {
  /** 확인 키 — `칸:글16:표현16`(헤더). 화면이 그대로 돌려보낸다. */
  key: string;
  field: CopyField;
  kind: CopyWarningKind;
  /**
   * 걸린 표현 — **정규화한 사본**의 글자다(전각 `１` 은 `1` 로, 폭 없는 문자는 빠진 채 보인다).
   * COPY_TEXT_SHOWN_MAX 자를 넘으면 잘라서 보인다(판정·키는 잘리지 않은 전체로 한다).
   */
  text: string;
}

/** 패널에 보일 표현의 최대 길이. */
export const COPY_TEXT_SHOWN_MAX = 40;

/** 폼 필드 이름(FormData) · 객체 입력의 키(갤러리 액션). */
export const COPY_ACK_FIELD = "copyAck";

/** 한 번에 보여 줄 경고 상한. 넘으면 앞의 것만 — 긴 목록은 읽히지 않는다. */
export const COPY_WARNING_MAX = 20;
/** 확인 키 모양 — `칸:글16:표현16`. 이 모양이 아닌 항목은 버린다(나머지 항목은 살린다). */
const ACK_KEY_RE = new RegExp(`^(${COPY_FIELDS.join("|")}):([0-9a-f]{16}):([0-9a-f]{16})$`);
/**
 * 한 번에 받는 확인 키 개수 상한. 본문 4000자에 짧은 주장("1대 보유 ")을 빽빽이 넣어도 600개 남짓이다.
 * 키 하나가 44자라 1000개여도 5만 자 — 서버액션 본문 한도(1MB)에 한참 못 미친다.
 */
const COPY_ACK_COUNT_MAX = 1000;

const AckList = z.array(z.unknown()).max(COPY_ACK_COUNT_MAX);

function toAckSet(raw: unknown): ReadonlySet<string> {
  const parsed = AckList.safeParse(raw);
  if (!parsed.success) return new Set();
  return new Set(parsed.data.filter((v): v is string => typeof v === "string" && ACK_KEY_RE.test(v)));
}

/** FormData 의 확인 키들. 개수가 넘치면 빈 집합, 모양이 틀린 항목은 버린다 — **확인하지 않은 것으로 본다**(다시 묻는 쪽이 안전하다). */
export function readCopyAckForm(formData: FormData): ReadonlySet<string> {
  return toAckSet(formData.getAll(COPY_ACK_FIELD));
}

/** 객체 입력(갤러리 액션)의 `copyAck`. 없거나 배열이 아니면 빈 집합. 입력의 나머지 키는 보지 않는다. */
export function readCopyAckValue(input: unknown): ReadonlySet<string> {
  if (typeof input !== "object" || input === null) return new Set();
  return toAckSet((input as Record<string, unknown>)[COPY_ACK_FIELD]);
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

/**
 * 이미 확인한 키에 새로 보인 키를 더한다(화면 상한 뒤에 숨은 표현이 있어도 몇 번 누르면 끝난다).
 * 이번 경고에 나온 칸은 **지금 글의 해시**를 알 수 있으므로, 그 칸의 옛 글 키는 버린다 —
 * 편집을 거듭해도 키가 쌓여 개수 상한에 걸리지 않게(걸리면 영영 확인할 수 없다).
 * 이번 경고에 안 나온 칸의 키는 그대로 둔다(상한 때문에 화면에서 밀렸을 뿐일 수 있다).
 */
export function mergeCopyAck(prev: readonly string[], warnings: readonly CopyWarning[]): string[] {
  const current = new Map<string, string>();
  for (const w of warnings) {
    const m = ACK_KEY_RE.exec(w.key);
    if (m) current.set(m[1], m[2]);
  }
  const kept = prev.filter((k) => {
    const m = ACK_KEY_RE.exec(k);
    if (!m) return false;
    const now = current.get(m[1]);
    return now === undefined || now === m[2];
  });
  return [...new Set([...kept, ...warnings.map((w) => w.key)])];
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
