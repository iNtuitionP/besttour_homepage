-- 0005_outbox.sql — notifications_log 를 통지 아웃박스로 (플랜 v4 P1-4 · ADR-7)
--
-- 왜: 0001 의 status CHECK 가 ('sent','failed') 두 값뿐이라 "기록 후 발송"이 구조적으로 불가능하다.
-- 발송 직전에 프로세스가 죽으면 흔적이 없고, after() 실패가 조용히 사라진다. 'pending' 을 추가해
-- 접수 트랜잭션이 먼저 "보낼 것"을 기록하고, 발송기가 그 행을 집어가 보내고, 결과를 같은 행에 남기게 한다.
-- 재시도·중복 방지는 코드가 아니라 스키마가 보장한다:
--   - 부분 유니크 notifications_log_sent_once — 같은 (reservation_id, event, channel, template) 로 'sent' 는 한 번만.
--     실패건은 그 인덱스 밖이라 재시도(재insert 또는 update)가 막히지 않는다.
--   - claim_pending_notifications — for update skip locked 로 발송기 두 개가 같은 행을 잡지 않는다.
--
-- 상태 전이 (lib/notify/outbox.ts 와 1:1):
--   pending --claim--> pending(attempts+1, lease) --mark_sent--> sent
--                                                --mark_failed(재시도)--> pending(next_attempt_at = now + 백오프)
--                                                --mark_failed(give_up)--> failed
--   'failed' 는 종착이다(5회 소진 또는 duplicate_sent). 재시도 대기 중인 행은 'pending' 그대로 next_attempt_at 만 미래다.
--
-- 기존 행 가드 없음 — 이유: 추가하는 컬럼 4개에 전부 default 가 있어(0, null, now(), now()) 기존 행이 있어도
-- 그대로 채워지고, CHECK 는 값 집합을 넓히기만 한다(pending·email 추가). 0003 처럼 "기존 행에 가짜 값을 채우는"
-- 위험이 없다. 0001 은 수정하지 않는다(원격에 이미 적용됨).
-- 0001 의 error 컬럼은 남긴다(호환) — 앞으로 쓰는 것은 last_error 다. to_phone 컬럼 이름도 유지한다 —
-- channel = 'email' 인 행은 여기에 메일 주소가 들어간다(이름 변경은 P4 에서 SMS/메일 모듈이 같이 확정).
-- 롤백: supabase/rollbacks/0005_outbox.down.sql (수동 실행 전용 — migrations/ 밖에 두는 이유는 그 파일 헤더 참조).

-- =========================================================================
-- 1. 컬럼 4개 (전부 default 있음)
-- =========================================================================
alter table notifications_log
  add column attempts        int         not null default 0,     -- claim 된 횟수(= 발송 시도 횟수). claim 이 올린다
  add column last_error      text,                               -- 마지막 실패 사유(제공자 응답 요약). 성공하면 null
  add column updated_at      timestamptz not null default now(), -- 마지막 상태 변경 시각 (claim/mark 가 찍는다)
  add column next_attempt_at timestamptz not null default now(); -- 이 시각 이후에만 claim 대상. 실패 시 백오프, claim 시 lease

-- =========================================================================
-- 2. status·channel CHECK 교체
--    0001 은 이름 없는 인라인 CHECK 를 걸었다. 이름(notifications_log_status_check 등 Postgres 기본값)에 기대지
--    않고 0002 처럼 pg_constraint 에서 정의문 기준으로 찾아 동적으로 제거한다. event CHECK 는 건드리지 않는다.
-- =========================================================================
do $$
declare
  ck record;
begin
  for ck in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'notifications_log'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~ '\m(status|channel)\M'
  loop
    execute format('alter table public.notifications_log drop constraint %I', ck.conname);
  end loop;
end
$$;

alter table notifications_log
  add constraint notifications_log_status_check
    check (status in ('pending', 'sent', 'failed')),
  -- email: P4-4/P4-5 의 폴백 메일(사장님 번호 미설정 시)이 같은 아웃박스를 쓴다
  add constraint notifications_log_channel_check
    check (channel in ('sms', 'alimtalk', 'email'));

-- =========================================================================
-- 3. 인덱스
-- =========================================================================
-- 같은 예약·이벤트·채널·템플릿으로 'sent' 는 한 번만. template 이 키에 들어가는 이유: created 이벤트는 사장님 SMS 와
-- 고객 SMS 두 건이라 (reservation_id, event, channel) 만으로는 두 번째 건이 막힌다 — template 키(created.owner.sms /
-- created.customer.sms)가 수신자 구분을 담는다. NULL reservation_id 는 유니크 비교에서 서로 다르므로 예약 없는 행은 대상 밖.
create unique index if not exists notifications_log_sent_once
  on notifications_log (reservation_id, event, channel, template) where status = 'sent';

-- 발송기가 집어갈 pending 을 빨리 찾게 (FIFO)
create index if not exists notifications_log_pending
  on notifications_log (created_at) where status = 'pending';

-- =========================================================================
-- 4. claim_pending_notifications(p_limit) — 발송기가 집어갈 행을 잠그고 lease 를 찍는다
--
-- for update skip locked 인 이유: 발송기가 동시에 두 개(예: Vercel 함수 중복 실행, cron 겹침) 돌아도 같은 행을
-- 두 개가 잡아 두 번 보내는 일이 없어야 한다. 한쪽이 잠근 행을 다른 쪽은 기다리지 않고 건너뛴다.
-- 같은 문장에서 update 하는 이유: 행 잠금은 이 함수의 트랜잭션이 끝나면 풀린다. select 만 하고 돌려주면 두 번째
-- 호출이 같은 행을 다시 본다. 그래서 잡는 즉시 attempts+1 과 next_attempt_at = now() + lease(5분)를 찍어,
-- lease 안에는 다른 발송기 눈에 띄지 않고, 발송기가 mark 없이 죽어도 lease 뒤에 다시 잡힌다(at-least-once).
-- attempts 를 claim 에서 올리는 이유: mark 에서 올리면 "claim 뒤 죽는" 행이 영원히 0회로 남아 무한 반복된다.
-- attempts < 5 는 lib/notify/outbox.ts MAX_ATTEMPTS 와 같은 숫자다(tests/outbox.test.ts 가 대조).
-- security definer 인 이유: notifications_log 는 RLS 가 켜져 있고 정책이 없다(서비스 롤 전용). 발송기를 나중에
-- 전용 역할로 돌리더라도 이 함수만 실행 권한을 주면 되게 함수 소유자 권한으로 돈다. 그래서 아래 5 에서
-- anon·authenticated 의 execute 를 반드시 회수한다 — 안 하면 PostgREST /rpc 로 누구나 큐를 비울 수 있다.
-- search_path 를 고정하는 이유: security definer 함수의 표준 방어(악의적 스키마 섀도잉 차단).
-- =========================================================================
create or replace function claim_pending_notifications(p_limit int default 10)
returns setof notifications_log
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id
    from notifications_log
    where status = 'pending' and next_attempt_at <= now() and attempts < 5
    order by created_at
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  )
  update notifications_log n
  set attempts        = n.attempts + 1,
      updated_at      = now(),
      next_attempt_at = now() + interval '5 minutes'
  from picked
  where n.id = picked.id
  returning n.*;
$$;

-- =========================================================================
-- 5. mark_notification_sent / mark_notification_failed
-- =========================================================================
-- pending → sent. 같은 키로 이미 sent 가 있으면(부분 유니크 위반) 이 행을 failed/duplicate_sent 로 남기고 false.
-- 발송은 이미 일어난 뒤라 되돌릴 수 없다 — 그래서 진짜 중복 방지는 enqueue 의 사전 확인과 claim 이고, 이 분기는
-- 그 둘을 뚫고 온 경우를 "조용히" 가 아니라 행에 기록하며 흡수하는 마지막 층이다.
create or replace function mark_notification_sent(p_id bigint, p_provider_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update notifications_log
  set status = 'sent',
      provider_message_id = p_provider_message_id,
      last_error = null,
      updated_at = now()
  where id = p_id and status = 'pending';
  return found;
exception
  when unique_violation then
    update notifications_log
    set status = 'failed',
        last_error = 'duplicate_sent',
        updated_at = now()
    where id = p_id;
    return false;
end;
$$;

-- 실패 기록. p_give_up 이면 failed(종착), 아니면 pending 유지 + next_attempt_at = now() + p_retry_after_ms.
-- 백오프 계단(1m·5m·30m·2h·12h)과 give_up 판정은 lib/notify/outbox.ts 가 계산해 넘긴다 — 스케줄을 두 곳에 두지 않는다.
create or replace function mark_notification_failed(p_id bigint, p_error text, p_give_up boolean, p_retry_after_ms bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update notifications_log
  set status          = case when p_give_up then 'failed' else 'pending' end,
      last_error      = p_error,
      updated_at      = now(),
      next_attempt_at = case when p_give_up then now()
                             else now() + make_interval(secs => greatest(coalesce(p_retry_after_ms, 0), 0) / 1000.0) end
  where id = p_id and status = 'pending';
$$;

-- =========================================================================
-- 6. 실행 권한 — security definer 함수는 기본으로 public 에 execute 가 열린다. 서비스 롤에만 남긴다.
-- =========================================================================
revoke all on function claim_pending_notifications(int) from public, anon, authenticated;
revoke all on function mark_notification_sent(bigint, text) from public, anon, authenticated;
revoke all on function mark_notification_failed(bigint, text, boolean, bigint) from public, anon, authenticated;
grant execute on function claim_pending_notifications(int) to service_role;
grant execute on function mark_notification_sent(bigint, text) to service_role;
grant execute on function mark_notification_failed(bigint, text, boolean, bigint) to service_role;
