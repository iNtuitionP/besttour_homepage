-- 0013_anon_write_privileges.sql — 공개 롤(anon)의 쓰기 권한을 콘텐츠·참조 7표에서 회수 (플랜 v4 P5-9 후속 · ADR-2)
--
-- 왜 0012 로 끝나지 않았나. 0012 는 `reservations`·`notifications_log` 두 표만 닫았고, 그 범위는
-- "관리자가 `authenticated` 로 정말 쓰는 표는 건드리지 않는다" 는 규칙에서 나왔다. 그 규칙은 옳았지만 **`authenticated` 에 대한 것**이다.
-- `anon` 에게는 애초에 해당하지 않는다 — 공개 롤은 이 7표 어디에도 쓰지 않는다(`lib/queries/*.ts` 는 전부 select 다).
-- 그런데 Supabase 기본권한 때문에 `anon` 은 아직 `notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·
-- `vehicles`·`places` 7표에 insert·update·delete·truncate 를 전부 갖고 있었다(적용 전 실측).
-- 0012 의 헤더가 "RLS 단일 방어선을 끝낸다" 고 선언했는데, 그 문장은 두 표에서만 참이었다. 이 파일이 나머지를 참으로 만든다.
--
-- **TRUNCATE 가 이 회수의 핵심이다.** RLS 는 select·insert·update·delete 에만 적용되고 **TRUNCATE 에는 전혀 관여하지 않는다.**
-- 다른 세 동작은 정책이 행을 막아 주지만(공개 정책은 `for select` 뿐이라 쓰기는 0행이 된다), TRUNCATE 는 정책을 아예 통과하지 않고
-- 표를 통째로 비운다. 즉 `anon` 의 TRUNCATE 는 "RLS 가 막아 주고 있었다" 가 아니라 **아무도 막고 있지 않았다**.
-- PostgREST 가 TRUNCATE 를 노출하지 않아 오늘의 실행 경로가 없을 뿐이고, 권한 층에 남겨 둘 이유는 없다.
-- (같은 이유를 0012 §헤더가 이미 적어 뒀다 — 거기서는 두 표에만 적용했다.)
--
-- 회수 대상이 7표인 이유:
--   · `notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·`vehicles` — 관리자가 쓰는 콘텐츠 6표.
--     쓰는 롤은 `authenticated` 이고 0009 §5 의 `*_admin_all` 정책 + 0009 §6 의 GRANT 가 그것을 받친다. `anon` 은 관여하지 않는다.
--   · `places` — 0002 가 시드한 참조 데이터(17행). 어떤 화면도 쓰지 않는다. 읽기 전용 표에 공개 롤의 쓰기가 남아 있을 이유가 없다.
-- 남기는 것: **select.** 공개 사이트가 `anon` 키로 활성 행을 읽는다(0001·0002·0004·0008 의 `*_select_active` 정책).
--
-- 건드리지 않는 것:
--   · `authenticated` 의 권한 전부 — 관리자 화면이 그것으로 쓴다. 한 칸이라도 회수하면 화면이 죽는다(아래 검증 ③).
--   · `reservations`·`notifications_log` — 0012 가 이미 두 롤 모두에서 닫았다.
--   · `admin_users` — 0009 가 `revoke all`.
--   · 시퀀스(`*_id_seq`)의 `anon` USAGE — 표에 insert 가 없으면 행을 만들 수 없다(`nextval` 로 번호만 태울 수 있다).
--     0012 리뷰 N4 가 같은 계열로 `notifications_log_id_seq` 를 올려 뒀다. 표 하나에만 손대면 또 반쪽이 되므로,
--     시퀀스는 "어느 범위까지" 를 정해 한 번에 처리하는 편이 낫다 — 이 파일의 범위 밖으로 둔다.
--
-- 기존 행 영향: 권한만 회수한다. 표·컬럼·CHECK·인덱스·정책 변경 0, 데이터 변경 0.
-- 재실행 안전: `revoke` 는 없는 권한을 회수해도 오류가 아니다.
-- 롤백: supabase/rollbacks/0013_anon_write_privileges.down.sql (수동 실행 전용 · 승인 플래그 **무조건** 요구).

-- =========================================================================
-- 1. 회수 — 7표, `anon` 만, 쓰기 네 동작만
-- =========================================================================
revoke insert, update, delete, truncate on table
  notices, popups, gallery, gallery_albums, showcase_routes, vehicles, places
  from anon;

-- =========================================================================
-- 2. 검증 — 0012 §3 과 같은 규약. 권한 회수는 조용히 어긋나므로 결과를 SQL 안에서 못박는다.
--    ① 공개 롤에 쓰기가 남았나 ② 공개 사이트가 읽을 select 가 사라졌나 ③ 관리자 화면이 죽었나
--    ②·③ 이 있는 이유는 0012 와 같다 — 이 마이그레이션의 가장 큰 사고는 "너무 많이 회수하는 것" 이다.
-- =========================================================================
do $$
declare
  leaked text;
  lost   text;
  broken text;
begin
  -- ① 7표 × 4동작 — `anon` 에게 하나라도 남으면 안 된다.
  select string_agg(format('anon → %s(%s)', t.tbl, p.priv), ', ' order by t.tbl, p.priv)
    into leaked
    from (values ('public.notices'), ('public.popups'), ('public.gallery'), ('public.gallery_albums'),
                 ('public.showcase_routes'), ('public.vehicles'), ('public.places')) as t(tbl)
    cross join (values ('insert'), ('update'), ('delete'), ('truncate')) as p(priv)
   where has_table_privilege('anon', t.tbl, p.priv);
  if leaked is not null then
    raise exception '0013: 회수되지 않은 공개 롤 쓰기 권한이 남았다 — %', leaked
      using hint = 'default privileges 가 다시 깔렸거나, PUBLIC 롤에 grant 가 있어 anon 이 상속하고 있다(표 단위 revoke 는 PUBLIC 의 grant 를 지우지 않는다). information_schema.role_table_grants 에서 grantee 를 전수 확인할 것.';
  end if;

  -- ② 공개 사이트는 이 7표를 anon 키로 읽는다. select 가 사라지면 홈이 통째로 빈다.
  select string_agg(t.tbl, ', ' order by t.tbl)
    into lost
    from (values ('public.notices'), ('public.popups'), ('public.gallery'), ('public.gallery_albums'),
                 ('public.showcase_routes'), ('public.vehicles'), ('public.places')) as t(tbl)
   where not has_table_privilege('anon', t.tbl, 'select');
  if lost is not null then
    raise exception '0013: 공개 사이트가 읽어야 할 anon select 권한까지 사라졌다 — %', lost
      using hint = '회수 문장에 select 나 all 이 섞였다. 0013 은 쓰기 네 동작만 회수한다.';
  end if;

  -- ③ 관리자는 `authenticated` 로 콘텐츠 6표에 쓴다(0009 §5·§6). 여기가 깨지면 관리자 화면이 죽는다.
  select string_agg(format('%s(%s)', t.tbl, p.priv), ', ' order by t.tbl, p.priv)
    into broken
    from (values ('public.notices'), ('public.popups'), ('public.gallery'), ('public.gallery_albums'),
                 ('public.showcase_routes'), ('public.vehicles')) as t(tbl)
    cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)
   where not has_table_privilege('authenticated', t.tbl, p.priv);
  if broken is not null then
    raise exception '0013: 콘텐츠 표의 관리자 권한이 깨졌다 — %', broken
      using hint = '0013 은 anon 에서만 회수한다. 회수 문장에 authenticated 가 섞였는지 확인할 것.';
  end if;
end
$$;
