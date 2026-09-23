-- 0022_admin_stats.down.sql — supabase/migrations/0022_admin_stats.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005~0021 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0022
--
-- ## 이 롤백이 하는 일 — 함수 하나를 지운다. 그게 전부다.
-- 0022 는 `admin_stats(date, date)` 함수 하나를 만들고 그 함수의 EXECUTE 를 `authenticated` 에만 줬다.
-- 표·칸·제약·트리거·정책·데이터는 한 글자도 건드리지 않았으므로 되돌릴 것도 그것뿐이다.
-- `drop function` 은 그 함수의 ACL 도 함께 없앤다 — 따로 `revoke` 할 대상이 남지 않는다.
-- **인자 타입까지 적어** 지운다(0010·0020 롤백과 같은 규약) — 같은 이름의 다른 오버로드를 남기거나 지우지 않기 위해서다.
--
-- ## 승인 플래그를 요구하지 **않는다** — 판단과 근거 (0015~0020 의 기준을 그대로 적용한 결과)
-- 그 기준은 **"실행이 안전한가" 가 아니라 "실행한 뒤의 세계가 조용히 위험한가"** 다. 0012~0021 의 롤백은 전부
-- 두 번째 질문에 "그렇다" 였다: 공개 롤에 쓰기·TRUNCATE·MAINTAIN·TRIGGER 를 **되돌려 열어 놓고도** 오류도 로그도
-- 화면 변화도 없어 아무도 눈치채지 못하는 상태가 남았다. 그래서 사람의 손을 한 번 더 요구했다.
-- 0022 는 그 조건에 하나도 걸리지 않는다:
--   · 되돌린 뒤 **열리는 권한이 없다.** 함수가 사라질 뿐이고, 사라진 함수에는 ACL 도 없다. 표 권한은 처음부터 안 건드렸다.
--   · 되돌린 뒤 **조용하지 않다.** `/admin/stats` 가 곧바로 `PGRST202`(함수 없음)로 실패한다 — 관리자 한 사람만 쓰는
--     읽기 전용 화면이고, 고장은 그 자리에서 눈에 보인다. 접수·확정·통지·파기 경로는 이 함수를 부르지 않는다.
--   · **데이터가 사라지지 않는다.** 집계 함수라 원본은 그대로다. 잘못 눌렀으면 0022 를 다시 적용하면 원상복구다.
-- 즉 이 파일에 플래그를 다는 것은 "누르면 조용히 위험한 문" 이라는 신호를 값싸게 남발하는 일이 된다 —
-- 플래그가 흔해지면 정작 위험한 0012·0017·0021 에서도 반사적으로 넘기게 된다. 그래서 달지 않는다.
-- (이 판단을 뒤집을 조건: 이 함수가 언젠가 **쓰기** 를 하게 되거나, 공개 표면이 그 결과를 읽게 되면 그때 플래그를 단다.)
--
-- ## ⚠️ 코드 배포와의 순서
-- `/admin/stats` 화면(app/admin/(protected)/stats/**)과 `lib/admin/stats.ts` 는 이 함수를 부른다.
-- **앱을 0022 이전 코드로 먼저 되돌린 뒤** 이 파일을 돌린다. 반대로 하면 그 사이 통계 탭이 오류 화면이다
-- (다른 관리자 탭과 공개 화면은 영향을 받지 않는다 — 이 함수를 부르는 곳이 통계 화면뿐이다).
--
-- ⚠️ **통계가 안 열려서 여기까지 왔다면 원인이 0022 가 아닐 수 있다.** 먼저 볼 것:
--   `select to_regprocedure('public.admin_stats(date,date)');`                         → null 이면 0022 가 적용되지 않았다
--   `select has_function_privilege('authenticated', 'public.admin_stats(date,date)', 'execute');`  → false 면 권한 문제다
--   그리고 로그인한 계정이 `admin_users` 에 있는지(가드가 42501 로 막는다).
--
-- 재실행 가능(idempotent): `drop function if exists`. 두 번째 실행은 아무것도 하지 않고 NOTICE 만 남긴다.

begin;

-- 잠금 대기 상한 — `drop function` 은 그 함수에 의존하는 객체를 확인하며 카탈로그 잠금을 잡는다.
-- 5초 넘게 기다리면 `55P03 lock timeout` 으로 이 파일 전체가 롤백된다(아무것도 바뀌지 않는다).
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.admin_stats(date,date)') is null then
    raise notice '0022 롤백: public.admin_stats(date,date) 가 없다 — 되돌릴 것이 없다(권한도 건드리지 않는다).';
  else
    raise notice '0022 롤백: public.admin_stats(date,date) 를 지운다. 그 함수의 EXECUTE 도 함께 사라진다.';
  end if;
end
$$;

drop function if exists public.admin_stats(date, date);

do $$
begin
  if to_regprocedure('public.admin_stats(date,date)') is not null then
    raise exception '0022 롤백: 함수가 아직 남아 있다 — 같은 이름의 다른 오버로드가 있는지 볼 것';
  end if;
  raise notice '0022 롤백 완료 — 표·칸·제약·정책·데이터는 건드리지 않았다. `supabase migration repair --status reverted 0022` 를 실행할 것.';
end
$$;

commit;
