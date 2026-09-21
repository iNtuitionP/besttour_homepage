/**
 * 영문 화면의 한국어 원장 블록 바로 위에 두는 안내 (P2-6 · 컨트롤러 확정 문안).
 *
 * 문안은 messages/en.json `legal.officialNotice` 한 곳에만 있다 — 여기에 다시 적지 않는다.
 * 호출부는 `ledgerUi(locale).officialNotice` 를 그대로 넘긴다. ko 에서는 null 이라 **아무것도 렌더하지 않는다**
 * (한국어 화면에서는 원장 원문이 곧 정본이고, ko 마크업은 이 태스크 전과 같아야 한다).
 *
 * 훅·원장 import 없음 — 서버 트리와 클라이언트 트리(ConsentBlock) 양쪽에서 같은 마크업을 낸다.
 * 첫 문장은 굵게(브리프 §3 원문의 **…** 강조).
 * `<p>` 가 아니라 `<div role="note">` 다 — 놓이는 자리의 `.prose p`·`.card p` 같은 문단 규칙이 안내의 글꼴·여백을 덮지 않게.
 */
import type { OfficialNotice } from "@/lib/i18n/ledger-ui-ko";

import styles from "./legal.module.css";

export function OfficialKoreanNotice({ notice }: { notice: OfficialNotice | null }) {
  if (!notice) return null;
  return (
    <div className={styles.officialNotice} role="note" data-legal="official-korean-notice">
      <strong>{notice.lead}</strong> {notice.body}
    </div>
  );
}
