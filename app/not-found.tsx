import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { CONSULT_TEL_HREF } from "@/lib/contact-phone";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";

import styles from "./errors.module.css";

/**
 * 전역 404 (REVIEW-FIX M1 · P2-5 · P7-4) — 로케일 세그먼트 밖.
 *
 * app/layout.tsx 는 children 을 통과만 시키고 <html>/<body> 는 app/[locale]/layout.tsx 가 만든다. 그래서 어떤 라우트에도
 * 매칭되지 않는 URL(옛 사이트 /bbs/board.php… 전부, /fr, /ko-KR/x, 그리고 /en 아래의 없는 주소)은 여기로 떨어지고, 여기서 문서 껍데기를 직접
 * 렌더하지 않으면 <!doctype>·<html>·<body> 없는 깨진 응답이 나간다(리뷰 실측: _not-found.html 에 <html 0건).
 *
 * - 요청 로케일이 없으므로 로케일을 명시해 getTranslations 를 부른다. locale 을 넘기면 next-intl 이 headers() 를 읽지 않아 정적 프리렌더가
 *   유지된다(.next/server/app/_not-found.html). **이 컴포넌트는 모든 페이지의 RSC 페이로드에 404 경계로 실린다**(next/dist/server/app-render/
 *   create-component-tree.js — notFound 요소를 LayoutRouter 에 props 로 넘긴다) — 그래서 headers()·setRequestLocale 을 여기서 부르면
 *   모든 페이지가 동적이 되거나 요청 로케일이 바뀐다. 그 둘 없이 쓴다.
 * - 영문 404 (P7-4 · 브리프 §7): 그래서 서버는 로케일을 모른다. 한국어·영문 두 블록을 함께 그리고, 맨 앞의 인라인 스크립트가 주소가
 *   `/en` 이면 <html> 에 lang="en" · data-locale="en" 을 단다 — CSS(errors.module.css)가 그때 영문 블록만 보인다. 스크립트는 본문보다 먼저
 *   돌아 깜박임이 없다. 스크립트가 없으면(JS 끔) 한국어가 보인다. <html> 의 속성이 바뀌므로 suppressHydrationWarning(이 요소 하나만).
 *   스크립트 내용은 아래 상수 하나(사용자 입력 없음).
 * - 로고(홈 링크) · 홈 버튼 · 예약·상담 전화(P7-4 · 브리프 §8). 사이트 머리글·바닥글 셸 안에 두는 것은 D1(docs/ops/known-defects.md) 때문에
 *   여기서 하지 않는다 — 셸 안 404 는 매칭된 라우트의 notFound() 만 받는다((site)/not-found.tsx).
 * - i18n Link 는 로케일 컨텍스트가 필요하므로 쓰지 않는다. 홈은 <a href="/"> · 영문 블록은 <a href="/en">.
 * - 문구는 messages errors(법정 문구가 아니라 i18n), 전화는 예약·상담 전화(원장 COMPANY.consultTel · 영문 consultTelIntl · 링크 CONSULT_TEL_HREF — P1-7).
 *   이 파일에 한글 리터럴 없음.
 * - (site) 안의 페이지가 notFound() 를 부르면 여기가 아니라 app/[locale]/(site)/not-found.tsx(헤더·푸터 상속)가 받는다.
 */
const LOCALE_SCRIPT =
  '(function(){try{var p=location.pathname;if(p==="/en"||p.indexOf("/en/")===0){var d=document.documentElement;d.setAttribute("lang","en");d.setAttribute("data-locale","en");}}catch(e){}})();';

export default async function RootNotFound() {
  const locale = routing.defaultLocale;
  const [t, tEn] = await Promise.all([
    getTranslations({ locale, namespace: "errors" }),
    getTranslations({ locale: "en", namespace: "errors" }),
  ]);
  const enUi = ledgerUi("en");

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: LOCALE_SCRIPT }} />
        <main className={`${styles.page} ${styles.root}`} data-testid="not-found-root">
          <div className={`${styles.block} ${styles.localeKo}`} data-locale-block="ko">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 로케일 밖 404: 홈은 <html> 껍데기가 다른 트리(app/[locale]/layout.tsx)라 소프트 내비게이션 대신 전체 로드가 맞다 */}
            <a className={styles.brand} href="/">
              <Image className={styles.logo} src="/brand/logo-bestour.png" alt={COMPANY.brandName} width={165} height={32} />
            </a>
            <p className={styles.code}>404</p>
            <h1 className={styles.title}>{t("notFoundTitle")}</h1>
            <p className={styles.body}>{t("notFoundBody")}</p>
            <p className={styles.actions}>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 위와 같다 */}
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
          </div>
          <div className={`${styles.block} ${styles.localeEn}`} data-locale-block="en" lang="en">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 한국어 블록과 같다(로케일 밖 404 → 전체 로드) */}
            <a className={styles.brand} href="/en">
              <Image className={styles.logo} src="/brand/logo-bestour.png" alt={COMPANY.brandNameEn} width={165} height={32} />
            </a>
            <p className={styles.code}>404</p>
            <h1 className={styles.title}>{tEn("notFoundTitle")}</h1>
            <p className={styles.body}>{tEn("notFoundBody")}</p>
            <p className={styles.actions}>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 위와 같다 */}
              <a className={styles.primary} href="/en">
                {tEn("home")}
              </a>
              <a
                className={styles.secondary}
                href={CONSULT_TEL_HREF}
                aria-label={`${enUi.labels.contact.consultTel} ${COMPANY.consultTelIntl}`}
              >
                {COMPANY.consultTelIntl}
              </a>
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
