import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
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
