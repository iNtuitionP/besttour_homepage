/**
 * 타임트랩 — 폼 렌더 ~ 제출이 3초 미만이면 봇 (P3-1 순서 3, 무료).
 *
 * 서버가 폼 렌더 시각을 HMAC(GUARD_SECRET) 으로 서명한 토큰으로 내려주고, 제출 시 서버 시계로 경과를 잰다.
 * 클라이언트 시계는 어디에도 쓰지 않는다 — 시각을 꾸미려면 서명을 위조해야 한다.
 *
 * 토큰 = `${issuedAtMs}.${hmac_sha256_hex}`. 발급 시각 외에 아무 것도 담지 않는다(IP·세션 없음).
 * 재사용(같은 토큰으로 반복 제출) 방지는 rate limit 이 흡수한다 — 같은 토큰 반복 = 같은 IP 반복.
 * 만료(1시간)는 오래 열어 둔 폼이 아니라, 한 번 발급받은 토큰을 영구히 돌려쓰는 봇을 막기 위한 것이다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GuardResult } from "./types";

/** 렌더 ~ 제출 최소 경과(ms). 이보다 빠르면 bot. */
export const FORM_MIN_MS = 3_000;
/** 토큰 최대 수명(ms). 이보다 오래되면 bot(다시 렌더받아야 한다). */
export const FORM_MAX_AGE_MS = 60 * 60 * 1_000;

const TOKEN_PATTERN = /^(\d{1,16})\.([0-9a-f]{64})$/;

function requireSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("timetrap: GUARD_SECRET 이 비어 있다 — 서명 없는 토큰은 만들지도 검증하지도 않는다");
  }
}

function sign(issuedAtMs: number, secret: string): string {
  return createHmac("sha256", secret).update(`form:${issuedAtMs}`).digest("hex");
}

/** 폼 렌더 시 서버가 호출한다. `now` 는 서버 시계. */
export function issueFormToken(now: Date, secret: string): string {
  requireSecret(secret);
  const ms = now.getTime();
  if (!Number.isFinite(ms)) throw new Error("timetrap: now 가 유효한 Date 가 아니다");
  return `${ms}.${sign(ms, secret)}`;
}

const bot = (code: string): GuardResult => ({ ok: false, reason: "bot", detail: { code } });

/**
 * 제출 시 서버가 호출한다. 통과 조건: 서명 일치 ∧ minMs ≤ (now − issuedAt) ≤ maxAgeMs.
 * 음수 경과(발급 시각이 미래)도 bot — 서버 시계로만 발급하므로 정상 경로에서 나올 수 없다.
 */
export function verifyFormToken(token: unknown, now: Date, secret: string, minMs = FORM_MIN_MS, maxAgeMs = FORM_MAX_AGE_MS): GuardResult {
  requireSecret(secret);
  if (typeof token !== "string") return bot("token-missing");
  const m = TOKEN_PATTERN.exec(token);
  if (!m) return bot("token-malformed");

  const issuedAtMs = Number(m[1]);
  const expected = Buffer.from(sign(issuedAtMs, secret), "hex");
  const given = Buffer.from(m[2], "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return bot("token-signature");

  const elapsed = now.getTime() - issuedAtMs;
  if (elapsed < minMs) return bot("too-fast");
  if (elapsed > maxAgeMs) return bot("token-expired");
  return { ok: true };
}
