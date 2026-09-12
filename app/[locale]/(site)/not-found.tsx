import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";

import styles from "@/app/errors.module.css";

/**
 * 공개 셸 안 404 (REVIEW-FIX M1 · P2-5) — 헤더·푸터·플로팅 문의를 상속한다.
 *
 * (site) 안의 페이지가 notFound() 를 부를 때 여기로 온다 — 지금은 production 의 /dev/krmap 이 그 예다. 어떤 라우트에도
 * 매칭되지 않는 URL 은 로케일 세그먼트 밖의 app/not-found.tsx 가 받는다. 둘은 같은 문구(messages errors)를 쓴다.
 * 이 파일에 한글 리터럴 없음 — 문구는 i18n, 전화는 원장 COMPANY.tel.
 */
export default async function SiteNotFound() {
  const t = await getTranslations("errors");

  return (
    <main className={styles.page} data-testid="not-found-site">
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>{t("notFoundTitle")}</h1>
      <p className={styles.body}>{t("notFoundBody")}</p>
      <p className={styles.actions}>
        <Link className={styles.primary} href="/">
          {t("home")}
        </Link>
        <a
          className={styles.secondary}
          href={`tel:${COMPANY.tel}`}
          aria-label={`${LEGAL_LABELS.contact.tel} ${COMPANY.tel}`}
        >
          {COMPANY.tel}
        </a>
      </p>
    </main>
  );
}
