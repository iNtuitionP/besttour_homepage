/**
 * 법정 페이지 제목 영역 — h1 + (있으면) 시행일. 레이아웃은 페이지 제목을 알 수 없어 페이지가 직접 놓는다.
 * 문구는 props 로만 받는다 — 제목·시행일 라벨은 페이지가 ledgerUi(locale) 에서 넣는다(ko 는 원장 LEGAL_PAGES·LEGAL_LABELS 그대로, P2-6).
 */
import styles from "./legal.module.css";

export function LegalPageHeader({
  title,
  effectiveDate,
  effectiveDateLabel,
}: {
  title: string;
  effectiveDate?: string;
  /** "시행일" / "Effective date" */
  effectiveDateLabel: string;
}) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {effectiveDate && effectiveDate.trim() !== "" ? (
        <p className={styles.meta}>
          {effectiveDateLabel} <time dateTime={effectiveDate}>{effectiveDate}</time>
        </p>
      ) : null}
    </header>
  );
}
