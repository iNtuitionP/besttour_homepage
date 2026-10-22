-- 0028_consult_sms.down.sql — supabase/migrations/0028_consult_sms.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다.
--
-- 🔴 순서: **코드를 먼저 0028 이전으로 되돌린 뒤** 이 파일을 돌린다. 새 코드는 admin_send_reservation_sms 를 부르고 notifications_log.body 를 읽는다 —
--    DB 를 먼저 되돌리면 [문자 보내기]가 실패하고, 관리자 상세의 보낸 문자 기록 조회가 없는 칸을 읽어 실패한다.
--    또 이 롤백은 **상담완료가 다시 확정 문자를 자동으로 큐에 넣게** 만든다(0010 의 동작) — 옛 코드의 화면 문구("상담완료로 바꾸면 … 문자가 가요")와 맞는 짝이다.
--
-- 🔴 **직접 쓴 문자 행(template = 'consult.customer.sms')이 있으면 멈춘다.** body 칸을 지우면 그 행의 본문(손님에게 실제로 보낸 계약 정보 문자 —
--    대금·취소 규정을 고지했다는 기록)이 사라지고, 같은 예약에 sent 가 여러 건이라 옛 부분 유니크(술어 status = 'sent' 만)를 다시 만들 수 없다.
--    멈췄다면 그 행을 먼저 내보낼 것(`select id, reservation_id, status, created_at, body from notifications_log where template = 'consult.customer.sms'`).
--    정말 되돌리려면 같은 세션에서 `set besttour.rollback_0028_drop_sms = 'yes';` 를 먼저 실행한다 — 그러면 그 행들을 **지운다**(사람이 판단한 뒤에만).
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0028
--
-- ## 하는 일 (0028 의 반대)
--   0. 직접 쓴 문자 행 가드(위)
--   1. admin_confirm_reservation 을 0010 의 정의로 되돌린다(확정 통지 1건 큐 · 사전 중복 확인) — 같은 서명이라 ACL 은 남지만 revoke/grant 를 다시 적는다.
--   2. admin_send_reservation_sms(uuid, text) 를 지운다.
--   3. CHECK 둘을 지우고, (승인했으면) 직접 쓴 문자 행을 지운 뒤, 부분 유니크를 0005 의 술어(status = 'sent')로 다시 만들고, body 칸을 지운다.
--   표 권한 재회수(0028 §5)는 되돌리지 않는다 — 0012·0017·0019 가 이미 같은 상태로 만들어 둔 것이라 되돌릴 것이 없다.
--
-- 재실행: if exists · create or replace 라 몇 번 돌려도 같다.

begin;

set local lock_timeout = '5s';

-- =========================================================================
-- 0. 가드 — 직접 쓴 문자 행
-- =========================================================================
do $$
declare
  n bigint := 0;
begin
  -- body 칸이 이미 없으면(재실행) 직접 쓴 문자 행도 있을 수 없다(짝 CHECK) — 그래도 키로 센다.
  select count(*) into n from public.notifications_log where template = 'consult.customer.sms';
  if n > 0 and coalesce(current_setting('besttour.rollback_0028_drop_sms', true), '') <> 'yes' then
    raise exception '0028 롤백 중단: 직접 쓴 상담완료 문자 행이 % 건 있다 — body 칸을 지우면 손님에게 보낸 본문(계약 정보 고지 기록)이 사라진다', n
      using hint = '그 행을 먼저 내보낸 뒤, 정말 되돌리려면 같은 세션에서 set besttour.rollback_0028_drop_sms = ''yes''; 를 실행하고 다시 돌릴 것(그 행들을 지운다).';
  end if;
end
$$;

-- =========================================================================
-- 1. admin_confirm_reservation — 0010 정의 그대로 (확정 통지 1건 큐)
-- =========================================================================
create or replace function admin_confirm_reservation(p_id uuid, p_memo text default null)
returns table (outcome text, public_code text, enqueued int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code     text;
  v_phone    text;
  v_enqueued int := 0;
begin
  if not is_admin() then
    raise exception 'admin_confirm_reservation: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update reservations set status = 'confirmed', confirmed_at = now(), admin_memo = coalesce(p_memo, admin_memo)
   where id = p_id and status = 'new'
  returning reservations.public_code, reservations.phone into v_code, v_phone;

  if not found then
    return query select 'noop'::text, null::text, 0;
    return;
  end if;

  insert into notifications_log (reservation_id, event, channel, to_phone, template, status)
  select p_id, 'confirmed', 'sms', v_phone, 'confirmed.customer.sms', 'pending'
   where not exists (
     select 1 from notifications_log n
      where n.reservation_id = p_id
        and n.event = 'confirmed'
        and n.channel = 'sms'
        and n.template = 'confirmed.customer.sms'
        and n.status in ('pending', 'sent')
   );
  get diagnostics v_enqueued = row_count;

  return query select 'confirmed'::text, v_code, v_enqueued;
end;
$$;

-- 같은 서명이라 ACL 은 유지되지만, 0010 §5 의 상태를 글로 다시 못박는다(CLAUDE.md §3 — 재정의 뒤 권한을 재기술).
revoke all on function admin_confirm_reservation(uuid, text) from public, anon, service_role;
grant execute on function admin_confirm_reservation(uuid, text) to authenticated;

-- =========================================================================
-- 2. 새 함수 제거
-- =========================================================================
drop function if exists admin_send_reservation_sms(uuid, text);

-- =========================================================================
-- 3. 칸 · 제약 · 인덱스
-- =========================================================================
alter table notifications_log drop constraint if exists notifications_log_body_shape_check;
alter table notifications_log drop constraint if exists notifications_log_body_template_check;

-- 가드를 승인(yes)으로 통과한 경우에만 남아 있다 — 옛 부분 유니크를 다시 만들기 전에 지운다(같은 예약의 sent 여러 건).
delete from notifications_log where template = 'consult.customer.sms';

drop index if exists notifications_log_sent_once;
create unique index notifications_log_sent_once
  on notifications_log (reservation_id, event, channel, template) where status = 'sent';

alter table notifications_log drop column if exists body;

commit;
