/**
 * 법정 문서의 단위 블록 두 가지.
 *   - LegalArticle: 약관 조문 (제N조 + 제목 + 본문) — /terms
 *   - LegalSection: 절 (제목 + children) — /privacy /guide
 * 문구는 props 로만 받는다. 이 파일에는 한글 리터럴이 없다 (tests/legal-pages.test.ts §3).
 */
import { LEGAL_LABELS } from "@/lib/legal/disclosures";
import styles from "./legal.module.css";

/** children — 조문 본문 바로 아래에 붙는 원장 고지(예: 제8조 아래 WITHDRAWAL.notice — P1-7). 조문 본문 자체는 바꾸지 않는다. */
export function LegalArticle({
  no,
  title,
  body,
  children,
}: {
  no: number;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <article className={styles.section} data-article-no={no}>
      <h2 className={styles.sectionTitle}>
        <span className={styles.articleNo}>
          {LEGAL_LABELS.articleNo.prefix}
          {no}
          {LEGAL_LABELS.articleNo.suffix}
        </span>
        {title}
      </h2>
      <p className={styles.body}>{body}</p>
      {children}
    </article>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section} id={id} data-section-key={id}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

/** 문단 — 빈 문자열은 렌더하지 않는다 (원장의 "" 폴백) */
export function LegalParagraph({ text }: { text: string }) {
  if (text.trim() === "") return null;
  return <p className={styles.body}>{text}</p>;
}

/** 목록 — 빈 항목은 건너뛰고, 남는 항목이 없으면 렌더하지 않는다 */
export function LegalList({ items, ordered = false }: { items: readonly string[]; ordered?: boolean }) {
  const kept = items.filter((s) => s.trim() !== "");
  if (kept.length === 0) return null;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={styles.list}>
      {kept.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </Tag>
  );
}
