/**
 * 접수 현황 (목업 variant-08 §02 "실시간 견적현황" — routes 아래·trust 위). 서버 컴포넌트. **개인정보 마스킹 피드.**
 *
 * 데이터는 페이지가 lib/queries/recent.ts(서비스 롤 · 60초 태그 캐시)로 받아 props 로 내린다 — 여기서는 조회하지 않는다.
 * 항목(RecentFeedItem, lib/recent-feed.ts)에는 원문 필드가 없다. 표시는 원장 PRIVACY_NOTICE.publicFeedNotice 의 범위 그대로
 * "성명 일부 · 차종 · 운행일 · 접수 상태" 뿐이고(ko.json itemLabel "{name} · {vehicle} · {date}" + 상태 칩), 그 고지를 목록 아래 한 줄로 그대로 렌더한다.
 * 고지의 열거와 항목 키의 대응은 tests/feed-notice-parity.test.ts 가 잠근다(항목에 키를 더하면 고지부터 고쳐야 컴파일된다).
 * 목업의 "오늘 접수 N건 · 이번 주 N건" 줄은 실증 불가 수치라 없다(CLAUDE.md §3) — 개수는 어디에도 렌더하지 않는다.
 * 0건이면 섹션 자체를 숨긴다(빈 목록 금지). 문구는 ko.json home.recentFeed 키만 쓴다 — 이 파일에 한글 리터럴 없음.
 */
import { getTranslations } from "next-intl/server";

import { PRIVACY_NOTICE } from "@/lib/legal/disclosures";
import { recentStatusKey, type RecentFeedItem } from "@/lib/recent-feed";

import h from "./home.module.css";
import s from "./RecentFeed.module.css";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

export async function RecentFeed({ items }: { items: readonly RecentFeedItem[] }) {
  if (items.length === 0) return null;
  const t = await getTranslations("home.recentFeed");

  return (
    <section id="recent" className={`${h.sectionTight} ${h.toneLav}`} aria-labelledby="recent-h" data-section="recent">
      <div className={h.wrap}>
        <SectionHead id="recent-h" eyebrow={t("eyebrow")} title={t.rich("title", RICH)} split={false} />
        <ul className={s.feed} aria-label={t("listLabel")} data-testid="recent-feed">
          {items.map((item, i) => (
            <li key={`${i}-${item.departDateKst}`} className={s.tick}>
              <span className={s.chip} data-status={item.status}>
                {t(recentStatusKey(item.status))}
              </span>
              <span className={s.text}>
                {t("itemLabel", { name: item.maskedName, vehicle: item.vehicleLabel, date: item.departDateKst })}
              </span>
            </li>
          ))}
        </ul>
        <p className={s.notice} data-testid="recent-feed-notice">
          {PRIVACY_NOTICE.publicFeedNotice}
        </p>
      </div>
    </section>
  );
}
