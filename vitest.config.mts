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
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
