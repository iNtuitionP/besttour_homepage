-- 0028_consult_sms.sql — 상담완료는 상태만 · 상담완료 문자는 관리자가 직접 보낸다 (OF3-R4 · OF3-requirements R4 10번 · 사장님 요청 2026-10-22)
--
-- ## 왜
--   지금(0010)은 [상담완료로 바꾸기] 한 번에 고객에게 고정 문안의 확정 문자가 큐에 들어간다. 사장님은 상담에서 정한 내용을
--   **직접 쓴 문구**로 보내고 싶어 한다 — 언제 보낼지도 사장님이 정한다. 그래서 상태 전이와 문자를 떼어 놓는다:
--     · 상담완료 = 상태만 바꾼다(통지 0건).
--     · [문자 보내기] = 관리자가 쓴 문구 + 계약 정보 블록(■ 대금 · ■ 취소·환불 — 앱이 원장에서 만들어 언제나 붙인다)을 문자로 한 통 큐에 넣는다.
--       여러 번 보낼 수 있다. 받는 번호는 **그 예약의 번호로 고정**이다(인자로 받지 않는다 — 관리자 세션이 남의 번호로 문자를 보내는 길을 만들지 않는다).
--
-- ## 무엇을 하나
--   1. `admin_confirm_reservation(uuid, text)` — **같은 서명으로** create or replace. 확정 통지 insert 를 걷고 enqueued 는 언제나 0.
--      가드·경합 방어(`and status = 'new'`)·반환 모양은 0010 그대로다(앱의 결과 해석 lib/admin/result.ts 를 바꾸지 않는다).
--      서명이 같으므로 함수 ACL 은 유지된다(drop 하지 않는다 — drop + create 는 EXECUTE 를 공개 롤에 다시 연다, CLAUDE.md §3). §5 가 실측한다.
--   2. `notifications_log.body text` — 관리자가 쓴 최종 본문. null 허용(자동 통지는 template 키로 문안을 만든다 — body 없음).
--      CHECK 둘: ① 모양 — 비어 있지 않고 UTF-8 2000바이트 이하(lib/notify/templates.ts LMS_BYTE_LIMIT 와 같은 수 — LMS 상한이자 보수적 바이트 기준)
--                ② 짝 — template = 'consult.customer.sms' 이면 body 가 있고 채널은 문자, 그 밖의 template 이면 body 가 없다.
--      그래서 발송기는 "body 가 있으면 그대로, 없으면 template 렌더" 하나로 갈리고(lib/notify/worker.ts), 자동 통지 행에 본문을 끼워 넣을 수 없다.
--      **event CHECK 는 바꾸지 않는다**: 직접 쓴 문자도 event = 'confirmed'(상담완료 사건)다. 그래서 끝내 실패하면 기존 실패 알림
--      (confirmed.owner.failure.email — "상담완료 통지가 발송되지 않았습니다")이 그대로 사장님께 간다(lib/notify/fallback.ts 변경 0).
--   3. 부분 유니크 `notifications_log_sent_once` — 같은 이름으로 다시 만들고 술어에 `and body is null` 을 더한다.
--      자동 통지의 "같은 키로 sent 는 한 번만"(0005)은 그대로이고, 여러 번 보내는 직접 문자는 그 밖이다(안 그러면 두 번째 문자가
--      **보낸 뒤에** duplicate_sent 로 기록된다 — 0005 mark_notification_sent 의 흡수 분기).
--   4. `admin_send_reservation_sms(p_id uuid, p_body text) returns table (outcome text, notification_id bigint)` — 유일한 쓰기 길.
--      definer · search_path `public, pg_temp` · 첫 문장 is_admin() 가드(42501) · 본문 검사(22023) · 예약이 상담완료(confirmed_at 있음 ·
--      상태 confirmed 또는 done)일 때만 · 받는 번호 = reservations.phone · pending 1건.
--      outcome: 'queued'(넣음) | 'not_consulted'(상담완료가 아님 — 새 접수 · 상담완료 뒤 취소) | 'noop'(없는 id).
--      계약 정보 블록은 앱이 붙인다(원장은 TS 상수다 — DB 가 만들 수 없다). DB 는 본문이 그 블록을 담았는지 보지 않는다 — 관리자 명단의 세션이
--      PostgREST 로 직접 부르면 블록 없이 보낼 수 있다(보고서 위험 항목 · 관리자는 이미 신뢰 경계 안이다).
--
-- ## 권한 (CLAUDE.md §3 — 새 객체는 기본으로 공개 롤에 전권이 열린다: postgres·supabase_admin → anon·authenticated·postgres·service_role)
--   · 새 함수: **같은 파일에서** public·anon·authenticated·service_role 넷 모두 회수 → authenticated 에만 grant.
--     service_role 도 막는다 — 배치가 고객 문자를 큐에 넣는 길은 없어야 한다(0010 §5 와 같은 판단. 서비스 롤로 불러도 is_admin() 이 false 지만 권한 층에서 한 번 더).
--   · 새 칸: 표 권한을 새로 열지 않는다. 다만 표 단위 쓰기·TRUNCATE·REFERENCES·TRIGGER 를 공개 롤(PUBLIC·anon·authenticated)에서 **다시** 회수하고
--     (0012·0017 이 이미 했다 — 멱등), PostgreSQL 17+ 의 MAINTAIN 은 server_version_num 조건부 동적 SQL 로 다시 회수한다(0019 와 같은 형태).
--     service_role 의 표 권한은 건드리지 않는다 — 접수 통지 적재(lib/notify/outbox.ts enqueue)가 service_role 의 insert 로 돈다.
--     authenticated 의 SELECT 는 남는다 — 관리자 상세의 "보낸 문자" 기록이 0009 notifications_log_admin_select(is_admin) 로 body 를 읽는다.
--   · §5 자기검증이 has_*_privilege · aclexplode(acldefault) 로 실측한다(권한 종류는 카탈로그에서 얻는다).
--
-- ## 배포 순서 (필수)
--   **DB 적용 → 코드 배포.** 새 코드는 admin_send_reservation_sms 를 부르고 body 를 읽는다. 코드가 먼저 나가면 [문자 보내기]가 실패하고
--   보낸 문자 기록이 비고, 발송기는 body 칸 없는 행만 받는다(자동 통지는 영향 없음). DB 를 먼저 올리면 옛 코드는:
--     · [상담완료로 바꾸기] 뒤 문자가 나가지 않는다(옛 화면의 "문자가 가요" 문구와 어긋난다 — 배포 사이 몇 분).
--     · 옛 발송기는 body 를 모른다 — 하지만 직접 쓴 문자 행은 새 코드가 있어야만 생기므로 옛 발송기가 그런 행을 만날 일이 없다.
--   롤백은 반대: 코드를 먼저 되돌린 뒤 supabase/rollbacks/0028_consult_sms.down.sql (직접 쓴 문자 행이 있으면 멈춘다 — 파일 헤더).
--
-- 기존 행 영향: 칸 추가(기존 행 body = null — 두 CHECK 를 그대로 만족: 기존 template 은 전부 자동 통지 키) · 인덱스 재생성(같은 키 · 술어가 좁아질 뿐이라 — 인덱스에 드는 행이
--   줄기만 한다 — 기존 sent 행이 유니크를 어길 수 없다) · 함수 1개 교체 · 함수 1개 추가. 데이터 변경 0.
--   남아 있는 pending 'confirmed.customer.sms' 행(0028 전 상담완료분)은 건드리지 않는다 — 발송기가 예전 문안으로 보낸다(런북 0028 절 확인 질의).
-- 재실행 안전: add column if not exists · 제약 drop if exists 후 add · drop index if exists 후 create · create or replace · revoke/grant 는 멱등.

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0028: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나).';
  end if;
end
$$;

-- =========================================================================
-- 1. admin_confirm_reservation — new → confirmed. 통지 없음. (서명·반환 모양·가드는 0010 그대로)
-- =========================================================================
create or replace function admin_confirm_reservation(p_id uuid, p_memo text default null)
returns table (outcome text, public_code text, enqueued int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if not is_admin() then
    raise exception 'admin_confirm_reservation: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  -- 경합 방어선(0010 그대로). status = 'new' 인 행을 잡은 쪽만 confirmed 를 돌려받는다.
  update reservations set status = 'confirmed', confirmed_at = now(), admin_memo = coalesce(p_memo, admin_memo)
   where id = p_id and status = 'new'
  returning reservations.public_code into v_code;

  if not found then
    return query select 'noop'::text, null::text, 0;
    return;
  end if;

  -- 문자는 넣지 않는다 — 관리자가 [문자 보내기](admin_send_reservation_sms)로 직접 보낸다(OF3-R4).
  return query select 'confirmed'::text, v_code, 0;
end;
$$;

-- =========================================================================
-- 2. notifications_log.body + CHECK 둘
-- =========================================================================
alter table notifications_log add column if not exists body text;

alter table notifications_log drop constraint if exists notifications_log_body_shape_check;
alter table notifications_log drop constraint if exists notifications_log_body_template_check;

-- 모양 — 공백 아닌 글자가 있고(btrim 은 줄바꿈을 걷지 않아 정규식 \S 로 본다) UTF-8 2000바이트 이하(LMS 상한 · lib/notify/consult-text.ts CONSULT_SMS_MAX_BYTES).
alter table notifications_log
  add constraint notifications_log_body_shape_check
    check (body is null or (octet_length(body) <= 2000 and body ~ '\S'));

-- 짝 — 직접 쓴 문자 키에는 본문과 문자 채널이 반드시, 그 밖의 키에는 본문이 없다.
alter table notifications_log
  add constraint notifications_log_body_template_check
    check (
      case when template = 'consult.customer.sms' then body is not null and channel = 'sms'
           else body is null
      end
    );

-- =========================================================================
-- 3. 부분 유니크 — 자동 통지(body 없음)에만. 같은 이름으로 다시 만든다(0005 를 읽는 사람이 같은 인덱스를 찾게).
-- =========================================================================
drop index if exists notifications_log_sent_once;
create unique index notifications_log_sent_once
  on notifications_log (reservation_id, event, channel, template) where status = 'sent' and body is null;

-- =========================================================================
-- 4. admin_send_reservation_sms — 상담완료 문자 한 통을 큐에 넣는다 (관리자 전용)
-- =========================================================================
create or replace function admin_send_reservation_sms(p_id uuid, p_body text)
returns table (outcome text, notification_id bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone     text;
  v_status    text;
  v_confirmed timestamptz;
  v_id        bigint;
begin
  if not is_admin() then
    raise exception 'admin_send_reservation_sms: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;
  -- 본문 — 표 CHECK 와 같은 규칙을 먼저 확인해 23514 가 아니라 "잘못된 인자"(22023)로 돌려준다(앱이 사유를 가른다).
  if p_body is null or p_body !~ '\S' or octet_length(p_body) > 2000 then
    raise exception 'admin_send_reservation_sms: 본문은 비어 있지 않고 UTF-8 2000바이트 이하여야 한다' using errcode = '22023';
  end if;

  -- 받는 번호는 이 예약의 번호다 — 인자로 받지 않는다. 행을 잠가 같은 순간의 상태 전이와 엇갈리지 않게 한다.
  select r.phone, r.status, r.confirmed_at into v_phone, v_status, v_confirmed from reservations r where r.id = p_id
  for share;
  if not found then
    return query select 'noop'::text, null::bigint;
    return;
  end if;
  -- 상담완료(confirmed_at 있음)이고 지금 취소 상태가 아닐 때만 — 상담완료 뒤 취소(0026: confirmed_at 이 남는다)에는 보내지 않는다.
  if v_confirmed is null or v_status not in ('confirmed', 'done') then
    return query select 'not_consulted'::text, null::bigint;
    return;
  end if;

  insert into notifications_log (reservation_id, event, channel, to_phone, template, status, body)
  values (p_id, 'confirmed', 'sms', v_phone, 'consult.customer.sms', 'pending', p_body)
  returning id into v_id;

  return query select 'queued'::text, v_id;
end;
$$;

-- CLAUDE.md §3 — 새 함수는 같은 파일에서 넷(PUBLIC 포함) 모두 회수한 뒤 필요한 롤에만 준다.
revoke all on function admin_send_reservation_sms(uuid, text) from public, anon, authenticated, service_role;
grant execute on function admin_send_reservation_sms(uuid, text) to authenticated;

-- =========================================================================
-- 5. 표 권한 — 공개 롤의 쓰기·RLS 밖 권한을 다시 회수한다(0012·0017·0019 가 이미 했다 — 멱등. 칸이 늘어난 표에 대한 확인을 겸한다).
-- =========================================================================
revoke insert, update, delete, truncate, references, trigger on table notifications_log from public, anon, authenticated;
-- PostgreSQL 17+ 의 MAINTAIN 은 RLS 밖이다(LOCK TABLE·VACUUM·ANALYZE·REINDEX). 16 이하에서는 문법 오류라 조건부 동적 SQL.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then execute 'revoke maintain on table public.notifications_log from public, anon, authenticated';
  end if;
end
$$;

-- =========================================================================
-- 6. 자기검증
--   ① 칸: text · null 허용 · CHECK 둘이 있다
--   ② 칸 권한: anon 은 넷(SELECT·INSERT·UPDATE·REFERENCES) 모두 불가 · authenticated 는 SELECT 만 · PUBLIC(컬럼·표 ACL) 0
--   ③ 표 권한: anon·authenticated·PUBLIC 에 SELECT 밖의 표 권한이 없다(종류는 acldefault + 실제 ACL 에서 열거 — TRUNCATE·MAINTAIN 포함)
--      anon 은 SELECT 도 없다(0017)
--   ④ 함수: admin_send_reservation_sms 의 EXECUTE 보유자 = authenticated 하나(롤마다 + PUBLIC aclexplode) · definer · search_path · 첫 문장 가드
--           admin_confirm_reservation 의 EXECUTE 보유자도 authenticated 하나(create or replace 가 ACL 을 지켰다) · 본문에 notifications_log 가 없다
--   ⑤ 인덱스: notifications_log_sent_once 가 유니크이고 술어에 body is null 이 있다
-- =========================================================================
do $$
declare
  tbl        constant regclass := 'public.notifications_log'::regclass;
  cprivs     constant text[] := array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];
  col        record;
  p          text;
  r          text;
  k          text;
  kinds      text[];
  leaked     text;
  spec       text[];
  fn         regprocedure;
  fn_row     record;
  holders    text;
  idx        text;
begin
  -- ① 칸
  select a.atttypid::regtype::text as typ, a.attnotnull as notnull into col
    from pg_attribute a where a.attrelid = tbl and a.attname = 'body' and not a.attisdropped;
  if col is null then
    raise exception '0028: notifications_log.body 칸이 없다';
  end if;
  if col.typ <> 'text' or col.notnull then
    raise exception '0028: body 의 모양이 기대와 다르다 (형 %, not null %)', col.typ, col.notnull;
  end if;
  if (select count(*) from pg_constraint where conrelid = tbl and contype = 'c'
        and conname in ('notifications_log_body_shape_check', 'notifications_log_body_template_check')) <> 2 then
    raise exception '0028: body 의 CHECK 둘(모양 · 짝)이 다 있지 않다';
  end if;

  -- ② 칸 권한
  foreach p in array cprivs loop
    if has_column_privilege('anon', tbl, 'body', p) then
      raise exception '0028: anon 이 notifications_log.body 에 % 권한을 갖는다', p;
    end if;
    if p <> 'SELECT' and has_column_privilege('authenticated', tbl, 'body', p) then
      raise exception '0028: authenticated 가 notifications_log.body 에 % 권한을 갖는다 — 쓰기 길은 admin_send_reservation_sms 하나뿐이다', p;
    end if;
  end loop;
  if not has_column_privilege('authenticated', tbl, 'body', 'SELECT') then
    raise exception '0028: authenticated 가 body 를 읽지 못한다 — 관리자 상세의 보낸 문자 기록이 이 칸을 읽는다(0009 정책이 is_admin 으로 거른다)';
  end if;
  select string_agg(format('컬럼 %s', lower(x.privilege_type)), ', ') into leaked
    from pg_attribute a cross join lateral aclexplode(a.attacl) x
   where a.attrelid = tbl and a.attname = 'body' and a.attacl is not null and x.grantee = 0;
  if leaked is not null then
    raise exception '0028: notifications_log.body 에 PUBLIC 권한이 있다 — %', leaked;
  end if;

  -- ③ 표 권한 — 종류는 카탈로그에서
  select array_agg(distinct s.p) into kinds from (
    select a.privilege_type as p from pg_class c cross join lateral aclexplode(acldefault('r', c.relowner)) a where c.oid = tbl
    union
    select a.privilege_type from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = tbl
  ) s;
  foreach r in array array['anon', 'authenticated'] loop
    foreach k in array kinds loop
      if (k <> 'SELECT' or r = 'anon')
         and (has_table_privilege(r, tbl, k) or has_table_privilege(r, tbl, k || ' WITH GRANT OPTION')) then
        raise exception '0028: % 가 notifications_log 에 % 권한을 갖는다 (RLS 밖일 수 있다 — TRUNCATE·MAINTAIN 포함)', r, k;
      end if;
    end loop;
  end loop;
  select string_agg(lower(a.privilege_type), ', ') into leaked
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = tbl and a.grantee = 0;
  if leaked is not null then
    raise exception '0028: notifications_log 에 PUBLIC 표 권한이 있다 — %', leaked;
  end if;

  -- ④ 함수 — (서명, 허용 롤 = authenticated)
  foreach spec slice 1 in array array[
    array['public.admin_send_reservation_sms(uuid,text)', 'admin_send_reservation_sms'],
    array['public.admin_confirm_reservation(uuid,text)', 'admin_confirm_reservation']
  ] loop
    fn := to_regprocedure(spec[1]);
    if fn is null then
      raise exception '0028: 함수 % 가 없다', spec[1];
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if (r = 'authenticated') <> has_function_privilege(r, fn, 'EXECUTE') then
        raise exception '0028: % 의 EXECUTE 가 % 에게 % 이다 — 허용은 authenticated 하나뿐이어야 한다', spec[1], r, has_function_privilege(r, fn, 'EXECUTE');
      end if;
    end loop;
    select p2.prosecdef as definer, coalesce(array_to_string(p2.proconfig, ' '), '') as cfg, p2.prosrc as src, p2.proowner as owner, p2.proacl as acl
      into fn_row from pg_proc p2 where p2.oid = fn;
    select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',') into holders
      from aclexplode(coalesce(fn_row.acl, acldefault('f', fn_row.owner))) a
     where a.privilege_type = 'EXECUTE' and a.grantee <> fn_row.owner;
    if holders is distinct from 'authenticated' then
      raise exception '0028: % 의 EXECUTE 보유자가 authenticated 하나가 아니다 (지금 %) — PUBLIC 포함', spec[1], coalesce(holders, '(없음)');
    end if;
    if not fn_row.definer or fn_row.cfg <> 'search_path=public, pg_temp' then
      raise exception '0028: % 이 definer + search_path=public, pg_temp 가 아니다 (definer %, 설정 %)', spec[1], fn_row.definer, fn_row.cfg;
    end if;
    if fn_row.src !~ ('^\s*(declare\s.*?)?begin\s+if not is_admin\(\) then\s+raise exception ''' || spec[2] || ': 관리자 명단에 없는 호출자다''') then
      raise exception '0028: % 의 첫 문장이 is_admin() 가드가 아니다', spec[1];
    end if;
    if spec[2] = 'admin_confirm_reservation' and fn_row.src ~* 'notifications_log' then
      raise exception '0028: admin_confirm_reservation 이 아직 notifications_log 를 건드린다 — 상담완료는 통지를 넣지 않는다';
    end if;
  end loop;

  -- ⑤ 인덱스
  select pg_get_indexdef(i.indexrelid) into idx
    from pg_index i join pg_class ic on ic.oid = i.indexrelid
   where i.indrelid = tbl and ic.relname = 'notifications_log_sent_once' and i.indisunique;
  if idx is null or idx !~* 'WHERE \(\(status = ''sent''::text\) AND \(body IS NULL\)\)' then
    raise exception '0028: notifications_log_sent_once 가 유니크 + (status = sent and body is null) 술어가 아니다 (지금 %)', coalesce(idx, '(없음)');
  end if;
end
$$;

-- PostgREST 스키마 캐시 — 새 함수가 /rpc 에 보이게(원격 db push 용 · 로컬 reset 은 이것 없이도 보인다).
notify pgrst, 'reload schema';
