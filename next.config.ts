import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

// 기본 경로 ./i18n/request.ts 를 그대로 쓴다.
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  images: {
    // P2-4: 갤러리·팝업 이미지는 Supabase Storage 공개 객체 URL 이다 (components/home/image-url.ts 가 만든다).
    // 원격 프로젝트(*.supabase.co)와 로컬 스택(127.0.0.1:54321) 둘 다 — 경로는 공개 버킷 객체만 허용한다.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "54321", pathname: "/storage/v1/object/public/**" },
    ],
  },
};

export default withNextIntl(nextConfig);
