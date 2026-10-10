/**
 * 예약확인 조각 가드 — zod → 허니팟 → Turnstile → rateLimit (플랜 v4 P6-3a · T2-5 · CLAUDE.md §3). 순수, deps 주입.
 *
 * T2-5(사장님 요청 1 · 결정 5, 2026-10-10): 조회 키가 "접수번호 + 뒷 4자리" 에서 **"휴대폰 번호 + 예약자 이름"** 으로 바뀌었다.
 * 접수번호는 추측할 수 없는 값이었지만 번호·이름은 남이 알 수도 있다 — 그래서 P6-3a 의 "예약확인엔 Turnstile 없음" 결정을
 * **번복하고** Turnstile 을 붙였다(action 'check' — 접수 'reserve' 토큰 재사용 불가 · lib/guard/deps.ts checkGuardDeps).
 * 전화번호 단위 한도는 두지 않는다(결정 5 — IP 한도 + Turnstile). 타임트랩은 여전히 없다(문자 링크로 바로 들어오는 손님).
 *
 * 순서 고정 (싼 것 → 비싼 것 — P3-1 runGuards 와 같은 원칙):
 *   1. zod        CheckInput.safeParse — 형식 틀린 요청은 네트워크도 카운터도 쓰지 않는다
 *   2. honeypot   숨은 필드 채워짐 → { ok:true, silent:true } — 호출자는 not_found 와 **같은 응답**을 돌려준다
 *   3. turnstile  siteverify(네트워크) — 사람 증명. 실패하면 rate limit 슬롯을 쓰지 않는다. 네트워크 오류는 infra(fail-closed)
 *   4. rateLimit  Upstash sliding window — 키는 IP 해시 하나(번호·이름을 키에 넣지 않는다). 오류·타임아웃은 infra(fail-closed)
 *
 * 한도는 RATE_LIMITS(known 10분 5 · 1시간 15) 그대로 — 여기서 숫자를 새로 정하지 않는다.
 * 시계는 **한 번** 읽는다(deps.now) — 통과 결과의 now 를 조회(운행일 "오늘 이후" 판정)가 그대로 쓴다(P3-8 리뷰 P2-6 과 같은 이유).
 */
import { z } from "zod";

import { checkHoneypot, checkRateLimit, clientIp, clientIpKey, verifyTurnstile, type GuardDeps, type HeadersLike } from "../guard";
import { NAME_MAX_LENGTH } from "../types";
import { checkPhoneE164 } from "./phone";

/**
 * 조회 입력. phone 은 칸 하나의 원문을 받아 정규 E.164 로 바꾼다(lib/reservation-check/phone.ts — 접수와 같은 정규화).
 * name 은 trim · 1~30자(접수와 같은 상한 — 0001 CHECK). 띄어쓰기·대소문자·유니코드 정규화는 비교 단계(lookup.ts)가 맡는다.
 */
export const CheckInput = z.object({
  phone: z
    .string()
    .refine((v) => checkPhoneE164(v) !== null)
    .transform((v) => checkPhoneE164(v) as string),
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
});
export type CheckInput = z.infer<typeof CheckInput>;

/**
 * 거부 사유. bot 은 없다 — 허니팟은 거부가 아니라 silent 통과(호출자가 not_found 로 위장)다.
 *   validation — 형식 위반. 호출자는 이것도 not_found 로 답한다(result.ts — 응답 하나로 단일화)
 *   turnstile  — Cloudflare 가 사람임을 확인해 주지 않음(토큰 없음·만료·다른 위젯의 토큰)
 *   ratelimit  — 한도 초과
 *   infra      — Turnstile·Upstash 오류·타임아웃 (fail-closed)
 */
export type CheckGuardReason = "validation" | "turnstile" | "ratelimit" | "infra";

export interface CheckGuardFailure {
  ok: false;
  reason: CheckGuardReason;
  /** 진단용 소량 데이터(zod issue path·Cloudflare 오류 코드·창 이름). IP·secret·입력값을 넣지 않는다. 클라이언트로 내려가지 않는다(result.ts). */
  detail?: unknown;
}

export type CheckGuardOutcome = { ok: true; silent: false; input: CheckInput; now: Date } | { ok: true; silent: true } | CheckGuardFailure;

export interface CheckGuardContext {
  headers: HeadersLike;
  /** 숨은 필드들(`website`). 하나라도 채워지면 silent. */
  honeypot: Record<string, unknown>;
  /** Turnstile 위젯이 폼에 넣은 토큰(`cf-turnstile-response`). 없으면 네트워크 없이 turnstile 거부. */
  turnstileToken: string | null | undefined;
}

/** lib/guard/deps.ts checkGuardDeps() 가 만든다 — GuardDeps 에서 타임트랩만 뺀 것(T2-5 부터 Turnstile 포함). */
export type CheckGuardDeps = Pick<GuardDeps, "now" | "secret" | "turnstile" | "rateLimit">;

export async function runCheckGuards(raw: unknown, ctx: CheckGuardContext, deps: CheckGuardDeps): Promise<CheckGuardOutcome> {
  const now = deps.now();

  // 1. zod — 형식이 틀리면 뒤로 가지 않는다
  const parsed = CheckInput.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code }));
    return { ok: false, reason: "validation", detail: issues };
  }

  // 2. honeypot — silent. 봇에게 성공도 실패도 알려주지 않는다(호출자가 not_found 로 응답)
  const hp = checkHoneypot(ctx.honeypot ?? {});
  if (!hp.ok) return { ok: true, silent: true };

  // 3. turnstile — 여기까지 온 요청만 네트워크를 쓴다. 실패하면 rate limit 슬롯을 쓰지 않는다
  let ts;
  try {
    ts = await verifyTurnstile(ctx.turnstileToken, clientIp(ctx.headers), deps.turnstile);
  } catch (err) {
    return { ok: false, reason: "infra", detail: { code: "exception", stage: "turnstile", name: err instanceof Error ? err.name : typeof err } };
  }
  if (!ts.ok) return { ok: false, reason: ts.reason === "turnstile" ? "turnstile" : "infra", detail: ts.detail };

  // 4. rate limit — 사람으로 확인된 요청만 슬롯을 소비한다. 키는 IP 해시(원문 아님) 하나 — 전화번호 단위 한도는 없다(결정 5)
  const { key, bucket } = clientIpKey(ctx.headers, deps.secret);
  let rl;
  try {
    rl = await checkRateLimit(key, bucket, deps.rateLimit);
  } catch (err) {
    return { ok: false, reason: "infra", detail: { code: "exception", stage: "ratelimit", name: err instanceof Error ? err.name : typeof err } };
  }
  if (!rl.ok) return { ok: false, reason: rl.reason === "ratelimit" ? "ratelimit" : "infra", detail: rl.detail };

  return { ok: true, silent: false, input: parsed.data, now };
}
