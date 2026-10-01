/**
 * 법정 페이지 제목 영역 — h1 + (있으면) 시행일. 레이아웃은 페이지 제목을 알 수 없어 페이지가 직접 놓는다.
 * 문구는 props 로만 받는다 — 제목·시행일 라벨은 페이지가 ledgerUi(locale) 에서 넣는다(ko 는 원장 LEGAL_PAGES·LEGAL_LABELS 그대로, P2-6).
 * 시행일(P7-4 · 브리프 §4): `effectiveDate` 는 원장의 값(YYYY-MM-DD)으로 `<time dateTime>` 에만 쓰고, 보이는 글자는 페이지가 공개 화면 공용 틀로
 * 만든 `effectiveDateText`(ko "2026년 9월 21일" · en "Sep 21, 2026")다. 값 자체(원장)는 바뀌지 않는다 — 표시만 바뀐다.
 */
import styles from "./legal.module.css";

export function LegalPageHeader({
  title,
  effectiveDate,
  effectiveDateText,
  effectiveDateLabel,
}: {
  title: string;
  effectiveDate?: string;
  /** 보이는 시행일 — formatPublicDate(effectiveDate, …, { style: "posted" }). 없으면 원문 그대로 보인다. */
  effectiveDateText?: string | null;
  /** "시행일" / "Effective date" */
  effectiveDateLabel: string;
}) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {effectiveDate && effectiveDate.trim() !== "" ? (
        <p className={styles.meta}>
          {effectiveDateLabel} <time dateTime={effectiveDate}>{effectiveDateText ?? effectiveDate}</time>
        </p>
      ) : null}
    </header>
  );
}
