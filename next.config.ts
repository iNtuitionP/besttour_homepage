import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

// 기본 경로 ./i18n/request.ts 를 그대로 쓴다.
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);
