/**
 * anon 키 Supabase 클라이언트 — 세션 없음, RLS 가 유일한 접근 제어.
 *
 * 용도: RSC 가 직접 호출하는 공개 읽기 계층(lib/queries/*). 0001·0002 의 공개 조회 정책
 * (`*_select_active`)이 허용하는 행만 읽힌다. 안 읽히면 정책 문제이지 키를 올릴 문제가 아니다 —
 * 서비스 롤 키는 이 모듈에 없다(tests/queries.test.ts 가 정규식으로 단언).
 *
 * 기존 3종과 다른 점:
 *  - lib/supabase/ssr.ts: 쿠키 스토어(admin 세션)를 받는다. 이쪽은 요청 스코프가 없어도 — vitest 에서도 — 호출 가능.
 *  - lib/supabase/client.ts: 브라우저 전용, 세션 공유. 이쪽은 서버·노드 어디서든 무상태.
 *  - lib/supabase/server.ts: RLS 우회. 이쪽은 RLS 위에 선다.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AnonClient = SupabaseClient;

/** anon 키·무세션 클라이언트를 만든다. 생성은 네트워크를 타지 않는다(요청마다 만들어도 된다). */
export function createAnonClient(): AnonClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("createAnonClient: NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.");
  }
  if (!anonKey) {
    throw new Error("createAnonClient: NEXT_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다.");
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
