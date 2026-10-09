#!/usr/bin/env bash
# scripts/check-admin-no-service-role.sh
#
# 관리자 경로 서비스 롤 금지 게이트 (플랜 v4 ADR-2 · P5-1/P5-2).
#
# 왜: 관리자 화면은 고객 이름·전화번호를 다룬다. service role 키는 RLS 를 우회하므로, 그것을 쓰는 순간
# 방어선이 `requireAdmin()` 호출 하나로 줄어든다 — 어느 한 화면에서 조기 return 을 빠뜨리면 그 화면이
# 전체를 그대로 내보낸다. 관리자 경로는 세션(anon 키 + 쿠키) 클라이언트로만 DB 에 닿고, 0009 의
# `is_admin()` 정책이 DB 에서 한 번 더 막는다. 이 게이트는 그 규약이 코드로 깨지는 순간을 잡는다.
#
# 검사 대상(존재하는 것만): app/admin  actions/admin  lib/admin  components/admin
#   하나도 없으면 통과(exit 0) — 대상이 생기는 순간부터 검사한다(0P5 게이트 3종과 같은 원칙).
#   lib/admin·components/admin 은 P5-3 독립 리뷰 M4 로 추가했다: 화면(app/admin)은 깨끗해도 **실제 쿼리는 lib/admin 에 있다**.
#   거기서 서비스 롤로 읽으면 RLS 를 우회하므로 방어선이 requireAdmin() 호출 하나로 줄어든다 — 게이트가 보지 못하던 자리였다.
#
# 금지 심볼: createServiceClient · SUPABASE_SERVICE_ROLE_KEY · supabase/server
#   앞 둘은 사용, 셋째는 모듈 경로(import) 다. 셋 중 하나라도 나오면 실패한다.
#   집계·크로스테이블 조회가 정책에 걸리면 SECURITY DEFINER 함수/뷰로 격리한다(ADR-2 폴백) — 서비스 롤로 돌아가지 않는다.
#
# 범위 밖: app/api/cron/** 같은 서버 배치는 서비스 롤이 정상이다. 이 게이트는 관리자 경로만 본다.
#
# 종료코드: 0 통과 · 1 위반(파일:줄 출력) · 2 실행 오류
# 로컬 실행: bash scripts/check-admin-no-service-role.sh  (= npm run check:admin)

set -uo pipefail

# CLAUDE_PROJECT_DIR 가 있으면 그것을 루트로(픽스처 위장 가능), 없으면 스크립트 위치 기준 레포 루트.
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}" \
  || { echo "check-admin-no-service-role: 프로젝트 루트로 이동 실패"; exit 2; }

TAG="check-admin-no-service-role"
PATTERN='createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase/server'
TARGETS=(app/admin actions/admin lib/admin components/admin)

existing=()
for t in "${TARGETS[@]}"; do
  [ -e "$t" ] && existing+=("$t")
done

if [ ${#existing[@]} -eq 0 ]; then
  echo "$TAG: 검사 대상 경로 없음 (대상 목록: ${TARGETS[*]}). 통과 처리."
  exit 0
fi

echo "$TAG: 검사 대상 = ${existing[*]}"
echo "$TAG: 금지 패턴 = ${PATTERN}"

matches=$(grep -rnIE --exclude-dir=node_modules --exclude-dir=.next -e "$PATTERN" "${existing[@]}" 2>/dev/null)
grep_exit=$?

if [ "$grep_exit" -eq 0 ]; then
  echo "$TAG: 관리자 경로에서 서비스 롤 심볼이 발견되었습니다 (ADR-2 위반):"
  echo "$matches"
  echo "$TAG: 관리자 조회는 lib/supabase/ssr.ts 의 세션 클라이언트 + 0009 의 is_admin() 정책으로 합니다."
  exit 1
elif [ "$grep_exit" -eq 1 ]; then
  echo "$TAG: OK — 관리자 경로에 서비스 롤 심볼 없음."
  exit 0
else
  echo "$TAG: grep 실행 중 오류가 발생했습니다 (exit ${grep_exit})."
  exit 2
fi
