-- 0021_withdrawal_consent.down.sql — supabase/migrations/0021_withdrawal_consent.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0003~0020 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 psql 로 이 파일을 통째로 실행한 뒤(파일이 begin … commit 을 스스로 쥔다), CLI 이력에서 0021 을 되돌린다:
--
--   supabase migration repair --status reverted 0021
--
-- ## 순서 — **잠금 먼저, 그다음 센다** (R2 · astra P1-6)
-- 첫 판은 기록 수를 잠금 없이 센 뒤 지웠다. 세는 순간과 지우는 순간 사이에 들어온 접수의 동의 기록은 "반출했다" 는 확인 밖에서 사라졌다.
--   1. `set local lock_timeout = '5s'` — 이 파일의 모든 잠금 대기에 상한(아래 lock table · alter table). 넘기면 파일째 롤백.
--   2. 승인 플래그 ① `bestour.rollback_0021_ack` — 조건 없이.
--   3. `lock table public.reservations in exclusive mode` — **쓰기(접수·관리자 확정)를 막고 읽기는 허용**한다. 여기부터 커밋까지 기록 수가 바뀌지 않는다.
--   4. 동의 기록 수를 센다 → 한 건이라도 있으면 승인 플래그 ② `bestour.rollback_0021_evidence_exported` 를 요구.
--   5. 트리거 → 트리거 함수 → 제약 3개 → 칸 2개 제거(0021 의 역순). 칸을 지우는 alter table 은 ACCESS EXCLUSIVE 로 올린다(같은 트랜잭션 —
--      진행 중인 읽기가 끝나기를 lock_timeout 안에서 기다린다).
--   6. 권한 복원 — **0021 이 실제로 회수한 표에만** `service_role` TRIGGER 를 되돌린다(적용 전과 같은 세계로 — 더도 덜도 아니다).
--      회수 목록은 2-b 에서 트리거 함수 주석을 읽어 `set local bestour.rollback_0021_revoked` 에 담는다. 기록이 없으면 사람이
--      `set bestour.rollback_0021_restore_trigger = 'reservations,notifications_log' | 'none'` 으로 적용 직전 스냅샷의 사실을 넘긴다.
--
-- ## 승인 플래그 — 판단과 근거
-- 0015~0020 롤백의 기준을 그대로 쓴다: **"실행이 안전한가" 가 아니라 "실행한 뒤의 세계가 조용히 위험한가".**
--   · 칸을 지우면 그 안의 **청약철회 제한 확인 기록이 되돌릴 수 없게 사라진다.** 그것은 취소·환불 분쟁에서 "고객이 제한을 확인하고
--     접수했다" 는 사업자 측의 유일한 행 단위 증거다(전자상거래법 §17⑥ 고지의 입증 — 0003 의 개인정보 동의 기록과 같은 성격).
--   · 되돌린 세계에서는 **새 접수가 확인 기록 없이도 저장된다** — 오류도 로그도 화면 변화도 없다(제약이 사라지므로).
--   · 그리고 이 롤백은 **앱 코드와 짝**이다: 코드는 insert 에 withdrawal_consent_at 을 싣고 관리자 상세는 두 칸을 읽는다. 칸만 지우면
--     모든 접수가 PGRST204(칸 없음)로 실패하고 관리자 상세가 42703 으로 죽는다 — **앱을 0021 이전 코드로 먼저 되돌린 뒤** 이 파일을 돌린다.
-- 그래서 두 단계로 막는다.
--   ① `bestour.rollback_0021_ack = '1'` — **조건 없이** 먼저 요구한다(행이 0 이어도 — 제약이 사라진 세계가 조용히 위험하기 때문이다).
--   ② 확인 기록이 한 건이라도 있으면 `bestour.rollback_0021_evidence_exported = '1'` 을 **추가로** 요구한다 — 먼저 내보냈다는 사람의 확인이다.
--      내보내기 질의(읽기 — 이 파일을 돌리기 **전에** 따로 실행한다):
--        select id, public_code, created_at, withdrawal_consent_at, withdrawal_consent_legacy from public.reservations
--         where withdrawal_consent_at is not null order by created_at;
--      내보낸 파일은 파기 정책(lib/retention/purge.ts — 확정건 5년)과 같은 기간 보관한다.
--      반출과 이 파일 사이에 접수가 더 들어왔을 수 있다 — 3번 잠금 뒤의 수가 반출 건수와 다르면 멈추고 다시 내보낸다(아래 hint 가 수를 보여 준다).
-- 롤백 뒤 0021 을 다시 적용하면 **그 순간의 모든 행이 legacy** 가 된다 — 그 사이 접수는 "기록 없음(도입 전)" 으로 남는다(되살릴 수 없다).
--
--   set bestour.rollback_0021_ack = '1';
--   set bestour.rollback_0021_evidence_exported = '1';   -- 확인 기록이 있을 때만, 내보낸 뒤
--   \i supabase/rollbacks/0021_withdrawal_consent.down.sql
--
-- 재실행 가능(idempotent): `drop … if exists` 뿐이다. 플래그 검사는 매번 먼저 돈다.

begin;
set local lock_timeout = '5s';

-- =========================================================================
-- 0. 안전장치 — ① 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (근거는 헤더)
-- =========================================================================
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0021 롤백 중단: lock_timeout 이 5s 가 아니다(지금 %) — 이 파일을 트랜잭션 밖에서 문장별로 돌리는 경로다', current_setting('lock_timeout');
  end if;
  if coalesce(current_setting('bestour.rollback_0021_ack', true), '') <> '1' then
    raise exception '0021 롤백 중단: 청약철회 제한 확인 칸과 "새 접수는 기록 필수" 제약을 지우려 한다 — 확인 기록은 되돌릴 수 없게 사라지고, 이후 접수는 기록 없이도 조용히 저장된다'
      using hint = '앱을 0021 이전 코드로 먼저 되돌렸는지 확인할 것(칸만 지우면 모든 접수가 PGRST204 로 실패한다). 되돌릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0021_ack = ''1'';` 을 실행한 뒤 다시 돌린다.';
  end if;
end
$$;

-- =========================================================================
-- 1. 쓰기 잠금 — 여기부터 커밋까지 접수·관리자 확정이 기다린다(읽기는 계속된다). 대기 상한은 위 lock_timeout.
-- =========================================================================
lock table public.reservations in exclusive mode;

-- =========================================================================
-- 2. 안전장치 — ② 잠금을 쥔 뒤에 센다. 확인 기록이 있으면 내보냈다는 확인을 한 번 더 요구한다
-- =========================================================================
do $$
declare
  n bigint := 0;
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.reservations'::regclass and attname = 'withdrawal_consent_at' and not attisdropped) then
    execute 'select count(*) from public.reservations where withdrawal_consent_at is not null' into n;
  end if;
  if n > 0 and coalesce(current_setting('bestour.rollback_0021_evidence_exported', true), '') <> '1' then
    raise exception '0021 롤백 중단: 청약철회 제한 확인 기록 % 건이 있다(쓰기 잠금 뒤에 센 수) — 칸을 지우면 되돌릴 수 없다. 먼저 내보낼 것', n
      using hint = 'select id, public_code, created_at, withdrawal_consent_at, withdrawal_consent_legacy from public.reservations where withdrawal_consent_at is not null order by created_at; 의 결과를 보관한 뒤(건수가 이 수와 같은지 확인) 같은 세션에서 `set bestour.rollback_0021_evidence_exported = ''1'';` 을 실행하고 다시 돌린다.';
  end if;
  raise notice '0021 롤백: 쓰기 잠금 뒤 확인 기록 % 건 — 제거를 진행한다', n;
end
$$;

-- =========================================================================
-- 2-b. 되돌릴 권한을 **먼저 읽는다** (R4 [P2-F]) — 0021 이 실제로 회수한 표 목록은 트리거 함수 주석에 적혀 있다.
--      함수를 지우면 그 기록도 사라지므로 여기서 읽어 트랜잭션 지역 설정(`set local`)에 담아 둔다.
--      기록을 찾지 못하면(함수가 이미 없거나 주석이 다르면) 사람이 적용 직전 스냅샷을 보고 값을 넘겨야 한다 — 0018 롤백의 "기준선 복원" 규범과 같다.
-- =========================================================================
do $$
declare
  cmt  text;
  lst  text;
  hint text;
begin
  select obj_description(to_regprocedure('public.reservations_withdrawal_legacy_guard()'), 'pg_proc') into cmt;
  lst := substring(coalesce(cmt, '') from '회수한 TRIGGER: service_role@([a-z_,]*)');
  -- 재실행(이미 되돌린 DB): 칸도 함수도 없다 — 되돌릴 것이 없으므로 아무것도 요구하지 않고 아무 권한도 만들지 않는다.
  --   (권한 복원은 첫 실행이 이미 했다. 여기서 다시 부여하면 그 사이 사람이 좁혀 둔 권한을 되살릴 수 있다.)
  if lst is null
     and not exists (select 1 from pg_attribute where attrelid = 'public.reservations'::regclass
                      and attname in ('withdrawal_consent_at', 'withdrawal_consent_legacy') and not attisdropped) then
    raise notice '0021 롤백: 되돌릴 것이 없다(칸·함수 모두 없음) — 권한도 건드리지 않는다';
    perform set_config('bestour.rollback_0021_revoked', '', true);
    return;
  end if;
  if lst is null then
    hint := coalesce(current_setting('bestour.rollback_0021_restore_trigger', true), '');
    if hint = '' then
      raise exception '0021 롤백 중단: 0021 이 회수한 TRIGGER 목록을 찾지 못했다 (함수 주석 없음 — 함수가 이미 지워졌거나 다른 판이 적용됐다)'
        using hint = '적용 직전 ACL 스냅샷에서 reservations·notifications_log 의 service_role TRIGGER 가 **있었는지** 확인한 뒤 같은 세션에서 `set bestour.rollback_0021_restore_trigger = ''reservations,notifications_log'';`(있었다) 또는 `''none''`(없었다)을 실행하고 다시 돌린다. 확인 없이 부여하면 원래 없던 권한을 새로 만든다.';
    end if;
    lst := case when hint = 'none' then '' else hint end;
  end if;
  perform set_config('bestour.rollback_0021_revoked', lst, true);
  raise notice '0021 롤백: 되돌릴 TRIGGER 목록 = [%]', case when lst = '' then '(없음 — 아무 권한도 만들지 않는다)' else lst end;
end
$$;

-- =========================================================================
-- 3. 트리거 → 트리거 함수 (legacy 칸을 지우기 전에 — 트리거 함수가 그 칸을 본다)
-- =========================================================================
drop trigger if exists reservations_withdrawal_legacy_guard on public.reservations;
drop function if exists public.reservations_withdrawal_legacy_guard();

-- =========================================================================
-- 4. 제약 제거
-- =========================================================================
alter table public.reservations
  drop constraint if exists reservations_withdrawal_consent_required,
  drop constraint if exists reservations_withdrawal_consent_before_created,
  drop constraint if exists reservations_withdrawal_consent_not_stale;

-- =========================================================================
-- 5. 칸 제거 (주석도 함께)
-- =========================================================================
alter table public.reservations
  drop column if exists withdrawal_consent_at,
  drop column if exists withdrawal_consent_legacy;

-- =========================================================================
-- 6. 권한 복원 — **0021 이 실제로 회수한 표에만** TRIGGER 를 되돌린다 (R3 [P1-A] · R4 [P2-F])
--    되돌린 세계는 0021 적용 **전과 같아야** 한다(ACL 스냅샷 md5 동일) — 더도 덜도 아니다.
--    목록이 비어 있으면(그 부여가 처음부터 없던 DB) **아무 권한도 만들지 않는다** — 무조건 grant 하면 권한 확대다.
--    ⚠️ 되돌리면 `create or replace trigger` 로 가드를 갈아끼울 수 있는 상태로 함께 돌아간다 — known-defects D11.
-- =========================================================================
do $$
declare
  lst   text := coalesce(current_setting('bestour.rollback_0021_revoked', true), '');
  tbls  text;
begin
  if lst = '' then
    raise notice '0021 롤백: 되돌릴 TRIGGER 없음 — 권한을 만들지 않는다';
    return;
  end if;
  select string_agg(format('public.%I', t), ', ') into tbls from unnest(string_to_array(lst, ',')) as t;
  execute format('grant trigger on table %s to service_role', tbls);
  raise notice '0021 롤백: TRIGGER 복원 — %', tbls;
end
$$;

commit;
