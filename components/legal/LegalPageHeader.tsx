/**
 * 법정 페이지 제목 영역 — h1 + (있으면) 시행일. 레이아웃은 페이지 제목을 알 수 없어 페이지가 직접 놓는다.
 * 문구는 props·원장에서만 온다.
 */
import { LEGAL_LABELS } from "@/lib/legal/disclosures";
import styles from "./legal.module.css";

export function LegalPageHeader({ title, effectiveDate }: { title: string; effectiveDate?: string }) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {effectiveDate && effectiveDate.trim() !== "" ? (
        <p className={styles.meta}>
          {LEGAL_LABELS.effectiveDate} <time dateTime={effectiveDate}>{effectiveDate}</time>
        </p>
      ) : null}
    </header>
  );
}
