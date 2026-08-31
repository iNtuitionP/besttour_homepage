#!/usr/bin/env bash
# L1 게이트: 디렉토리를 옮긴 복합 명령 안에서의 git push 차단.
# 실제 사고(2026-08): `cd <스크래치패드> && node build.js && git push origin ...` 실행 →
# 셸 cwd가 다른 저장소를 가리켜 엉뚱한 원격(YOLOV3P.git)으로 push 시도됨.
# 규칙: push는 저장소 루트에서 단독 실행하거나 `git -C <경로> push` 형태로만.
set -uo pipefail
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

printf '%s' "$CMD" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push' || exit 0

# git -C 로 경로를 명시했으면 안전
printf '%s' "$CMD" | grep -Eq 'git[[:space:]]+-C[[:space:]]' && exit 0

# cd / pushd 가 섞인 복합 명령이면 차단
if printf '%s' "$CMD" | grep -Eq '(^|[;&|[:space:]])(cd|pushd)[[:space:]]'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "git push가 cd/pushd를 포함한 복합 명령 안에 있습니다. 셸 cwd가 다른 저장소를 가리키면 엉뚱한 원격으로 push됩니다(2026-08 실제 사고). 저장소 루트에서 push만 단독 실행하거나 `git -C <저장소경로> push ...` 형태로 다시 실행하세요."
    }
  }'
  exit 0
fi
exit 0
