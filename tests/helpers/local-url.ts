/**
 * 로컬 Supabase 스택 URL 판정 — 한 곳에만 둔다(load-env-local.ts 가 다시 내보낸다).
 * notify-env.ts(setup)와 load-env-local.ts(로더)가 둘 다 써야 해서 따로 떼었다 — 서로 import 하면 순환이 생긴다.
 */

/** 로컬 Supabase 스택의 호스트명 — `supabase status` 가 내는 127.0.0.1, 개발자가 적는 localhost, 컨테이너 네트워크 안의 kong. */
const LOCAL_STACK_HOSTS = new Set(["127.0.0.1", "localhost", "kong"]);

/**
 * URL 의 호스트명이 로컬 스택인가. 부분 문자열이 아니라 URL 파서의 hostname 으로 판정한다 —
 * `https://localhost.example.com`, `https://x.supabase.co/?u=localhost` 같은 위장을 로컬로 보지 않는다.
 * 파싱 불가·빈 값은 false (모르면 원격으로 취급한다).
 */
export function isLocalStackUrl(url: string | undefined): boolean {
  if (!url) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return LOCAL_STACK_HOSTS.has(hostname.toLowerCase());
}
