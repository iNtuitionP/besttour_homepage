import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        // next-intl 의 ESM 빌드는 `next/server` 를 확장자 없이 import 한다. Node 의 ESM 로더는 exports 맵이 없는 `next` 에서
        // 그것을 풀지 못해(tests/purge.test.ts 가 기록한 "미들웨어는 vitest 에서 import 가 안 된다") vite 가 변환하게 한다.
        // P2-6b: 로케일 감지를 끈 미들웨어의 실제 동작(쿠키·Accept-Language 로 리다이렉트하지 않는다)을 단위 테스트로 잠그기 위해서다.
        inline: ["next-intl"],
      },
    },
  },
  /**
   * `.tsx` 를 테스트에서 **import 할 수 있게** 한다 (P5-17 수정 라운드 3).
   *
   * tsconfig 의 `jsx: "preserve"` 는 Next 가 자기 컴파일러로 JSX 를 처리하라는 뜻이다 — vite 가 그대로 따르면
   * 테스트에서 화면 파일을 import 할 때 `content contains invalid JS syntax` 로 죽는다.
   * 여기서만 자동 런타임(`react/jsx-runtime`)으로 바꿔, 서버 컴포넌트를 **실제로 호출해** 돌아온 element 트리를
   * 검사할 수 있게 한다(빈 상태·권한 없음 분기를 "번역 호출이 있다" 가 아니라 렌더 결과로 단언하기 위해서다).
   * 앱 빌드에는 영향이 없다 — Next 는 tsconfig 를 그대로 쓴다.
   */
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
