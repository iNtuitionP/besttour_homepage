/**
 * 서버 전용 Supabase 클라이언트 — service role 키 사용.
 *
 * 절대 규칙: service role 키는 서버 전용이며 클라이언트(브라우저) 번들에
 * 절대 노출되어서는 안 된다. 이 모듈을 클라이언트 컴포넌트에서 import하지
 * 말 것.
 *
 * 원래는 파일 최상단에 `import 'server-only'`를 두어 클라이언트 번들에
 * 실수로 포함될 경우 빌드 타임에 에러가 나도록 강제해야 하지만, 현재
 * `server-only` 패키지가 설치되어 있지 않다(package.json 미포함). 이
 * 태스크(A2) 범위에서는 "산출물 외 파일 수정 금지" 규칙에 따라 임의로
 * 의존성을 추가하지 않았다. `server-only` 패키지 설치가 결정되면 아래
 * import를 추가할 것:
 *
 *   import "server-only";
 */
import { createClient } from "@supabase/supabase-js";

/**
 * Service role 클라이언트를 생성한다. RLS를 우회하므로 서버 코드
 * (Route Handler·Server Action 등)에서만 호출해야 한다.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("createServiceClient: NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.");
  }
  if (!serviceRoleKey) {
    throw new Error("createServiceClient: SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
