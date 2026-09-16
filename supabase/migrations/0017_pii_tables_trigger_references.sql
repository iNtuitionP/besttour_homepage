-- 0017_pii_tables_trigger_references.sql — 개인정보 두 표에 남은 TRIGGER·REFERENCES 와 `anon` 의 SELECT 회수
--                                          (플랜 v4 P5-13 · ADR-2)
--
-- ## 왜 0016 으로 끝나지 않았나
-- 0016 은 **콘텐츠 일곱 표**에서 `TRUNCATE`·`TRIGGER`·`REFERENCES` 를 회수했다. 브리프가 범위를 그 일곱으로 못박았고,
-- 구현자는 범위를 지키면서 **같은 구멍이 개인정보 두 표에도 있다**고 보고했다(0016 헤더 "회수하지 않는 것" 마지막 항목).
-- 이 파일이 그 뒤를 잇는다. 적용 전 실측(2026-09-16, 로컬 스택):
--   reservations       | anon:          references, select, trigger
--   reservations       | authenticated: references, select, trigger
--   notifications_log  | anon:          references, select, trigger
--   notifications_log  | authenticated: references, select, trigger
--   (두 표 모두 PUBLIC 롤 grant 0 · 따로 부여된 컬럼 ACL 0 — `pg_class.relacl`·`pg_attribute.attacl` 을 aclexplode 로 전수)
--
-- **콘텐츠 표보다 위험이 크다.** `reservations` 에는 고객 성명·전화번호·이메일·문의내용이, `notifications_log` 에는
-- 수신처와 문자 본문이 들어 있다.
--
-- ## ① TRIGGER — 이것은 이론이 아니다. 붙여 봤고, 붙었다
-- `CREATE TRIGGER` 는 ⓐ 그 표의 TRIGGER 권한과 ⓑ **이미 존재하는** 트리거 반환 함수의 EXECUTE 만 요구한다
-- (스키마 CREATE 도, 표 소유권도 필요 없다 — 0012 헤더의 틀린 근거를 0016 이 정정했다). ⓑ 가 이 DB 에 실재한다:
--   supabase_functions.http_request   ← 행이 바뀔 때마다 **외부 URL 로 HTTP 호출**. anon·authenticated 모두 execute=true
-- 적용 전에 **실제로 시도해 봤다**(2026-09-16, 로컬 스택 · DO 블록 안에서 `set local role` → `create trigger` →
-- 마지막에 `raise` 로 전부 롤백):
--   [anon → reservations] CREATE TRIGGER 성공  ·  [anon → notifications_log] CREATE TRIGGER 성공
--   [authenticated → reservations] CREATE TRIGGER 성공  ·  [authenticated → notifications_log] CREATE TRIGGER 성공
-- 즉 그 권한을 가진 롤이 트리거를 붙이면 **접수가 들어올 때마다 고객 개인정보가 공격자 주소로 나간다.**
-- RLS 는 이것을 막지 못한다 — 트리거는 정책이 아니라 권한의 영역이고, TRIGGER 권한은 `CREATE TRIGGER` 때만 검사된다.
-- (오늘 PostgREST 로 DDL 을 칠 경로는 없다. 그러나 0012 가 "쓸 수 없다" 는 **틀린 근거**로 이 권한을 남겼고,
--  그 근거가 틀렸다는 것이 확인된 이상 근거 없이 남은 권한이다.)
--
-- ## ② REFERENCES — 0016 §③ 과 같은 판단, 같은 근거
-- 지금 실행 경로는 없다(`anon`·`authenticated` 에게 public 스키마 CREATE 가 없고, 임시 표에서 영구 표로 가는 외래키는
-- Postgres 가 거부하며, 남의 표에 제약을 더하려면 소유자여야 한다 — 두 표의 소유자는 postgres 다).
-- 그럼에도 회수한다: ⓐ 쓰이지 않는 권한이고 ⓑ "만들 수 없으니 괜찮다" 는 논증은 TRIGGER 에서 이미 한 번 틀렸으며
-- ⓒ 되살아났을 때의 피해가 조용하다(고객 표를 가리키는 외래키가 생기면 **보유기간 파기 크론이 조용히 실패한다** —
-- lib/retention/purge.ts 가 지우려는 행을 남의 외래키가 붙잡는다. 화면에는 아무 일도 일어나지 않는다).
-- **기존 외래키는 영향을 받지 않는다** — REFERENCES 는 제약을 **만들 때만** 검사되고, 이미 걸린
-- `notifications_log.reservation_id → reservations(id)` 의 무결성 검사는 내부 RI 트리거가 표 소유자 권한으로 돈다.
-- 같은 이유로 **트리거 발화에도 TRIGGER 권한은 필요하지 않다.**
--
-- ## ③ `anon` 의 `SELECT` — **회수한다.** 판단과 근거 (이 파일에서 유일하게 판단이 갈렸던 지점)
-- 0012 는 "select 는 회수하지 않는다" 고 했고 그 근거는 **관리자 화면이 읽는다** 였다. 그것은 `authenticated` 에만
-- 해당한다 — `anon` 에는 해당한 적이 없다. 두 표를 `anon` 으로 읽는 경로가 저장소에 **하나도 없다**(전수 확인):
--   · 홈 "접수 현황" 피드   → lib/queries/recent.ts — **서비스 롤**. 파일 헤더가 "reservations 는 RLS 정책이 없어
--     anon 으로는 0행이라 이 계층의 원칙으로는 만들 수 없다" 고 적고 예외로 등록돼 있다(tests/queries.test.ts).
--   · 예약확인 페이지       → lib/reservation-check/db.ts — **서비스 롤**(`server-only`).
--   · 통지 문안 변수        → lib/notify/vars.ts — 크론이 주입하는 **서비스 롤** 클라이언트.
--   · 파기 크론             → lib/retention/purge.ts — **서비스 롤**.
--   · 관리자 목록·발송 내역 → lib/admin/reservations.ts · lib/admin/notifications.ts — **`authenticated`**(SSR 세션).
-- 그리고 RLS 쪽에도 `anon` 을 위한 정책이 없다: 0009 의 `reservations_admin_select`·`reservations_admin_update`·
-- `notifications_log_admin_select` 는 전부 `to authenticated` 다. 즉 `anon` 의 select 는 **쓰이지 않는 권한**이다.
--
-- **회수하면 무엇이 달라지나**: PostgREST 가 빈 배열(`[]`·200) 대신 **권한 거부(401 · `42501`)** 를 낸다.
-- 그것이 이 회수의 요점이다. 지금의 "0행" 은 **정책이 없어서** 생기는 결과이므로, 누군가 `anon` 에 select 정책을
-- 하나 붙이는 순간(예: "접수 현황을 클라이언트에서 직접 읽자") 고객 표가 공개된다 — 권한 층이 비어 있기 때문이다.
-- 회수하면 그 실수가 **정책 한 줄로는 열리지 않는다.** 방어선이 하나(RLS)에서 둘(GRANT+RLS)로 늘어난다.
-- 바꾸는 단언: `tests/notify-vars.test.ts` 의 "anon 키로는 같은 조회가 0행이다" 는 **"권한 거부다"** 로 정확히 바뀐다.
-- 그 테스트의 의도는 "공개 롤은 고객 데이터를 못 본다" 였고, 회수는 그 의도를 **약화가 아니라 강화**한다
-- (0행은 "권한은 있는데 마침 볼 게 없다" 와 구분되지 않는다 — 거부는 구분된다).
--
-- ## 회수하지 않는 것 (범위를 좁게 잡는 것이 이 계열 마이그레이션의 핵심이다)
--   · 🔴 **`authenticated` 의 `select`** — 관리자 화면이 두 표를 그것으로 읽는다(0009 §6 의 grant + 두 select 정책).
--     한 칸이라도 회수하면 예약 목록과 발송 내역이 통째로 빈다. §3 ② 가 그것을 확인한다.
--   · **`anon`·`authenticated` 의 쓰기 네 동작** — 0010·0012 가 이미 회수했다. 여기서 다시 쓰지 않는 이유는
--     **롤백 때문이다**(0012 §2·0016 §2 와 같은 규약): 0017 롤백은 0017 이 회수한 것만 되돌려야 하는데,
--     여기에 적으면 롤백이 0010·0012 가 닫은 문을 되살리게 된다.
--   · **`service_role`·`postgres`** — 접수·enqueue·발송기·파기가 그것으로 돈다. §3 ③ 이 불변을 확인한다.
--   · **definer 함수의 본문·EXECUTE** — 한 글자도 건드리지 않는다. `drop function` 도 쓰지 않는다
--     (drop 하면 ACL 이 초기화돼 이 DB 의 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다 — CLAUDE.md §3).
--     §3 ⑥ 이 아웃박스 definer 함수 **넷**의 EXECUTE 보유자가 `service_role`(+소유자) 뿐임을 다시 확인한다.
--   · **`admin_users`** — 0009 가 이미 `revoke all` 했다. 이 파일의 대상이 아니다.
--
-- 기존 행 영향: 권한만 회수한다. 표·컬럼·CHECK·인덱스·정책·함수 변경 0, 데이터 변경 0.
--   §3 ⑦ 의 거동 탐침은 **실제 두 표에 아무것도 시도하지 않는다**(2026-09-17 개정, P5-15 astra R3 — CREATE TRIGGER 는
--   권한 검사 **전에** SHARE ROW EXCLUSIVE 를 기다려 잡으므로 거부될 시도도 접수를 멈출 수 있다). 거동은 서브트랜잭션 안의
--   일회용 표(`public.p0017_probe_tbl`)에서만 보고 통째로 되돌린다. 마지막에 두 표의 "사용자 트리거 0" 과 일회용 표 0 을 확인한다.
-- 재실행 안전: `revoke` 는 없는 권한을 회수해도 오류가 아니다. 조건 분기가 필요 없다.
-- PostgREST 스키마 캐시: 갱신하지 않는다. 표·컬럼·함수 시그니처가 그대로다(권한 변경은 캐시가 아니라 요청마다 평가된다).
-- 적용 경로: `supabase db push` 또는 SQL Editor. **`psql -f` 를 쓰지 마라** — 파일이 원자적이지 않아 자기검증이
--   `raise` 해도 앞 문장이 남는다(P4-5 리뷰 K1, docs/ops/migration-runbook.md).
-- ⚠️ §3 ⑦ 의 일회용 표는 적용 롤에 public 스키마 CREATE 가 필요하다(`postgres` 는 있다 — 0018·0019 와 같다).
-- ⚠️ §3 ⑦ 은 탐침 뒤 `reset role` 이 아니라 **시작할 때 캡처한 적용 롤**로 `set local role` 해서 돌아온다(2026-09-17 수정, GPT 검증 P2).
--    `reset role` 은 세션 기본 롤로 돌아가므로, `set role postgres` 후 적용하는 연결에서 권한이 옳아도 마지막 단언이 실패했다(로컬 재현).
-- 롤백: supabase/rollbacks/0017_pii_tables_trigger_references.down.sql (수동 실행 전용 · 승인 플래그 요구).

-- =========================================================================
-- 1. 두 표 × 두 공개 롤 — TRIGGER·REFERENCES 회수
--    표 이름을 한 줄로 적는다(0013 §1·0016 §1 과 같은 형태) — tests/write-privileges.test.ts 가 이 문장을 파싱해
--    상행이 회수한 (롤·표·권한) 삼중항과 하행이 부여하는 삼중항을 집합으로 대조한다.
-- =========================================================================
revoke trigger, references on table
  reservations, notifications_log
  from anon, authenticated;

-- =========================================================================
-- 2. `anon` 의 SELECT 회수 (헤더 ③ 의 판단)
--    `authenticated` 는 여기 없다 — 관리자 화면이 두 표를 읽는다.
-- =========================================================================
revoke select on table
  reservations, notifications_log
  from anon;

-- =========================================================================
-- 3. 자기검증 — 조용히 어긋나는 것들을 실행 중에 못박는다 (0012·0013·0014·0015·0016 과 같은 규약)
--
--    권한 회수는 조용히 어긋난다. 문장 하나가 빠져도, 롤 이름을 하나 빠뜨려도, 기본 권한이 다시 깔려도
--    오류는 나지 않고 그냥 "권한이 남는다". 그 상태에서 테스트는 여전히 green 이 될 수 있다 —
--    RLS 가 행을 막아 겉보기 결과가 같기 때문이다. 그리고 TRIGGER 는 RLS 가 막지도 않는다.
--
--    ① 두 표 × 두 공개 롤에서 `trigger`·`references` 가 false
--    ② `authenticated` 의 `select` 생존 — 관리자 화면이 두 표를 읽는다 (표 단위 + 컬럼 단위)
--    ③ `service_role`·`postgres` 는 일곱 동작 전부 불변
--    ④ `anon` 의 **표 단위** `select` 가 false (§2 의 결정)
--    ⑤ **컬럼 단위** 권한도 0 — 표 단위 revoke 가 지우지 못하는 경로
--       (`delete`·`truncate`·`trigger` 는 **표 전용**이라 컬럼 검사에 넣으면 22023 이다 — 0016 이 한 번 걸렸다)
--    ⑥ 아웃박스 definer 함수 넷의 EXECUTE 보유자가 `service_role`(+소유자) 뿐이고 service_role 이 실행할 수 있다
--    ⑦ **거동 탐침** — 행렬 대조로 끝내지 않는다. 단 **일회용 표에서만** `CREATE TRIGGER` 를 시도해
--       `anon`·`authenticated` 는 42501, TRIGGER 를 받은 `service_role`·`anon` 은 성공하는지(대조군 · 카탈로그↔거동 일치) 본다.
--       실제 두 표는 시도 없이 카탈로그로 본다(⑦-가 — 이유는 블록 안 🔴).
--
--    🔴 **④ 를 ⑤ 보다 먼저 본다 — 순서가 진단을 가른다.** 표 단위 `select` 를 가지면 컬럼 단위도 자동으로
--    참이 되므로(표 권한이 컬럼 권한을 함의한다), ⑤ 를 먼저 두면 표 단위 누락까지 "컬럼 단위 grant 가 남았다" 로
--    보고된다 — 엉뚱한 곳을 고치게 된다. 이 순서라면 두 사고가 서로 다른 메시지로 갈린다:
--      · `revoke select … from anon` 이 빠졌다            → ④ 가 잡는다
--      · 표 단위는 회수됐는데 컬럼 grant 가 따로 남아 있다 → ⑤ 가 잡는다 (표 단위 revoke 는 그것을 지우지 않는다)
--
--    `information_schema.role_table_grants` 를 쓰지 않는다 — grantor·grantee 가 활성 롤인 항목만 보이는
--    필터된 뷰라 PUBLIC 상속을 놓친다(CLAUDE.md §3). `has_table_privilege()` 는 PUBLIC 과 상속까지 잡고,
--    컬럼 단위 grant 는 `has_any_column_privilege()` 로 따로 본다.
-- =========================================================================
do $$
declare
  two        constant text[] := array['public.reservations', 'public.notifications_log'];
  bare       constant text[] := array['reservations', 'notifications_log'];
  fns        constant text[] := array['public.claim_pending_notifications(int, text[])',
                                      'public.mark_notification_sent(bigint, text)',
                                      'public.mark_notification_failed(bigint, text, boolean, bigint)',
                                      'public.reap_stale_notifications()'];
  -- 탐침에 쓰는 트리거 반환 함수. **일부러 내장 무해 함수를 쓴다**: 검사하는 것은 "TRIGGER 권한이
  -- CREATE TRIGGER 를 막는가" 이지 특정 함수가 아니고, pg_catalog 함수라면 어느 DB 에나 있어 원격에서도 같게 돈다.
  -- 이 DB 에서 실제로 위험한 함수는 supabase_functions.http_request 다(헤더 ①).
  probe_fn   constant text := 'pg_catalog.suppress_redundant_updates_trigger()';
  leaked     text;
  leaked_col text;
  lost       text;
  changed    text;
  fn_sig     text;
  fn_oid     oid;
  holders    text;
  -- 루프 변수 이름은 아래 질의의 컬럼 별칭(`t(tbl)`)과 겹치지 않게 짓는다 —
  -- 겹치면 plpgsql 이 `plpgsql.variable_conflict = error` 기본값으로 42702(ambiguous column) 를 낸다.
  role_name  text;
  probe_tbl  text;
  trg        text;
  probe_n    int := 0;
  created    boolean;
  expected   boolean;
  control_ok boolean := false;
  st         text;
  ms         text;
  applier    constant text := current_user;
begin
  -- ① TRIGGER·REFERENCES — 두 표 × 두 공개 롤. 하나라도 남으면 안 된다.
  select string_agg(format('%s → %s(%s)', r.role, t.tbl, p.priv), ', ' order by r.role, t.tbl, p.priv)
    into leaked
    from (values ('anon'), ('authenticated')) as r(role)
    cross join unnest(two) as t(tbl)
    cross join (values ('trigger'), ('references')) as p(priv)
   where has_table_privilege(r.role, t.tbl, p.priv);
  if leaked is not null then
    raise exception '0017: RLS 가 막지 못하는 권한이 개인정보 표에 남았다 — %', leaked
      using hint = '원인 셋을 순서대로 볼 것: ① §1 의 revoke 문에서 표나 롤이 빠졌다 ② 기본 권한(alter default privileges)이 다시 깔렸다 ③ PUBLIC 롤에 grant 가 있어 두 롤이 상속한다 — 표 단위 revoke 는 PUBLIC 의 grant 를 지우지 않는다. PUBLIC 전수는 `select a.privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a where a.grantee = 0` 로 본다. TRIGGER 가 남으면 supabase_functions.http_request 를 붙여 고객 성명·전화번호를 외부로 흘릴 수 있다.';
  end if;

  -- ② `authenticated` 의 select 생존 — 이 마이그레이션의 가장 큰 사고는 "너무 많이 회수하는 것" 이다.
  select string_agg(t.tbl, ', ' order by t.tbl)
    into lost
    from unnest(two) as t(tbl)
   where not has_table_privilege('authenticated', t.tbl, 'select')
      or not has_any_column_privilege('authenticated', t.tbl, 'select');
  if lost is not null then
    raise exception '0017: 관리자 화면이 읽어야 할 authenticated select 가 사라졌다 — %', lost
      using hint = '§2 의 회수 문장에 authenticated 가 섞였거나 all 이 들어갔다. 0009 §6 이 그 롤에 두 표의 읽기 권한을 준다 — 사라지면 관리자 예약 목록(lib/admin/reservations.ts)과 발송 내역(lib/admin/notifications.ts)이 통째로 빈다.';
  end if;

  -- ③ service_role·postgres 불변 — 접수·enqueue·발송기·파기가 그것으로 돈다.
  select string_agg(format('%s → %s(%s)', r.role, t.tbl, p.priv), ', ' order by r.role, t.tbl, p.priv)
    into changed
    from (values ('service_role'), ('postgres')) as r(role)
    cross join unnest(two) as t(tbl)
    cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('trigger'), ('references')) as p(priv)
   where not has_table_privilege(r.role, t.tbl, p.priv);
  if changed is not null then
    raise exception '0017: service_role·postgres 의 권한이 바뀌었다 — %', changed
      using hint = '회수 문장의 롤 목록에 service_role 이나 postgres 가 섞였다. 공개 접수(lib/reservations/db.ts)·아웃박스 enqueue(lib/notify/outbox.ts)·발송기(lib/notify/worker.ts)·파기 크론(lib/retention/purge.ts)이 전부 서비스 롤이다 — 하나라도 빠지면 접수가 죽는다.';
  end if;

  -- ④ `anon` 의 표 단위 select — §2 의 결정(헤더 ③). **⑤ 보다 먼저 본다**(위 🔴 의 이유).
  select string_agg(t.tbl, ', ' order by t.tbl)
    into leaked
    from unnest(two) as t(tbl)
   where has_table_privilege('anon', t.tbl, 'select');
  if leaked is not null then
    raise exception '0017: 공개 롤이 개인정보 표를 여전히 읽을 수 있다 — %', leaked
      using hint = '§2 의 `anon` 대상 select 회수 문장이 실행됐는지 확인할 것. 지금의 "0행" 은 RLS 정책이 없어서 생기는 결과일 뿐이라, 누군가 anon 용 select 정책을 한 줄 붙이는 순간 고객 표가 공개된다 — 권한 층이 비어 있으면 그 실수를 막을 것이 없다.';
  end if;

  -- ⑤ 컬럼 단위 — 표 단위 revoke 가 지우지 못하는 경로(has_table_privilege 는 이것을 못 본다).
  --    `delete`·`truncate`·`trigger` 는 **표 전용 권한**이라 여기에 넣으면 22023(unrecognized privilege type)이다.
  --    `authenticated` 의 select 는 살아 있어야 하므로 이 검사에서 제외한다(위 ② 가 반대 방향으로 본다).
  select string_agg(format('%s → %s(%s · 컬럼 단위)', r.role, t.tbl, p.priv), ', ' order by r.role, t.tbl, p.priv)
    into leaked_col
    from (values ('anon'), ('authenticated')) as r(role)
    cross join unnest(two) as t(tbl)
    cross join (values ('insert'), ('update'), ('references'), ('select')) as p(priv)
   where not (r.role = 'authenticated' and p.priv = 'select')
     and has_any_column_privilege(r.role, t.tbl, p.priv);
  if leaked_col is not null then
    raise exception '0017: 컬럼 단위 권한이 개인정보 표에 남았다 — %', leaked_col
      using hint = '표 단위 revoke 는 따로 부여된 컬럼 grant 를 지우지 않는다. 컬럼을 직접 회수할 것(revoke <권한> (컬럼) … ). 누가 줬는지는 pg_attribute.attacl 을 aclexplode 로 푼다. 컬럼 하나만 남아도 그 컬럼은 읽히거나 쓰인다 — reservations 의 phone 한 칸이면 충분하다. 표 단위 select 가 함께 남아 있다면 ④ 가 먼저 잡았을 것이다.';
  end if;

  -- ⑥ 아웃박스 definer 함수 넷 — 이 파일은 함수를 건드리지 않는다. 건드리지 않았음을 확인한다.
  foreach fn_sig in array fns loop
    fn_oid := to_regprocedure(fn_sig)::oid;
    if fn_oid is null then
      raise exception '0017: 아웃박스 definer 함수 % 가 없다', fn_sig
        using hint = '0005·0007·0014 가 적용됐는지 확인할 것. 0017 은 함수를 만들지도 지우지도 않는다 — 여기서 걸렸다면 앞선 마이그레이션이 빠졌거나 누가 drop 했다.';
    end if;

    -- 🔴 `proacl IS NULL` 은 "아무도 없음" 이 아니라 **기본 ACL**(소유자 + PUBLIC EXECUTE)이다. aclexplode(NULL) 은 0행이라
    --    그대로 두면 이 검사가 **통과**한다(P5-15 astra R4 P1). acldefault('f', 소유자) 로 채운다.
    select string_agg(distinct g, ', ')
      into holders
      from (
        select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as g
          from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where p.oid = fn_oid and a.privilege_type = 'EXECUTE'
      ) s
     where s.g <> 'service_role'
       and s.g <> (select pg_get_userbyid(proowner) from pg_proc where oid = fn_oid);
    if holders is not null then
      raise exception '0017: % 의 EXECUTE 를 service_role 말고도 갖고 있다 — %', fn_sig, holders
        using hint = '0005 §6 · 0007 · 0014 §3 의 revoke all … from public, anon, authenticated 가 되돌려졌다. PUBLIC 이 보이면 누군가 drop function 후 재생성해 이 DB 의 기본 권한이 다시 붙었거나 ACL 이 NULL(기본값 = PUBLIC EXECUTE)이다(CLAUDE.md §3). 이 문이 열리면 /rpc 로 통지 큐를 조작할 수 있어 표 권한 회수가 무의미해진다.';
    end if;

    -- 유효값으로도 본다 — 직접 ACL 이 아니라 PUBLIC·멤버십으로 얻은 EXECUTE 까지(ACL 해석과 독립된 두 번째 판정).
    select string_agg(r.role, ', ' order by r.role)
      into holders
      from (values ('anon'), ('authenticated')) r(role)
     where has_function_privilege(r.role, fn_oid, 'EXECUTE');
    if holders is not null then
      raise exception '0017: 공개 롤이 % 를 실행할 수 있다(유효 EXECUTE) — %', fn_sig, holders
        using hint = '직접 ACL 검사가 통과했는데 여기 걸렸다면 멤버십이나 PUBLIC 상속 경로다. 아웃박스 definer 함수는 서비스 롤 전용이어야 한다.';
    end if;

    if not has_function_privilege('service_role', fn_oid, 'execute') then
      raise exception '0017: service_role 이 % 를 실행할 수 없다 — 발송기가 멈춘다', fn_sig
        using hint = '0005 §6 · 0007 · 0014 의 grant execute … to service_role 이 살아 있는지 확인할 것.';
    end if;
  end loop;

  -- ⑦ 거동 탐침 — **실제 두 표에는 CREATE TRIGGER 를 시도하지 않는다** (P5-15 astra R3 · 2026-09-17 개정).
  --
  --    🔴 왜: PostgreSQL 17 `CreateTriggerFiringOn`(src/backend/commands/trigger.c)은 **표를 먼저 잠그고 권한은 나중에 본다**:
  --         rel = table_open(relOid, ShareRowExclusiveLock);   /  rel = table_openrv(stmt->relation, ShareRowExclusiveLock);
  --         …
  --         /* permission checks */
  --         aclresult = pg_class_aclcheck(RelationGetRelid(rel), GetUserId(), ACL_TRIGGER);
  --    즉 **거부될 시도도** SHARE ROW EXCLUSIVE 를 **기다려서** 잡는다(NOWAIT 없음) — 진행 중인 접수 insert 뒤에 줄을 서고, 그 뒤의 새
  --    insert 는 이 잠금 뒤에 줄을 선다. 옛 판은 또 대조군이 실제 표에 트리거를 **만들고** `drop trigger` 했는데, drop 은
  --    ACCESS EXCLUSIVE 를 **마이그레이션 커밋까지** 쥔다(RemoveTriggerById: table_open(relid, AccessExclusiveLock)). 원격 적용 중에 접수를 멈춘다.
  --    그래서 이렇게 나눈다:
  --      ⑦-가 실제 두 표는 **카탈로그로만** 본다 — CREATE TRIGGER 를 허용할 수 있는 것은 표의 TRIGGER 권한뿐이고
  --           (소유권·슈퍼유저·멤버십·PUBLIC 은 has_table_privilege 가 반영한다), 종류는 acldefault 열거에서 얻는다.
  --           ① 이 이미 본 것을 **시도 자리에서 한 번 더** 본다 — 하나라도 true 면 멈춘다(아무것도 시도하지 않았다).
  --      ⑦-나 거동은 **일회용 표**에서 본다 — 서브트랜잭션 안에서 만들고 끝에서 예외로 통째로 되돌린다.
  --           그 표에는 TRIGGER 권한을 **service_role 에게만** 준다(나머지 기본 권한은 전부 회수).
  --           anon·authenticated 는 42501, service_role 은 성공(대조군), 그리고 **anon 에게 TRIGGER 만 주면 성공**한다(카탈로그 ↔ 거동 일치 —
  --           ⑦-가 가 보는 권한이 정확히 그 거동을 결정한다는 증거). 매 시도 전에 has_table_privilege 의 예측을 적어 두고 결과와 대조한다.
  --    일회용 표의 DDL(CREATE TABLE·CREATE TRIGGER)은 이벤트 트리거를 태운다 — 트리거는 태그로 분기할 수 있으므로 "revoke 도 DDL 이니
  --    같다" 는 성립하지 않는다(P5-15 astra R4). 원격 적용 **직전**에 pg_event_trigger 를 읽어 확인한다(runbook "적용 직전 필수").
  --
  --    ⑦-가 실제 두 표 — 시도 없이 카탈로그로.
  select string_agg(format('%s → %s(%s)', r.role, t.tbl, lower(d.privilege_type)), ', ' order by r.role, t.tbl, d.privilege_type)
    into leaked
    from (values ('anon'), ('authenticated')) as r(role)
    cross join unnest(two) as t(tbl)
    cross join lateral aclexplode(acldefault('r', (select relowner from pg_class where oid = t.tbl::regclass))) d
   where d.privilege_type = 'TRIGGER'  -- 소스 근거: src/backend/commands/trigger.c CreateTriggerFiringOn — pg_class_aclcheck(…, ACL_TRIGGER) 하나뿐
     and has_table_privilege(r.role, t.tbl, d.privilege_type);
  if leaked is not null then
    raise exception '0017: 공개 롤이 개인정보 표에 트리거를 붙일 수 있는 권한을 갖고 있다 — % (실제 표에는 아무것도 시도하지 않았다)', leaked
      using hint = '① 이 통과했는데 여기 걸렸다면 판정 밖 경로(멤버십·소유권)다. 실제 표에 CREATE TRIGGER 를 치지 않는 이유: 권한 검사 전에 SHARE ROW EXCLUSIVE 를 기다려 잡기 때문에 거부될 시도도 접수를 멈출 수 있다.';
  end if;

  --    ⑦-나 일회용 표 — 거동과 대조군. 끝에서 P0017 로 통째로 되돌린다.
  begin
    execute 'create table public.p0017_probe_tbl (id int)';
    -- PUBLIC 까지 회수한다 — 기본 PUBLIC TRIGGER 가 있으면 거부 기대가 깨진다(P5-15 astra R4 P2-3).
    execute 'revoke all on table public.p0017_probe_tbl from public, anon, authenticated, service_role';
    execute 'grant trigger on table public.p0017_probe_tbl to service_role';

    -- 마지막 줄의 anon 은 **TRIGGER 를 준 뒤** 다시 시도한다(카탈로그 ↔ 거동 일치의 반대쪽).
    foreach role_name in array array['anon', 'authenticated', 'service_role', 'anon+trigger'] loop
      probe_n := probe_n + 1;
      trg := format('p0017_probe_%s', probe_n);
      probe_tbl := role_name;
      if role_name = 'anon+trigger' then
        execute 'grant trigger on table public.p0017_probe_tbl to anon';
        role_name := 'anon';
      end if;
      -- 의도한 유효 권한만 — 세 롤 × 열거한 표 권한 종류 전부. TRIGGER 는 service_role(과 이 단계의 anon)에게만, 나머지는 전부 false.
      select string_agg(format('%s(%s)=%s', w.role, lower(d.privilege_type), has_table_privilege(w.role, 'public.p0017_probe_tbl', d.privilege_type)), ', ')
        into leaked
        from (values ('anon'), ('authenticated'), ('service_role')) w(role)
        cross join lateral aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.p0017_probe_tbl'::regclass))) d
       where has_table_privilege(w.role, 'public.p0017_probe_tbl', d.privilege_type)
             is distinct from (d.privilege_type = 'TRIGGER'
                               and (w.role = 'service_role' or (w.role = 'anon' and probe_tbl = 'anon+trigger')));
      if leaked is not null then
        raise exception '0017: 일회용 표의 유효 권한이 의도와 다르다 — % (단계 %)', leaked, probe_tbl
          using hint = 'PUBLIC 이나 기본 권한(alter default privileges)이 남아 있으면 거부 기대나 대조군이 엉뚱한 이유로 성립한다. 회수 목록에 public 이 있는지 볼 것.';
      end if;

      -- 예측 — 시도 전에 카탈로그가 뭐라고 하는가
      expected := has_table_privilege(role_name, 'public.p0017_probe_tbl', 'TRIGGER');  -- src/backend/commands/trigger.c CreateTriggerFiringOn (ACL_TRIGGER)
      created := false;
      st := null;
      ms := null;

      -- 롤 전환 자체가 실패하면(적용 롤이 그 롤의 멤버가 아님) 탐침 결과를 "거부" 로 오독할 수 있다 — 따로 잡는다.
      begin
        execute format('set local role %I', role_name);
      exception when others then
        get stacked diagnostics st = returned_sqlstate, ms = message_text;
        raise exception '0017: 거동 탐침이 롤 %(으)로 전환하지 못했다 — % %', role_name, st, ms
          using hint = '이 마이그레이션을 적용하는 롤이 anon·authenticated·service_role 의 멤버가 아니다. 보통 postgres(또는 supabase_admin)로 적용하며 그 롤은 셋 모두의 멤버다 — `supabase db push` 또는 SQL Editor 로 적용할 것. 멤버가 아니면 ⑦ 의 결과가 "권한이 없어 거부" 인지 "롤 전환 실패" 인지 구분되지 않으므로 조용히 통과시키지 않는다.';
      end;
      if current_user <> role_name then
        raise exception '0017: 거동 탐침의 롤 전환이 반영되지 않았다 (current_user=% · 기대=%)', current_user, role_name
          using hint = 'set local role 이 트랜잭션 블록 밖이라 무시됐을 수 있다. DO 블록 안에서는 암묵 트랜잭션이 있어 정상 동작한다 — 적용 경로를 확인할 것.';
      end if;

      begin
        execute format('create trigger %I before update on public.p0017_probe_tbl for each row execute function %s', trg, probe_fn);
        created := true;
      exception when others then
        get stacked diagnostics st = returned_sqlstate, ms = message_text;
      end;
      -- 적용 롤로 **명시적으로** 돌아온다. `reset role` 을 쓰지 않는다 — 그것은 캡처한 적용 롤이 아니라 **세션 기본 롤**로 돌아간다
      -- (GPT 검증 P2 · 로컬 재현: session_user=supabase_admin 에서 set role postgres 로 적용하면 마지막 단언이 실패했다).
      execute format('set local role %I', applier);
      if current_user <> applier then
        raise exception '0017: 탐침 뒤 적용 롤(%)로 돌아오지 못했다 (current_user=%)', applier, current_user;
      end if;

      if created is distinct from expected then
        raise exception '0017: 카탈로그와 거동이 어긋난다 — % (%) : has_table_privilege(TRIGGER)=% · CREATE TRIGGER 성공=% (SQLSTATE=% MESSAGE=%)', role_name, probe_tbl, expected, created, st, ms
          using hint = '⑦-가 는 실제 표를 카탈로그로만 본다 — 그 판단이 옳으려면 TRIGGER 권한이 CREATE TRIGGER 를 정확히 결정해야 한다. 어긋나면 ⑦-가 의 결론을 믿을 수 없다.';
      end if;
      if probe_tbl in ('anon', 'authenticated') and st is distinct from '42501' then
        raise exception '0017: 탐침이 권한 거부(42501)가 아닌 이유로 실패했다 — % : SQLSTATE=% MESSAGE=%', role_name, st, ms
          using hint = '거부는 됐지만 이유가 권한이 아니다(함수가 없다 등). 그 상태에서는 "권한이 거동을 막는다" 가 증명되지 않는다.';
      end if;
      if probe_tbl in ('service_role', 'anon+trigger') and not created then
        raise exception '0017: 대조군이 실패했다 — % 가 TRIGGER 를 가진 일회용 표에 트리거를 붙이지 못했다 (SQLSTATE=% MESSAGE=%)', probe_tbl, st, ms
          using hint = '탐침 SQL 이 틀렸거나(트리거 함수가 없다) 롤 전환이 되지 않는다. 대조군이 실패하면 anon·authenticated 의 "거부" 는 아무것도 증명하지 못한다 — 그래서 여기서 멈춘다.';
      end if;
    end loop;

    raise exception using errcode = 'P0017', message = 'p0017 probe rollback';
  exception
    when sqlstate 'P0017' then
      control_ok := true;
  end;
  if not control_ok then
    raise exception '0017: 거동 탐침이 끝까지 돌지 않았다';
  end if;
  if to_regclass('public.p0017_probe_tbl') is not null then
    raise exception '0017: 일회용 표가 남았다'
      using hint = '⑦-나 서브트랜잭션이 되돌려지지 않았다. public.p0017_probe_tbl 을 직접 지울 것.';
  end if;

  if current_user <> applier then
    raise exception '0017: 탐침이 롤을 되돌리지 못했다 (current_user=% · 기대=%)', current_user, applier
      using hint = '이 상태로 뒤 문장이 돌면 엉뚱한 롤로 실행된다. 적용 롤 복원(set local role <적용 롤>)이 빠진 경로가 있는지 확인할 것. reset role 로 바꾸면 안 된다 — 세션 기본 롤로 돌아간다.';
  end if;

  select string_agg(format('%s.%s', tgrelid::regclass::text, tgname), ', ')
    into leaked
    from pg_trigger
   where not tgisinternal
     and tgrelid in ('public.reservations'::regclass, 'public.notifications_log'::regclass);
  if leaked is not null then
    raise exception '0017: 탐침이 만든 트리거가 남았다 — %', leaked
      using hint = '⑦ 의 drop trigger 경로가 빠졌다. 남은 트리거를 직접 지울 것: drop trigger <이름> on <표>.';
  end if;
end
$$;
