import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { CONSULT_TEL_HREF } from "@/lib/contact-phone";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";

import styles from "./errors.module.css";

/**
 * 전역 404 (REVIEW-FIX M1 · P2-5) — 로케일 세그먼트 밖.
 *
 * app/layout.tsx 는 children 을 통과만 시키고 <html>/<body> 는 app/[locale]/layout.tsx 가 만든다. 그래서 어떤 라우트에도
 * 매칭되지 않는 URL(옛 사이트 /bbs/board.php… 전부, /fr, /ko-KR/x)은 여기로 떨어지고, 여기서 문서 껍데기를 직접 렌더하지
 * 않으면 <!doctype>·<html>·<body> 없는 깨진 응답이 나간다(리뷰 실측: _not-found.html 에 <html 0건).
 *
 * - 요청 로케일이 없으므로 기본 로케일(ko)을 명시해 getTranslations 를 부른다. locale 을 넘기면 next-intl 이 headers() 를
 *   읽지 않아 정적 프리렌더가 유지된다(.next/server/app/_not-found.html 이 생긴다).
 * - i18n Link 는 로케일 컨텍스트가 필요하므로 쓰지 않는다. 홈은 <a href="/">.
 * - 문구는 messages/ko.json errors(법정 문구가 아니라 i18n), 전화는 예약·상담 전화(원장 COMPANY.consultTel · 링크 CONSULT_TEL_HREF — P1-7).
 *   로케일 밖이라 언제나 한국어 화면이므로 국내 표기를 쓴다. 이 파일에 한글 리터럴 없음.
 * - (site) 안의 페이지가 notFound() 를 부르면 여기가 아니라 app/[locale]/(site)/not-found.tsx(헤더·푸터 상속)가 받는다.
 */
export default async function RootNotFound() {
  const locale = routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "errors" });

  return (
    <html lang={locale}>
      <body>
        <main className={`${styles.page} ${styles.root}`} data-testid="not-found-root">
          <p className={styles.code}>404</p>
          <h1 className={styles.title}>{t("notFoundTitle")}</h1>
          <p className={styles.body}>{t("notFoundBody")}</p>
          <p className={styles.actions}>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 로케일 밖 404: 홈은 <html> 껍데기가 다른 트리(app/[locale]/layout.tsx)라 소프트 내비게이션 대신 전체 로드가 맞다 */}
            <a className={styles.primary} href="/">
              {t("home")}
            </a>
            <a
              className={styles.secondary}
              href={CONSULT_TEL_HREF}
              aria-label={`${LEGAL_LABELS.contact.consultTel} ${COMPANY.consultTel}`}
            >
              {COMPANY.consultTel}
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
