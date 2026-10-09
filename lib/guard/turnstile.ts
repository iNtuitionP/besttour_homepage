/**
 * Cloudflare Turnstile siteverify (P3-1 순서 4 — 사람 증명, 네트워크).
 *
 * 통과 조건: HTTP 2xx ∧ JSON ∧ success:true ∧ hostname ∈ allowedHosts ∧ (action === deps.action, null 이면 생략).
 * fail-closed: 네트워크 오류·타임아웃·5xx·JSON 아님·Cloudflare internal-error → infra(거부).
 * 우회 스위치는 없다. 토큰이 없으면 네트워크를 쓰지 않고 바로 거부한다.
 *
 * remoteip 는 Cloudflare 에만 보낸다(개인정보 처리방침 국외이전 고지의 Cloudflare Inc. 항목). 결과·detail 에는 넣지 않는다.
 *
 * 더미 키(문서 공개, 비밀 아님): secret 1x…AA 항상 통과 / 2x…AA 항상 실패. 응답은 hostname "example.com", action 없음 —
 * 그래서 라이브 스모크만 action:null 로 돈다. 운영 deps 는 action 을 TURNSTILE_ACTION 으로 고정하고,
 * defaultGuardDeps 는 운영(VERCEL_ENV=production)에서 더미 secret 을 거부한다.
 */
import type { GuardResult, TurnstileDeps } from "./types";

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** 위젯 `data-action` 값. 접수 폼 외의 위젯 토큰이 접수에 쓰이지 못하게 한다. */
export const TURNSTILE_ACTION = "reserve";
export const TURNSTILE_TIMEOUT_MS = 5_000;
/** Cloudflare 문서상 토큰 최대 길이. */
const TOKEN_MAX_LENGTH = 2_048;

interface SiteverifyBody {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  "error-codes"?: unknown;
}

const turnstile = (detail: Record<string, unknown>): GuardResult => ({ ok: false, reason: "turnstile", detail });
const infra = (detail: Record<string, unknown>): GuardResult => ({ ok: false, reason: "infra", detail });

const toStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function verifyTurnstile(token: unknown, remoteIp: string | null, deps: TurnstileDeps): Promise<GuardResult> {
  if (typeof deps.secret !== "string" || deps.secret.length === 0) {
    throw new Error("verifyTurnstile: TURNSTILE_SECRET_KEY 가 비어 있다");
  }
  if (typeof token !== "string" || token.length === 0) return turnstile({ code: "missing-token" });
  if (token.length > TOKEN_MAX_LENGTH) return turnstile({ code: "token-too-long" });

  const payload: Record<string, string> = { secret: deps.secret, response: token };
  if (remoteIp) payload.remoteip = remoteIp;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs);

  let res: Response;
  try {
    res = await deps.fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) return infra({ code: "timeout" });
    return infra({ code: "network", name: err instanceof Error ? err.name : typeof err });
  }
  clearTimeout(timer);

  if (!res.ok) return infra({ code: "http", status: res.status });

  let body: SiteverifyBody;
  try {
    body = (await res.json()) as SiteverifyBody;
  } catch {
    return infra({ code: "bad-json" });
  }

  const errorCodes = toStringArray(body["error-codes"]);
  if (body.success !== true) {
    if (errorCodes.includes("internal-error")) return infra({ code: "upstream-internal-error", errorCodes });
    return turnstile({ code: "verify-failed", errorCodes });
  }

  const hostname = typeof body.hostname === "string" ? body.hostname.toLowerCase() : null;
  if (hostname === null || !deps.allowedHosts.includes(hostname)) {
    return turnstile({ code: "hostname-mismatch", hostname });
  }

  if (deps.action !== null && body.action !== deps.action) {
    return turnstile({ code: "action-mismatch", action: typeof body.action === "string" ? body.action : null });
  }

  return { ok: true };
}
