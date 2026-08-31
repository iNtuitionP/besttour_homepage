#!/usr/bin/env bash
# L1 게이트: 앱 코드 편집 직후 가격 계산 코드 회귀 검사(CI 게이트를 왼쪽으로 당김).
# 근거: 스펙 §12 — 실시간 가격 계산 전면 제거. CI에서 잡히기 전에 편집 순간 알린다.
set -uo pipefail
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0

NORM=$(printf '%s' "$FILE" | tr '\\' '/')
case "$NORM" in
  */app/*|*/lib/*|*/actions/*|*/components/*|*/middleware.ts|*/tests/*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -f scripts/check-no-pricing.sh ] || exit 0

if ! OUTPUT=$(bash scripts/check-no-pricing.sh 2>&1); then
  echo "가격 코드 게이트 실패 — 스펙 §12(실시간 가격 계산 전면 제거) 위반입니다. 방금 편집한 코드에서 금지 심볼을 제거하세요." >&2
  echo "$OUTPUT" >&2
  exit 2
fi
exit 0
