/**
 * SSR(쿠키 기반 세션) Supabase 클라이언트 — Phase D admin 로그인 세션용.
 *
 * `@supabase/ssr`의 `createServerClient`를 Next.js 쿠키 스토어로 래핑한다.
 * anon 키를 사용하며(사용자 세션 컨텍스트), service role 키는 여기서 절대
 * 사용하지 않는다 — RLS 우회가 필요한 작업은 lib/supabase/server.ts를 쓸 것.
 */
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js `cookies()`(App Router)가 반환하는 저장소와 호환되는 최소 인터페이스.
 * Server Component에서 호출될 때는 `set`이 예외를 던질 수 있으므로 호출부에서
 * 무시 가능해야 한다(미들웨어가 세션 갱신을 담당).
 */
export interface SsrCookieStore {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

/** 요청 스코프의 쿠키 스토어를 받아 admin 세션 기반 Supabase 클라이언트를 생성한다. */
export function createSsrClient(cookieStore: SsrCookieStore) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("createSsrClient: NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.");
  }
  if (!anonKey) {
    throw new Error("createSsrClient: NEXT_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다.");
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component에서 호출되면 쿠키를 쓸 수 없다 — 미들웨어가
          // 세션 갱신을 담당하므로 여기서는 무시한다.
        }
      },
    },
  });
}
