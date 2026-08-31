#!/usr/bin/env bash
# L1 게이트: 아카이브로 강등된 목업 파일 편집 차단.
# 근거: 스펙 §12 — 최종 기준은 variant-08-map-hero.html / wizard-b.html / admin.html.
# v7 계열(실시간 가격 계산 UI 포함)을 수정하거나 여기서 코드를 이식하면 폐기된 방향이 되살아난다.
set -uo pipefail
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0

NORM=$(printf '%s' "$FILE" | tr '\\' '/')

case "$NORM" in
  *mockups/variant-07-final.html|*mockups/wizard.html|*mockups/variant-0[1-6]-*.html)
    jq -n --arg f "$FILE" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ("아카이브 목업은 수정 금지: " + $f + " — 스펙 §12로 강등된 파일입니다. 최종 기준은 mockups/variant-08-map-hero.html · wizard-b.html · admin.html 입니다. 아카이브를 정말 손봐야 하면 사용자에게 먼저 확인하세요.")
      }
    }'
    exit 0
    ;;
esac
exit 0
