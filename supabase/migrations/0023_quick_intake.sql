-- 0023_quick_intake.sql — 홈 간편 견적 접수(intake='quick')를 받을 수 있게 reservations 를 넓힌다 (플랜 v4 P3-8 · 사용자 결정 2026-09-27)
--
-- ## 왜
-- 접수 경로가 6단계 위저드에서 **홈 간편 견적 하나**로 바뀌었다. 간편 견적은 출발지·도착지·출발일·도착일·인원 + 이름·연락처만 받는다.
-- 차종·여행 목적·출발 시각·왕복 구분·대수는 사장님이 전화로 확인한다. 그런데 0001 은 vehicle_slug·purpose_code 를 NOT NULL,
-- bus_count 를 NOT NULL DEFAULT 1 로 요구한다 — 그대로 두면 손님이 고르지 않은 차종·목적을 **지어내어** 넣어야 하고,
-- 그 순간 관리자 화면·통계(0022)·통지 문안이 거짓이 된다. 그래서 지어내지 않고 **비워 두는** 길을 연다.
--
-- ## 무엇을 바꾸나
--   ① `intake text not null` — `'wizard' | 'quick'`. 이 파일이 표를 쥔 순간에 있던 행은 전부 `'wizard'`(빠른 기본값 —
--      행을 다시 쓰지 않는다) → 같은 트랜잭션에서 **기본값을 지운다.** 이후 insert 는 intake 를 반드시 적어야 한다
--      (빠뜨리면 23502). 기본값을 남기면 "적지 않은 새 접수" 가 조용히 wizard 로 분류된다 — 그것이 곧 지어낸 값이다.
--   ② `vehicle_slug`·`purpose_code`·`bus_count` 의 NOT NULL 을 푼다. **bus_count 의 기본값(1)도 지운다** —
--      남기면 bus_count 를 적지 않은 간편 insert 가 "1대" 를 지어낸다. wizard 행은 아래 CHECK 가 여전히 셋 다 요구한다.
--   ③ CHECK `reservations_intake_fields_ck`: `intake = 'quick' or (vehicle_slug, purpose_code, bus_count 모두 not null)`.
--      intake 가 NOT NULL 이므로 이 식은 NULL 로 평가될 수 없다(우연한 통과가 없다).
--   ④ `reservations_round_trip_return_ck`(0006)를 **다시 쓴다.** 0006 판은 trip_type 이 null 이면 세 갈래가 모두 NULL 이 되어
--      CHECK 가 "우연히" 통과했다(CHECK 는 NULL 을 통과로 본다). 간편 행(trip_type null)이 그 우연에 기대지 않도록 CASE 로 명시한다:
--        trip_type 없음        → intake = 'quick' 일 때만 허용 (간편 접수는 왕복 구분을 받지 않는다 — 의도된 통과)
--        round                 → return_at 필수        (0006 과 같다)
--        oneway                → return_at 금지        (0006 과 같다)
--        oneway_oneway         → return_at 선택        (0006 과 같다)
--      CASE 의 각 갈래는 NULL 이 될 수 없는 불리언이다. **조여지는 곳은 하나** — trip_type 이 없는 wizard 행.
--      위저드 zod 는 P3 부터 tripType 을 필수로 받았으므로 그런 행은 없어야 한다. 있으면 제약 추가가 실패하기 전에
--      자기검증 ② 가 건수와 함께 멈춘다(원격 적용 전에 사람이 본다).
--   ⑤ CHECK `reservations_quick_passengers_ck`: `intake = 'wizard' or passengers is not null` (P3-8 리뷰 P2-5 · 방어 심층).
--      간편 접수는 인원이 **유일한** 규모 정보다 — 앱(zod)이 필수로 받지만 DB 도 비워 두지 못하게 한다. wizard 행은 0001 그대로
--      (인원 선택)라 조이지 않는다. 기존 행은 전부 wizard 가 되므로 이 제약이 기존 행을 거부할 일은 없다.
--   `return_at > depart_at`(0001 칸 CHECK)·`nights >= 0` 은 그대로다. 간편 행은 depart_at = 출발일 00:00 KST, 도착일이 뒤면
--   return_at = 도착일 00:00 KST(같은 날이면 null) — 앱(lib/reservations/create.ts)이 만든다.
--
-- ## 권한 — 바꾸지 않는다
-- 새 **표·함수·시퀀스를 만들지 않는다**(칸 하나·제약 셋·NOT NULL 해제 + 기존 함수 본문 교체 하나). 기본 권한(pg_default_acl, CLAUDE.md §3)은
-- 새 객체에만 걸리므로 회수할 것이 없다. 칸 추가는 칸 ACL(attacl)을 만들지 않는다 — 새 칸은 표 단위 권한을 그대로 따른다(anon 0 ·
-- authenticated SELECT · service_role 접수). 자기검증 ⑥ 이 public 전 표·시퀀스·칸 ACL 을 적용 전후로 대조한다(0021 과 같은 방법).
--
-- ## admin_stats(0022) — 본문 한 줄만 바꾼다 (P3-8 리뷰 P2-7 · 이 파일 §2)
-- null 차종·목적은 그 함수 안에서 한 칸(값 null · other=false)으로 묶여 k=3 숨김·보완 숨김을 다른 칸과 똑같이 받는다.
-- 화면(app/admin/(protected)/stats)이 그 칸을 "미정" 으로 그린다. **문제는 그 칸이 "기타" 로 접힐 때**다: 0022 의 "기타" 대수는
-- `sum(y.buses)` 라 간편 접수(대수 null)를 **조용히 빼고** 더한다 — "기타 5건 · 4대" 의 건수와 대수가 서로 다른 모집단을 센다.
-- §2 는 그 한 줄을 "접힌 칸 중 하나라도 대수를 모르면 대수 합을 내지 않는다(null)" 로 바꾼다. 화면은 null 이면 대수를 생략한다(이미 그렇다).
-- **`create or replace` 로만 바꾼다** — 같은 시그니처의 create or replace 는 소유자·EXECUTE 권한을 그대로 둔다(PostgreSQL 명세).
-- `drop function` 을 쓰지 않는다(drop 후 create 는 EXECUTE 를 공개 롤에 다시 연다 — CLAUDE.md §3). 자기검증 §2 가 proacl 을 전후로 대조한다.
-- 본문은 0022 와 **그 한 줄만** 다르다 — tests/quick-intake.test.ts 가 두 파일의 함수 본문을 줄 단위로 대조한다.
--
-- ## 자기검증은 실제 표에 문장을 치지 않는다 (P5-15 규칙 · 0021 규범)
-- 카탈로그로 모양을 보고, 거동은 **일회용 LIKE 복제본**(pg_temp.p0023_probe — 기본값·CHECK·NOT NULL 복제)에 친 뒤 서브트랜잭션째 되돌린다.
--
-- 기존 행 영향: 값 변경 0(intake 는 빠른 기본값 'wizard' — 행 재작성 없음). NOT NULL 해제·기본값 제거는 카탈로그만 바꾼다.
--   제약 추가 둘은 기존 행을 한 번 훑는다(수백~수천 행 — 수 ms).
-- 재실행: intake 칸이 이미 있으면 ① 에서 멈춘다.
-- 🔴 배포 순서 — **적용 → 배포**(0021 과 같은 짝). 이 파일 뒤로 intake 를 적지 않은 insert 는 23502 로 실패한다:
--   · 적용 뒤 **옛 코드**(위저드 — intake 를 모른다)가 접수를 받으면 그 접수는 23502 로 실패한다.
--   · **새 코드**를 먼저 배포하면 intake 칸이 없어 접수가 PGRST204 로 실패한다.
--   환경마다 적용 → 배포 순서를 지키고, 그 사이 창(수 분)의 접수 실패는 화면이 "일시적 오류 · 전화" 로 안내한다(fail-closed).
-- PostgREST 스키마 캐시: 칸이 생겼으므로 갱신이 필요하다 — 이 DB 의 pgrst_ddl_watch 이벤트 트리거가 NOTIFY 를 낸다(runbook 맨 위 ③).
-- 적용 경로: **`supabase db push` 만**(runbook 「적용 경로」). 로컬 단건 검증은 `psql -1`.
-- ⚠️ 자기검증 ⑦ 은 임시 표를 만든다(CREATE TABLE 태그 — 이벤트 트리거가 본다). 적용 롤에 임시 표 권한이 필요하다(기본).
-- 🔒 잠금 — 표를 **맨 먼저** ACCESS EXCLUSIVE 로 잡은 뒤에 센다(P3-8 리뷰 P2-2). 세고 나서 잠그면 그 사이 커밋된 접수 하나가
--   ⑤ 의 "행 수가 바뀌었다" 거짓 중단을 만든다. 잠금 대기는 lock_timeout 5초가 상한이다.
-- 롤백: supabase/rollbacks/0023_quick_intake.down.sql (수동 실행 전용 · **승인 플래그 없음**). 간편 행이 한 건이라도 있으면 값을
--   지어내거나 행을 지우지 않고 **무조건 멈춘다** — 그 파일 헤더 ①~④(앱 되돌리기 → 간편 행 처리 → 처분 결정 → 재실행)를 사람이 먼저 한다.
--   건수는 쓰기 잠금을 쥔 뒤에 센다. §2 의 admin_stats 본문은 되돌리지 않는다 — 0022 스키마에서도 그대로 돈다(intake 를 읽지 않는다).

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0023: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다. 아무것도 바꾸기 전에 멈춘다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나). psql -f 처럼 문장마다 커밋하는 경로에서는 set local 이 그 문장에서 끝난다(PostgreSQL 은 경고만 낸다).';
  end if;
end
$$;

do $$
declare
  n_before     bigint;
  n_after      bigint;
  n_bad        bigint;
  before_acl   text[];
  after_acl    text[];
  diff         text;
  col          record;
  def          text;
  st           text;
  ms           text;
  cn           text;
  probe_ok     boolean := false;
  outcome      text[] := '{}';
  expected     constant text :=
    'no_intake=23502:intake wizard_no_vehicle=23514:reservations_intake_fields_ck wizard_no_bus=23514:reservations_intake_fields_ck '
    || 'wizard_no_trip=23514:reservations_round_trip_return_ck bad_intake=23514:reservations_intake_ck '
    || 'quick_same_day=OK quick_multi_day=OK quick_with_trip_oneway_return=23514:reservations_round_trip_return_ck '
    || 'wizard_full=OK wizard_round_no_return=23514:reservations_round_trip_return_ck '
    || 'quick_no_pax=23514:reservations_quick_passengers_ck wizard_no_pax=OK';
begin
  -- ① 이미 적용된 DB 가 아닌가.
  if exists (select 1 from pg_attribute where attrelid = 'public.reservations'::regclass and attname = 'intake' and not attisdropped) then
    raise exception '0023: public.reservations 에 intake 칸이 이미 있다 — 이미 적용된 DB 다. 다시 돌리지 않는다'
      using hint = 'select version from supabase_migrations.schema_migrations order by version desc limit 3; 로 이력을 확인할 것. 이력에 0023 이 없는데 칸이 있으면 누군가 수동으로 만든 것이다 — 컨트롤러에게 보고한다.';
  end if;

  -- 🔒 잠금을 **먼저** 잡는다(P3-8 리뷰 P2-2). 아래 ②·⑤ 의 건수는 이 잠금 아래에서 세므로 그 사이 새 접수가 끼어들 수 없다.
  --    ACCESS EXCLUSIVE — 뒤의 ALTER 들이 어차피 잡는 강도다(더 세게 잡지 않는다). 대기는 lock_timeout 5초가 상한.
  lock table public.reservations in access exclusive mode;

  -- ② 조여지는 유일한 곳 — trip_type 이 없는 기존 행. 있으면 제약 추가가 23514 로 실패하기 전에 건수를 들고 멈춘다.
  select count(*) into n_bad from public.reservations where trip_type is null;
  if n_bad > 0 then
    raise exception '0023: trip_type 이 비어 있는 기존 접수가 % 건 있다 — 이 파일 뒤로 trip_type 없음은 간편 접수(intake=quick)에만 허용된다', n_bad
      using hint = '위저드는 P3 부터 tripType 을 필수로 받았다. 그 행들이 어디서 왔는지(수동 입력·테스트 잔여물) 사람이 확인한 뒤 적용한다. 지어낸 값으로 채우지 않는다.';
  end if;

  -- ⑥ 의 "적용 전" — public 스키마 모든 표·뷰·시퀀스의 ACL 항목 전부(종류 불문 · aclexplode)와 칸 ACL 전부(0021 과 같은 질의).
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

  -- ③ 본문. 표는 위에서 이미 ACCESS EXCLUSIVE 로 쥐었다 — 여기서 센 건수는 ⑤ 까지 바뀔 수 없다.
  --    intake 는 기본값 'wizard' 로 붙여 **지금 있는 행 전부**를 wizard 로 만든 뒤(빠른 기본값) 곧바로 기본값을 지운다.
  select count(*) into n_before from public.reservations;
  alter table public.reservations add column intake text not null default 'wizard';
  alter table public.reservations alter column intake drop default;
  alter table public.reservations add constraint reservations_intake_ck check (intake in ('wizard', 'quick'));

  alter table public.reservations
    alter column vehicle_slug drop not null,
    alter column purpose_code drop not null,
    alter column bus_count drop not null,
    alter column bus_count drop default;
  alter table public.reservations add constraint reservations_intake_fields_ck check (
    intake = 'quick' or (vehicle_slug is not null and purpose_code is not null and bus_count is not null)
  );

  alter table public.reservations drop constraint reservations_round_trip_return_ck;
  alter table public.reservations add constraint reservations_round_trip_return_ck check (
    case
      when trip_type is null            then intake = 'quick'
      when trip_type = 'round'          then return_at is not null
      when trip_type = 'oneway'         then return_at is null
      when trip_type = 'oneway_oneway'  then true
      else false
    end
  );

  -- 간편 접수는 인원이 유일한 규모 정보다 — 비워 둘 수 없다(리뷰 P2-5). wizard 는 0001 그대로(인원 선택).
  alter table public.reservations add constraint reservations_quick_passengers_ck check (intake = 'wizard' or passengers is not null);

  comment on column public.reservations.intake is
    '접수 경로(0023 · P3-8): wizard = 옛 6단계 위저드(차종·목적·대수·왕복 구분 필수) · quick = 홈 간편 견적(그 넷은 null — 사장님이 전화로 확인). 기본값 없음 — insert 가 반드시 적는다.';

  -- ④ 모양 — 카탈로그로만 본다.
  select a.attnotnull, a.atthasdef, format_type(a.atttypid, a.atttypmod) as ty into col
    from pg_attribute a where a.attrelid = 'public.reservations'::regclass and a.attname = 'intake' and not a.attisdropped;
  if not col.attnotnull or col.atthasdef or col.ty <> 'text' then
    raise exception '0023: intake 칸의 모양이 설계와 다르다 — not null=% · 기본값 있음=% · 형=%', col.attnotnull, col.atthasdef, col.ty;
  end if;
  for col in
    select a.attname, a.attnotnull, a.atthasdef from pg_attribute a
     where a.attrelid = 'public.reservations'::regclass and a.attname in ('vehicle_slug', 'purpose_code', 'bus_count') and not a.attisdropped
  loop
    if col.attnotnull then
      raise exception '0023: % 가 아직 NOT NULL 이다', col.attname;
    end if;
    if col.attname = 'bus_count' and col.atthasdef then
      raise exception '0023: bus_count 에 기본값이 남았다 — 간편 insert 가 "1대" 를 지어낸다';
    end if;
  end loop;
  -- 옛 제약(0001 bus_count 1~20 · 0006 을 대체한 새 판)이 그대로 걸려 있는가 — 이름으로 찾고 정의로 대조한다.
  select pg_get_constraintdef(c.oid) into def from pg_constraint c
   where c.conrelid = 'public.reservations'::regclass and c.conname = 'reservations_round_trip_return_ck';
  if def is null or position('intake' in def) = 0 or position('CASE' in upper(def)) = 0 then
    raise exception '0023: reservations_round_trip_return_ck 가 새 판(CASE · intake)이 아니다 — %', coalesce(def, '(없음)');
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.reservations'::regclass and c.contype = 'c'
                   and pg_get_constraintdef(c.oid) ~ 'bus_count >= 1' and pg_get_constraintdef(c.oid) ~ 'bus_count <= 20') then
    raise exception '0023: bus_count 1~20 범위 CHECK(0001)가 보이지 않는다 — NOT NULL 을 풀면서 범위까지 잃으면 안 된다';
  end if;
  select pg_get_constraintdef(c.oid) into def from pg_constraint c
   where c.conrelid = 'public.reservations'::regclass and c.conname = 'reservations_quick_passengers_ck';
  if def is null or position('passengers IS NOT NULL' in def) = 0 then
    raise exception '0023: reservations_quick_passengers_ck 가 없거나 모양이 다르다 — %', coalesce(def, '(없음)');
  end if;

  -- ⑤ 기존 행 — 건수 불변 · 전부 wizard.
  select count(*) into n_after from public.reservations;
  if n_after <> n_before then
    raise exception '0023: 적용 중에 행 수가 바뀌었다 (% → %) — ACCESS EXCLUSIVE 아래에서는 있을 수 없다', n_before, n_after;
  end if;
  if exists (select 1 from public.reservations where intake <> 'wizard') then
    raise exception '0023: 기존 행 중 wizard 가 아닌 것이 있다 — 빠른 기본값이 적용되지 않았다';
  end if;

  -- ⑥ ACL 불변 — 이 파일은 권한 문장이 0 개다. 적용 전 집합과 **정확히** 같아야 한다.
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
  if after_acl is distinct from before_acl then
    select string_agg(x, ', ') into diff from (
      (select '-' || unnest(before_acl) except select '-' || unnest(after_acl))
      union all
      (select '+' || unnest(after_acl) except select '+' || unnest(before_acl))
    ) d(x);
    raise exception '0023: 권한이 바뀌었다 — % (이 파일에는 권한 문장이 없다)', diff
      using hint = '이벤트 트리거나 다른 세션이 권한을 바꿨는지 볼 것.';
  end if;

  -- ⑦ 거동 탐침 — 실제 표가 아니라 **임시 복제본**(기본값·CHECK·NOT NULL 복제)에 친다. 서브트랜잭션째 되돌린다.
  --    동의 칸(0003·0021 CHECK)은 복제되므로 유효한 값을 넣는다. FK(vehicles)는 LIKE 가 복제하지 않는다 — 여기서 볼 것이 아니다.
  begin
    execute 'create temp table p0023_probe (like public.reservations including defaults including constraints)';
    select string_agg(t.conname, ', ') into diff
      from (values ('reservations_intake_ck'), ('reservations_intake_fields_ck'), ('reservations_round_trip_return_ck'), ('reservations_quick_passengers_ck')) t(conname)
     where (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.reservations'::regclass and c.conname = t.conname)
           is distinct from
           (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'pg_temp.p0023_probe'::regclass and c.conname = t.conname);
    if diff is not null then
      raise exception '0023: 탐침 복제본의 CHECK 가 실제 표와 다르다 — %', diff;
    end if;

    -- (a) intake 를 적지 않은 insert → 23502(기본값이 없다)
    begin
      insert into pg_temp.p0023_probe (public_code, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, bus_count, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
        values ('P0023A', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', 1, now(), 'probe', now() + interval '365 days', now());
      outcome := outcome || 'no_intake=INSERTED'::text;
    exception when not_null_violation then
      get stacked diagnostics cn = column_name;
      outcome := outcome || ('no_intake=23502:' || cn);
    end;
    -- (b) wizard 인데 차종 없음 → 23514 intake_fields
    begin
      insert into pg_temp.p0023_probe (public_code, intake, name, phone, purpose_code, origin_code, destination_code, trip_type, depart_at, bus_count, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
        values ('P0023B', 'wizard', 'x', '+821000000000', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', 1, now(), 'probe', now() + interval '365 days', now());
      outcome := outcome || 'wizard_no_vehicle=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('wizard_no_vehicle=23514:' || cn);
    end;
    -- (c) wizard 인데 대수를 적지 않음 → 기본값이 없어 null → 23514 intake_fields (옛 기본값 1 이 살아 있으면 INSERTED 가 된다)
    begin
      insert into pg_temp.p0023_probe (public_code, intake, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
        values ('P0023C', 'wizard', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now(), 'probe', now() + interval '365 days', now());
      outcome := outcome || 'wizard_no_bus=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('wizard_no_bus=23514:' || cn);
    end;
    -- (d) wizard 인데 trip_type 없음 → 23514 round_trip (0006 판에서는 NULL 로 통과하던 자리)
    begin
      insert into pg_temp.p0023_probe (public_code, intake, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, depart_at, bus_count, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
        values ('P0023D', 'wizard', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', now() + interval '7 days', 1, now(), 'probe', now() + interval '365 days', now());
      outcome := outcome || 'wizard_no_trip=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('wizard_no_trip=23514:' || cn);
    end;
    -- (e) 모르는 intake → 23514 intake_ck
    begin
      insert into pg_temp.p0023_probe (public_code, intake, name, phone, origin_code, destination_code, depart_at, passengers, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
        values ('P0023E', 'phone', 'x', '+821000000000', 'SEL', 'BSN', now() + interval '7 days', 30, now(), 'probe', now() + interval '365 days', now());
      outcome := outcome || 'bad_intake=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('bad_intake=23514:' || cn);
    end;
    -- (f) 간편 — 같은 날(도착일 = 출발일 → return_at null) · 차종·목적·대수·왕복 구분 전부 null → 통과
    insert into pg_temp.p0023_probe (public_code, intake, name, phone, origin_code, destination_code, depart_at, return_at, nights, passengers, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P0023F', 'quick', 'x', '+821000000000', 'ICN', 'SEL', date_trunc('day', now()) + interval '7 days', null, 0, 30, now(), 'probe', now() + interval '365 days', now());
    outcome := outcome || 'quick_same_day=OK'::text;
    -- (g) 간편 — 여러 날(return_at 있음) → 통과
    insert into pg_temp.p0023_probe (public_code, intake, name, phone, origin_code, destination_code, depart_at, return_at, nights, passengers, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P0023G', 'quick', 'x', '+821000000000', 'SEL', 'BSN', date_trunc('day', now()) + interval '7 days', date_trunc('day', now()) + interval '9 days', 2, 30, now(), 'probe', now() + interval '365 days', now());
    outcome := outcome || 'quick_multi_day=OK'::text;
    -- (h) 간편이라도 trip_type 을 적었다면 규칙을 따른다 — oneway 인데 return_at 있음 → 23514
    begin
      insert into pg_temp.p0023_probe (public_code, intake, name, phone, origin_code, destination_code, trip_type, depart_at, return_at, passengers, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
        values ('P0023H', 'quick', 'x', '+821000000000', 'SEL', 'BSN', 'oneway', now() + interval '7 days', now() + interval '8 days', 30, now(), 'probe', now() + interval '365 days', now());
      outcome := outcome || 'quick_with_trip_oneway_return=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('quick_with_trip_oneway_return=23514:' || cn);
    end;
    -- (i) wizard 완전한 행 → 통과(위저드 접수분의 모양은 여전히 유효하다 — 옛 행의 관리자 UPDATE 가 막히지 않는다)
    insert into pg_temp.p0023_probe (public_code, intake, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, return_at, bus_count, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P0023I', 'wizard', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'round', now() + interval '7 days', now() + interval '8 days', 2, now(), 'probe', now() + interval '365 days', now());
    update pg_temp.p0023_probe set status = 'confirmed', confirmed_at = now(), admin_memo = 'probe' where public_code = 'P0023I';
    outcome := outcome || 'wizard_full=OK'::text;
    -- (j) wizard round 인데 return_at 없음 → 23514 (0006 과 같은 규칙이 살아 있다)
    begin
      insert into pg_temp.p0023_probe (public_code, intake, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, bus_count, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
        values ('P0023J', 'wizard', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'round', now() + interval '7 days', 1, now(), 'probe', now() + interval '365 days', now());
      outcome := outcome || 'wizard_round_no_return=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('wizard_round_no_return=23514:' || cn);
    end;
    -- (k) 간편인데 인원 없음 → 23514 quick_passengers (리뷰 P2-5 — 앱이 필수로 받지만 DB 도 막는다)
    begin
      insert into pg_temp.p0023_probe (public_code, intake, name, phone, origin_code, destination_code, depart_at, nights, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
        values ('P0023K', 'quick', 'x', '+821000000000', 'SEL', 'BSN', date_trunc('day', now()) + interval '7 days', 0, now(), 'probe', now() + interval '365 days', now());
      outcome := outcome || 'quick_no_pax=INSERTED'::text;
    exception when check_violation then
      get stacked diagnostics cn = constraint_name;
      outcome := outcome || ('quick_no_pax=23514:' || cn);
    end;
    -- (l) wizard 인데 인원 없음 → 통과(0001 그대로 — 위저드는 인원을 선택으로 받았다. 옛 행을 조이지 않는다)
    insert into pg_temp.p0023_probe (public_code, intake, name, phone, vehicle_slug, purpose_code, origin_code, destination_code, trip_type, depart_at, bus_count, privacy_consent_at, privacy_policy_version, retention_until, withdrawal_consent_at)
      values ('P0023L', 'wizard', 'x', '+821000000000', 'bus45', 'family', 'SEL', 'BSN', 'oneway', now() + interval '7 days', 1, now(), 'probe', now() + interval '365 days', now());
    outcome := outcome || 'wizard_no_pax=OK'::text;

    raise exception using errcode = 'P0023', message = 'p0023 probe rollback';
  exception
    when sqlstate 'P0023' then
      probe_ok := true;
    when others then
      get stacked diagnostics st = returned_sqlstate, ms = message_text;
      if ms like '0023:%' then
        raise exception '%', ms;
      end if;
      raise exception '0023: 거동 탐침이 실패했다 — SQLSTATE=% MESSAGE=% (지금까지: %)', st, ms, array_to_string(outcome, ' ');
  end;
  if not probe_ok then
    raise exception '0023: 거동 탐침이 끝까지 돌지 않았다';
  end if;
  if array_to_string(outcome, ' ') <> expected then
    raise exception '0023: 거동 탐침 결과가 설계와 다르다 — %', array_to_string(outcome, ' ');
  end if;
  if to_regclass('pg_temp.p0023_probe') is not null then
    raise exception '0023: 탐침 임시 표가 남았다';
  end if;

  raise notice '0023: intake 추가(기존 % 건 wizard · 기본값 없음) · 차종·목적·대수 NOT NULL 해제(bus_count 기본값 제거) · intake_fields·round_trip·quick_passengers CHECK · 권한 불변 · 탐침 %',
    n_before, array_to_string(outcome, ' ');
end
$$;

-- =========================================================================
-- §2. admin_stats — "기타" 로 접힌 칸에 대수를 모르는 칸(간편 접수)이 섞이면 대수 합을 내지 않는다 (리뷰 P2-7)
--     본문은 0022 와 **한 줄**(vehicle_rows 의 "기타" 줄)만 다르다. 권한·소유자·주석은 create or replace 가 그대로 둔다.
-- =========================================================================

-- 적용 전 권한·성질을 이 트랜잭션의 설정값에 적어 둔다(아래 확인 DO 가 대조한다). set_config(..., true) = 이 트랜잭션에만.
do $$
begin
  if to_regprocedure('public.admin_stats(date,date)') is null then
    raise exception '0023 §2: public.admin_stats(date,date) 가 없다 — 0022 가 먼저 적용돼야 한다';
  end if;
  perform set_config('p0023.stats_before',
    (select format('%s|%s|%s|%s', coalesce(p.proacl::text, '(default)'), p.proowner::regrole, p.prosecdef, coalesce(array_to_string(p.proconfig, ' '), '(none)'))
       from pg_proc p where p.oid = 'public.admin_stats(date,date)'::regprocedure),
    true);
end
$$;

create or replace function admin_stats(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- 작은 칸 숨김 기준(컨트롤러 결정 2026-09-21). 1~2건은 건수를 내리지 않고 "기타" 로 합친다.
  -- 같은 값이 ③ 의 "표본 부족" 기준이기도 하다 — 사장님께 보이는 규칙이 하나여야 한다.
  c_k               constant int := 3;
  -- ④ 접수 후 이만큼 지난 대기 건을 따로 센다(사장님이 놓친 문의).
  c_backlog_hours   constant int := 72;
  -- ⑤ 최근 이만큼의 발송 기록만 본다 / pending 이 이만큼 넘게 머물면 문제로 본다.
  c_notify_days     constant int := 7;
  c_notify_stuck_h  constant int := 1;
  -- 버킷 단위가 갈리는 기간 길이. 31일 이하 = 일 · 92일 이하 = 주(월요일 시작) · 그 위 = 월.
  c_day_max         constant int := 31;
  c_week_max        constant int := 92;
  -- 조회 상한 — 12개월. 그보다 길면 파기(보관기간)로 앞쪽이 비어 추이가 왜곡된다(보고서 §0-2).
  -- 화면의 프리셋은 **365일 이내**로 더 좁힌다(lib/admin/stats.ts MAX_RANGE_DAYS = PRIVACY_NOTICE.retentionDays) —
  -- 366일이면 가장 오래된 하루가 이미 파기 경계를 넘어 확정률이 부풀어 보인다(수정 라운드 2 · astra P1).
  c_max_days        constant int := 366;
  -- 지원하는 날짜 범위. PostgreSQL 의 date 는 `infinity`·`-infinity` 와 사실상 무제한의 유한 날짜를 받는다 —
  -- 그대로 두면 `p_to - p_from` 이나 `(p_to + 1)::timestamp` 가 **검증보다 먼저** 22008 로 터진다(astra P2).
  c_min_date        constant date := date '1900-01-01';
  c_max_date        constant date := date '2200-01-01';

  v_days        int;
  v_bucket      text;
  v_from_ts     timestamptz;
  v_to_ts       timestamptz;
  v_prev_from   date;
  v_prev_to     date;
  v_has_prev    boolean;
  v_series_from date;
  v_step        interval;
  v_out         jsonb;
begin
  -- 가드 — 이 파일의 유일한 방어선이다(헤더). 문구는 lib/admin/adminRpc.ts 의 ADMIN_GUARD_MESSAGE 와
  -- **한 글자도** 같아야 한다: 앱이 이 문구로 "가드 거부" 와 "EXECUTE 거부"(둘 다 42501)를 가른다.
  if not is_admin() then
    raise exception 'admin_stats: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  -- 입력 검증 — 화면은 언제나 올바른 값을 보내지만, 이 함수는 화면 밖에서도 불릴 수 있다.
  -- **순서가 중요하다**: 유한성 → 지원 범위 → 앞뒤 → 길이. 산술(`p_to - p_from`·`p_from - v_days`·`::timestamp`)은
  -- 그 뒤에만 나온다. 뒤집으면 `infinity - infinity` 가 22008 로 먼저 터져 22023 이 나오지 않는다(astra P2).
  if p_from is null or p_to is null then
    raise exception 'admin_stats: 조회 기간의 양끝이 모두 있어야 한다' using errcode = '22023';
  end if;
  if p_from in ('infinity'::date, '-infinity'::date) or p_to in ('infinity'::date, '-infinity'::date) then
    raise exception 'admin_stats: 조회 기간에 무한대 날짜를 쓸 수 없다' using errcode = '22023';
  end if;
  if p_from < c_min_date or p_from > c_max_date or p_to < c_min_date or p_to > c_max_date then
    raise exception 'admin_stats: 조회 기간이 지원 범위(% ~ %) 밖이다', c_min_date, c_max_date using errcode = '22023';
  end if;
  if p_from > p_to then
    raise exception 'admin_stats: 조회 시작일이 종료일보다 늦다' using errcode = '22023';
  end if;
  v_days := (p_to - p_from) + 1;
  if v_days > c_max_days then
    raise exception 'admin_stats: 조회 기간이 % 일을 넘는다 (요청 % 일)', c_max_days, v_days using errcode = '22023';
  end if;

  -- KST 경계 — 양끝 포함 달력 날짜를 인스턴트 반열린구간으로 바꾼다.
  v_from_ts := (p_from::timestamp at time zone 'Asia/Seoul');
  v_to_ts   := ((p_to + 1)::timestamp at time zone 'Asia/Seoul');

  -- 직전 같은 길이의 기간. 3개월을 넘으면 비교하지 않는다 — 비교 대상이 파기로 이미 비어 있다(보고서 §0-2).
  v_prev_to   := p_from - 1;
  v_prev_from := p_from - v_days;
  v_has_prev  := v_days <= c_week_max;

  v_bucket := case when v_days <= c_day_max then 'day' when v_days <= c_week_max then 'week' else 'month' end;
  if v_bucket = 'day' then
    v_series_from := p_from;
    v_step := interval '1 day';
  elsif v_bucket = 'week' then
    v_series_from := date_trunc('week', p_from::timestamp)::date;
    v_step := interval '7 days';
  else
    v_series_from := date_trunc('month', p_from::timestamp)::date;
    v_step := interval '1 month';
  end if;

  with r as (
    -- 기간 안의 접수. **읽는 칸이 전부 여기 있다** — 개인정보 칸은 이름조차 꺼내지 않는다.
    select
      res.status                                                                                    as status,
      res.confirmed_at                                                                              as confirmed_at,
      res.created_at                                                                                as created_at,
      res.purpose_code                                                                              as purpose_code,
      res.vehicle_slug                                                                              as vehicle_slug,
      res.bus_count                                                                                 as bus_count,
      res.origin_code                                                                               as origin_code,
      res.destination_code                                                                          as destination_code,
      (res.depart_at at time zone 'Asia/Seoul')::date - (res.created_at at time zone 'Asia/Seoul')::date as lead_days,
      case v_bucket
        when 'day'  then (res.created_at at time zone 'Asia/Seoul')::date
        when 'week' then date_trunc('week',  res.created_at at time zone 'Asia/Seoul')::date
        else             date_trunc('month', res.created_at at time zone 'Asia/Seoul')::date
      end                                                                                           as bkt
    from reservations res
    where res.created_at >= v_from_ts
      and res.created_at <  v_to_ts
  ),
  -- ①②③ 머리 숫자
  head as (
    select
      count(*)::bigint                                              as total,
      count(*) filter (where r.confirmed_at is not null)::bigint     as confirmed,
      count(*) filter (where r.status = 'new')::bigint               as pending
    from r
  ),
  prev as (
    select count(*)::bigint as total
    from reservations res
    where v_has_prev
      and res.created_at >= (v_prev_from::timestamp at time zone 'Asia/Seoul')
      and res.created_at <  ((v_prev_to + 1)::timestamp at time zone 'Asia/Seoul')
  ),
  resp as (
    select
      count(*)::bigint as sample,
      percentile_cont(0.5) within group (order by extract(epoch from (r.confirmed_at - r.created_at))) as median_seconds
    from r
    where r.confirmed_at is not null
  ),
  -- ④⑤ 기간과 무관 — "지금" 을 본다
  backlog as (
    select
      count(*) filter (where res.status = 'new')::bigint as new_total,
      count(*) filter (where res.status = 'new' and res.created_at < now() - make_interval(hours => c_backlog_hours))::bigint as over_hours
    from reservations res
  ),
  notif as (
    select
      count(*) filter (where n.status = 'failed')::bigint as failed,
      count(*) filter (where n.status = 'pending' and n.created_at < now() - make_interval(hours => c_notify_stuck_h))::bigint as stuck
    from notifications_log n
    where n.created_at >= now() - make_interval(days => c_notify_days)
  ),
  -- ⑥ 추이 — 빈 버킷을 0 으로 채운다(화면이 구멍을 만들지 않는다)
  series as (
    select gs::date as bkt
    from generate_series(v_series_from::timestamp, p_to::timestamp, v_step) gs
  ),
  trend_raw as (
    select
      s.bkt                                                                        as bkt,
      count(r.status) filter (where r.status = 'new')::bigint                      as waiting,
      count(r.status) filter (where r.status in ('confirmed', 'done'))::bigint     as confirmed,
      count(r.status) filter (where r.status = 'cancelled')::bigint                as cancelled,
      count(r.status)::bigint                                                      as total
    from series s
    left join r on r.bkt = s.bkt
    group by s.bkt
  ),
  trend as (
    -- 쪼개도 되는가 — **칸마다** 본다(0 이거나 c_k 이상). 하나라도 1~2건이면 이 버킷은 총건수만 내보낸다.
    select
      x.bkt, x.waiting, x.confirmed, x.cancelled, x.total,
      (    (x.waiting   = 0 or x.waiting   >= c_k)
       and (x.confirmed = 0 or x.confirmed >= c_k)
       and (x.cancelled = 0 or x.cancelled >= c_k)) as splittable
    from trend_raw x
  ),
  -- =======================================================================
  -- ⑦⑧⑨⑩ 공통 규칙 — 작은 칸 숨김 + **보완 숨김**
  --   각 축에서 칸을 **작은 것부터** 줄 세우고(`rn`), 앞에서 `hide_n` 개를 "기타" 로 합친다.
  --     hide_n = 0                     (1~2건 칸이 없다)
  --            = least(2, 칸 수)        (1~2건 칸이 **하나뿐** — 보이는 칸 중 가장 작은 것도 함께 가린다)
  --            = 1~2건 칸의 수          (둘 이상 — 그대로)
  --   왜 하나를 더 가리나: 가려진 칸이 하나면 `총건수 − 보이는 칸들의 합` 이 그 칸의 건수이고,
  --   칸 목록이 고정된 축에서는 어느 칸인지까지 드러난다(헤더 「보완 숨김」).
  --   남는 칸은 전부 `n >= c_k` 다(작은 것부터 가렸으므로). 그래서 `suppressed` 판정은 아래에서도 `n < c_k` 그대로다.
  -- =======================================================================
  -- ⑦ 여행 구분별
  purpose_raw as (
    select r.purpose_code as code, count(*)::bigint as n from r group by 1
  ),
  purpose_ranked as (
    select
      x.code, x.n,
      row_number() over (order by x.n asc, x.code asc) as rn,
      case
        when count(*) filter (where x.n < c_k) over () = 0 then 0
        when count(*) filter (where x.n < c_k) over () = 1 then least(2, count(*) over ())
        else count(*) filter (where x.n < c_k) over ()
      end as hide_n
    from purpose_raw x
  ),
  purpose_rows as (
    select y.code, y.n, false as other from purpose_ranked y where y.rn > y.hide_n
    union all
    select null::text, sum(y.n)::bigint, true from purpose_ranked y where y.rn <= y.hide_n having sum(y.n) > 0
  ),
  -- ⑧ 차량별 + 요청 대수 합 (숨겨진 칸은 대수도 내려가지 않는다 — 대수는 건수를 역산하는 또 다른 창이다)
  vehicle_raw as (
    select r.vehicle_slug as slug, count(*)::bigint as n, sum(r.bus_count)::bigint as buses from r group by 1
  ),
  vehicle_ranked as (
    select
      x.slug, x.n, x.buses,
      row_number() over (order by x.n asc, x.slug asc) as rn,
      case
        when count(*) filter (where x.n < c_k) over () = 0 then 0
        when count(*) filter (where x.n < c_k) over () = 1 then least(2, count(*) over ())
        else count(*) filter (where x.n < c_k) over ()
      end as hide_n
    from vehicle_raw x
  ),
  vehicle_rows as (
    select y.slug, y.n, y.buses, false as other from vehicle_ranked y where y.rn > y.hide_n
    union all
    select null::text, sum(y.n)::bigint, case when bool_and(y.buses is not null) then sum(y.buses) end::bigint, true from vehicle_ranked y where y.rn <= y.hide_n having sum(y.n) > 0
  ),
  -- ⑨ 많이 찾는 구간 Top 10 — 홈 대표 노선(활성)과 같은 구간이면 표시한다.
  --    숨김은 **전체 쌍**에서 먼저 정하고, 상위 10 은 남은 칸에서 고른다(Top 10 은 표시 상한이지 숨김 규칙이 아니다).
  seg_raw as (
    select r.origin_code as o, r.destination_code as d, count(*)::bigint as n from r group by 1, 2
  ),
  seg_ranked as (
    select
      x.o, x.d, x.n,
      row_number() over (order by x.n asc, x.o asc, x.d asc) as rn,
      case
        when count(*) filter (where x.n < c_k) over () = 0 then 0
        when count(*) filter (where x.n < c_k) over () = 1 then least(2, count(*) over ())
        else count(*) filter (where x.n < c_k) over ()
      end as hide_n
    from seg_raw x
  ),
  seg_big as (
    select
      y.o, y.d, y.n,
      exists (
        select 1 from showcase_routes sr
         where sr.active and sr.origin_code = y.o and sr.destination_code = y.d
      ) as showcase
    from seg_ranked y
    where y.rn > y.hide_n
    order by y.n desc, y.o, y.d
    limit 10
  ),
  seg_rows as (
    select z.o, z.d, z.n, z.showcase, false as other from seg_big z
    union all
    select null::text, null::text, sum(y.n)::bigint, false, true from seg_ranked y where y.rn <= y.hide_n having sum(y.n) > 0
  ),
  -- ⑩ 운행일까지 남은 기간 — 네 구간(음수는 운행일이 지난 접수다. 가장 급한 칸에 넣는다)
  lead_raw as (
    select
      case
        when r.lead_days <= 7  then 'd0_7'
        when r.lead_days <= 30 then 'd8_30'
        when r.lead_days <= 90 then 'd31_90'
        else                        'd91_plus'
      end as bkt,
      count(*)::bigint as n
    from r
    group by 1
  ),
  lead_ranked as (
    select
      x.bkt, x.n,
      -- 동률이면 **먼 구간부터** 가린다 — 사장님이 가장 자주 보는 "7일 이내" 를 마지막까지 남긴다.
      row_number() over (order by x.n asc, array_position(array['d0_7', 'd8_30', 'd31_90', 'd91_plus'], x.bkt) desc) as rn,
      case
        when count(*) filter (where x.n < c_k) over () = 0 then 0
        when count(*) filter (where x.n < c_k) over () = 1 then least(2, count(*) over ())
        else count(*) filter (where x.n < c_k) over ()
      end as hide_n
    from lead_raw x
  ),
  lead_rows as (
    select y.bkt, y.n, false as other from lead_ranked y where y.rn > y.hide_n
    union all
    select null::text, sum(y.n)::bigint, true from lead_ranked y where y.rn <= y.hide_n having sum(y.n) > 0
  )
  select jsonb_build_object(
    'range', jsonb_build_object(
      'from',      to_char(p_from, 'YYYY-MM-DD'),
      'to',        to_char(p_to, 'YYYY-MM-DD'),
      'days',      v_days,
      'bucket',    v_bucket,
      'prev_from', case when v_has_prev then to_char(v_prev_from, 'YYYY-MM-DD') end,
      'prev_to',   case when v_has_prev then to_char(v_prev_to, 'YYYY-MM-DD') end,
      'has_prev',  v_has_prev
    ),
    'intake', jsonb_build_object(
      'total',      head.total,
      'prev_total', case when v_has_prev then prev.total end,
      'delta',      case when v_has_prev then head.total - prev.total end
    ),
    'confirmation', jsonb_build_object(
      'total',     head.total,
      'confirmed', head.confirmed,
      'rate_pct',  case when head.total > 0 then round(100.0 * head.confirmed / head.total)::int end,
      'pending',   head.pending
    ),
    'response_time', jsonb_build_object(
      'sample',         resp.sample,
      'median_minutes', case when resp.sample >= c_k then round(resp.median_seconds / 60.0)::int end,
      'enough',         resp.sample >= c_k
    ),
    'backlog', jsonb_build_object(
      'new_total', backlog.new_total,
      'over_72h',  backlog.over_hours,
      'hours',     c_backlog_hours
    ),
    'notifications', jsonb_build_object(
      'failed',      notif.failed,
      'stuck',       notif.stuck,
      'window_days', c_notify_days,
      'stuck_hours', c_notify_stuck_h
    ),
    'trend', (
      -- 🔴 판정은 **각 상태 칸의 건수**로 한다(수정 라운드 3). 총건수만 보면 하루 3건이 대기·확정·취소 1건씩일 때
      --    세 칸이 그대로 나간다 — 숨기려던 바로 그 모양이다(astra P1 반례). 어느 칸이든 1~2건이면 쪼개지 않는다.
      --    0건 칸은 드러낼 것이 없으므로 통과시킨다(그래야 `3·0·0` 같은 버킷이 정상적으로 쪼개진다).
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket',    to_char(t.bkt, 'YYYY-MM-DD'),
               'total',     t.total,
               'split',     t.splittable,
               'waiting',   case when t.splittable then t.waiting end,
               'confirmed', case when t.splittable then t.confirmed end,
               'cancelled', case when t.splittable then t.cancelled end) order by t.bkt), '[]'::jsonb)
        from trend t
    ),
    'purposes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code',       x.code,
               'count',      case when x.n >= c_k then x.n end,
               'suppressed', x.n < c_k,
               'other',      x.other) order by x.other, x.n desc, x.code), '[]'::jsonb)
        from purpose_rows x
    ),
    'vehicles', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug',       x.slug,
               'count',      case when x.n >= c_k then x.n end,
               'buses',      case when x.n >= c_k then x.buses end,
               'suppressed', x.n < c_k,
               'other',      x.other) order by x.other, x.n desc, x.slug), '[]'::jsonb)
        from vehicle_rows x
    ),
    'segments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'origin',      x.o,
               'destination', x.d,
               'count',       case when x.n >= c_k then x.n end,
               'showcase',    x.showcase,
               'suppressed',  x.n < c_k,
               'other',       x.other) order by x.other, x.n desc, x.o, x.d), '[]'::jsonb)
        from seg_rows x
    ),
    'lead_time', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket',     x.bkt,
               'count',      case when x.n >= c_k then x.n end,
               'suppressed', x.n < c_k,
               'other',      x.other)
               order by x.other, array_position(array['d0_7', 'd8_30', 'd31_90', 'd91_plus'], x.bkt)), '[]'::jsonb)
        from lead_rows x
    )
  )
  into v_out
  from head, prev, resp, backlog, notif;

  return v_out;
end;
$$;

-- §2 확인 — 권한·소유자·definer·search_path 가 적용 전과 **정확히** 같고, 본문이 새 판이다.
do $$
declare
  v_after text;
  v_src   text;
begin
  select format('%s|%s|%s|%s', coalesce(p.proacl::text, '(default)'), p.proowner::regrole, p.prosecdef, coalesce(array_to_string(p.proconfig, ' '), '(none)')), p.prosrc
    into v_after, v_src
    from pg_proc p where p.oid = 'public.admin_stats(date,date)'::regprocedure;
  if v_after is distinct from current_setting('p0023.stats_before', true) then
    raise exception '0023 §2: admin_stats 의 권한·소유자·성질이 바뀌었다 — 전 % · 후 %', current_setting('p0023.stats_before', true), v_after
      using hint = 'create or replace 는 이것들을 두는 것이 명세다. 바뀌었다면 누군가 drop 했거나 다른 세션이 끼었다.';
  end if;
  if position('bool_and(y.buses is not null)' in v_src) = 0 then
    raise exception '0023 §2: admin_stats 본문이 새 판이 아니다("기타" 대수 줄)';
  end if;
  if has_function_privilege('anon', 'public.admin_stats(date,date)', 'execute')
     or has_function_privilege('service_role', 'public.admin_stats(date,date)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_stats(date,date)', 'execute') then
    raise exception '0023 §2: admin_stats EXECUTE 가 0022 규약(authenticated 만)과 다르다';
  end if;
  raise notice '0023 §2: admin_stats "기타" 대수 — 접힌 칸에 대수 미상이 섞이면 null · 권한·소유자·definer·search_path 불변 (%)', v_after;
end
$$;
