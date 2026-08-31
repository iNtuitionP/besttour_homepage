#!/usr/bin/env bash
# L0 세션 부트스트랩: 다른 세션이 남긴 작업을 감지해 컨텍스트에 주입한다.
# 사고 이력: 2026-08 다른 세션의 v8.1 실험 작업을 모른 채 진행 → 아티팩트 발행 2회 거부.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BRANCH=$(git branch --show-current 2>/dev/null)
OUT=""

git fetch --quiet origin 2>/dev/null

if [ -n "$BRANCH" ] && git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null 2>&1; then
  BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)
  if [ "${BEHIND:-0}" -gt 0 ]; then
    OUT="${OUT}⚠ origin/${BRANCH}이 로컬보다 ${BEHIND}커밋 앞섬 — 다른 세션의 작업일 수 있음. 진행 전 git log HEAD..origin/${BRANCH} 확인 필요."$'\n'
    OUT="${OUT}$(git log --oneline "HEAD..origin/$BRANCH" 2>/dev/null | head -5)"$'\n'
  fi
fi

DIRTY=$(git status --porcelain 2>/dev/null | head -5)
[ -n "$DIRTY" ] && OUT="${OUT}미커밋 변경:"$'\n'"${DIRTY}"$'\n'

LEDGER=".superpowers/sdd/2026-08-15-bestour-implementation-master/progress.md"
if [ -f "$LEDGER" ]; then
  OUT="${OUT}구현 레저 최근:"$'\n'"$(tail -4 "$LEDGER")"
fi

[ -z "$OUT" ] && exit 0
jq -n --arg ctx "$OUT" '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$ctx}}'
