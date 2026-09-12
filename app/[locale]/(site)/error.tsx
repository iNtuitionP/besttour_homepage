"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";

import styles from "@/app/errors.module.css";

/**
 * 공개 셸 안 에러 바운더리 (REVIEW-FIX M1 · P2-5). 'use client' 는 Next 의 error.tsx 규약이다.
 *
 * (site) 페이지·하위 컴포넌트가 던진 예외를 받아 헤더·푸터는 살린 채 본문만 바꾼다((site)/layout.tsx 자체의 예외는 상위로 간다).
 * 에러 원문(message·stack)은 화면에 내지 않는다 — 내부 경로·쿼리·env 이름이 섞여 나올 수 있다. Next 가 붙이는 digest 만
 * 참조 번호로 보여 준다(서버 로그와 대조하는 용도, 그 자체로는 아무 정보도 아니다).
 * 문구는 messages/ko.json errors — app/[locale]/layout.tsx 의 NextIntlClientProvider 가 서버 메시지를 그대로 넘겨 주므로
 * 클라이언트에서도 useTranslations 가 된다. 실측 경로: 개발 서버 /dev/krmap?boom=1 (dev/krmap/page.tsx 가 일부러 throw).
 */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  return (
    <main className={styles.page} data-testid="error-boundary" role="alert">
      <h1 className={styles.title}>{t("errorTitle")}</h1>
      <p className={styles.body}>{t("errorBody")}</p>
      {error.digest ? <p className={styles.ref}>{t("errorRef", { digest: error.digest })}</p> : null}
      <p className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => reset()}>
          {t("retry")}
        </button>
        <Link className={styles.secondary} href="/">
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
