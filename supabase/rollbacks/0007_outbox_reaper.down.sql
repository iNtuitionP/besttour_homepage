-- 0007_outbox_reaper.down.sql — supabase/migrations/0007_outbox_reaper.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다(0005 롤백 헤더 참조).
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0007
--
-- 되돌리는 것은 함수 하나뿐이다. 회수기가 failed/lease_expired_after_max_attempts 로 바꾼 행은 되돌리지 않는다 —
-- 그 행은 "5회 시도 뒤 lease 가 만료됐다"는 사실 기록이고, pending 으로 되돌리면 M3(영구 pending)가 다시 생긴다.
-- 발송기(lib/notify/worker.ts)는 reapStale 이 실패하면 실행 전체를 throw 하므로(크론 500), 함수를 지운 뒤에는 발송기도
-- 함께 내려야 한다 — vercel.json 의 /api/cron/notify 항목 제거 또는 코드 롤백. 조용히 실패하는 경로는 없다.

begin;

drop function if exists reap_stale_notifications();

commit;
