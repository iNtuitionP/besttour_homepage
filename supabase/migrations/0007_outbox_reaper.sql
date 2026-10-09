-- 0007_outbox_reaper.sql — 5회 claim 뒤 lease 가 만료된 pending 을 failed 로 회수 (플랜 v4 P4-1 · 독립 리뷰 M3)
--
-- 왜(M3): 0005 claim_pending_notifications 는 행을 잡을 때 attempts 를 +1 하고 lease(next_attempt_at = now() + 5분)를 찍는다.
-- 발송기가 markSent/markFailed 없이 죽으면 행은 pending 인 채 남고, lease 가 지나면 다시 claim 된다(at-least-once).
-- 그런데 claim 의 where 절은 attempts < 5 다. 5회째 claim 뒤 죽으면 attempts = 5 가 되어 다시는 claim 대상이 아니고,
-- mark_notification_failed 는 호출돼야만 동작한다 — 그 호출자가 죽은 상황이 바로 이 시나리오다. 그 행은 pending 인 채
-- 영원히 남아 어떤 실패 집계에도 잡히지 않는다. ADR-7 이 막으려던 "통지가 조용히 사라진다"가 형태만 바꿔 살아 있었다.
--
-- 대상: status = 'pending' and attempts >= 5 and next_attempt_at <= now()
--   - attempts >= 5 의 5 는 0005 의 attempts < 5, lib/notify/outbox.ts MAX_ATTEMPTS 와 같은 숫자다(tests/outbox-reaper.test.ts 가 대조).
--     claim(< 5)과 reap(>= 5)은 여집합이라 같은 행을 두 함수가 동시에 잡지 않는다.
--   - next_attempt_at <= now() = 5회째 lease 가 만료됨. lease 가 남은 행(발송기가 아직 처리 중일 수 있음)은 건드리지 않는다.
-- 조치: status = 'failed', last_error = 'lease_expired_after_max_attempts', updated_at = now(). 바뀐 행을 돌려준다(발송기 보고서용).
--   attempts 는 그대로 둔다 — 몇 번 시도했는지가 기록이다. 행을 지우지 않는다.
--
-- 호출자: lib/notify/outbox.ts reapStale() ← lib/notify/worker.ts 가 매 실행(dry-run 아닐 때) 시작 시 먼저 부른다 —
-- sender 구성 여부와 무관하게(회수는 발송이 아니다). 5분 주기 크론(app/api/cron/notify/route.ts, vercel.json).
--
-- security definer 인 이유: notifications_log 는 RLS 가 켜져 있고 정책이 없다(서비스 롤 전용) — 0005 §4 와 같다. 그래서 아래에서
-- anon·authenticated 의 execute 를 반드시 회수한다 — 안 하면 PostgREST /rpc 로 누구나 큐 전체를 failed 로 만들 수 있다.
-- search_path 고정: security definer 함수의 표준 방어(스키마 섀도잉 차단).
--
-- 기존 행 영향: 함수 추가뿐이다(컬럼·CHECK·인덱스 변경 없음). 롤백은 함수 drop 만 — failed 로 바뀐 행은 되돌리지 않는다(그 행은 진실이다).
-- 롤백: supabase/rollbacks/0007_outbox_reaper.down.sql (수동 실행 전용 — migrations/ 밖에 두는 이유는 0005 롤백 헤더 참조).
-- 번호: 플랜 §4 — 0007 을 이 회수기가 선점, admin_rls 는 0009 로.

create or replace function reap_stale_notifications()
returns setof notifications_log
language sql
security definer
set search_path = public
as $$
  update notifications_log
  set status     = 'failed',
      last_error = 'lease_expired_after_max_attempts',
      updated_at = now()
  where status = 'pending' and attempts >= 5 and next_attempt_at <= now()
  returning *;
$$;

-- 실행 권한 — security definer 함수는 기본으로 public 에 execute 가 열린다. 서비스 롤에만 남긴다(0005 §6 과 동일).
revoke all on function reap_stale_notifications() from public, anon, authenticated;
grant execute on function reap_stale_notifications() to service_role;
