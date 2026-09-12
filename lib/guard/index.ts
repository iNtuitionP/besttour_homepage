/**
 * 공개 뮤테이션 방어 4종 — 진입점 (플랜 v4 P3-1 · CLAUDE.md §3 "전부 통과 후").
 *
 * 순서 고정 (싼 것 → 비싼 것, 검증된 사람만 슬롯 소비):
 *   1. zod        ReservationInput.safeParse   — 무료. 쓰레기가 뒤로 못 간다
 *   2. honeypot   숨은 필드 채워짐 → 조용한 성공 — 무료
 *   3. timetrap   렌더~제출 < 3초 → bot          — 무료
 *   4. turnstile  siteverify (네트워크)           — 사람 증명. 실패하면 슬롯을 쓰지 않는다
 *   5. rateLimit  Upstash sliding window          — 검증된 사람만 소비
 * Turnstile 을 rate limit 앞에 두는 이유: 토큰 없는 봇이 Upstash 슬롯을 태우지 못하게. tests/guard.test.ts 가 각 실패 케이스의
 * fetch·limit 호출 카운트로 순서를 잠근다.
 *
 * fail-closed: 4·5 의 네트워크 오류·타임아웃은 infra 로 거부한다. 방어가 꺼진 채 접수를 받는 것보다 잠깐 못 받는 편이 낫다
 * (전화 폴백은 항상 있다 — lib/legal/disclosures.ts 의 대표번호). 우회 환경변수는 없다.
 *
 * 이 파일은 서버 액션 지시어 없는 lib 순수 모듈이다. 서버 액션(P3-3)이 `runGuards(raw, ctx, defaultGuardDeps())` 로 부르고, 통과하면 `input` 을 저장한다.
 * defaultGuardDeps 는 ./deps.ts(server-only) 에 있고 여기서 re-export 하지 않는다 — 이 모듈은 어디서든(테스트 포함) import 할 수 있어야 한다.
 */
import { ReservationInput } from "../types";
import { HONEYPOT_FIELD, checkHoneypot } from "./honeypot";
import { clientIp, clientIpKey } from "./ipKey";
import { checkRateLimit } from "./rateLimit";
import { verifyFormToken } from "./timetrap";
import { verifyTurnstile } from "./turnstile";
import type { GuardContext, GuardDeps, GuardOutcome } from "./types";

export * from "./types";
export { HONEYPOT_FIELD, checkHoneypot } from "./honeypot";
export { FORM_MAX_AGE_MS, FORM_MIN_MS, issueFormToken, verifyFormToken } from "./timetrap";
export { IP_KEY_LENGTH, UNKNOWN_IP_BUCKET, clientIp, clientIpKey, hashIpKey } from "./ipKey";
export { TURNSTILE_ACTION, TURNSTILE_SITEVERIFY_URL, TURNSTILE_TIMEOUT_MS, verifyTurnstile } from "./turnstile";
export { RATE_LIMITS, RATE_LIMIT_TIMEOUT_MS, RATE_WINDOWS, checkRateLimit, type RateWindowDuration } from "./rateLimit";

/**
 * 호출자가 raw 에서 숨은 필드를 분리하지 않고 통째로 넘겨도 허니팟이 "조용한 성공"으로 동작하게 한다.
 * zod 스키마의 `website: max(0)` 이 먼저 걸리면 봇에게 validation 실패를 알려주게 되므로, 숨은 필드는 zod 이전에 떼어 honeypot 단계로 넘긴다.
 * 순서는 그대로다 — zod 는 업무 필드에 먼저 돌고, 허니팟 판정은 그 다음이다.
 */
function splitHoneypot(raw: unknown, honeypot: Record<string, unknown>): { body: unknown; fields: Record<string, unknown> } {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && HONEYPOT_FIELD in raw) {
    const { [HONEYPOT_FIELD]: fromRaw, ...body } = raw as Record<string, unknown>;
    return { body, fields: { ...honeypot, [`raw.${HONEYPOT_FIELD}`]: fromRaw } };
  }
  return { body: raw, fields: honeypot };
}

export async function runGuards(raw: unknown, ctx: GuardContext, deps: GuardDeps): Promise<GuardOutcome> {
  const now = deps.now();
  const { body, fields } = splitHoneypot(raw, ctx.honeypot ?? {});

  // 1. zod
  const parsed = ReservationInput.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code, message: i.message }));
    return { ok: false, reason: "validation", detail: issues };
  }

  // 2. honeypot — 조용한 성공. input 을 돌려주지 않는다(저장할 것이 없다).
  const hp = checkHoneypot(fields);
  if (!hp.ok) return { ok: true, silent: true };

  // 3. timetrap
  const tt = verifyFormToken(ctx.formToken, now, deps.secret);
  if (!tt.ok) return tt;

  // 4. turnstile — 여기까지 온 요청만 네트워크를 쓴다. 실패하면 rate limit 슬롯을 쓰지 않는다.
  const ip = clientIp(ctx.headers);
  let ts;
  try {
    ts = await verifyTurnstile(ctx.turnstileToken, ip, deps.turnstile);
  } catch (err) {
    return { ok: false, reason: "infra", detail: { code: "exception", stage: "turnstile", name: err instanceof Error ? err.name : typeof err } };
  }
  if (!ts.ok) return ts;

  // 5. rate limit — 검증된 사람만 슬롯을 소비한다. 키는 해시(IP 원문 아님).
  const { key, bucket } = clientIpKey(ctx.headers, deps.secret);
  let rl;
  try {
    rl = await checkRateLimit(key, bucket, deps.rateLimit);
  } catch (err) {
    return { ok: false, reason: "infra", detail: { code: "exception", stage: "ratelimit", name: err instanceof Error ? err.name : typeof err } };
  }
  if (!rl.ok) return rl;

  return { ok: true, silent: false, input: parsed.data };
}
