/**
 * Rate limit 키 — IP 원문을 저장하지 않는다 (P3-1 · PIPA 최소수집).
 *
 * 키 = sha256(GUARD_SECRET + ip) 앞 16자(hex). Redis 키·로그·에러 메시지 어디에도 IP 원문이 나타나지 않는다.
 * secret 을 섞는 이유: IPv4 전체 공간(2^32)은 해시만으로는 역산 가능하다 — secret 없이는 키에서 IP 를 되짚을 수 없어야 한다.
 *
 * IP 추출: x-forwarded-for 첫 항목(Vercel 이 실제 접속 IP 로 덮어쓴다) → x-real-ip → 없으면 'unknown' 버킷.
 * unknown 버킷은 모든 미상 요청이 한 키를 공유하며 한도가 절반이다(rateLimit.ts RATE_LIMITS.unknown).
 */
import { createHash } from "node:crypto";
import type { HeadersLike, IpBucket } from "./types";

/** IP 를 모를 때 해시에 넣는 고정 문자열 — 미상 요청 전체가 한 키를 공유한다. */
export const UNKNOWN_IP_BUCKET = "unknown";
/** 키 길이(hex 문자 수) — 16자 = 64비트. 충돌보다 원문 비노출이 목적이다. */
export const IP_KEY_LENGTH = 16;

const firstNonEmpty = (raw: string | null): string | null => {
  if (!raw) return null;
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v.length > 0) return v;
  }
  return null;
};

/** 헤더에서 접속 IP 를 뽑는다. 결과는 Turnstile `remoteip` 로만 보내고 저장·기록하지 않는다. */
export function clientIp(headers: HeadersLike): string | null {
  return firstNonEmpty(headers.get("x-forwarded-for")) ?? firstNonEmpty(headers.get("x-real-ip"));
}

export function hashIpKey(ip: string, secret: string): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("ipKey: GUARD_SECRET 이 비어 있다 — secret 없는 해시는 IP 를 되짚을 수 있다");
  }
  return createHash("sha256").update(secret + ip).digest("hex").slice(0, IP_KEY_LENGTH);
}

export function clientIpKey(headers: HeadersLike, secret: string): { key: string; bucket: IpBucket } {
  const ip = clientIp(headers);
  if (ip === null) return { key: hashIpKey(UNKNOWN_IP_BUCKET, secret), bucket: "unknown" };
  return { key: hashIpKey(ip, secret), bucket: "known" };
}
