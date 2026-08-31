#!/usr/bin/env bash
# L5 창작 금지 규약: 임시값/가정값을 전수 조회한다.
# 근거: 서브에이전트가 실제 데이터 없이 값을 지어낸 사고(운행 연차·누적 건수·공항 할인율·권역 배율)가
# 크로스파일 불일치로 이어졌다. 규약 = 확인되지 않은 값에는 [TEMP] 마커를 붙인다.
# 사용: Phase 게이트에서 실행해 남은 임시값을 전수 확인한다. 종료코드는 항상 0(정보 제공용).
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}" || exit 0

PATHS=""
for p in app lib actions components tests supabase messages middleware.ts CLAUDE.md; do
  [ -e "$p" ] && PATHS="$PATHS $p"
done
[ -z "$PATHS" ] && { echo "check-temp-values: 검사 대상 경로 없음"; exit 0; }

echo "check-temp-values: 검사 대상 =$PATHS"
HITS=$(grep -rnE '\[TEMP\]|TODO\(실값\)|__PLACEHOLDER__' $PATHS 2>/dev/null || true)

if [ -z "$HITS" ]; then
  echo "check-temp-values: 임시값 마커 없음."
else
  COUNT=$(printf '%s\n' "$HITS" | wc -l | tr -d ' ')
  echo "check-temp-values: 임시값 ${COUNT}건 — 정식 오픈 전 실값 교체 또는 명시적 유지 결정 필요."
  printf '%s\n' "$HITS"
fi
exit 0
