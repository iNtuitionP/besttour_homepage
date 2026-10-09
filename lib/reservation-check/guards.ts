/**
 * 예약확인 조각 가드 — zod → 허니팟 → rateLimit (플랜 v4 P6-3a · CLAUDE.md §3). 순수, deps 주입.
 *
 * P3-1 의 runGuards(접수)와 달리 타임트랩·Turnstile 이 없다(컨트롤러 결정 — 문자 링크로 들어오는 고객에게 과한 마찰).
 * 열거 방지는 rateLimit(IP 해시 키, 접수와 **분리된 prefix** — lib/guard/deps.ts checkGuardDeps) + "부재 = 불일치 동일 응답"(lookup.ts)이 맡는다.
 *
 * 순서 고정 (싼 것 → 비싼 것):
 *   1. zod        CheckInput.safeParse — 형식 틀린 요청은 카운터를 먹지 않는다(P3-1 과 같은 원칙)
 *   2. honeypot   숨은 필드 채워짐 → { ok:true, silent:true } — 호출자는 not_found 와 **같은 응답**을 돌려준다(성공 화면이 곧 데이터라 "가짜 실패")
 *   3. rateLimit  Upstash sliding window — 검증된 사람만 슬롯을 소비. 네트워크 오류·타임아웃은 infra(fail-closed)
 *
 * 한도는 RATE_LIMITS(known 10분 5 · 1시간 15) 그대로 — 여기서 숫자를 새로 정하지 않는다.
 * 이 파일은 서버 액션 지시어 없는 lib 순수 모듈이다. 서버 액션(actions/reservation-check.ts)이 `runCheckGuards(raw, ctx, checkGuardDeps())` 로 부른다.
 */
import { z } from "zod";

import { checkHoneypot, checkRateLimit, clientIpKey, type GuardDeps, type HeadersLike } from "../guard";
import { PUBLIC_CODE_PATTERN } from "../reservations/publicCode";

/** 휴대폰 뒷 4자리 — 숫자 4개 정확히. */
export const PHONE_LAST4_PATTERN = /^\d{4}$/;

/**
 * 조회 입력. publicCode 는 trim → 대문자 정규화 뒤 PUBLIC_CODE_PATTERN(알파벳 31자 × 8)으로 검사한다 —
 * 문자로 받은 코드를 소문자로 치는 사람을 거부하지 않되, 혼동 문자(0·O·1·I·L)는 애초에 코드에 없으므로 형식 실패다.
 */
export const CheckInput = z.object({
  publicCode: z.string().trim().toUpperCase().regex(PUBLIC_CODE_PATTERN),
  phoneLast4: z.string().regex(PHONE_LAST4_PATTERN),
});
export type CheckInput = z.infer<typeof CheckInput>;

/**
 * 거부 사유. bot 은 없다 — 허니팟은 거부가 아니라 silent 통과(호출자가 not_found 로 위장)다.
 *   validation — 형식 위반(존재 여부와 무관한 정보)
 *   ratelimit  — 한도 초과
 *   infra      — Upstash 오류·타임아웃 (fail-closed)
 */
export type CheckGuardReason = "validation" | "ratelimit" | "infra";

export interface CheckGuardFailure {
  ok: false;
  reason: CheckGuardReason;
  /** 진단용 소량 데이터(zod issue path·창 이름). IP·secret·입력값을 넣지 않는다. 클라이언트로 내려가지 않는다(result.ts). */
  detail?: unknown;
}

export type CheckGuardOutcome = { ok: true; silent: false; input: CheckInput } | { ok: true; silent: true } | CheckGuardFailure;

export interface CheckGuardContext {
  headers: HeadersLike;
  /** 숨은 필드들(`website`). 하나라도 채워지면 silent. */
  honeypot: Record<string, unknown>;
}

/** lib/guard/deps.ts checkGuardDeps() 가 만든다 — GuardDeps 에서 Turnstile 을 뺀 부분집합. */
export type CheckGuardDeps = Pick<GuardDeps, "now" | "secret" | "rateLimit">;

export async function runCheckGuards(raw: unknown, ctx: CheckGuardContext, deps: CheckGuardDeps): Promise<CheckGuardOutcome> {
  // 1. zod — 형식이 틀리면 뒤로 가지 않는다
  const parsed = CheckInput.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code, message: i.message }));
    return { ok: false, reason: "validation", detail: issues };
  }

  // 2. honeypot — silent. 봇에게 성공도 실패도 알려주지 않는다(호출자가 not_found 로 응답)
  const hp = checkHoneypot(ctx.honeypot ?? {});
  if (!hp.ok) return { ok: true, silent: true };

  // 3. rate limit — 검증된 사람만 슬롯을 소비한다. 키는 해시(IP 원문 아님)
  const { key, bucket } = clientIpKey(ctx.headers, deps.secret);
  let rl;
  try {
    rl = await checkRateLimit(key, bucket, deps.rateLimit);
  } catch (err) {
    return { ok: false, reason: "infra", detail: { code: "exception", stage: "ratelimit", name: err instanceof Error ? err.name : typeof err } };
  }
  if (!rl.ok) return { ok: false, reason: rl.reason === "ratelimit" ? "ratelimit" : "infra", detail: rl.detail };

  return { ok: true, silent: false, input: parsed.data };
}
