/**
 * 법정 문서 셸 — /privacy /terms /guide (P1-6).
 * 공개 (site) 셸(헤더·푸터)을 상속하지 않는다(P0-0). 본문 폭 + 하단에 원장 LEGAL_LINKS 3개와 홈 링크만 둔다.
 * 제목 영역은 페이지가 <LegalPageHeader/> 로 직접 놓는다(레이아웃은 페이지 제목을 모른다).
 * 링크 라벨은 원장 LEGAL_PAGES.*.title · LEGAL_LABELS.home — 이 파일에 한글 리터럴 없음.
 */
import { Link } from "@/i18n/navigation";
import { LEGAL_LABELS, LEGAL_LINKS, LEGAL_PAGES } from "@/lib/legal/disclosures";
import styles from "@/components/legal/legal.module.css";

const NAV = [
  { href: LEGAL_LINKS.privacy, label: LEGAL_PAGES.privacy.title },
  { href: LEGAL_LINKS.terms, label: LEGAL_PAGES.terms.title },
  { href: LEGAL_LINKS.guide, label: LEGAL_PAGES.guide.title },
] as const;

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        {children}
        <footer className={styles.footer}>
          <nav aria-label={LEGAL_LABELS.legalNav}>
            <ul className={styles.nav}>
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link className={styles.navLink} href={n.href}>
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link className={styles.navLink} href="/">
                  {LEGAL_LABELS.home}
                </Link>
              </li>
            </ul>
          </nav>
        </footer>
      </main>
    </div>
  );
}
