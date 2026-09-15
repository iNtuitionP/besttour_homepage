import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { siteOrigin, siteVerification } from "@/lib/site-url";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * 로케일 셸의 메타데이터 — 여기서 정하는 것은 **사이트 단위 두 가지**뿐이다 (P7-2b).
 *
 * 1. `metadataBase` — 상대 메타데이터 URL(앞으로 들어올 og:image 등)의 기준점. 지금 canonical 은
 *    페이지가 완성된 절대 URL 문자열로 내므로 여기에 기대지 않는다(`lib/site-url.ts` canonicalUrl 주석 참조).
 *    metadataBase 가 없으면 Next 는 localhost:3000 을 기준으로 삼는다
 *    (`node_modules/next/dist/lib/metadata/resolvers/resolve-url.js` createLocalMetadataBase).
 * 2. `verification` — 네이버 서치어드바이저·구글 서치콘솔 소유확인. 값은 env 에서만 오고,
 *    없으면 키 자체를 넣지 않는다(빈 `content=""` 는 콘솔이 실패로 읽는다).
 *
 * 정적 export(`metadata`)가 아니라 함수인 이유: 두 값 모두 env 에서 온다. 모듈 로드 시점에 굳히면
 * 환경마다 다른 값이 반영되지 않는다(`lib/site-url.ts` 의 같은 이유).
 * canonical 은 **여기에 두지 않는다** — 레이아웃이 canonical 을 내면 그것을 덮어쓰지 않은 모든 하위 페이지가
 * 같은 정본을 가리키게 된다(noindex 페이지 포함). 정본은 페이지가 자기 것을 안다.
 */
export function generateMetadata(): Metadata {
  const verification = siteVerification();
  return {
    metadataBase: new URL(siteOrigin()),
    ...(verification ? { verification } : {}),
  };
}

/**
 * 로케일 셸 — <html lang>을 로케일에 맞춰 렌더한다.
 * 공개 셸(헤더/푸터)은 (site)/layout.tsx가 담당한다. 여기에는 두지 않는다.
 * 법정 문서 (legal)도 이 provider 아래에 들어오지만 (site) 셸은 상속하지 않는다.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // 정적 렌더링을 유지하기 위해 필수 (없으면 전 페이지가 동적 렌더링으로 떨어진다)
  setRequestLocale(locale);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
