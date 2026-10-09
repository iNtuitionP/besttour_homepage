-- 0005_outbox.down.sql — supabase/migrations/0005_outbox.sql 롤백 (수동 실행 전용)
--
-- 이 파일이 migrations/ 가 아니라 rollbacks/ 에 있는 이유: Supabase CLI(2.117.0 확인)는 migrations/ 안의
-- `^([0-9]+)_(.*)\.sql$` 파일을 전부 마이그레이션으로 집는다. 거기 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 이 파일을 통째로 실행한 뒤, CLI 이력에서 0005 를 되돌린다:
--
--   supabase migration repair --status reverted 0005
--
-- 되돌리는 순서 (0005 의 역순):
--   0. 가드 — pending 또는 email 행이 있으면 멈춘다 (복원할 CHECK 가 그 행 때문에 실패한다. 조용히 지우지 않는다 —
--      pending 은 아직 안 보낸 통지다. 사람이 보내거나 failed 로 바꾼 뒤 다시 실행한다)
--   1. 함수 3개 제거
--   2. 인덱스 2개 제거
--   3. 컬럼 4개 제거
--   4. CHECK 를 0001 원문 값 집합으로 복원 — status ('sent','failed'), channel ('sms','alimtalk')

begin;

-- 0. 가드
do $$
declare
  n bigint;
begin
  select count(*) into n from notifications_log where status = 'pending' or channel = 'email';
  if n > 0 then
    raise exception '0005_outbox.down: notifications_log 에 pending 또는 email 행 % 건 — 0001 의 CHECK 로 되돌릴 수 없다. 사람이 판단할 것', n
      using hint = 'pending 은 아직 발송되지 않은 통지다. 발송하거나 failed 로 바꾸고, email 행은 내보낸 뒤 삭제한 다음 다시 실행한다.';
  end if;
end
$$;

-- 1. 함수
drop function if exists claim_pending_notifications(int);
drop function if exists mark_notification_sent(bigint, text);
drop function if exists mark_notification_failed(bigint, text, boolean, bigint);

-- 2. 인덱스
drop index if exists notifications_log_sent_once;
drop index if exists notifications_log_pending;

-- 3. 컬럼
alter table notifications_log
  drop column if exists attempts,
  drop column if exists last_error,
  drop column if exists updated_at,
  drop column if exists next_attempt_at;

-- 4. CHECK 복원
alter table notifications_log
  drop constraint if exists notifications_log_status_check,
  drop constraint if exists notifications_log_channel_check;
alter table notifications_log
  add constraint notifications_log_status_check  check (status in ('sent', 'failed')),
  add constraint notifications_log_channel_check check (channel in ('sms', 'alimtalk'));

commit;
