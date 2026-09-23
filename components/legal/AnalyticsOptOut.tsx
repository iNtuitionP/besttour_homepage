"use client";

/**
 * 방문 통계 거부 / 다시 허용 버튼 (P1-7 R2 · 사용자 결정 "거부 버튼 + 별도 고지") — /privacy 의 방문 통계 국외이전 항목 바로 아래.
 *
 * 원장 VISITOR_STATS_TRANSFER.refusal: "이 항목의 '방문 통계 거부' 버튼을 누르시면 그 브라우저에서는 방문 통계를 보내지 않습니다."
 *   - 누르면 lib/analytics/before-send.ts 가 **먼저 이번 방문 표시를 세우고** localStorage(`bestour:analytics-optout`)에 남기려 한다.
 *     저장에 실패해도(사파리 옛 사생활 모드·용량 초과) 그 브라우저에서는 **이번 방문 동안 실제로 멈춘다** — 그 사실을 문구로 보여 준다(R3 [P2-C]).
 *   - 화면 표시는 **판정 함수 한 곳**(readAnalyticsSignals)에서 온다. 저장소 값을 따로 읽지 않는다 — 보이는 상태와 실제로 막는 조건이
 *     갈라지지 않게. 옛 판은 자체 state 를 들고 있어 "거부 안 됨" 으로 보이면서 수집은 멈춘(또는 그 반대) 경우가 있었다.
 *   - 브라우저의 추적 거부(DNT·GPC)가 켜져 있으면 버튼 대신 "이미 거부 중" 을 보여 준다 — 사이트 버튼으로 되돌릴 수 없는 상태다.
 *   - 다른 탭에서 바꾸면 `storage` 이벤트로, 같은 탭에서 바꾸면 ANALYTICS_OPTOUT_EVENT 로 따라간다.
 * 라벨은 props 로만 받는다(ko = 원장 LEGAL_LABELS.analyticsOptOut · en = en.json legal.labels) — 이 파일에는 한글 리터럴이 없다.
 */
import { useCallback, useEffect, useState } from "react";

import {
  ANALYTICS_OPTOUT_EVENT,
  analyticsRefused,
  browserRefused,
  readAnalyticsSignals,
  setAnalyticsOptOut,
  type AnalyticsSignals,
} from "@/lib/analytics/before-send";

import styles from "./legal.module.css";

export interface AnalyticsOptOutLabels {
  optOut: string;
  optIn: string;
  storageFailed: string;
  browserRefused: string;
}

/** 서버 렌더·첫 화면 — 브라우저 신호를 아직 모른다. 아무 신호도 없는 상태로 그린 뒤 마운트에서 실제 값으로 맞춘다. */
const UNKNOWN: AnalyticsSignals = { optedOut: false, doNotTrack: null, globalPrivacyControl: false };

export function AnalyticsOptOut({ labels }: { labels: AnalyticsOptOutLabels }) {
  const [signals, setSignals] = useState<AnalyticsSignals>(UNKNOWN);
  const [saveFailed, setSaveFailed] = useState(false);

  const sync = useCallback(() => setSignals(readAnalyticsSignals()), []);

  useEffect(() => {
    sync();
    window.addEventListener(ANALYTICS_OPTOUT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ANALYTICS_OPTOUT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [sync]);

  const byBrowser = browserRefused(signals);
  const refused = analyticsRefused(signals);

  const toggle = () => {
    const result = setAnalyticsOptOut(!refused);
    setSaveFailed(!result.ok);
    sync();
  };

  return (
    <div className={styles.optOut} data-testid="analytics-optout" data-opted-out={refused} data-browser-refused={byBrowser}>
      {byBrowser ? (
        <p className={styles.optOutState}>{labels.browserRefused}</p>
      ) : (
        <button type="button" className={styles.optOutButton} onClick={toggle}>
          {refused ? labels.optIn : labels.optOut}
        </button>
      )}
      {saveFailed ? (
        <p className={styles.optOutError} role="alert">
          {labels.storageFailed}
        </p>
      ) : null}
    </div>
  );
}
