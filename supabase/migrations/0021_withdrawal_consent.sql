-- 0021_withdrawal_consent.sql — 예약에 청약철회 제한 확인 시각 칸 + **동의 기록 도입 뒤의 모든 행**에 필수로 강제
--                               (플랜 v4 P1-7 · 수정 라운드 2 · 사장님 답변 2026-09-21 A-2 · 전자상거래법 §17)
--
-- ## 왜
-- 위저드 6단계에 청약철회 제한 고지(원장 lib/legal/disclosures.ts WITHDRAWAL.notice)와 필수 체크박스가 생겼다.
-- 고지·확인 사실의 입증책임은 사업자에게 있다. 0003 이 개인정보 동의 시각을 행마다 남긴 것과 같은 이유로
-- 청약철회 제한을 확인한 시각을 행마다 남기고, **값 없는 새 접수는 코드 경로가 아니라 DB 제약이 막는다**
-- (앱은 zod `withdrawalConsent: z.literal(true)` 로 먼저 거부하고, lib/reservations/consent.ts 가 서버 시각을 찍는다).
--
-- ## 설계 — **시각에 기대지 않는다** (R2 · astra P1-3 반영)
-- 요구: (a) 이 파일 뒤의 새 접수는 값이 반드시 있다.
--       (b) 기존 행은 값이 없다 — 소급해 채우면 받은 적 없는 확인의 **허위 기록**이다(0003 헤더와 같은 원칙).
--       (c) 기존 행의 UPDATE(관리자 확정·취소·완료·메모 — 0010 definer 함수)가 막히면 안 된다.
-- 첫 판(적용 시각 기준 CHECK `… or created_at < '<적용 시각>'`)은 버렸다. `created_at default now()` 는 **트랜잭션 시작 시각**이라
-- 적용 전에 시작한 트랜잭션이 적용 뒤에 동의 없이 넣을 수 있었고, created_at 을 과거로 넣으면 통째로 우회됐으며,
-- 시계가 되돌려지면 새 행이 "옛 행" 으로 분류됐다. 자기검증도 created_at 을 명시해 넣어 기본값 경로의 반례를 놓쳤다.
-- 이 판은 **행이 스스로 "동의 기록 도입 전 행" 인지 표시**하게 한다:
--   · `withdrawal_consent_legacy boolean not null` — **이 파일이 표를 쥔 순간에 있던 행만 true**, 그 뒤 들어오는 행은 기본값 false.
--       구현: `add column … not null default true`(기존 행은 빠른 기본값으로 true — 행을 다시 쓰지도, 행 UPDATE 트리거를 태우지도 않는다)
--       → 같은 트랜잭션에서 `set default false`. add column 이 ACCESS EXCLUSIVE 를 쥔 채이므로 그 사이에 들어오는 행은 없다.
--       잠금을 기다리던 접수(적용 전에 시작한 트랜잭션)도 커밋 뒤에 들어오므로 기본값 false 를 받는다 — 시각이 아니라 순서로 정해진다.
--   · CHECK (VALID) `withdrawal_consent_at is not null or withdrawal_consent_legacy` — 새 행은 값이 없으면 23514.
--       created_at 을 무엇으로 넣든(과거·기본값) 상관없다. 새 행의 값을 null 로 지우는 UPDATE 도 23514(증거가 지워지지 않는다).
--   · legacy 는 **적용 때 한 번만 정해진다** — 트리거 reservations_withdrawal_legacy_guard(before insert or update · 행 단위)가
--       ① 새 행을 legacy=true 로 넣는 것 ② false→true ③ true→false 를 전부 거부한다(23000 integrity_constraint_violation).
--       ①이 없으면 "legacy=true 로 넣기" 가 CHECK 를 비켜 가는 새 우회로가 된다(서비스 롤은 표 단위 insert 가 있다).
--       legacy 행의 다른 칸 UPDATE(상태·확정 시각·메모)는 legacy 값이 그대로라 통과한다 — (c).
-- 버린 대안: `NOT NULL`(기존 행 때문에 불가 · 채우면 허위) · `NOT VALID` CHECK(기존 행 UPDATE 때 새 튜플에 검사되어 관리자 확정이 23514) ·
--   적용 시각 기준 CHECK(위 — 시각 우회).
--
-- 동의 시각 범위 — 0003 과 같은 폭: 접수 시각 +5분 이내 · -1일 이후. null 은 두 CHECK 를 통과한다(값이 있을 때만 범위를 본다).
--
-- ## 가드를 갈아끼우는 길을 닫는다 (R3 [P1-A] · astra R2 재현)
-- `create or replace trigger` 는 표의 **TRIGGER 권한**과 교체할 함수의 EXECUTE 만 요구한다. 0017 은 anon·authenticated 에서만
-- TRIGGER 를 회수했고 `service_role` 에는 남겨 뒀다 — 그래서 SQL 을 칠 수 있는 service_role 이 한 줄로 이 가드를 무해한 내장 함수로
-- 바꾼 뒤 `legacy=true · 동의 시각 null` 행을 넣을 수 있었다(CHECK 는 legacy 예외로 통과한다). 이 파일이 **두 표의 TRIGGER 를
-- service_role 에서도 회수**한다(③-c). **실제로 회수한 표는 트리거 함수 주석에 기록**되고, 롤백은 그 목록만 되돌린다
-- (R4 [P2-F] — 이미 그 부여가 없던 DB 에서 되돌릴 때 없던 권한을 만들지 않게).
--
-- ## 이 파일이 증명하는 것과 증명하지 못하는 것 (R4 [P2-C] — 주장을 검사 범위에 맞춘다)
-- 자기검증 ⑤-tp 가 보는 것:
--   · **직접 부여**(relacl 전수 · `aclexplode`): 두 표에 소유자 아닌 grantee 의 TRIGGER 항목이 0(PUBLIC 포함).
--   · **유효 권한**(`has_table_privilege` · `pg_roles` **전수**): **소유자·소유자 롤의 멤버·슈퍼유저를 뺀 모든 롤**에 유효 TRIGGER 0.
--     (검사 밖에 있는 롤 이름은 적용 NOTICE 에 그대로 찍힌다 — 로컬 실측에서는 `postgres`(소유자) 와 `supabase_admin`(슈퍼유저)뿐이다.)
--   · **`session_replication_role` 부여 0**(`pg_parameter_acl`): 그 SET 권한을 가진 롤은 `replica` 로 이 트리거를 **통째로 끌** 수 있다.
--     그것은 소유자·슈퍼유저 전용 권한이 아니다 — PostgreSQL 15+ 에서 부여할 수 있다(지금은 아무에게도 부여돼 있지 않다).
-- ⚠️ 증명하지 못하는 것(**남는 우회**): 표 소유자·소유자 롤의 멤버·슈퍼유저의 DDL. 그들은 트리거를 갈아끼우거나 지우고,
-- `alter table … disable trigger` 를 걸고, 제약 자체도 지울 수 있다 — DB 안에서 막을 수단이 없다. 접근 통제와 감사
-- (적용 전/후 확인 질의 · runbook 0017 행렬 ⑦)로 다룬다. `docs/ops/known-defects.md` D11.
--
-- ## 권한 — 늘리지 않는다
-- 칸 추가는 칸 ACL(pg_attribute.attacl)을 만들지 않는다 — 기본 권한(pg_default_acl, CLAUDE.md §3)은 **새 객체(표·시퀀스·함수)**에만
-- 걸린다. 새 칸은 표 단위 권한을 그대로 따른다(anon 0 · authenticated SELECT 만 · service_role 접수).
-- 트리거 함수는 새 객체라 기본 권한이 anon·authenticated·service_role 에 EXECUTE 를 연다 — **같은 트랜잭션에서 전부 회수**한다
-- (0015 와 같다: 트리거 발화에는 EXECUTE 가 필요 없다. 아무도 이 함수를 직접 부르지 않는다). 함수는 invoker(security definer 아님) —
-- 표를 읽지도 쓰지도 않고 NEW/OLD 만 본다.
-- 자기검증 ④ 가 public 전 표·시퀀스·칸 ACL 을 적용 전후로 대조하고, ⑤ 가 새 칸의 유효 권한을 옆 칸(privacy_consent_at)과 **카탈로그로**
-- 대조한다(권한 종류는 acldefault 에서 얻는다 — 하드코딩 0).
--
-- ## 자기검증은 실제 표에 문장을 치지 않는다 (R2 · astra P2-8 · P5-15 규칙)
-- 첫 판은 공개 롤로 전환해 실제 표에 `select … limit 0`·`update … where false` 를 쳤다. 그 문장들은 **권한 검사보다 잠금을 먼저** 잡는다.
-- 이 판은 롤 전환·잠금·실제 표 insert/update 가 0 이다: 권한은 카탈로그(has_column_privilege·has_function_privilege)로, 거동은
-- **일회용 LIKE 복제본**(pg_temp.p0021_probe — CHECK·기본값을 복제하고 트리거는 실제 트리거 정의에서 표 이름만 바꿔 붙인다)으로 친다.
--
-- 기존 행 영향: 값 변경 0(동의 시각 null · legacy true — 빠른 기본값). 표 재작성 0. 제약 추가는 기존 행을 한 번 훑는다.
-- 파기(lib/retention/purge.ts)는 행째 지우므로 이 칸들도 함께 사라진다 — 추가 조치 없음.
-- 재실행: 이미 칸이 있으면 ① 에서 멈춘다(두 번 돌면 그 사이 접수까지 legacy 가 된다 — 다시 돌리지 않는다).
-- PostgREST 스키마 캐시: 칸이 생겼으므로 갱신이 필요하다 — 이 DB 의 pgrst_ddl_watch 이벤트 트리거가 NOTIFY 를 낸다(runbook 맨 위 ③).
-- 적용 경로: **`supabase db push` 만**(runbook 맨 위 「적용 경로」 · 0021 절 「환경별 순서」). **`psql -f` 를 쓰지 마라** — 파일이 원자적이지 않다.
--   로컬 검증은 `psql -1`(단일 트랜잭션).
-- ⚠️ 자기검증 ⑥ 은 임시 표를 만든다(CREATE TABLE · CREATE TRIGGER 태그 — 이벤트 트리거가 본다). 적용 롤에 임시 표 권한이 필요하다(기본).
-- 롤백: supabase/rollbacks/0021_withdrawal_consent.down.sql (수동 실행 전용 · 승인 플래그 · 쓰기 잠금 뒤 기록 수 확인 · 반출 플래그).

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0021: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다. 아무것도 바꾸기 전에 멈춘다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나). psql -f 처럼 문장마다 커밋하는 경로에서는 set local 이 그 문장에서 끝난다(PostgreSQL 은 경고만 낸다).';
  end if;
end
$$;

do $$
declare
  fn_sig     constant text := 'public.reservations_withdrawal_legacy_guard()';
  fn_oid     oid;
  trg        record;
  trg_def    text;
  n_before   bigint;
  n          bigint;
  before_acl text[];
  after_acl  text[];
  expected_acl text[];
  revoked_list text := '';
  outside_roles text;
  diff       text;
  leaked     text;
  k          text;
  w          text;
  col        text;
  checked    int := 0;
  st         text;
  ms         text;
  cn         text;
  probe_ok   boolean := false;
  legacy_id  uuid;
  new_id     uuid;
  outcome    text[] := '{}';
begin
  -- ① 이미 적용된 DB 가 아닌가 — 두 번 돌면 그 사이 들어온 접수까지 legacy=true 가 된다(동의 강제에서 빠진다).
  if exists (select 1 from pg_attribute where attrelid = 'public.reservations'::regclass
               and attname in ('withdrawal_consent_at', 'withdrawal_consent_legacy') and not attisdropped) then
    raise exception '0021: public.reservations 에 withdrawal_consent_* 칸이 이미 있다 — 이미 적용된 DB 다. 다시 돌리지 않는다'
      using hint = 'select version from supabase_migrations.schema_migrations order by version desc limit 3; 로 이력을 확인할 것. 이력에 0021 이 없는데 칸이 있으면 누군가 수동으로 만든 것이다 — 컨트롤러에게 보고한다.';
  end if;
  if to_regprocedure(fn_sig) is not null then
    raise exception '0021: 트리거 함수 % 가 이미 있다 — 이전 적용의 잔여물이다. 사람이 확인한 뒤 지우고 다시 돌린다', fn_sig;
  end if;

  -- ④ 의 "적용 전" — public 스키마 모든 표·뷰·시퀀스의 ACL 항목 전부(종류 불문 · aclexplode)와 칸 ACL 전부.
  select coalesce(array_agg(x order by x), '{}') into before_acl from (
    select format('%s|%s|%s|%s|%s', c.relname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable) as x
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where ns.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    union all
    select format('%s.%s|%s|%s|%s|%s', c.relname, at.attname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable)
      from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace ns on ns.oid = c.relnamespace
      cross join lateral aclexplode(at.attacl) a
     where ns.nspname = 'public' and at.attacl is not null
  ) s;

  -- ② 칸 둘 — 이 문장이 reservations 에 ACCESS EXCLUSIVE 를 잡는다(진행 중인 접수가 끝날 때까지 최대 lock_timeout 5초).
  --    여기부터 커밋까지 새 접수는 들어오지 않는다. legacy 는 기본값 true 로 붙여 **지금 있는 행 전부**를 true 로 만든다(빠른 기본값 —
  --    행을 다시 쓰지 않고 UPDATE 트리거도 태우지 않는다). 곧바로 기본값을 false 로 바꿔 이후 행은 false 로 들어오게 한다.
  alter table public.reservations
    add column withdrawal_consent_at timestamptz,
    add column withdrawal_consent_legacy boolean not null default true;
  alter table public.reservations alter column withdrawal_consent_legacy set default false;

  select count(*) into n_before from public.reservations;
  select count(*) into n from public.reservations where not withdrawal_consent_legacy;
  if n > 0 then
    raise exception '0021: 적용 순간의 행 % 건이 legacy=true 가 아니다 — 빠른 기본값이 적용되지 않았다', n;
  end if;

  -- ③ 제약 3개
  alter table public.reservations
    add constraint reservations_withdrawal_consent_required check (withdrawal_consent_at is not null or withdrawal_consent_legacy),
    add constraint reservations_withdrawal_consent_before_created check (withdrawal_consent_at <= created_at + interval '5 minutes'),
    add constraint reservations_withdrawal_consent_not_stale check (withdrawal_consent_at >= created_at - interval '1 day');

  -- ③-b legacy 는 적용 때 한 번만 정해진다 — 트리거(행 단위 · before insert or update). invoker · 표를 읽거나 쓰지 않는다.
  create function public.reservations_withdrawal_legacy_guard()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
  as $fn$
  begin
    if tg_op = 'INSERT' then
      if new.withdrawal_consent_legacy then
        raise exception 'reservations_withdrawal_legacy_guard: 새 접수는 withdrawal_consent_legacy = true 로 넣을 수 없다 — legacy 는 0021 적용 순간의 행에만 있다'
          using errcode = 'integrity_constraint_violation';
      end if;
    elsif new.withdrawal_consent_legacy is distinct from old.withdrawal_consent_legacy then
      raise exception 'reservations_withdrawal_legacy_guard: withdrawal_consent_legacy 는 바꿀 수 없다 (% → %)', old.withdrawal_consent_legacy, new.withdrawal_consent_legacy
        using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end
  $fn$;
  create trigger reservations_withdrawal_legacy_guard
    before insert or update on public.reservations
    for each row execute function public.reservations_withdrawal_legacy_guard();
  -- 기본 권한이 연 EXECUTE 를 같은 트랜잭션에서 전부 회수한다(CLAUDE.md §3 — service_role 까지). 트리거 발화에는 EXECUTE 가 필요 없다.
  revoke all on function public.reservations_withdrawal_legacy_guard() from public, anon, authenticated, service_role;

  -- ③-c 표의 TRIGGER 권한 회수 (R3 [P1-A] · astra R2 재현) — **가드를 갈아끼우는 길을 닫는다.**
  --   `create or replace trigger` 는 표의 TRIGGER 권한 + 교체할 함수의 EXECUTE 만 요구한다(0017 헤더의 실측과 같은 규칙).
  --   0017 은 anon·authenticated 에서만 회수했고 service_role 에는 남겨 뒀다. 그러면 SQL 을 칠 수 있는 service_role 이
  --     create or replace trigger reservations_withdrawal_legacy_guard before update on public.reservations
  --       for each row execute function pg_catalog.suppress_redundant_updates_trigger();
  --   한 줄로 가드를 무해한 내장 함수로 바꾼 뒤 `legacy=true · 동의 시각 null` 행을 넣을 수 있다(CHECK 는 legacy 예외로 통과).
  --   앱은 트리거를 만들지 않는다 — 접수(insert)·관리자 확정(definer 함수)·파기(delete)는 TRIGGER 권한을 쓰지 않는다.
  --   notifications_log 도 같이 회수한다: 같은 수법으로 발송 큐에 트리거를 붙이면 고객 연락처가 외부로 나갈 수 있고(0017 이 anon·authenticated 에서
  --   회수한 바로 그 이유), 앱의 쓰기 경로는 여기서도 트리거를 쓰지 않는다.
  --   ⚠️ **실제로 회수한 표만 기록한다** (R4 [P2-F] astra): 이미 굳혀 둔 DB(그 부여가 처음부터 없는 DB)에 적용했다가 되돌릴 때,
  --   롤백이 무조건 grant 하면 **원래 없던 권한을 새로 만든다.** 아래 목록을 트리거 함수 주석에 적어 두고 롤백이 그것만 되돌린다.
  select coalesce(string_agg(c.relname, ',' order by c.relname), '') into revoked_list
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where ns.nspname = 'public' and c.relname in ('reservations', 'notifications_log')
     and a.privilege_type = 'TRIGGER' and a.grantee = 'service_role'::regrole;
  revoke trigger on table public.reservations, public.notifications_log from service_role;

  -- 롤백이 읽는 기록(R4 [P2-F]) — 함수와 함께 살고 함께 사라진다. 롤백은 함수를 지우기 **전에** 이 주석을 읽는다.
  execute format(
    'comment on function public.reservations_withdrawal_legacy_guard() is %L',
    '0021 청약철회 legacy 가드(invoker · 표를 읽거나 쓰지 않는다). 이 파일이 회수한 TRIGGER: service_role@' || revoked_list ||
    ' (롤백은 이 목록만 되돌린다 — 빈 목록이면 아무 권한도 만들지 않는다)');

  comment on column public.reservations.withdrawal_consent_at is
    '청약철회 제한 확인 시각(서버 수신 인스턴트 — lib/reservations/consent.ts). legacy 가 아닌 행은 필수(reservations_withdrawal_consent_required · 0021).';
  comment on column public.reservations.withdrawal_consent_legacy is
    '0021 적용 순간에 이미 있던 접수(동의 기록 도입 전)면 true. 적용 때 한 번만 정해지고 트리거(reservations_withdrawal_legacy_guard)가 바꾸지 못하게 한다.';

  -- ⑤-a 카탈로그 — 칸 모양 · 제약 상태 · 소급 채움 0.
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.reservations'::regclass and a.attname = 'withdrawal_consent_at'
       and not a.attnotnull and not a.atthasdef and a.atttypid = 'timestamptz'::regtype and a.attacl is null) then
    raise exception '0021: withdrawal_consent_at 의 모양이 설계와 다르다 (nullable · 기본값 없음 · timestamptz · 칸 ACL 없음이어야 한다)';
  end if;
  if not exists (
    select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.reservations'::regclass and a.attname = 'withdrawal_consent_legacy'
       and a.attnotnull and a.atttypid = 'boolean'::regtype and a.attacl is null and pg_get_expr(d.adbin, d.adrelid) = 'false') then
    raise exception '0021: withdrawal_consent_legacy 의 모양이 설계와 다르다 (not null · boolean · 기본값 false · 칸 ACL 없음이어야 한다)';
  end if;
  select string_agg(format('%s:%s', t.conname, coalesce(c.convalidated::text, 'MISSING')), ', ' order by t.conname)
    into leaked
    from (values ('reservations_withdrawal_consent_required'), ('reservations_withdrawal_consent_before_created'), ('reservations_withdrawal_consent_not_stale')) t(conname)
    left join pg_constraint c on c.conrelid = 'public.reservations'::regclass and c.conname = t.conname and c.contype = 'c'
   where c.oid is null or not c.convalidated;
  if leaked is not null then
    raise exception '0021: 제약이 없거나 검증되지 않은(convalidated = false) 상태다 — %', leaked
      using hint = '검증을 미룬 CHECK 도 기존 행의 UPDATE 에서는 검사된다. legacy 예외를 담은 VALID 제약이어야 한다.';
  end if;
  select count(*) into n from public.reservations where withdrawal_consent_at is not null;
  if n > 0 then
    raise exception '0021: 기존 행에 청약철회 제한 확인 시각이 % 건 채워졌다 — 소급 기록은 허위다', n;
  end if;

  -- ⑤-t 트리거 — 붙었는가 · before · row · insert+update · 켜짐 · 우리 함수 · 함수는 invoker · EXECUTE 는 아무 공개 롤에도 없다.
  fn_oid := to_regprocedure(fn_sig)::oid;
  select t.tgname, t.tgtype, t.tgenabled, t.tgfoid, t.tgqual into trg
    from pg_trigger t
   where t.tgrelid = 'public.reservations'::regclass and not t.tgisinternal and t.tgname = 'reservations_withdrawal_legacy_guard';
  if not found then
    raise exception '0021: reservations 에 legacy 가드 트리거가 붙지 않았다 — 새 행을 legacy=true 로 넣어 CHECK 를 비켜 갈 수 있다';
  end if;
  -- tgtype 비트: 1 = row, 2 = before, 4 = insert, 16 = update (pg_trigger 의 TRIGGER_TYPE_* 상수)
  if trg.tgfoid <> fn_oid or (trg.tgtype & 1) = 0 or (trg.tgtype & 2) = 0 or (trg.tgtype & 4) = 0 or (trg.tgtype & 16) = 0 or trg.tgenabled <> 'O' then
    raise exception '0021: legacy 가드 트리거의 모양이 설계와 다르다 (함수=% · tgtype=% · enabled=%)', trg.tgfoid::regprocedure, trg.tgtype, trg.tgenabled;
  end if;
  -- R3 [P2-E] — WHEN 조건이 붙으면 한 행도 발화하지 않을 수 있다(`when (false)`). 조건 없는 트리거여야 한다.
  if trg.tgqual is not null then
    raise exception '0021: legacy 가드 트리거에 WHEN 조건이 붙어 있다 (%) — 조건부 트리거는 발화하지 않을 수 있다',
      pg_get_expr(trg.tgqual, 'public.reservations'::regclass);
  end if;
  if (select prosecdef from pg_proc where oid = fn_oid) then
    raise exception '0021: 트리거 함수의 prosecdef 가 true 다 — invoker 여야 한다(표를 읽거나 쓰지 않으므로 소유자 권한이 필요 없다)';
  end if;
  select string_agg(w2.role, ', ') into leaked
    from (values ('anon'), ('authenticated'), ('service_role')) w2(role)
   where has_function_privilege(w2.role, fn_oid, 'EXECUTE');
  if leaked is not null then
    raise exception '0021: 트리거 함수의 EXECUTE 가 남았다 — %', leaked
      using hint = '기본 권한(pg_default_acl)이 새 함수에 anon·authenticated·service_role EXECUTE 를 연다. 같은 트랜잭션의 revoke 목록을 확인할 것.';
  end if;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = fn_oid and a.grantee = 0) then
    raise exception '0021: 트리거 함수의 EXECUTE 가 PUBLIC 에 남았다';
  end if;

  -- ⑤-tp 두 표의 TRIGGER 보유자는 **소유자뿐**이다 (R3 [P1-A]).
  --   권한 종류는 하드코딩하지 않는다 — 이 서버의 표 권한 종류를 acldefault 에서 얻고, 그중 TRIGGER 가 있는지부터 본다
  --   (CLAUDE.md §3: PostgreSQL 이 MAINTAIN 을 더했을 때 목록을 박아 둔 게이트가 볼 수단이 없었다).
  if not exists (
    select 1 from aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.reservations'::regclass))) d
     where d.privilege_type = 'TRIGGER') then
    raise exception '0021: 이 서버의 표 권한 종류에 TRIGGER 가 없다 — 회수 검사의 전제가 깨졌다';
  end if;
  select string_agg(format('%s/%s', c.relname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end), ' ' order by c.relname)
    into leaked
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where ns.nspname = 'public' and c.relname in ('reservations', 'notifications_log')
     and a.privilege_type = 'TRIGGER' and a.grantee is distinct from c.relowner;
  if leaked is not null then
    raise exception '0021: 개인정보 두 표의 TRIGGER 를 소유자 말고 다른 롤이 갖고 있다 — %', leaked
      using hint = 'TRIGGER 가 있으면 create or replace trigger 로 청약철회 가드를 갈아끼울 수 있다(astra R2). 이 파일의 revoke 목록을 볼 것.';
  end if;
  -- 유효 권한(상속 포함)으로 **롤 전수**를 본다 (R4 [P2-C] astra: 셋만 보면 소유자를 상속하는 롤·`set role` 로 소유자가 될 수 있는 롤·
  --   소유자가 아닌 슈퍼유저가 빠진다). 검사 대상에서 빼는 것은 **소유자와 사실상 소유자**(소유자 롤의 멤버)와 **슈퍼유저**뿐이다 —
  --   그들은 TRIGGER 권한과 무관하게 DDL 로 트리거를 지우거나 갈아끼울 수 있어, DB 안에서 막을 수단이 없다(known-defects D11).
  select string_agg(format('%s/%s', t.tbl, r.rolname), ' ' order by t.tbl, r.rolname) into leaked
    from pg_roles r
    cross join (values ('public.reservations'), ('public.notifications_log')) t(tbl)
   where not r.rolsuper
     and not pg_has_role(r.oid, (select c.relowner from pg_class c where c.oid = t.tbl::regclass), 'USAGE')
     and has_table_privilege(r.oid, t.tbl::regclass, 'TRIGGER');
  if leaked is not null then
    raise exception '0021: 소유자도 슈퍼유저도 아닌 롤에 두 표의 유효 TRIGGER 권한이 남았다 — %', leaked
      using hint = '상속(롤 멤버십)으로 들어온 권한일 수 있다. pg_auth_members 로 누가 그 롤의 멤버인지 볼 것.';
  end if;
  -- 검사 밖에 있는 롤이 누구인지 이름으로 남긴다 — "소유자만" 이라는 주장을 실제 검사 범위에 맞춰 좁혀 읽게.
  select string_agg(r.rolname, ', ' order by r.rolname) into outside_roles
    from pg_roles r
   where r.rolsuper
      or pg_has_role(r.oid, (select c.relowner from pg_class c where c.oid = 'public.reservations'::regclass), 'USAGE');

  -- ⑤-tp2 `session_replication_role` 에 SET 권한이 부여돼 있으면 멈춘다 (R4 [P2-C] astra).
  --   그 권한을 가진 롤은 `set session_replication_role = replica` 로 **이 트리거를 통째로 끄고** legacy=true 행을 넣을 수 있다.
  --   PostgreSQL 15+ 의 pg_parameter_acl 에만 행이 생긴다(부여가 하나도 없으면 행 자체가 없다). 15 미만에서는 그 권한 자체가 없다.
  if to_regclass('pg_catalog.pg_parameter_acl') is not null then
    --   소유자·소유자 롤의 멤버·슈퍼유저는 여기서도 검사 밖이다(위와 같은 이유 — 그들은 DDL 로 무엇이든 한다).
    --   그래서 `postgres`(소유자)·`supabase_admin`(슈퍼유저)에게 붙어 있는 기본 항목은 멈춤 사유가 아니다.
    execute $q$
      select string_agg(format('%s(%s)', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type), ' ')
        from pg_parameter_acl p cross join lateral aclexplode(p.paracl) a
       where p.parname = 'session_replication_role'
         and (a.grantee = 0
              or not exists (select 1 from pg_roles r
                              where r.oid = a.grantee
                                and (r.rolsuper
                                     or pg_has_role(r.oid, (select c.relowner from pg_class c where c.oid = 'public.reservations'::regclass), 'USAGE'))))
    $q$ into leaked;
    if leaked is not null then
      raise exception '0021: session_replication_role 에 SET 권한이 부여돼 있다 — % — 그 롤은 replica 로 이 가드를 통째로 끌 수 있다', leaked
        using hint = '부여를 회수하거나(권장), 감수한다면 known-defects 에 기록하고 이 검사를 그 롤만 예외로 좁힐 것.';
    end if;
  end if;

  -- ④ ACL 은 **의도한 두 항목만** 바뀐다 — service_role 의 두 표 TRIGGER 회수(③-c). 그 밖에는 적용 전과 같아야 한다.
  select coalesce(array_agg(x order by x), '{}') into after_acl from (
    select format('%s|%s|%s|%s|%s', c.relname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable) as x
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where ns.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    union all
    select format('%s.%s|%s|%s|%s|%s', c.relname, at.attname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable)
      from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace ns on ns.oid = c.relnamespace
      cross join lateral aclexplode(at.attacl) a
     where ns.nspname = 'public' and at.attacl is not null
  ) s;
  -- 기대값 = 적용 전 집합에서 **실제로 회수한 표**의 service_role TRIGGER 항목만 뺀 것(회수한 것이 없으면 그대로).
  select coalesce(array_agg(x order by x), '{}') into expected_acl
    from unnest(before_acl) as u(x)
   where not (split_part(u.x, '|', 1) = any (string_to_array(revoked_list, ','))
              and split_part(u.x, '|', 2) = 'service_role' and split_part(u.x, '|', 4) = 'TRIGGER');
  if after_acl is distinct from expected_acl then
    select string_agg(x, ', ') into diff from (
      (select '-' || unnest(expected_acl) except select '-' || unnest(after_acl))
      union all
      (select '+' || unnest(after_acl) except select '+' || unnest(expected_acl))
    ) d(x);
    raise exception '0021: 의도한 것 말고 다른 권한이 바뀌었다 — %', diff
      using hint = '이 파일의 권한 문장은 둘뿐이다: 트리거 함수 EXECUTE 회수 · 두 표의 service_role TRIGGER 회수. 이벤트 트리거나 다른 세션이 권한을 바꿨는지 볼 것.';
  end if;

  -- ⑤-b 새 칸 둘의 유효 권한 = 옆 칸(privacy_consent_at)의 유효 권한 — **카탈로그로만** 본다(실제 표에 문장을 치지 않는다).
  --      권한 종류는 표 권한 종류(acldefault('r'))에서 얻는다 — 칸에 쓸 수 없는 종류는 has_column_privilege 가 22023 으로 거부하므로 건너뛴다.
  for k in select d.privilege_type from aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.reservations'::regclass))) d order by 1 loop
    begin
      perform has_column_privilege('anon', 'public.reservations', 'privacy_consent_at', k);
    exception when invalid_parameter_value then
      continue;
    end;
    checked := checked + 1;
    foreach col in array array['withdrawal_consent_at', 'withdrawal_consent_legacy'] loop
      foreach w in array array['anon', 'authenticated', 'service_role'] loop
        if has_column_privilege(w, 'public.reservations', col, k)
           is distinct from has_column_privilege(w, 'public.reservations', 'privacy_consent_at', k) then
          raise exception '0021: % 의 % 권한이 새 칸 % 와 옆 칸(privacy_consent_at)에서 다르다', w, lower(k), col;
        end if;
      end loop;
      if has_column_privilege('anon', 'public.reservations', col, k) then
        raise exception '0021: anon 이 새 칸 % 에 % 권한을 가진다 — 0017 뒤로 anon 은 reservations 에 권한이 없어야 한다', col, lower(k);
      end if;
    end loop;
  end loop;
  if checked = 0 then
    raise exception '0021: 칸 권한 대조가 공허하다 — 대조한 권한 종류가 0 개다';
  end if;

  -- ⑥ 거동 탐침 — 실제 표가 아니라 **임시 복제본**에 친다. 복제본은 CHECK·기본값을 LIKE 로 복제하고, 트리거는 실제 트리거의 정의에서
  --    표 이름만 바꿔 붙인다(같은 함수). 서브트랜잭션째 되돌린다.
  begin
    execute 'create temp table p0021_probe (like public.reservations including defaults including constraints)';
    select string_agg(t.conname, ', ') into leaked
      from (values ('reservations_withdrawal_consent_required'), ('reservations_withdrawal_consent_before_created'), ('reservations_withdrawal_consent_not_stale')) t(conname)
     where (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.reservations'::regclass and c.conname = t.conname)
           is distinct from
           (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'pg_temp.p0021_probe'::regclass and c.conname = t.conname);
    if leaked is not null then
      raise exception '0021: 탐침 복제본의 CHECK 가 실제 표와 다르다 — %', leaked;
    end if;

    -- legacy 행 하나 — 트리거를 붙이기 **전에** 넣는다(트리거는 legacy=true 삽입을 막는다 — 적용 순간의 기존 행을 흉내 낸다).
    insert into pg_temp.p0021_probe (public_code, created_at, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_legacy)
      values ('P0021L', now() - interval '30 days', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now() - interval '30 days', 'probe', now() + interval '300 days', true)
      returning id into legacy_id;

    select pg_get_triggerdef(t.oid) into trg_def
      from pg_trigger t where t.tgrelid = 'public.reservations'::regclass and t.tgname = 'reservations_withdrawal_legacy_guard';
    if position('ON public.reservations ' in trg_def) = 0 then
      raise exception '0021: 트리거 정의에서 표 이름을 찾지 못했다 — %', trg_def;
    end if;
    execute replace(trg_def, 'ON public.reservations ', 'ON pg_temp.p0021_probe ');

    -- (a) 기본값 경로 반례 — created_at·legacy 를 지정하지 않은 insert, 동의 없음 → 23514 required (astra 가 짚은 경로)
    begin
      insert into pg_temp.p0021_probe (public_code, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until)
        values ('P0021A', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now(), 'probe', now() + interval '365 days');
      outcome := outcome || 'default_path=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('default_path=23514:' || cn);
    end;
    -- (a') created_at 을 과거로 넣어도 동의가 없으면 23514 — 시각으로 우회되지 않는다
    begin
      insert into pg_temp.p0021_probe (public_code, created_at, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until)
        values ('P0021P', now() - interval '30 days', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now() - interval '30 days', 'probe', now() + interval '300 days');
      outcome := outcome || 'backdated=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('backdated=23514:' || cn);
    end;
    -- (e) 새 행을 legacy=true 로 넣기 → 트리거 거부(23000)
    begin
      insert into pg_temp.p0021_probe (public_code, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_legacy)
        values ('P0021X', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now(), 'probe', now() + interval '365 days', true);
      outcome := outcome || 'legacy_insert=INSERTED'::text;
    exception when integrity_constraint_violation then
      get stacked diagnostics st = returned_sqlstate;
      outcome := outcome || ('legacy_insert=' || st);
    end;
    -- (b) 동의 있는 새 행(기본값 경로) → 성공 · legacy false
    insert into pg_temp.p0021_probe (public_code, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P0021B', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now(), 'probe', now() + interval '365 days', now())
      returning id into new_id;
    outcome := outcome || ('new_with=legacy_' || (select withdrawal_consent_legacy::text from pg_temp.p0021_probe where id = new_id));
    -- (d) 새 행의 동의 시각을 지우기 → 23514
    begin
      update pg_temp.p0021_probe set withdrawal_consent_at = null where id = new_id;
      outcome := outcome || 'wipe=UPDATED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('wipe=23514:' || cn);
    end;
    -- (e) 새 행 legacy false→true → 23000
    begin
      update pg_temp.p0021_probe set withdrawal_consent_legacy = true, withdrawal_consent_at = null where id = new_id;
      outcome := outcome || 'promote=UPDATED'::text;
    exception when integrity_constraint_violation then
      get stacked diagnostics st = returned_sqlstate;
      outcome := outcome || ('promote=' || st);
    end;
    -- (c) legacy 행 — 관리자 확정·취소·메모와 같은 UPDATE 는 통과
    update pg_temp.p0021_probe set status = 'confirmed', confirmed_at = now(), admin_memo = 'probe' where id = legacy_id;
    update pg_temp.p0021_probe set status = 'cancelled' where id = legacy_id;
    update pg_temp.p0021_probe set admin_memo = null where id = legacy_id;
    outcome := outcome || 'legacy_update=OK'::text;
    -- (e) legacy 행 true→false → 23000
    begin
      update pg_temp.p0021_probe set withdrawal_consent_legacy = false where id = legacy_id;
      outcome := outcome || 'demote=UPDATED'::text;
    exception when integrity_constraint_violation then
      get stacked diagnostics st = returned_sqlstate;
      outcome := outcome || ('demote=' || st);
    end;

    raise exception using errcode = 'P0021', message = 'p0021 probe rollback';
  exception
    when sqlstate 'P0021' then
      probe_ok := true;
    when others then
      get stacked diagnostics st = returned_sqlstate, ms = message_text;
      if ms like '0021:%' then
        raise exception '%', ms;
      end if;
      raise exception '0021: 거동 탐침이 실패했다 — SQLSTATE=% MESSAGE=% (지금까지: %)', st, ms, array_to_string(outcome, ' ')
        using hint = 'legacy 행의 UPDATE 가 실패했다면 트리거가 legacy 값이 그대로인 UPDATE 까지 막는지, CHECK 가 legacy 예외를 잃었는지 볼 것.';
  end;
  if not probe_ok then
    raise exception '0021: 거동 탐침이 끝까지 돌지 않았다';
  end if;
  if array_to_string(outcome, ' ') <> 'default_path=23514:reservations_withdrawal_consent_required backdated=23514:reservations_withdrawal_consent_required legacy_insert=23000 new_with=legacy_false wipe=23514:reservations_withdrawal_consent_required promote=23000 legacy_update=OK demote=23000' then
    raise exception '0021: 거동 탐침 결과가 설계와 다르다 — %', array_to_string(outcome, ' ');
  end if;
  if to_regclass('pg_temp.p0021_probe') is not null then
    raise exception '0021: 탐침 임시 표가 남았다';
  end if;

  raise notice '0021: withdrawal_consent_at·legacy 추가 · 적용 순간 행 % 건 legacy · TRIGGER 회수 [%] · 두 표 TRIGGER 보유자 0(검사 밖: %) · session_replication_role 부여 0 · 그 밖 권한 불변(칸 권한 종류 %개 대조) · 탐침 %',
    n_before, case when revoked_list = '' then '이미 없음' else revoked_list end, coalesce(outside_roles, '(없음)'), checked, array_to_string(outcome, ' ');
end
$$;
