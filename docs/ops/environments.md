# 환경 구성 — 운영 · 시험(프리뷰) · 로컬 (플랜 P0-2)

2026-09-21 작성. 이 문서가 생기기 전까지 **프리뷰 배포가 어느 DB 를 쓰는지 기록이 없었다** — 0020 적용 때 GitHub 배포 기록으로 역추적해야 했다(`migration-runbook.md` 「원격 적용 기록 — 0020」).

## 세 환경

| 환경 | Supabase 프로젝트 | ref | 리전 | 누가 쓰나 |
|---|---|---|---|---|
| **운영** | `bestour_hompage` | `expexkhcuogkavpacrem` | 서울 `ap-northeast-2` | Vercel **Production** · 실제 손님 개인정보 |
| **시험(프리뷰)** | `bestour_homepage_preview` | `gjnieoojgmhulkohdcnl` | 서울 `ap-northeast-2` | Vercel **Preview** · 시험 데이터만 |
| **로컬** | `supabase start` 스택 | — | `127.0.0.1:54321` | 개발·테스트·CI `db-test` |

두 원격 프로젝트는 같은 조직(`bestour_homepage`)에 있다. 저장소의 `supabase link` 는 **운영**을 가리킨다(`supabase/.temp/project-ref`) — **시험 프로젝트로 다시 link 하지 마라.** 시험 프로젝트에는 `--db-url` 로 붙는다(아래).

## 왜 나눴나
프리뷰에서 견적 신청을 시험하면 그 행이 **운영 DB 의 실제 고객 표**에 들어가고, 보관·파기·통지 규칙이 그 행에 그대로 적용된다. 시험 데이터와 실제 예약이 섞이고, "어느 배포본이 운영 DB 에 붙어 있나" 를 매번 추적해야 한다. 나누면 둘 다 사라진다.

## 시험 프로젝트의 상태 (2026-09-21 생성 직후 실측)
- 마이그레이션 **0001~0020** 적용(`db push --db-url`, 빈 DB 에서 처음부터 — 모든 자기검증 통과).
- 기본 데이터는 마이그레이션이 넣는다: 대표 노선 16 · 차량 5 · 장소 17 — **운영과 같은 수**.
- Storage 버킷 `gallery`(public) · `gallery-originals`(private) — 운영과 같은 설정(20MB, jpeg·png·webp·heic·heif). 버킷은 SQL 이 아니라 **Storage API** 로 만들었다(0011 헤더 — SQL insert 는 대시보드 메타를 건너뛴다).
- 예약·통지 0건.

## ⚠️ 아직 남은 설정 (사람이 해야 한다)
1. **Vercel Preview 환경변수** — Vercel 대시보드 → Settings → Environment Variables 에서 **Preview 범위만** 체크하고 아래 셋을 시험 프로젝트 값으로 넣는다. 값은 `docs/private/preview-supabase.env`(저장소에 올라가지 않는다):
   - `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`
   - **Production 범위의 값은 건드리지 않는다**(운영 그대로).
   - 넣은 뒤 프리뷰를 다시 배포해야 반영된다(`NEXT_PUBLIC_*` 는 빌드 시점에 박힌다).
2. **시험 프로젝트의 공개 회원가입 끄기** — Supabase 대시보드 → 시험 프로젝트 → Authentication → Sign In / Providers → "Allow new users to sign up" 끄기. 운영은 2026-09-13 에 껐다(`known-defects.md` D2). 시험 프로젝트의 anon 키도 프리뷰 번들에 실려 공개되므로 같은 조치가 필요하다. 새 프로젝트의 기본값은 **켜짐**이다.
3. 시험 프로젝트에 관리자 계정이 필요하면 `admin_users` 에 행을 넣는다(운영과 같은 절차 — `docs/ops/admin-manual.md`).

## 🔴 앞으로의 마이그레이션 — **시험 먼저, 운영 나중**
두 프로젝트의 스키마가 어긋나면 프리뷰에서 통과한 코드가 운영에서 깨진다. 그래서:
1. CI green 뒤 **시험 프로젝트에 먼저** 적용한다:
   ```
   # 비밀번호는 docs/private/preview-supabase.env 의 PREVIEW_DB_PASSWORD
   npx --no-install supabase db push --db-url "postgresql://postgres.gjnieoojgmhulkohdcnl:<비밀번호>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
   ```
   (`aws-1-…` 호스트는 이 프로젝트에서 `tenant/user not found` 로 실패했다 — `aws-0` 이 맞다.)
2. 시험 프로젝트에서 자기검증이 통과하고 프리뷰 배포가 정상이면 **운영에** `migration-runbook.md` 의 「적용 직전 필수」 절차대로 적용한다.
시험 적용이 **운영 적용의 리허설**이 된다 — 빈 DB 에서 처음부터 도는 경로를 매번 확인하는 효과도 있다.

## 비용
Supabase 조직의 요금제에 따라 프로젝트 하나를 더하면 월 컴퓨팅 비용이 붙을 수 있다. **생성 전에 요금제를 확인하지 못했다** — 조직 결제 화면에서 확인할 것. 필요 없어지면 시험 프로젝트는 일시정지(pause)할 수 있다.

---

## 🔴 Vercel 빌드가 2026-09-13 부터 막혔던 이유 — 원인 둘 (2026-09-26 규명)

9월 13일 이후 `feature/implementation` 의 **모든 커밋이 Vercel 에서 실패**했고, 그래서 그 뒤 만든 것(영문 페이지·새 전화번호·취소·환불 2단계·청약철회 동의·관리자 통계)이 **하나도 배포되지 않았다.** 저장소 CI 의 프로덕션 빌드는 매번 통과해서 드러나지 않았다. 원인은 둘이 겹쳤다.

| 커밋 | 시각(KST) | Vercel 상태 | 원인 |
|---|---|---|---|
| `ef20718` | 09-13 05:02 | 빌드가 **돌았다가** 실패 | **Preview 환경변수 누락.** 홈(`/ko`)은 빌드 때 미리 만드는 페이지라 빌드 시점에 DB 를 읽는데, Preview 범위에 `NEXT_PUBLIC_SUPABASE_URL` 이 없어 `createAnonClient` 가 던졌다 |
| `2257505` 부터 전부 | 09-13 05:53 ~ | **빌드 시작 전 거부**(`pending` 없이 곧바로 `Deployment failed.`, 링크는 전부 `vercel.link/3Fpeeb1`) | **무료(Hobby) 요금제의 크론 제한.** 이 커밋이 `vercel.json` 에 통지 크론 `*/5 * * * *`(5분마다)를 넣었다. Hobby 는 크론을 **하루 1회**까지만 허용하고, 그보다 잦으면 배포를 거부한다(링크가 가리키는 문서: Cron Jobs · Usage & Pricing) |

진단 방법(다음에 또 쓸 수 있게): GitHub 커밋 상태 API(`/commits/<sha>/statuses`)의 `description`·`target_url`·시각을 본다. **빌드가 돌았으면** `pending` 뒤에 배포별 URL 이 나오고, **배포가 거부됐으면** `pending` 없이 공통 링크 하나만 나온다. 공통 링크를 `curl -I` 로 따라가면 거부 사유 문서가 나온다.

### 조치
1. **Preview 환경변수** — 사용자가 2026-09-26 에 Production/Preview 로 나눠 다시 넣었다. 세 변수(주소·anon·service role) 모두. 빌드를 멈추게 하는 변수는 이 셋뿐이다(`lib/supabase/*` 가 없으면 던진다). 나머지(Turnstile·Upstash·Solapi 등)는 없어도 빌드는 되고 해당 기능만 스스로 닫힌다.
2. **확정 실험 (2026-09-26 · 컨트롤러)** — 정황만으로 단정하지 않고 실험했다. 최신 커밋 `24ec293` 에서 **크론만 하루 1회로 바꾼** 임시 브랜치 `ci/vercel-cron-probe`(`a13dc0f`)를 푸시하자 Vercel 이 곧바로 `pending → success`(02:40:18 → 02:41:45 UTC)로 빌드·배포했다. 같은 코드에 5분 크론만 있는 커밋들은 전부 빌드 전에 거부됐다 — **크론 주기가 원인임이 확정.** 같은 배포가 빌드 중 DB 를 읽는 단계를 통과해 **Preview 환경변수도 동작**함이 함께 확인됐다.
3. **사용자 결정: 유료 대신 구조 변경 (P4-7)** — 결제 시도가 카드사에서 거절된 뒤 사용자가 **"① 접수·확정 즉시 발송 + 하루 1회 재시도 크론"** 을 골랐다. 손님은 오히려 더 빨리 문자를 받고, 무료 요금제의 크론 제한 안에 든다. 나중에 Pro 로 가도 이 구조를 그대로 쓴다.
   🔴 **그래도 오픈 전에는 Pro(또는 상업용 무료 구간이 있는 다른 호스팅)가 필요하다.** Vercel 무료 요금제는 약관상 **개인·비상업 전용**이다 — 영업용 사이트를 무료로 운영하면 계정 정지 위험이 있다. 방문 통계(Web Analytics)의 상업적 사용도 Pro 가 전제다. P4-7 은 **개발·시험이 멈추지 않게** 하는 조치이지, 유료 전환을 없애는 조치가 아니다.
   계획(P0-1)대로 오픈 전 **사장님 명의 Pro 팀**으로 이전하고 결제도 사장님께 넘긴다. 요금: 월 $20(부가세 별도 · 개발자 좌석 1 · 사용량 크레딧 $20 포함 · 조회 좌석 무료), 2026-09-26 vercel.com/pricing 확인.

### 부수 발견 — 환경변수가 한때 뒤바뀌었다
재설정 도중 Production 행에 **시험용 DB 주소가 저장된 적**이 있다(값은 시험용 · 환경은 Production). Vercel 은 환경변수를 **배포할 때 찍어 두므로** 떠 있던 운영 배포(08-31)에는 영향이 없었고, 운영 재배포 전에 바로잡았다. 교훈: 값의 **끝 6자리**로 짝을 확인한다 — Supabase 키는 앞 36자가 모든 프로젝트에서 같다(`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.`).
| | Production | Preview |
|---|---|---|
| URL | `expexkhcuogkavpacrem` | `gjnieoojgmhulkohdcnl` |
| anon 키 끝 | `…o9vSks` | `…A2Vpvg` |
| service role 키 끝 | `…0alKNU` | `…mNVvQw` |
(키 전체는 `docs/private/prod-supabase.env`·`preview-supabase.env` — 저장소 밖)
