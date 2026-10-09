/**
 * 관리자 상태 배지 — 하나로 통일 (P5-20 · 시안 ⑤-0). 예약 목록·상세·통계가 같은 부품을 쓴다.
 *
 * 새 접수(● 점) · N일째 대기(! · 급함) · 확정(✓) · 운행 완료(실선) · 취소(점선 ×) · 간편 접수 칩(전화) · 답이 늦은 접수(! · 급함, 묶음 이름).
 * 모양·톤은 순수 모델(components/admin/status-badge.ts BADGE_LOOK)이 정하고, 이 파일은 그리기만 한다.
 *   - 표식(점·그림)은 **장식**이다(aria-hidden) — 스크린리더가 읽는 것은 글자 하나다.
 *   - 색만으로 구분하지 않는다: 글자 + 표식 + 선(data-line). 색은 --status-* 역할 토큰(admin.module.css `.statusBadge`).
 *
 * 서버 컴포넌트다 — 'use client'·훅·async 가 없다. 서버 페이지가 그대로 부르고(서버 렌더 테스트가 그대로 그린다),
 * 글자는 부르는 쪽이 서버 도우미(components/admin/statusBadgeLabels.ts)로 한 번 받아 넘긴다. 개인정보를 받지 않는다(상태·날수뿐).
 */
import { BADGE_LOOK, badgeText, type BadgeMark, type StatusBadgeLabels, type StatusBadgeModel } from "./status-badge";

import s from "./admin.module.css";

/** 표식 그림(24 격자 · 선 그림) — 시안의 아이콘과 같은 모양. dot·none 은 그림이 아니다. */
const MARK_PATHS: Readonly<Record<Exclude<BadgeMark, "dot" | "none">, string>> = {
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5v.3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  phone: "M6.6 3.5h2.6l1.5 4-2 1.3a11 11 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z",
};

export function StatusBadge({ badge, labels }: { badge: StatusBadgeModel; labels: StatusBadgeLabels }) {
  const look = BADGE_LOOK[badge.kind];
  return (
    <span
      className={s.statusBadge}
      data-kind={badge.kind}
      data-tone={look.tone}
      data-mark={look.mark}
      data-line={look.line}
      data-testid="admin-status-badge"
    >
      {look.mark === "dot" ? <span className={s.badgeDot} aria-hidden="true" /> : null}
      {look.mark !== "dot" && look.mark !== "none" ? (
        <svg className={s.badgeIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={MARK_PATHS[look.mark]} />
        </svg>
      ) : null}
      {badgeText(badge, labels)}
    </span>
  );
}
