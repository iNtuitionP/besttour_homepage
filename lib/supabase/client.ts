/**
 * 브라우저(클라이언트 컴포넌트) 전용 Supabase 클라이언트 — anon 키 사용.
 *
 * `@supabase/ssr`의 `createBrowserClient`를 사용해 lib/supabase/ssr.ts의
 * 서버 클라이언트와 쿠키 기반 세션을 공유할 수 있게 한다(Phase D admin 로그인).
 */
import { createBrowserClient } from "@supabase/ssr";

export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("createBrowserSupabase: NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.");
  }
  if (!anonKey) {
    throw new Error("createBrowserSupabase: NEXT_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다.");
  }

  return createBrowserClient(url, anonKey);
}
