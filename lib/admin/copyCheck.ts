/**
 * 사장님 글 대조 — **서버 전용** (P6-12 · known-defects D4).
 *
 * 앱에서 목록(lib/copy/rules.ts)을 값으로 import 하는 **유일한 파일**이다. `server-only` 라서 클라이언트 컴포넌트가
 * 이 파일을 (직접이든 간접이든) 끌어오면 빌드가 깨진다 — 목록이 브라우저 번들에 실리는 경로를 빌드가 막는다.
 * 목록 모듈 자체에 `server-only` 를 붙이지 않은 이유는 그 파일 헤더(규약 0).
 *
 * 하는 일은 둘뿐이다: 칸별로 규칙을 돌려 걸린 글자를 모으고, 사장님이 그것을 이미 확인했는지 본다.
 * **저장을 막지 않는다**(D4). 확인하지 않은 표현이 있을 때만 "먼저 확인해 주세요" 결과를 돌려주고, 확인하면 저장된다.
 * 로그에 글자를 남기지 않는다 — 호출하는 액션은 결과 코드만 기록한다.
 */
import "server-only";

import { OWNER_COPY_RULES } from "@/lib/copy/rules";

import { COPY_FIELDS, COPY_WARNING_MAX, copyHold, copyWarningKey, type CopyField, type CopyHoldResult, type CopyWarning } from "./copyWarning";

export type CopyFields = Partial<Record<CopyField, string | null | undefined>>;

/**
 * 칸별 대조. 같은 칸에서 같은 글자는 한 번만 싣는다(규칙 둘이 같은 글자를 잡아도 사장님께는 한 줄이다).
 * 문자열은 NFC 로 맞춘다 — 입력기에 따라 한글이 자모 분해(NFD)로 올 수 있고, 그러면 어떤 규칙도 맞지 않는다.
 */
function collect(fields: CopyFields): CopyWarning[] {
  const out: CopyWarning[] = [];
  const seen = new Set<string>();
  for (const field of COPY_FIELDS) {
    const raw = fields[field];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const text = raw.normalize("NFC");
    for (const rule of OWNER_COPY_RULES) {
      const m = rule.pattern.exec(text);
      if (!m) continue;
      const hit = m[0].trim();
      const key = copyWarningKey(field, hit);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, field, kind: rule.kind, text: hit });
    }
  }
  return out;
}

/** 걸린 표현 전부(상한 없음). 화면에 싣는 목록은 holdForCopy 가 자른다. */
export function findCopyWarnings(fields: CopyFields): CopyWarning[] {
  return collect(fields);
}

/**
 * 저장 전에 멈춰야 하는가. 걸린 것이 없거나 **전부** 확인 키에 있으면 null(= 저장해도 된다).
 * 판정은 상한 없이 전부로 한다 — 화면 상한(COPY_WARNING_MAX) 뒤에 숨은 표현이 확인 없이 저장되지 않게.
 * 화면에는 **아직 확인하지 않은 것부터** 상한까지 싣는다. 화면은 확인 키를 누적해 보내므로(CopyWarningPanel)
 * 20개가 넘어도 몇 번 더 누르면 끝난다.
 */
export function holdForCopy(fields: CopyFields, ack: ReadonlySet<string>): CopyHoldResult | null {
  const all = collect(fields);
  const pending = all.filter((w) => !ack.has(w.key));
  if (pending.length === 0) return null;
  const done = all.filter((w) => ack.has(w.key));
  return copyHold([...pending, ...done].slice(0, COPY_WARNING_MAX));
}
