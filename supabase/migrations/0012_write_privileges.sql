-- 0012_write_privileges.sql — 쓰기가 의도된 적 없는 두 표에서 write 권한 회수 (플랜 v4 P5-9 · ADR-2)
--
-- 왜: Supabase 는 public 스키마의 표에 `anon`·`authenticated` 로 **기본 권한을 넓게** 깔아 둔다
-- (`alter default privileges … grant all on tables`). 그래서 마이그레이션이 GRANT 를 하지 않은 표에도 두 롤은
-- 이미 insert·update·delete·truncate 를 갖고 있다. 명시적으로 회수하지 않으면 **RLS 가 유일한 방어선**이 된다.
--
-- 그 상태가 왜 위험한가. RLS 는 "어느 행" 이고 GRANT 는 "어느 동작" 이다. 정책이 없는 동작을 PostgREST 로 치면
-- 권한이 있으니 문장은 실행되고, RLS 가 행을 하나도 통과시키지 않아 **0행이 갱신**되고, PostgREST 는 그것을
-- **성공(204)** 으로 보고한다. 거부가 아니라 성공이다. 호출한 쪽은 "됐다" 고 믿는다. 실제로 CI db-test 가
-- tests/admin-notifications.test.ts 의 "관리자도 쓸 수는 없다" 에서 204 를 받고 8bc3549 이후 계속 실패했다.
-- 더 나쁜 것은 **TRUNCATE 다 — RLS 는 TRUNCATE 에 적용되지 않는다.** 정책이 몇 개든 상관없이,
-- 그 권한을 가진 롤로 DB 에 붙을 수 있으면 고객 개인정보 표를 통째로 비울 수 있다.
-- (PostgREST 는 TRUNCATE 를 노출하지 않지만, 권한 층에 남겨 둘 이유가 없다.)
--
-- 같은 뿌리에서 나온 세 번째 재발이다:
--   1) P5-1/P5-2 독립 리뷰 M1 — `admin_users` (→ 0009 의 `revoke all`)
--   2) 독립 리뷰 N5 — `reservations` 의 UPDATE (→ 0010 §6)
--   3) 이번(0012) — 나머지 전부
--
-- **범위를 좁게 잡는 것이 이 마이그레이션의 핵심이다.** 회수해도 되는 표는 쓰기 주체가 `authenticated` 가 아닌 표뿐이다:
--   · 공개 접수 insert      → 서비스 롤 (lib/reservations/db.ts, 가드 4종 통과 후)
--   · 아웃박스 enqueue      → 서비스 롤 (lib/notify/outbox.ts)
--   · 발송기 상태 update    → 서비스 롤 (lib/notify/worker.ts)
--   · 보유기간 파기 delete  → 서비스 롤 (lib/retention/purge.ts, app/api/cron/purge)
--   · 관리자 상태 전이      → 0005·0007·0010 의 **security definer** 함수 (소유자 권한으로 돌아 이 회수와 무관)
--   · 관리자 화면 조회      → select. **회수하지 않는다** (0009 의 두 정책이 그것으로 읽는다)
-- 서비스 롤은 이 회수의 대상이 아니고, definer 함수는 호출자 권한이 아니라 소유자 권한으로 돈다.
-- 즉 회수해도 정상 경로는 **하나도** 막히지 않는다. tests/write-privileges.test.ts §3 이 로컬 스택에서 그것을 실증한다.
--
-- 반대로 콘텐츠 표 6개(notices·popups·gallery·gallery_albums·showcase_routes·vehicles)는 관리자가
-- `authenticated` + `is_admin()` 정책으로 **정말 쓴다**(0009 §5·§6, P5-4~6·P6-2). 여기서 회수하면 관리자 화면이 죽는다.
-- 이 파일은 그 여섯 표의 권한을 건드리지 않고, 아래 검증 블록이 "멀쩡한지" 만 확인한다.
--
-- REFERENCES·TRIGGER 를 남기는 이유: 둘 다 다른 객체를 만들 수 있어야 쓸모가 있는데(외래키를 걸 새 표, 트리거가 부를 함수),
-- `anon`·`authenticated` 에게는 public 스키마 CREATE 권한이 없다(로컬 실측: has_schema_privilege → false).
-- 만들 수 없는 것을 위한 권한이라 실행 경로가 없다. 좁게 가는 이 태스크의 원칙에 따라 이번 회수 대상에서 뺀다.
--
-- 🔴 **위 문단의 TRIGGER 부분은 틀렸다 — 정정 (2026-09-16 · P5-12 / 0016).**
-- 원문을 지우지 않고 남긴다. 무엇을 어떤 근거로 남겼는지가 기록이어야 하고, 그래야 같은 논증이 다시 나왔을 때 알아본다.
-- **틀린 곳**: TRIGGER 는 "다른 객체를 만들 수 있어야 쓸모가 있는" 권한이 **아니다.** `CREATE TRIGGER` 가 요구하는 것은
-- ⓐ 그 표의 TRIGGER 권한과 ⓑ **이미 존재하는** 트리거 반환 함수의 EXECUTE **둘뿐**이다 — 새 함수도, 새 표도,
-- 스키마 CREATE 도 필요 없고, 표 소유자가 아니어도 된다. 그리고 ⓑ 가 이 DB 에 실제로 있다(2026-09-16 실측):
--   `supabase_functions.http_request` — 행이 바뀔 때마다 **외부 URL 로 HTTP 호출**. `anon`·`authenticated` 모두 execute=true.
--   (그 밖에 storage.protect_delete · storage.update_updated_at_column · realtime.subscription_check_filters 등)
-- 즉 "만들 수 없으니 실행 경로가 없다" 는 TRIGGER 에 대해서는 성립하지 않는다. 외부 모델 크로스체크가 지적했고
-- 컨트롤러가 실측으로 확인했다(docs/ops/migration-runbook.md 의 ⚠️ 절).
-- **REFERENCES 부분은 여전히 맞다**(영구 표를 만들 수 없고, 임시 표에서 영구 표로 가는 외래키는 Postgres 가 거부하며,
-- 남의 표에 제약을 더하려면 소유자여야 한다). 그래도 0016 이 함께 회수한다 — 쓰이지 않는 권한이고, 무엇보다
-- **"만들 수 없으니 괜찮다" 는 논증이 바로 여기서 한 번 틀렸기 때문이다.** 같은 논증에 두 번째로 기대지 않는다.
-- **조치**: `supabase/migrations/0016_privileges_rls_cannot_protect.sql` 이 일곱 콘텐츠 표에서 TRUNCATE·TRIGGER·
-- REFERENCES 를 회수한다(0012 는 파일을 바꾸지 않는다 — 원격에 적용될 순서가 이미 정해져 있다).
--
-- 기존 행 영향: 권한만 회수한다. 표·컬럼·CHECK·인덱스·정책 변경 0, 데이터 변경 0.
-- 재실행 안전: `revoke` 는 없는 권한을 회수해도 오류가 아니다. 조건 분기가 필요 없다.
-- 롤백: supabase/rollbacks/0012_write_privileges.down.sql (수동 실행 전용 — 0005·0007·0009·0010 롤백 헤더 참조).

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0012: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다. 아무것도 바꾸기 전에 멈춘다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나). psql -f 처럼 문장마다 커밋하는 경로에서는 set local 이 그 문장에서 끝난다(PostgreSQL 은 경고만 낸다).';
  end if;
end
$$;

-- =========================================================================
-- 1. notifications_log — 네 동작 전부. 상태 전이(pending→sent/failed)는 서비스 롤 발송기와
--    0005·0007 의 definer 함수 몫이고, 관리자에게는 0009 의 select 정책 하나만 있다.
--    관리자가 status 를 직접 고칠 수 있으면 "보내지 않은 것을 보냈다고 적는" 경로가 열린다.
-- =========================================================================
revoke insert, update, delete, truncate on table notifications_log from anon, authenticated;

-- =========================================================================
-- 2. reservations — insert·delete·truncate.
--    UPDATE 는 0010 §6 이 이미 `authenticated` 에서 회수했다(리뷰 N5). 여기서 다시 쓰지 않는 이유는
--    **롤백 때문이다**: 0012 롤백은 0012 가 회수한 것만 되돌려야 하는데, 여기에 그 UPDATE 를 적으면
--    롤백이 0010 이 닫은 문(관리자가 retention_until·privacy_consent_at 까지 고칠 수 있던 상태)을 되살리게 된다.
--    `anon` 쪽 UPDATE 는 아직 남아 있으므로(0010 은 authenticated 만 회수했다) 여기서 닫는다.
--    아래 §4 의 검증 블록이 두 롤 · 네 동작을 전부 확인하므로, 0010 이 빠진 DB 에서는 이 마이그레이션이 실패한다.
-- =========================================================================
revoke insert, delete, truncate on table reservations from anon, authenticated;
revoke update on table reservations from anon;

-- =========================================================================
-- 3. 검증 — 회수 결과를 마이그레이션이 스스로 확인한다.
--
--    권한 회수는 조용히 어긋난다. 문장 하나가 빠져도, 롤 이름을 하나 빠뜨려도, 나중에 누가 default privileges 를
--    다시 깔아도 에러는 나지 않고 그냥 "권한이 남는다". 그 상태에서 테스트는 여전히 green 이 될 수 있다 —
--    RLS 가 행을 막아 겉보기 결과가 같기 때문이다. 그래서 결과를 여기서 못박는다:
--    남으면 마이그레이션이 실패하고, 실패하면 배포가 멈춘다.
--
--    세 가지를 본다. ① 회수 대상에 쓰기 권한이 남았나 ② 남겨야 할 select 가 사라졌나 ③ 콘텐츠 6표가 깨졌나.
--    ②·③ 이 있는 이유: 이 마이그레이션의 가장 큰 사고는 "너무 많이 회수해서 관리자 화면이 죽는 것" 이다.
-- =========================================================================
do $$
declare
  leaked text;
  lost   text;
  broken text;
begin
  -- ① 회수 대상 2표 × 2롤 × 4동작 — 하나라도 남으면 안 된다.
  select string_agg(format('%s → %s(%s)', r.role, t.tbl, p.priv), ', ' order by r.role, t.tbl, p.priv)
    into leaked
    from (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('public.reservations'), ('public.notifications_log')) as t(tbl)
    cross join (values ('insert'), ('update'), ('delete'), ('truncate')) as p(priv)
   where has_table_privilege(r.role, t.tbl, p.priv);
  if leaked is not null then
    raise exception '0012: 회수되지 않은 쓰기 권한이 남았다 — %', leaked
      using hint = '원인 세 가지를 순서대로 볼 것: ① 0010 §6 이 적용되지 않았다(reservations update → authenticated) ② default privileges 가 다시 깔렸다 ③ PUBLIC 롤에 grant 가 있어 anon·authenticated 가 상속한다 — 이 파일의 표 단위 revoke 는 PUBLIC 의 grant 를 지우지 않으므로 `select grantee from information_schema.role_table_grants where table_schema=''public'' and table_name in (''reservations'',''notifications_log'')` 로 수혜자를 전수 확인할 것. 이 상태로는 RLS 가 유일한 방어선이다.';
  end if;

  -- ② 관리자 화면이 읽는 select 는 살아 있어야 한다 (0009 §3·§4 의 두 정책이 이것 위에 선다).
  select string_agg(format('%s → %s', r.role, r.tbl), ', ' order by r.role, r.tbl)
    into lost
    from (values ('authenticated', 'public.reservations'), ('authenticated', 'public.notifications_log')) as r(role, tbl)
   where not has_table_privilege(r.role, r.tbl, 'select');
  if lost is not null then
    raise exception '0012: 관리자 화면이 읽어야 할 select 권한까지 사라졌다 — %', lost
      using hint = '회수 문장에 select 나 all 이 섞였다. 0012 는 쓰기 네 동작만 회수한다.';
  end if;

  -- ③ 콘텐츠 6표는 관리자가 authenticated 로 정말 쓴다 — 여기가 깨지면 관리자 화면이 죽는다.
  select string_agg(format('%s(%s)', t.tbl, p.priv), ', ' order by t.tbl, p.priv)
    into broken
    from (values ('public.notices'), ('public.popups'), ('public.gallery'), ('public.gallery_albums'), ('public.showcase_routes'), ('public.vehicles')) as t(tbl)
    cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)
   where not has_table_privilege('authenticated', t.tbl, p.priv);
  if broken is not null then
    raise exception '0012: 콘텐츠 표의 관리자 권한이 깨졌다 — %', broken
      using hint = '0009 §6 이 준 권한이다. 0012 는 이 여섯 표를 건드리지 않는다 — 회수 문장의 표 이름을 확인할 것.';
  end if;
end
$$;
