-- 0016_privileges_rls_cannot_protect.sql — RLS 가 **애초에 막지 못하는** 권한을 회수한다 (플랜 v4 P5-12 · ADR-2)
--
-- ## 왜 0012·0013 으로 끝나지 않았나
-- 0012 는 두 개인정보 표에서, 0013 은 콘텐츠 7표에서 `anon`·`authenticated` 의 **쓰기 네 동작**을 회수했다.
-- 두 파일 모두 "RLS 가 유일한 방어선인 상태를 끝낸다" 고 선언했는데, 그 선언은 **네 동작에 대해서만** 참이었다.
-- 남은 것은 `TRUNCATE`·`TRIGGER`·`REFERENCES` 인데, 앞의 둘은 **RLS 가 관여하는 종류의 권한이 아니다.**
-- 즉 이 세 가지에 대해서는 "RLS 가 유일한 방어선" 조차 아니고 **아무 방어선도 없다.**
--
-- 적용 전 실측(2026-09-16, 로컬 스택):
--   notices · popups · gallery · gallery_albums · showcase_routes · vehicles · places
--     authenticated : delete, insert, references, select, trigger, truncate, update
--     anon          : references, select, trigger        ← 0013 이 네 동작만 회수해서 둘이 남았다
--
-- ## ① TRUNCATE — RLS 의 적용을 받지 않는다
-- 정책이 몇 개든, `is_admin()` 이 얼마나 촘촘하든 상관없다. TRUNCATE 는 행을 하나씩 보지 않으므로 정책 평가 자체가
-- 일어나지 않고, 권한을 가진 롤은 표를 **통째로** 비운다. 관리자 화면은 TRUNCATE 를 쓰지 않는다 — 한 행씩 지운다
-- (lib/admin/notices.ts·popups.ts·gallery.ts·routes.ts 전부 `.delete().eq('id', …)` 다. 저장소 전체에 SQL TRUNCATE 0건).
-- 지금 `authenticated` 는 사실상 사장님 한 사람이다(공개 가입 차단). 그래도 남겨 둘 이유가 없다:
-- 이 권한이 쓰이는 정상 경로가 **하나도 없고**, 사고가 나면 되돌릴 수 없다.
--
-- ## ② TRIGGER — 0012 헤더가 적은 "쓸 수 없다" 는 근거가 **틀렸다**
-- 0012 는 TRIGGER·REFERENCES 를 남기며 *"둘 다 다른 객체를 만들 수 있어야 쓸모가 있는데 public 스키마 CREATE 권한이
-- 없다"* 고 적었다. REFERENCES 에는 맞는 말이지만 **TRIGGER 에는 맞지 않는다.**
-- `CREATE TRIGGER` 는 ⓐ 그 표의 TRIGGER 권한과 ⓑ **이미 존재하는** 트리거 반환 함수의 EXECUTE 만 요구한다 —
-- 새 함수도, 새 표도, 스키마 CREATE 도 필요 없다. 그리고 이 DB 에는 ⓑ 가 실제로 있다(2026-09-16 실측):
--   supabase_functions.http_request     ← 행이 바뀔 때마다 **외부 URL 로 HTTP 호출**. anon·authenticated 모두 execute=true
--   storage.protect_delete · storage.update_updated_at_column · realtime.subscription_check_filters · pg_catalog 다수
-- `http_request` 트리거를 붙일 수 있으면 그 표의 모든 변경이 공격자 주소로 흘러 나간다. 표 소유자가 아니어도 된다 —
-- `CREATE TRIGGER` 는 소유권이 아니라 TRIGGER 권한을 본다. (오늘 PostgREST 로 DDL 을 칠 경로는 없다. 그러나
-- 0012 가 남긴 근거는 "경로가 없다" 가 아니라 "만들 수 없다" 였고, **그 문장이 사실이 아니다.** 틀린 근거로 남긴
-- 권한은 다음 사람이 같은 근거로 다시 남긴다 — 그래서 근거를 고치고 권한을 회수한다. 0012 헤더에 정정을 남겼다.)
--
-- ## ③ REFERENCES — 회수한다. 판단과 근거
-- REFERENCES 는 "이 표를 가리키는 외래키를 만들 수 있다" 이고, 그러려면 **외래키를 걸 표**가 있어야 한다.
--   · `anon`·`authenticated` 는 public 스키마에 CREATE 가 없다(실측 false) — 영구 표를 만들 수 없다.
--   · `pg_temp` 에는 만들 수 있지만 Postgres 는 임시 표에서 영구 표로 가는 외래키를 거부한다.
--   · 남의 표에 `alter table … add constraint` 를 하려면 **그 표의 소유자**여야 한다. 일곱 표 소유자는 전부 postgres 다.
-- 즉 TRIGGER 와 달리 REFERENCES 는 지금 실행 경로가 정말 없다. **그럼에도 회수하는 이유는 셋이다.**
--   ⓐ 쓰이지 않는 권한이다. 이 파일이 회수하는 다른 것들과 정확히 같은 기준이고, 남길 이유가 하나도 없다.
--   ⓑ **"만들 수 없으니 괜찮다" 는 바로 지금 한 번 틀린 논증이다**(위 ②). 같은 논증에 두 번째로 기대지 않는다.
--       스키마 CREATE 가 어딘가에 생기는 순간 — 통합용 스키마 하나, 확장 하나 — 이 권한은 조용히 살아난다.
--   ⓒ 살아났을 때의 피해가 조용하다. 콘텐츠 표를 가리키는 외래키가 생기면 사장님이 공지 하나를 못 지우게 되는데,
--       화면에는 "삭제 실패" 만 뜨고 원인은 DB 안에 있다.
-- **기존 외래키는 영향을 받지 않는다.** REFERENCES 는 제약을 **만들 때만** 검사되고, 이미 걸린
-- `showcase_routes_origin_code_fkey`(→ places) · `gallery.album_id`(→ gallery_albums) 의 무결성 검사는
-- 내부 RI 트리거가 표 소유자 권한으로 돌아 호출자의 권한·RLS 와 무관하다.
-- 같은 이유로 **트리거 발화에도 TRIGGER 권한은 필요하지 않다** — 그 권한은 `CREATE TRIGGER` 때만 검사된다.
-- 0015 가 `gallery_albums` 에 건 `before delete` 트리거는 회수 뒤에도 관리자의 삭제에서 그대로 발화한다.
-- 이 둘(외래키 있는 표에 쓰기 · 트리거 달린 표에서 삭제)은 행렬 대조로는 증명되지 않는다 —
-- tests/write-privileges.test.ts §5 가 **관리자 세션으로 실제 쓰고 지워** 2xx 를 확인한다.
--
-- ## ④ `places` — 관리자 쓰기 정책이 아예 없는데 전권을 갖고 있다
-- `places` 의 정책은 `places_select_active`(0002:60) **하나뿐**이다. 0009 §5 가 관리자 쓰기 정책(`*_admin_all`)을
-- 단 **여섯 표**에만 달았고 `places` 는 빠져 있다. 코드에도 쓰기 경로가 없다 — `lib/queries/places.ts` 의 `getPlaces`
-- 가 유일한 접근이고 select 다. 즉 `authenticated` 의 insert/update/delete 는 **쓰이지 않는 권한**이고,
-- RLS 가 0행으로 만들어 주지만 그 "0행" 을 PostgREST 는 **성공(204)** 으로 보고한다(0012 헤더가 적은 그 함정).
-- **`select` 는 남긴다** — 관리자 노선 편집 화면이 출발·도착 후보를 이 표에서 읽고(lib/admin/routeInput.ts),
-- 공개 지도 히어로도 `anon` 으로 읽는다.
--
-- ## ⑤ definer 함수의 `search_path` 에 `pg_temp` 가 빠져 있다
-- 0009·0010·0014·0015 는 `set search_path = public, pg_temp` 로 한다. 목록에서 `pg_temp` 를 빼면 Postgres 가
-- 그것을 **맨 앞**에서 암묵 검색하므로, 호출자가 만든 `pg_temp.notifications_log` 가 진짜 표를 가릴 수 있다
-- (P4-5 독립 리뷰 K2 가 같은 본문의 함수 둘로 실증 재현했다: `public` 만 쓴 쪽만 가려졌다).
-- 지금 EXECUTE 가 `service_role` 뿐이라 공개 exploit 은 없다. 고치는 이유는 **정본 형태와 다른 것 자체**다.
--
-- 🔴 **고칠 함수는 넷이 아니라 셋이다.** 후속 목록(runbook)과 이 태스크의 브리프는 `0005:96` 의
-- `claim_pending_notifications(int)` 를 포함해 넷으로 적었는데, **그 함수는 이미 존재하지 않는다.**
-- `0014` 가 `drop function if exists claim_pending_notifications(int)` 로 지우고 2-인자
-- `claim_pending_notifications(int, text[])` 를 만들었으며 그쪽은 처음부터 `public, pg_temp` 다(실측 확인).
-- 여기서 1-인자 형태를 `create or replace` 하면 **없던 함수를 새로 만드는 것**이 되어 두 함수가 공존하고,
-- `claim_pending_notifications(10)` 호출이 **모호(42725)** 해져 **발송기가 통째로 멈춘다** — 0014 §4 ① 이 정확히
-- 그 사고를 막으려고 있는 검사다. 그래서 이 파일은 claim 함수를 **건드리지 않고**, §5 ⑥ 이 1-인자 형태가
-- 되살아나지 않았음을 다시 확인한다.
--
-- 🔴 **`drop function` 을 쓰지 않는다.** 이 DB 의 기본 권한은 함수 EXECUTE 를 `anon`·`authenticated`·`service_role`
-- 에게 **적극적으로 부여한다**(CLAUDE.md §3 의 `pg_default_acl` 실측 — 부여자 `postgres`·`supabase_admin` 둘,
-- 대상 넷). drop 하면 ACL 이 초기화되고 재생성 시 그 부여가 다시 붙는다(0014 가 그래서 §3 의 revoke 가 필요했다).
-- **`create or replace` 는 기존 함수의 ACL 을 보존한다** — 그래서 이 파일에는 revoke/grant 가 한 줄도 없고,
-- §5 ④ 가 "보존됐다" 를 실행 중에 확인한다(보존되지 않았다면 그 자리에서 멈춘다).
-- 함수 **본문 로직은 한 글자도 바꾸지 않는다** — 0005·0007 원문 그대로이고 `set` 줄 하나만 다르다.
--
-- ## 회수하지 않는 것 (범위를 좁게 잡는 것이 이 계열 마이그레이션의 핵심이다)
--   · **콘텐츠 6표의 `authenticated` select·insert·update·delete** — 관리자 화면이 그것으로 쓴다. 한 칸이라도
--     회수하면 화면이 죽는다(0009 §5·§6). §5 ③ 이 그것을 확인하고, tests/write-privileges.test.ts §5 가
--     행렬이 아니라 **실제 쓰기·삭제 2xx** 로 증명한다.
--   · **`places` 의 `select`** (위 ④) · **모든 롤의 `select`**.
--   · **`service_role`** — 서버 전용 키이고 접수·enqueue·발송기·파기가 그것으로 돈다. 이 파일의 대상이 아니다.
--   · **`reservations`·`notifications_log` 의 TRIGGER·REFERENCES** — 실측하니 두 표에도 남아 있다
--     (`anon`·`authenticated` 둘 다 `references, select, trigger`). 개인정보가 든 표라 위험은 더 크지만
--     **이 태스크의 범위가 아니다**(브리프가 일곱 표로 못박았다). 보고서 ⑧ 과 runbook 후속 목록에 올린다.
--     → **후속 완료 (2026-09-16 · P5-13 / 0017).** `supabase/migrations/0017_pii_tables_trigger_references.sql`
--       이 두 표에서 TRIGGER·REFERENCES 를 회수하고, 함께 **`anon` 의 SELECT** 도 회수했다(그 select 를 쓰는
--       공개 경로가 하나도 없다 — 전부 서비스 롤이다). 0017 은 이 파일을 한 글자도 바꾸지 않는다(위 세 줄은
--       그대로 두는 것이 기록이다). 0017 적용 전에 두 표에 `http_request` 트리거를 **실제로 붙여 봤고 붙었다.**
--
-- 기존 행 영향: 권한을 회수하고 함수 셋의 `search_path` 를 바꾼다. 표·컬럼·CHECK·인덱스·정책 변경 0, 데이터 변경 0.
--   0014·0015 와 달리 **자기검증도 행을 만들지 않는다** — §5 는 카탈로그만 읽는다(임시 행을 넣는 거동 탐침이 없다).
--   거동은 카탈로그로 증명할 수 없는 종류라 테스트가 맡는다: `tests/write-privileges.test.ts` §5 가 관리자 세션으로
--   실제 쓰고 지우며, TRUNCATE·TRIGGER 는 PostgREST 로 호출할 방법이 아예 없어 같은 파일 §9 의 행렬이 유일한 증거다.
-- 재실행 안전: `revoke` 는 없는 권한을 회수해도 오류가 아니고, `create or replace` 는 멱등이다.
-- PostgREST 스키마 캐시: 갱신하지 않는다. 함수 **시그니처**가 바뀌지 않았고(0014 는 그래서 필요했다) 표·컬럼 모양도 그대로다.
-- 적용 경로: `supabase db push` 또는 SQL Editor. **`psql -f` 를 쓰지 마라** — 파일이 원자적이지 않아 자기검증이
--   `raise` 해도 앞 문장이 남는다(P4-5 리뷰 K1, docs/ops/migration-runbook.md).
-- 롤백: supabase/rollbacks/0016_privileges_rls_cannot_protect.down.sql (수동 실행 전용 · 승인 플래그 요구 — 근거는 그 파일 헤더).

-- =========================================================================
-- 1. 일곱 표 — `authenticated` 의 TRUNCATE·TRIGGER·REFERENCES 회수
--    표 이름을 한 줄로 적는다(0013 §1 과 같은 형태) — tests/write-privileges.test.ts 가 이 문장을 파싱해
--    상행이 회수한 (롤·표·권한) 삼중항과 하행이 부여하는 삼중항을 집합으로 대조한다.
-- =========================================================================
revoke truncate, trigger, references on table
  notices, popups, gallery, gallery_albums, showcase_routes, vehicles, places
  from authenticated;

-- =========================================================================
-- 2. 같은 일곱 표 — `anon` 의 TRIGGER·REFERENCES 회수
--    0013 은 네 동작(insert·update·delete·truncate)만 회수했다. 그래서 공개 롤에 이 둘이 남아 있었다.
--    TRUNCATE 를 여기서 다시 쓰지 않는 이유는 **롤백 때문이다**(0012 §2 와 같은 규약): 0016 롤백은 0016 이
--    회수한 것만 되돌려야 하는데, 여기에 anon 의 TRUNCATE 를 적으면 롤백이 0013 이 닫은 문을 되살리게 된다.
-- =========================================================================
revoke trigger, references on table
  notices, popups, gallery, gallery_albums, showcase_routes, vehicles, places
  from anon;

-- =========================================================================
-- 3. `places` — `authenticated` 의 쓰기 세 동작 회수 (`select` 는 남긴다)
--    관리자 쓰기 정책이 없고(0009 가 여섯 표에만 달았다) 코드 경로도 없다. TRUNCATE 는 §1 이 이미 가져갔다.
-- =========================================================================
revoke insert, update, delete on table places from authenticated;

-- =========================================================================
-- 4. definer 함수 셋 — `search_path` 에 `pg_temp` 를 더한다
--    본문은 0005 §5 · 0007 원문 그대로다. `create or replace` 라 ACL 이 보존되고(헤더 🔴), 그래서
--    revoke/grant 가 한 줄도 없다 — §5 ④ 가 보존을 확인한다.
--    claim_pending_notifications 는 여기 없다: 0014 의 2-인자 판이 이미 `public, pg_temp` 이고,
--    1-인자 판을 되살리면 호출이 모호해져 발송기가 멈춘다(헤더 🔴 · §5 ⑥).
-- =========================================================================

-- pending → sent. 같은 키로 이미 sent 가 있으면(부분 유니크 위반) 이 행을 failed/duplicate_sent 로 남기고 false.
create or replace function mark_notification_sent(p_id bigint, p_provider_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
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
create or replace function mark_notification_failed(p_id bigint, p_error text, p_give_up boolean, p_retry_after_ms bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update notifications_log
  set status          = case when p_give_up then 'failed' else 'pending' end,
      last_error      = p_error,
      updated_at      = now(),
      next_attempt_at = case when p_give_up then now()
                             else now() + make_interval(secs => greatest(coalesce(p_retry_after_ms, 0), 0) / 1000.0) end
  where id = p_id and status = 'pending';
$$;

-- 5회 claim 뒤 lease 가 만료된 pending 을 failed 로 회수한다(0007).
create or replace function reap_stale_notifications()
returns setof notifications_log
language sql
security definer
set search_path = public, pg_temp
as $$
  update notifications_log
  set status     = 'failed',
      last_error = 'lease_expired_after_max_attempts',
      updated_at = now()
  where status = 'pending' and attempts >= 5 and next_attempt_at <= now()
  returning *;
$$;

-- =========================================================================
-- 5. 자기검증 — 조용히 어긋나는 것들을 실행 중에 못박는다 (0012·0013·0014·0015 와 같은 규약)
--
--    권한 회수는 조용히 어긋난다. 문장 하나가 빠져도, 롤 이름을 하나 빠뜨려도, 기본 권한이 다시 깔려도
--    오류는 나지 않고 그냥 "권한이 남는다". 그 상태에서 테스트는 여전히 green 이 될 수 있다 —
--    RLS 가 행을 막아 겉보기 결과가 같기 때문이다(그리고 TRUNCATE·TRIGGER 는 RLS 가 막지도 않는다).
--
--    ① 일곱 표에서 `authenticated` 의 truncate·trigger·references 가 false
--    ② `places` 의 authenticated insert/update/delete 가 false 이고 select 는 true
--    ③ 나머지 여섯 표의 `authenticated` CRUD 생존 — **관리자 화면이 죽으면 안 된다**
--    ④ 함수 셋의 proconfig 에 pg_temp 가 있고 EXECUTE 보유자가 `service_role`(+소유자) 뿐이며 그가 실행할 수 있다
--    ⑤ `anon` 은 일곱 표에서 여전히 `select` 만
--    ⑥ (보너스) 1-인자 claim 구버전이 되살아나지 않았다 — 되살아나면 발송기가 42725 로 멈춘다
--
--    `information_schema.role_table_grants` 를 쓰지 않는다 — grantor·grantee 가 활성 롤인 항목만 보이는
--    필터된 뷰라 PUBLIC 상속을 놓친다(CLAUDE.md §3). `has_table_privilege()` 는 PUBLIC 과 상속까지 잡고,
--    컬럼 단위 grant 는 `has_any_column_privilege()` 로 따로 본다(표 단위 revoke 가 지우지 못하는 경로).
-- =========================================================================
do $$
declare
  seven      constant text[] := array['public.notices', 'public.popups', 'public.gallery', 'public.gallery_albums',
                                      'public.showcase_routes', 'public.vehicles', 'public.places'];
  six        constant text[] := array['public.notices', 'public.popups', 'public.gallery', 'public.gallery_albums',
                                      'public.showcase_routes', 'public.vehicles'];
  fns        constant text[] := array['public.mark_notification_sent(bigint, text)',
                                      'public.mark_notification_failed(bigint, text, boolean, bigint)',
                                      'public.reap_stale_notifications()'];
  leaked     text;
  leaked_col text;
  lost       text;
  broken     text;
  anon_left  text;
  anon_lost  text;
  fn_sig     text;
  fn_oid     oid;
  holders    text;
  cfg        text[];
begin
  -- ① 일곱 표 × authenticated × (truncate, trigger, references) — 하나라도 남으면 안 된다.
  select string_agg(format('authenticated → %s(%s)', t.tbl, p.priv), ', ' order by t.tbl, p.priv)
    into leaked
    from unnest(seven) as t(tbl)
    cross join (values ('truncate'), ('trigger'), ('references')) as p(priv)
   where has_table_privilege('authenticated', t.tbl, p.priv);
  if leaked is not null then
    raise exception '0016: RLS 가 막지 못하는 권한이 남았다 — %', leaked
      using hint = '원인 셋을 순서대로 볼 것: ① §1 의 revoke 문에서 표나 권한이 빠졌다 ② 기본 권한(alter default privileges)이 다시 깔렸다 ③ PUBLIC 롤에 grant 가 있어 authenticated 가 상속한다 — 표 단위 revoke 는 PUBLIC 의 grant 를 지우지 않는다. PUBLIC 전수는 `select a.privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a where a.grantee = 0` 로 본다. TRUNCATE·TRIGGER 는 RLS 가 막아 주지 않는다 — 이 상태에는 방어선이 아예 없다.';
  end if;

  -- 컬럼 단위 REFERENCES — 표 단위 revoke 가 지우지 못하는 경로다(has_table_privilege 는 이것을 못 본다).
  select string_agg(format('authenticated → %s(references · 컬럼 단위)', t.tbl), ', ' order by t.tbl)
    into leaked_col
    from unnest(seven) as t(tbl)
   where has_any_column_privilege('authenticated', t.tbl, 'references');
  if leaked_col is not null then
    raise exception '0016: 컬럼 단위 REFERENCES 가 남았다 — %', leaked_col
      using hint = '표 단위 revoke 는 따로 부여된 컬럼 grant 를 지우지 않는다. `revoke references (컬럼) on table … from authenticated` 로 그 컬럼을 직접 회수할 것. 누가 줬는지는 pg_attribute.attacl 을 aclexplode 로 푼다.';
  end if;

  -- ② places — 쓰기 셋은 사라지고 select 는 남아야 한다.
  --    컬럼 단위는 insert·update 만 본다: DELETE 와 TRUNCATE·TRIGGER 는 **표 단위에만 존재하는 권한**이라
  --    `has_any_column_privilege` 에 넣으면 22023(unrecognized privilege type)으로 죽는다(적용 중 실측).
  select string_agg(format('authenticated → public.places(%s)', p.priv), ', ' order by p.priv)
    into leaked
    from (values ('insert'), ('update'), ('delete')) as p(priv)
   where has_table_privilege('authenticated', 'public.places', p.priv)
      or (p.priv <> 'delete' and has_any_column_privilege('authenticated', 'public.places', p.priv));
  if leaked is not null then
    raise exception '0016: places 의 쓰기 권한이 남았다 — %', leaked
      using hint = '§3 의 revoke insert, update, delete on table places from authenticated 를 확인할 것. insert·update 는 컬럼 단위로도 본다 — 표 단위 revoke 는 컬럼 grant 를 지우지 않는다. places 에는 관리자 쓰기 정책이 없어 RLS 가 0행을 내지만, PostgREST 는 그 0행을 성공(204)으로 보고한다.';
  end if;

  if not has_table_privilege('authenticated', 'public.places', 'select')
     or not has_table_privilege('anon', 'public.places', 'select') then
    raise exception '0016: places 의 select 까지 사라졌다 (authenticated=% · anon=%)',
      has_table_privilege('authenticated', 'public.places', 'select'),
      has_table_privilege('anon', 'public.places', 'select')
      using hint = '회수 문장에 select 나 all 이 섞였다. 관리자 노선 편집 화면이 출발·도착 후보를 이 표에서 읽고(lib/admin/routeInput.ts) 공개 지도 히어로도 anon 으로 읽는다 — 둘 다 빈다.';
  end if;

  -- ③ 콘텐츠 6표의 authenticated CRUD 생존 — 이 마이그레이션의 가장 큰 사고는 "너무 많이 회수하는 것" 이다.
  select string_agg(format('%s(%s)', t.tbl, p.priv), ', ' order by t.tbl, p.priv)
    into broken
    from unnest(six) as t(tbl)
    cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)
   where not has_table_privilege('authenticated', t.tbl, p.priv);
  if broken is not null then
    raise exception '0016: 콘텐츠 표의 관리자 권한이 깨졌다 — 관리자 화면이 죽는다 — %', broken
      using hint = '0009 §6 이 준 권한이다. 0016 은 truncate·trigger·references 만 회수한다 — §1 의 권한 목록에 CRUD 네 동작이 섞였는지 확인할 것.';
  end if;

  -- 시퀀스도 함께 본다: insert 권한만 있고 nextval 이 막히면 관리자 화면은 "저장 실패" 로만 보인다(0009 §6 의 grant).
  select string_agg(s.seq, ', ' order by s.seq)
    into lost
    from unnest(array['public.notices_id_seq', 'public.popups_id_seq', 'public.gallery_id_seq',
                      'public.gallery_albums_id_seq', 'public.showcase_routes_id_seq', 'public.vehicles_id_seq']) as s(seq)
   where not has_sequence_privilege('authenticated', s.seq, 'usage');
  if lost is not null then
    raise exception '0016: 콘텐츠 표의 시퀀스 사용 권한이 사라졌다 — 관리자가 새 행을 만들 수 없다 — %', lost
      using hint = '0009 §6 의 grant usage, select on sequence … to authenticated 를 확인할 것. 0016 은 시퀀스를 건드리지 않는다.';
  end if;

  -- ④ 함수 셋 — pg_temp 가 들어갔고, create or replace 가 ACL 을 보존했는가.
  foreach fn_sig in array fns loop
    fn_oid := to_regprocedure(fn_sig)::oid;
    if fn_oid is null then
      raise exception '0016: definer 함수 % 가 없다', fn_sig
        using hint = '§4 의 create or replace 가 실행됐는지, 시그니처가 0005·0007 과 같은지 확인할 것. drop 이 섞여 들어갔다면 ACL 이 초기화돼 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다.';
    end if;

    select p.proconfig into cfg from pg_proc p where p.oid = fn_oid;
    if cfg is null or not exists (select 1 from unnest(cfg) c where c ~ '^search_path=.*\mpg_temp\M') then
      raise exception '0016: % 의 search_path 에 pg_temp 가 없다 (proconfig=%)', fn_sig, cfg
        using hint = 'set search_path = public, pg_temp 로 적을 것. 목록에서 빼면 Postgres 가 pg_temp 를 맨 앞에서 암묵 검색해 호출자의 임시 표가 진짜 표를 가릴 수 있다(P4-5 리뷰 K2 가 실증했다).';
    end if;

    -- EXECUTE 보유자는 service_role 과 소유자뿐이어야 한다. `create or replace` 는 ACL 을 보존하므로
    -- 여기가 깨졌다면 이 파일 밖에서 grant 했거나, drop 이 섞여 기본 권한이 다시 붙은 것이다.
    select string_agg(distinct g, ', ')
      into holders
      from (
        select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as g
          from pg_proc p
          cross join lateral aclexplode(p.proacl) a
         where p.oid = fn_oid and a.privilege_type = 'EXECUTE'
      ) s
     where s.g <> 'service_role'
       and s.g <> (select pg_get_userbyid(proowner) from pg_proc where oid = fn_oid);
    if holders is not null then
      raise exception '0016: % 의 EXECUTE 를 service_role 말고도 갖고 있다 — %', fn_sig, holders
        using hint = 'create or replace 는 ACL 을 보존한다 — 여기가 걸렸다면 drop function 이 섞여 들어갔다(그러면 이 DB 의 기본 권한이 anon·authenticated·service_role 에 EXECUTE 를 다시 부여한다) 또는 이 파일 밖에서 grant 했다. PUBLIC 이 보이면 0005 §6 의 revoke 가 되돌려졌다.';
    end if;

    if has_function_privilege('anon', fn_oid, 'execute') or has_function_privilege('authenticated', fn_oid, 'execute') then
      raise exception '0016: 공개 롤이 % 를 실행할 수 있다 (anon=% · authenticated=%) — /rpc 로 통지 큐를 조작할 수 있다',
        fn_sig, has_function_privilege('anon', fn_oid, 'execute'), has_function_privilege('authenticated', fn_oid, 'execute')
        using hint = '0005 §6 · 0007 의 revoke all … from public, anon, authenticated 가 살아 있는지 확인할 것.';
    end if;

    if not has_function_privilege('service_role', fn_oid, 'execute') then
      raise exception '0016: service_role 이 % 를 실행할 수 없다 — 발송기가 멈춘다', fn_sig
        using hint = '0005 §6 · 0007 의 grant execute … to service_role 이 살아 있는지 확인할 것. create or replace 는 ACL 을 보존하므로, 사라졌다면 drop 이 섞였거나 밖에서 revoke 한 것이다.';
    end if;
  end loop;

  -- ⑤ anon 은 일곱 표에서 select 만 갖는다(0013 이 네 동작, §2 가 나머지 둘).
  select string_agg(format('anon → %s(%s)', t.tbl, p.priv), ', ' order by t.tbl, p.priv)
    into anon_left
    from unnest(seven) as t(tbl)
    cross join (values ('insert'), ('update'), ('delete'), ('truncate'), ('trigger'), ('references')) as p(priv)
   where has_table_privilege('anon', t.tbl, p.priv);
  if anon_left is not null then
    raise exception '0016: 공개 롤에 select 말고 다른 권한이 남았다 — %', anon_left
      using hint = '0013 이 네 동작을, 0016 §2 가 trigger·references 를 회수한다. 둘 중 하나가 적용되지 않았거나 기본 권한이 다시 깔렸다. PUBLIC 상속도 볼 것(pg_class.relacl + aclexplode, grantee=0).';
  end if;

  select string_agg(t.tbl, ', ' order by t.tbl)
    into anon_lost
    from unnest(seven) as t(tbl)
   where not has_table_privilege('anon', t.tbl, 'select');
  if anon_lost is not null then
    raise exception '0016: 공개 사이트가 읽어야 할 anon select 가 사라졌다 — %', anon_lost
      using hint = '회수 문장에 select 나 all 이 섞였다. 0016 은 truncate·trigger·references(와 places 의 쓰기 셋)만 회수한다.';
  end if;

  -- ⑥ 1-인자 claim 구버전 — 되살아나면 1-인자 호출이 모호(42725)해져 발송기가 통째로 멈춘다(0014 §4 ①).
  if to_regprocedure('public.claim_pending_notifications(int)') is not null then
    raise exception '0016: 1-인자 claim_pending_notifications(int) 가 되살아났다 — 2-인자 판과 공존하면 호출이 모호(42725)해져 발송기가 멈춘다'
      using hint = '0016 §4 에 claim_pending_notifications 를 create or replace 로 적지 않았는지 확인할 것. 그 함수는 0014 가 2-인자로 바꿨고 이미 public, pg_temp 다 — 0016 의 대상이 아니다.';
  end if;

  if to_regprocedure('public.claim_pending_notifications(int, text[])') is null then
    raise exception '0016: 2-인자 claim_pending_notifications(int, text[]) 가 없다 — 0014 가 적용되지 않았다'
      using hint = '0016 은 0014 뒤에 적용된다. 마이그레이션 순서를 확인할 것.';
  end if;
end
$$;
