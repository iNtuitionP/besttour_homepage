-- 0010_admin_reservation_actions.sql — 관리자 상태 전이 4함수 + 0009 열린 update 정책 회수 (플랜 v4 P5-3 · ADR-2·ADR-7 · 리뷰 N5)
--
-- 왜 함수인가: 확정은 "읽고 → 판단하고 → 쓰고 → 큐에 넣기" 가 아니라 **한 문장**이어야 한다.
-- 애플리케이션이 select 로 status 를 보고 update 하고 notifications_log 에 insert 하면, 사장님이 버튼을 두 번 누르거나
-- 탭이 두 개 열려 있을 때 두 트랜잭션이 모두 "지금은 new 다"를 보고 각자 확정 문자를 큐에 넣는다. 고객은 같은 문자를 두 번 받는다.
-- 여기서는 `update … where id = p_id and status = 'new'` 한 문장이 경합의 승자를 정한다 — 진 쪽은 `found = false` 라
-- 큐에 아무것도 넣지 않고 outcome = 'noop' 으로 돌아간다. 0005 의 부분 유니크(notifications_log_sent_once)는 그 뒤의 마지막 층이다.
--
-- 왜 함수가 스스로 권한을 확인하는가: security definer 는 **RLS 를 우회한다**(그래서 정책이 없는 notifications_log 에 쓸 수 있다).
-- 즉 실행 권한만 있으면 정책은 아무것도 막아 주지 않는다. `grant execute … to authenticated` 인 이상, 첫 줄의 `is_admin()` 가드가
-- 빠지면 **로그인만 한 아무나** 남의 예약을 확정하고 남의 번호로 문자를 큐에 넣는다. 그래서 네 함수 모두 첫 문장이 가드다.
-- search_path 를 `public, pg_temp` 로 고정하고 pg_temp 를 **끝에** 두는 이유는 0009 §2 헤더와 같다(임시 스키마 섀도잉 차단).
--
-- 왜 0009 의 reservations_admin_update 를 지우는가 (독립 리뷰 N5, P5-1-2-review.md:272):
--   그 정책은 컬럼을 제한하지 않는다. 관리자 세션이 PostgREST 로 `retention_until`(파기 예정 시각)·`privacy_consent_at`
--   (동의 기록)·`public_code` 까지 고칠 수 있다는 뜻이다. 파기 크론(P1-5)은 retention_until 하나를 믿고 돌고, 동의 시각은
--   PIPA §22③ 의 입증 자료다 — 화면 하나의 실수나 탈취된 관리자 세션이 그것을 조용히 바꿀 수 있으면 안 된다.
--   그래서 정책을 지우고, 관리자의 쓰기 경로를 이 네 함수(status·confirmed_at·admin_memo 만 건드린다)로 좁힌다.
--   GRANT 층에서도 update 를 회수한다 — RLS 는 "어느 행", GRANT 는 "어느 동작"이고, 0009 §6 이 잠금을 둘로 만든 것과 같은 이유다.
--   select 는 건드리지 않는다(관리자 화면이 그것으로 읽는다). insert·delete 는 0009 에서부터 없었다.
--
-- 전이는 앞으로만 간다: new → confirmed → done, 그리고 new·confirmed → cancelled. 역방향(done → new, cancelled → confirmed)은
-- 함수가 아예 제공하지 않는다.
-- "실수로 확정을 눌렀다" 는 사장님이 전화로 처리할 일이지, 통지가 이미 나간 뒤 상태만 되돌려 기록을 어긋나게 할 일이 아니다.
--
-- 취소는 통지를 넣지 않는다 — 취소 문안이 승인되지 않았다(P4-3 이후 결정). 문안 없이 큐에 넣으면 발송기가 무엇을 보낼지 모른다.
--
-- 기존 행 영향: 함수 4개 추가 + 정책 1개·권한 1개 제거. 컬럼·CHECK·인덱스 변경 0, 데이터 변경 0.
-- 롤백: supabase/rollbacks/0010_admin_reservation_actions.down.sql (수동 실행 전용 — 0005·0007·0009 롤백 헤더 참조).

-- =========================================================================
-- 1. admin_confirm_reservation — new → confirmed (+ 확정 통지 1건 큐)
--    반환: outcome('confirmed'|'noop') · public_code(성공 시) · enqueued(넣은 통지 수)
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

  -- 경합 방어선. status = 'new' 인 행을 잡은 쪽만 아래로 내려간다.
  update reservations set status = 'confirmed', confirmed_at = now(), admin_memo = coalesce(p_memo, admin_memo)
   where id = p_id and status = 'new'
  returning reservations.public_code, reservations.phone into v_code, v_phone;

  if not found then
    -- 이미 확정·완료·취소됐거나 없는 행. 오류가 아니다 — 두 번째 클릭에 빨간 에러를 띄우지 않는다.
    return query select 'noop'::text, null::text, 0;
    return;
  end if;

  -- 여기까지 온 트랜잭션은 하나뿐이다. 사전 확인은 "다른 경로가 이미 넣어 둔 확정 통지"(수동 재큐 등)를 위한 것이고,
  -- 진짜 경합 방어는 위의 status 조건이며, 마지막 층은 0005 의 부분 유니크다.
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

-- =========================================================================
-- 2. admin_cancel_reservation — new·confirmed → cancelled. 통지 없음.
--    반환 모양은 확정과 같다(호출부가 결과를 한 가지 방식으로만 해석하게). enqueued 는 언제나 0 이다.
-- =========================================================================
create or replace function admin_cancel_reservation(p_id uuid, p_memo text default null)
returns table (outcome text, public_code text, enqueued int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if not is_admin() then
    raise exception 'admin_cancel_reservation: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update reservations set status = 'cancelled', admin_memo = coalesce(p_memo, admin_memo)
   where id = p_id and status in ('new', 'confirmed')
  returning reservations.public_code into v_code;

  if not found then
    return query select 'noop'::text, null::text, 0;
    return;
  end if;

  -- 취소 통지는 넣지 않는다(문안 미승인 — 파일 헤더).
  return query select 'cancelled'::text, v_code, 0;
end;
$$;

-- =========================================================================
-- 3. admin_complete_reservation — confirmed → done (운행이 끝났다). 통지 없음.
--
--    독립 리뷰 M1: 목록 화면에는 '완료' 필터가 있는데 0010 에는 done 으로 가는 길이 없었다 — 영원히 비는 필터였다.
--    고객에게 알릴 일이 아니므로 통지는 넣지 않는다(확정만이 고객이 기다리는 소식이다).
--    new 에서 바로 done 으로 건너뛸 수 없다: 확정하지 않은 운행이 끝났다는 기록은 통지 이력과 어긋난다.
-- =========================================================================
create or replace function admin_complete_reservation(p_id uuid, p_memo text default null)
returns table (outcome text, public_code text, enqueued int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if not is_admin() then
    raise exception 'admin_complete_reservation: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update reservations set status = 'done', admin_memo = coalesce(p_memo, admin_memo)
   where id = p_id and status = 'confirmed'
  returning reservations.public_code into v_code;

  if not found then
    return query select 'noop'::text, null::text, 0;
    return;
  end if;

  return query select 'completed'::text, v_code, 0;
end;
$$;

-- =========================================================================
-- 4. admin_update_memo — admin_memo 만. 리뷰 N5 에 대한 직접적인 답이다.
--    p_memo 가 null 이면 메모를 지운다(coalesce 를 쓰지 않는 이유 — 지울 방법이 없으면 사장님이 오기록을 못 고친다).
-- =========================================================================
create or replace function admin_update_memo(p_id uuid, p_memo text)
returns table (outcome text, public_code text, enqueued int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if not is_admin() then
    raise exception 'admin_update_memo: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update reservations set admin_memo = p_memo
   where id = p_id
  returning reservations.public_code into v_code;

  if not found then
    return query select 'noop'::text, null::text, 0;
    return;
  end if;

  return query select 'memo_updated'::text, v_code, 0;
end;
$$;

-- =========================================================================
-- 5. 실행 권한 — security definer 함수는 기본으로 public 에 execute 가 열린다(0005 §6·0009 §2 와 같은 규약).
--    anon 에게 주지 않는다: 로그인하지 않은 요청이 /rpc/admin_confirm_reservation 을 두드릴 수 있으면 안 된다.
--    **service_role 에서도 회수한다**(독립 리뷰 M2): Supabase 의 public 스키마 기본권한은 새 함수의 execute 를
--    service_role 에도 준다. 배치가 예약을 확정하는 경로는 없어야 한다 — 확정은 사람이 하고, 그 사람이 명단에 있는지
--    함수가 확인한다. 서비스 롤 키가 새더라도 이 함수들로는 남의 예약을 확정하거나 문자를 큐에 넣을 수 없다.
--    (서비스 롤로 불러도 auth.uid() 가 없어 is_admin() 이 false 지만, 권한 층에서 한 번 더 못박는다 — 0009 §6 과 같은 규약.)
-- =========================================================================
revoke all on function admin_confirm_reservation(uuid, text) from public, anon, service_role;
revoke all on function admin_cancel_reservation(uuid, text) from public, anon, service_role;
revoke all on function admin_complete_reservation(uuid, text) from public, anon, service_role;
revoke all on function admin_update_memo(uuid, text) from public, anon, service_role;
grant execute on function admin_confirm_reservation(uuid, text) to authenticated;
grant execute on function admin_cancel_reservation(uuid, text) to authenticated;
grant execute on function admin_complete_reservation(uuid, text) to authenticated;
grant execute on function admin_update_memo(uuid, text) to authenticated;

-- =========================================================================
-- 6. 0009 의 열린 update 경로 회수 (리뷰 N5) — 정책과 권한 둘 다.
--    이 뒤로 관리자 세션의 reservations 쓰기는 위 네 함수뿐이다. select 정책은 그대로 둔다.
-- =========================================================================
drop policy if exists reservations_admin_update on reservations;
revoke update on table reservations from authenticated;
