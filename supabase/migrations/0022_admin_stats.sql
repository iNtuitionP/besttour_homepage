-- 0022_admin_stats.sql — 관리자 통계 한 번에 돌려주는 definer 함수 하나 (플랜 v4 P5-17 · ADR-2)
--
-- ## 왜
-- 사장님이 "홈페이지가 문의를 얼마나 가져오는지" 를 볼 화면이 없었다. 조사 보고서
-- (.superpowers/sdd/2026-09-06-bestour-implementation-v4/ADMIN-STATS-RESEARCH.md)가 국내 빌더·예약 SaaS 를 훑고
-- **지금 DB 에 이미 있는 데이터만으로** 지표 10개를 권했다. 이 파일은 그 10개를 **함수 하나**로 만든다.
--
-- ## 함수가 하나인 이유
-- 권한·테스트 표면이 작아진다. definer 함수는 RLS 를 우회하므로(소유자 `postgres` 는 FORCE RLS 가 아닌 표에서 정책을
-- 평가받지 않는다) 실행 권한만 있으면 정책은 아무것도 막아 주지 않는다 — **첫 문장의 `is_admin()` 가드가 유일한
-- 방어선**이다(0010·0020 헤더와 같은 말). 문을 하나만 만들면 그 문 하나만 지키면 된다.
--
-- ## 결과에 개인정보가 없다 — 이 파일의 가장 중요한 성질
-- 돌려주는 것은 (버킷 또는 코드, 건수)뿐이다. 이름·전화·메일·메모·접수번호·수신처는 **집계에도 쓰지 않는다**
-- (`select` 목록에 그 칸들의 이름이 아예 없다). 관리자는 원본을 이미 볼 수 있지만, 통계 화면은 **캡처·출력되어
-- 협력사·세무사·대행사에 건네지기 쉽다** — 그래서 한 단계 더 좁힌다.
--   · **작은 칸 숨김 k = 3**: 분해표(여행 구분·차량·구간·리드타임)에서 1~2건인 칸은 건수를 내리지 않고
--     `count: null · suppressed: true` 로 오며, 그런 칸들은 **하나의 "기타"** 로 합쳐진다("기타" 자체가 1~2건이면 그것도 숨는다).
--     숨김은 **여기(SQL) 안에서** 일어난다 — 원자료가 브라우저로 내려가지 않는다는 뜻이다. 앱이 가리는 것과 다르다.
--   · **보완 숨김(complementary suppression)** — 가려질 칸이 하나뿐이면 보이는 칸 중 가장 작은 것도 함께 가린다(§⑦⑧⑨⑩ `hide_n`).
--     한 칸만 가리면 `총건수 − 보이는 칸들의 합` 이 곧 그 칸의 건수라, **흔한 배치에서** 그 한 줄짜리 복원을 막아 준다.
--   · **추이(⑥)의 상태 칸** — 상태 칸(대기·확정·취소) 중 **어느 하나라도 1~2건이면** 그 버킷은 상태로 쪼개지 않고
--     총건수만 준다(`split: false` · 상태 칸은 `null`). 총건수만 보고 판단하면 하루 3건이 1·1·1 일 때 세 칸이 그대로 나간다
--     (수정 라운드 3 · astra P1 — 그 반례가 실제로 있었다). 0건 버킷은 드러낼 것이 없으므로 쪼갠 채로 둔다.
--
-- 🔴 **이 장치는 익명화가 아니다 — 못 지킬 약속을 하지 않는다** (수정 라운드 3 · 컨트롤러 방향 정정)
--   가릴수록 "왜 가려졌는지" 가 새 단서가 된다. 실제로 이 파일의 규칙만으로도 되짚을 수 있는 배치가 있다:
--     · 한 축에 "기타" 가 **가려진 채**(3건 미만) 보이면 그것은 **1건짜리 칸이 정확히 둘** 이라는 뜻이다
--       (한 칸만 작았다면 보완 숨김이 3건 이상인 칸을 끌어와 "기타" 가 보이는 숫자가 됐을 것이다).
--     · 리드타임 `(2,3,3,3)` 은 `d8_30=3 · d31_90=3 · 기타 5` 가 되는데, 동률 처리 규칙(먼 구간부터)이 정해져 있어
--       가려진 둘이 `d0_7=2 · d91_plus=3` 으로 **유일하게** 풀린다(astra 재검토, 전수 열거).
--     · `confirmation.pending` 같은 다른 숫자와 맞물리면 1건짜리 날의 상태가 드러난다.
--   그래서 이 파일은 **가리는 것을 유지하되 보장하지 않는다.** 목적은 관리자 화면의 캡처가 밖으로 나갔을 때의 예의 수준이다.
--   관리자는 예약 목록에서 이름·전화를 이미 보고, 기간을 바꿔 가며 빼면 한 건의 속성도 되짚는다 —
--   definer 함수가 관리자에게 열려 있는 한 구조적으로 막을 수 없고, 막을 대상도 아니다(관리자는 원본 권한자다).
--   남는 경로와 뒤집을 조건은 `docs/ops/known-defects.md` **D13**. 화면·코드·문서 어디에도 **보장하는 말투로 적지 않는다.**
--
-- ## KST — 세션 TZ 는 UTC 다 (0004 가 고친 버그)
-- 기간의 양끝과 모든 버킷은 **서울 벽시계**로 계산한다.
--   경계  `created_at >= (p_from::timestamp at time zone 'Asia/Seoul')` · `< ((p_to + 1)::timestamp at time zone 'Asia/Seoul')`
--   버킷  `(created_at at time zone 'Asia/Seoul')::date` · `date_trunc('week'|'month', … at time zone 'Asia/Seoul')::date`
-- `current_date` 와 `now()::date` 는 쓰지 않는다 — 세션 TZ 가 UTC 라 한국의 00:00~08:59 에 하루가 어긋난다.
-- "오늘" 이 필요한 곳(④ 처리 대기 · ⑤ 발송 문제)은 **날짜가 아니라 인스턴트**로 센다(`now() - interval …`) —
-- 시간대와 무관한 판정이라 KST 로 바꿀 이유가 없다.
--
-- ## 지표 10개와 쓰는 칸 (보고서 「권장 v1」 그대로)
--   ① 접수 수 + 직전 기간            reservations.created_at
--   ② 확정 · 확정률 · 처리 전        confirmed_at(한 번이라도 확정 = is not null) · status
--   ③ 확정까지 걸린 시간 중앙값      confirmed_at − created_at (확정 3건 미만이면 표본 부족)
--   ④ 처리 대기 (기간 무관)          status='new' 전체 · 그중 접수 후 72시간 초과
--   ⑤ 발송 문제 (기간 무관, 최근 7일) notifications_log.status·created_at (failed · 1시간 넘은 pending)
--   ⑥ 접수 추이                      created_at 버킷 × 현재 status (빈 버킷 0 채움)
--   ⑦ 여행 구분별                    purpose_code
--   ⑧ 차량별 + 요청 대수 합          vehicle_slug · bus_count
--   ⑨ 많이 찾는 구간 Top 10          origin_code · destination_code (+ 활성 showcase_routes 와 일치 여부)
--   ⑩ 운행일까지 남은 기간 4구간     depart_at − created_at (둘 다 KST 달력 날짜)
-- **취소·완료는 접수일 기준**이다 — 이 표에는 취소 시각·완료 시각 칸이 없다(0001·0010). 화면이 그렇게 적는다.
-- **가격은 건드리지 않는다** — `price_from` 을 곱하거나 더한 "추정 매출" 은 만들지 않는다(CLAUDE.md §3 · check:pricing).
--
-- ## 권한 (0010 §5 · 0020 §6 과 같은 규약)
-- `revoke all … from public, anon, service_role` + `grant execute … to authenticated`.
-- `pg_default_acl` 이 새 함수에 `anon`·`authenticated`·`postgres`·`service_role` 넷에게 EXECUTE 를 준다(CLAUDE.md §3) —
-- **명시적으로 회수하지 않으면 익명 롤이 고객 집계를 읽는다.** `service_role` 도 목록에 넣는다(빠뜨리기 쉬운 자리다).
-- **`drop function` 을 쓰지 않는다**: drop 후 create 는 EXECUTE 를 공개 롤에 다시 열어 준다. `create or replace` 만 쓴다.
-- 호출은 **세션 클라이언트**로 한다(서비스 롤 금지 — ADR-2 · scripts/check-admin-no-service-role.sh).
--
-- ## 성능
-- 수백~수천 행 규모다. **인덱스·뷰·캐시를 만들지 않는다**(보고서 §5-4). 표를 몇 번 훑어도 수 ms 다.
-- 행이 10만을 넘으면 `created_at` 단독 인덱스를 검토한다(기존 인덱스는 `status` 가 선두다).
--
-- 기존 행 영향: **0**. 표·칸·제약·트리거·정책 변경 0, 데이터 변경 0. 함수 하나가 늘고 그 함수의 권한이 정해진다.
-- 재실행 안전: `create or replace` · `revoke`(없는 권한을 회수해도 오류가 아니다) · `grant`(있는 권한을 다시 줘도 오류가 아니다).
-- 자기검증은 **실제 표에 문장을 치지 않는다**(P5-15 규칙 · 0021 규범): 롤 전환 0 · 잠금 문장 0 · 쓰기 0.
--   거동 탐침은 **가드 하나뿐**이고 그것도 읽기다 — 적용 롤이 관리자 명단에 없을 때 `42501` + 정확한 문구가 나는지 본다
--   (본문의 다른 한 줄도 돌지 않았다는 증거이기도 하다). 적용 롤이 명단에 있으면 탐침을 건너뛰고 NOTICE 로 알린다.
-- PostgREST 스키마 캐시: 함수를 새로 만들므로 갱신이 필요하다. 이 DB 의 이벤트 트리거 `pgrst_ddl_watch` 가
--   `NOTIFY pgrst, 'reload schema'` 를 낸다(runbook 0019 절 「이벤트 트리거 확인」).
-- 적용 경로: **`supabase db push` 만**(runbook 「적용 경로」). 로컬 단건은 `psql -1`.
-- 🔴 배포 순서: **적용 → 배포**. 반대로 하면 /admin/stats 가 `PGRST202`(함수 없음)로 열리지 않는다.
--   그 반대 방향의 사고는 없다 — 이 파일은 기존 코드가 쓰는 것을 아무것도 바꾸지 않는다.
-- 롤백: supabase/rollbacks/0022_admin_stats.down.sql (수동 실행 전용 · 승인 플래그 없음 — 그 파일 헤더에 근거).

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0022: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다. 아무것도 바꾸기 전에 멈춘다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나). psql -f 처럼 문장마다 커밋하는 경로에서는 set local 이 그 문장에서 끝난다(PostgreSQL 은 경고만 낸다).';
  end if;
end
$$;

-- =========================================================================
-- 1. admin_stats(p_from date, p_to date) — 지표 10개를 jsonb 하나로
-- =========================================================================
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
    select null::text, sum(y.n)::bigint, sum(y.buses)::bigint, true from vehicle_ranked y where y.rn <= y.hide_n having sum(y.n) > 0
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

comment on function admin_stats(date, date) is
  '관리자 통계(P5-17 · 0022) — 기간(KST 달력 날짜, 양끝 포함)의 견적 접수 집계를 jsonb 하나로. 결과는 (버킷·코드, 건수)뿐이며 1~2건 칸은 함수 안에서 "기타" 로 합쳐 가린다. 첫 문장이 is_admin() 가드다.';

-- =========================================================================
-- 2. 실행 권한 — 0010 §5 · 0020 §6 과 같은 규약.
--    pg_default_acl 이 새 함수에 anon·authenticated·postgres·service_role 넷에게 EXECUTE 를 준다(CLAUDE.md §3).
--    명시적으로 회수하지 않으면 **익명 롤이 고객 집계를 읽는다.** service_role 도 목록에 넣는다.
-- =========================================================================
revoke all on function admin_stats(date, date) from public, anon, service_role;
grant execute on function admin_stats(date, date) to authenticated;

-- =========================================================================
-- 3. 자기검증 (0016~0021 규범 — 실제 표에 문장을 치지 않는다)
-- =========================================================================
do $$
declare
  v_sig     text := 'public.admin_stats(date,date)';
  v_oid     oid;
  v_proc    record;
  v_src     text;
  v_norm    text;
  v_sel     text;
  v_pos     int;
  v_msg     text;
  v_state   text;
  v_leak    text;
  v_keys    text[];
  v_want    text[];
begin
  -- ① 함수가 기대한 시그니처로 있다.
  v_oid := to_regprocedure(v_sig)::oid;
  if v_oid is null then
    raise exception '0022: % 가 만들어지지 않았다 — 인자 타입이 한 글자라도 다르면 이 이름으로 잡히지 않는다', v_sig;
  end if;

  -- ② definer · stable · search_path 는 pg_temp 로 끝난다(0009 §2 규약 — 임시 스키마 섀도잉 차단).
  select p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ' '), '(없음)') as cfg, p.prosrc
    into v_proc from pg_proc p where p.oid = v_oid;
  if not v_proc.prosecdef then
    raise exception '0022: admin_stats 의 prosecdef 가 false 다 — security definer 여야 RLS 를 우회해 집계할 수 있다';
  end if;
  if v_proc.provolatile <> 's' then
    raise exception '0022: admin_stats 의 volatility 가 % 다 — stable 이어야 한다(읽기 전용 집계)', v_proc.provolatile;
  end if;
  if v_proc.cfg <> 'search_path=public, pg_temp' then
    raise exception '0022: admin_stats 의 search_path 가 % 다 — `public, pg_temp`(pg_temp 가 끝) 여야 한다', v_proc.cfg
      using hint = 'pg_temp 를 앞에 두면 임시 스키마의 같은 이름 객체가 definer 함수 안에서 실제 표를 가린다.';
  end if;

  -- ③ 가드가 **본문의 첫 실행문**이다 (수정 라운드 3 — astra P2: 옛 판의 `\mbegin\s+if …` 는 **앵커가 없어**
  --    중첩 `begin` 안의 가드도 통과했고, 선언부 초기화처럼 가드보다 먼저 도는 경로를 아예 보지 않았다).
  --    주석과 줄바꿈을 지운 뒤 (ㄱ) **첫 번째** `begin` 낱말 바로 뒤가 그 `if` 인지, (ㄴ) 그 앞(선언부)의 모든 초기화가
  --    **리터럴** 인지 본다. 앱(lib/admin/adminRpc.ts isAdminGuardDenial)은 이 문구로 가드 거부와 EXECUTE 거부를 가르므로
  --    한 글자도 달라서는 안 된다.
  v_src  := regexp_replace(v_proc.prosrc, '--[^' || chr(10) || ']*', '', 'g');
  v_norm := ' ' || btrim(regexp_replace(v_src, '\s+', ' ', 'g')) || ' ';
  v_pos  := position(' begin ' in v_norm);
  if v_pos = 0 then
    raise exception '0022: 본문에서 begin 을 찾지 못했다 — 자기검증이 가드 위치를 볼 수 없다';
  end if;
  if substring(v_norm from v_pos) not like
       ' begin if not is_admin() then raise exception ''admin_stats: 관리자 명단에 없는 호출자다'' using errcode = ''42501''; end if;%' then
    raise exception '0022: 가드가 본문의 첫 실행문이 아니다(또는 문구가 다르다) — %', left(substring(v_norm from v_pos), 160)
      using hint = '본문은 첫 begin 다음에 곧바로 `if not is_admin() then raise exception ''admin_stats: 관리자 명단에 없는 호출자다'' using errcode = ''42501''; end if;` 여야 한다. 한 줄이라도 앞서면 명단 밖 호출자가 그 줄을 실행한다.';
  end if;
  -- (ㄴ) 선언부 초기화는 리터럴만 — 함수 호출이 있으면 가드보다 먼저 돈다.
  select string_agg(btrim(m[1]), ' | ') into v_leak
    from regexp_matches(left(v_norm, v_pos), ':=([^;]+);', 'g') m
   where btrim(m[1]) !~ '^([0-9]+|date ''[0-9-]+''|true|false|''[^'']*'')$';
  if v_leak is not null then
    raise exception '0022: 선언부 초기화가 리터럴이 아니다 — % (가드보다 먼저 실행된다)', v_leak;
  end if;

  -- ④ 결과에 나가는 **JSON 키 전수**가 계약과 정확히 같다 (수정 라운드 3 — astra P2: 옛 판은 "4칸 들여쓴 줄" 만 봐서
  --    **여섯 칸으로 넣은** `'debug_rows',` 가 통과했다). 들여쓰기에 기대지 않고, 마지막 select 구간의
  --    소문자 따옴표 리터럴을 **전부** 뽑아 허용 목록과 집합 비교한다. 최상위·중첩·리드타임 구간 이름이 모두 들어 있다.
  v_sel := substring(v_norm from position('select jsonb_build_object(' in v_norm) for
                     greatest(position(' into v_out ' in v_norm) - position('select jsonb_build_object(' in v_norm), 1));
  if length(v_sel) < 200 then
    raise exception '0022: 결과를 만드는 select 구간을 찾지 못했다 — 자기검증이 키를 볼 수 없다';
  end if;
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}') into v_keys
    from regexp_matches(v_sel, '''([a-z][a-z0-9_]*)''', 'g') m;
  select array_agg(k order by k) into v_want
    from unnest(array[
      -- 최상위 11
      'range', 'intake', 'confirmation', 'response_time', 'backlog', 'notifications',
      'trend', 'purposes', 'vehicles', 'segments', 'lead_time',
      -- 중첩
      'from', 'to', 'days', 'bucket', 'prev_from', 'prev_to', 'has_prev',
      'total', 'prev_total', 'delta', 'confirmed', 'rate_pct', 'pending',
      'sample', 'median_minutes', 'enough', 'new_total', 'over_72h', 'hours',
      'failed', 'stuck', 'window_days', 'stuck_hours', 'split', 'waiting', 'cancelled',
      'code', 'count', 'suppressed', 'other', 'slug', 'buses', 'origin', 'destination', 'showcase',
      -- 리드타임 구간 이름(정렬용 array 리터럴)
      'd0_7', 'd8_30', 'd31_90', 'd91_plus']) k;
  if v_keys is distinct from v_want then
    raise exception '0022: 결과 select 의 키 집합이 계약과 다르다 — 더 있음 [%] / 없음 [%]',
      array_to_string(array(select x from unnest(v_keys) x except select y from unnest(v_want) y), ', '),
      array_to_string(array(select y from unnest(v_want) y except select x from unnest(v_keys) x), ', ')
      using hint = '키를 더하거나 이름을 바꾸면 lib/admin/stats.ts 의 ADMIN_STATS_KEYS 와 tests/admin-stats.test.ts 도 함께 바꿔야 한다. 들여쓰기와 무관하게 잡힌다.';
  end if;

  -- ⑤ 개인정보 칸을 **이름으로도** 쓰지 않는다. 옛 목록에는 `name`·`phone`·`email`·`message` 가 빠져 있었다(astra P2).
  --    낱말 경계로 본다 — `to_phone` 이 `phone` 으로 두 번 잡히지 않게.
  select string_agg(c, ', ' order by c) into v_leak
    from unnest(array['name', 'phone', 'email', 'message', 'public_code', 'admin_memo',
                      'to_phone', 'provider_message_id', 'last_error']) c
   where v_src ~ ('\m' || c || '\M');
  if v_leak is not null then
    raise exception '0022: 본문이 개인정보 칸을 참조한다 — %', v_leak;
  end if;

  -- ⑥ EXECUTE 보유자 — authenticated 뿐이다. NULL proacl 함정(P5-15 R4)을 피해 acldefault 로 풀어 본다.
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception '0022: anon 이 admin_stats 를 실행할 수 있다 — §2 의 revoke 목록을 확인할 것'
      using hint = 'pg_default_acl 이 새 함수에 anon·authenticated·postgres·service_role 넷에게 EXECUTE 를 준다(CLAUDE.md §3).';
  end if;
  if has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '0022: service_role 이 admin_stats 를 실행할 수 있다 — 회수 목록에서 가장 빠뜨리기 쉬운 자리다';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception '0022: authenticated 가 admin_stats 를 실행하지 못한다 — 관리자 화면이 세션 클라이언트로 부른다(ADR-2)';
  end if;
  if exists (
    select 1 from pg_proc p
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '0022: admin_stats 의 EXECUTE 가 PUBLIC 에 열려 있다';
  end if;
  -- 소유자·슈퍼유저를 뺀 나머지 롤 전수 — 상속으로 들어온 실행 권한까지 본다.
  select string_agg(rl.rolname, ', ' order by rl.rolname) into v_leak
    from pg_roles rl
   where not rl.rolsuper
     and rl.rolname <> 'authenticated'
     and not pg_has_role(rl.oid, (select p.proowner from pg_proc p where p.oid = v_oid), 'USAGE')
     and has_function_privilege(rl.oid, v_oid, 'EXECUTE');
  if v_leak is not null then
    raise exception '0022: authenticated 말고 다른 롤이 admin_stats 를 실행할 수 있다 — %', v_leak
      using hint = '상속(롤 멤버십)으로 들어온 권한일 수 있다. pg_auth_members 로 누가 그 롤의 멤버인지 볼 것.';
  end if;

  -- ⑦ 거동 탐침 — **가드 하나뿐이고 읽기다.** 적용 롤은 관리자 명단에 없으므로 42501 + 정확한 문구가 나야 한다.
  --    나면 본문의 다른 한 줄도 돌지 않았다는 뜻이기도 하다(가드가 첫 문장이다).
  if is_admin() then
    raise notice '0022: 적용 롤이 관리자 명단에 있어 가드 탐침을 건너뛴다 — 적용 롤은 보통 postgres 이고 명단에 없다.';
  else
    begin
      perform admin_stats('2000-01-01'::date, '2000-01-02'::date);
      raise exception '0022: 가드가 막지 않았다 — 명단 밖 호출자가 집계를 읽을 수 있다';
    exception when insufficient_privilege then
      get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
      if v_msg <> 'admin_stats: 관리자 명단에 없는 호출자다' or v_state <> '42501' then
        raise exception '0022: 가드가 던진 것이 기대와 다르다 — %:%', v_state, v_msg;
      end if;
      raise notice '0022: 가드 탐침 통과 — %:%', v_state, v_msg;
    end;
  end if;

  raise notice '0022: 자기검증 통과 — admin_stats(date,date) definer·stable·pg_temp, EXECUTE 는 authenticated 뿐.';
end
$$;
