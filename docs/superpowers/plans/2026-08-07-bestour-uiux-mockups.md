# 베스트투어 UIUX 시안 제작 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 베스트투어 홈페이지 리디자인의 클라이언트 컨펌용 홈 화면 시안 6개 + 비교 갤러리를 정적 HTML로 제작한다.

**Architecture:** soul.md(전체 컨텍스트) → 각 시안은 자기완결형 단일 HTML 파일(인라인 CSS/JS, 공유 이미지는 `mockups/assets/`) → 비교 갤러리 `mockups/index.html`이 6개를 iframe 썸네일 + 핀 기능으로 나열. 백엔드 없음. YC 파이프라인의 "일회용 시안" 철학에 따라 시안 간 코드 공유(DRY)보다 독립성을 우선한다.

**Tech Stack:** 순수 HTML/CSS/JS (프레임워크 없음), Pretendard 웹폰트(CDN + system-ui 폴백), browse 스킬로 스크린샷 검증.

## Global Constraints

- 모든 카피는 한국어. 회사 정보는 스펙 §4 푸터 정보를 그대로 사용 (합자회사 베스트투어, 대표 이승묵, 1566-6188 등)
- 기존 메뉴 전부 네비게이션에 존재: 회사소개 / 차량소개 / 견적요청 / 갤러리 / 고객센터 / 예약확인
- 차량 5종 고정: 45인승 관광버스, 35인승 관광버스, 28인승 우등리무진, 25인승 관광버스, 16인승 관광버스
- 가격 표기는 항상 "예상가" 라벨 + "실제 견적은 확정 시 안내" 문구 동반
- 모바일 우선 반응형 (375px에서 가로 스크롤 없음, 1280px 데스크톱 대응)
- 보라색 아이덴티티: 기본 팔레트 딥퍼플 `#3B1F5C`, 바이올렛 `#7C3AED`, 라벤더 배경 `#F3EFFA`, 다크 `#1A1523`, 뉴트럴 `#FAF9FC`, 골드 액센트 `#D4A843` (시안별 비율만 다르게, 색상군 이탈 금지)
- 히어로에는 반드시 견적 진입점(위젯 카드 또는 차량 카드)이 있어야 함 — 스크롤 없이 보이는 위치
- 각 시안 파일은 자기완결형: 외부 의존성은 Pretendard CDN과 `assets/` 이미지뿐

## 디자인 소울 (사용자 제공 레퍼런스 4종에서 추출 — 겉모습 복제 금지, 원리만 적용)

1. **견적 진입은 히어로 속 컴팩트 위젯 카드** — 거대한 폼을 페이지 하단에 두지 않고, 밀도 있는 카드 하나가 히어로에 떠 있다 (레퍼런스: Shuttle의 오버랩 폼 카드, Premier Limo의 우측 부킹 위젯)
2. **한 색 계열에 대한 확신** — 브랜드색을 여러 틴트로 깊게 쓰고(면·배경·일러스트까지), 포인트로만 뿌리지 않는다 (레퍼런스: Global Express의 블루 몰입)
3. **타이포 대비** — 큰 볼드 헤드라인 + 문장 속 핵심 단어만 액센트 컬러/서체 변화 (레퍼런스: Shuttle의 컬러 키워드, Punctual의 손글씨+헤비산스 믹스)
4. **신뢰는 숫자로** — 연혁 문단 대신 스탯 블록(운행 연차, 누적 견적 건수)과 실시간 견적현황 (레퍼런스: Shuttle의 25 years/2,640 customers)
5. **가격 투명성 전면** — 차량/노선 카드에 예상가 노출 (레퍼런스: Global Express의 목적지 카드 가격, Premier Limo의 시간당 요금)
6. **섹션 리듬** — 라이트/다크 교차, 번호 매긴 에디토리얼 구조(01/02/03), 넉넉한 여백 (레퍼런스: Premier Limo)
7. **사진은 드라마틱하게** — 오버레이, 프레임 브레이크, 풀블리드. 보라색 버스 실사진이 최고의 자산 (레퍼런스: Punctual의 폰 프레임을 뚫는 버스)

---

### Task 1: soul.md 작성

**Files:**
- Create: `mockups/soul.md`

**Interfaces:**
- Produces: 이후 모든 시안 태스크가 읽는 단일 컨텍스트 파일

- [ ] **Step 1: soul.md 작성** — 아래 내용을 전부 포함:
  - 프로젝트 개요: 베스트투어(전세버스 대절 알선, 고양시), 노후 그누보드 사이트 리디자인, 견적 최우선 원칙
  - 스펙 §3 견적 정책 원문 (실시간 예상가 + 예약 걸기 + 사장 확정 + 확정 건만 결제)
  - 스펙 §4 IA 매핑 표 + 회사 정보 전문
  - 스펙 §5 홈 구성 8개 항목
  - 스펙 §6 위저드 7단계 (시안에서는 히어로 진입점까지만, 위저드 상세는 선택안 확정 후)
  - 위 "디자인 소울" 7개 원리 전문
  - Global Constraints의 팔레트/차량/카피 규칙
  - 실시간 견적현황 더미 데이터 12건 (형식: `한** · 45인승 관광버스 · 2026-08-06`)
  - 더미 요금표: 45인승 당일왕복 서울→강원 650,000원 / 35인승 550,000원 / 28인승 우등 600,000원 / 25인승 480,000원 / 16인승 400,000원, 편도 60%, 1박2일 x1.8 (시안 카드 표기용)
- [ ] **Step 2: Commit** — `git add mockups/soul.md && git commit -m "docs: add soul.md context file for mockup generation"`

### Task 2: 실사진 에셋 수집

**Files:**
- Create: `mockups/assets/` (버스 사진 4~8장)

**Interfaces:**
- Produces: `mockups/assets/bus-01.jpg` … 상대경로로 각 시안이 사용

- [ ] **Step 1: browse 스킬로 기존 사이트에서 보라색 버스 사진 다운로드** — `$B goto http://www.bestour.co.kr/` 후 `$B scrape images --dir mockups/assets --limit 20`, 갤러리 게시판(`bbs/board.php?bo_table=thema1`)에서도 시도. 로고/아이콘 제거, 버스 실사진만 남기고 `bus-01.jpg`~ 순번 리네임
- [ ] **Step 2: 검증** — 사진이 4장 미만이면 CSS 그라디언트 + 인라인 SVG 버스 실루엣으로 대체하는 방침을 soul.md에 추가
- [ ] **Step 3: Commit** — `git add mockups/assets && git commit -m "chore: collect purple bus photo assets from legacy site"`

### Task 3: 시안 1 — 딥퍼플 프리미엄

**Files:**
- Create: `mockups/variant-01-deep-purple.html`

**Interfaces:**
- Consumes: `mockups/soul.md`, `mockups/assets/`
- Produces: 자기완결 HTML (갤러리가 iframe으로 로드)

- [ ] **Step 1: HTML 작성** — 디자인 브리프:
  - 배경 `#3B1F5C` 계열 몰입형(소울 #2), 텍스트는 라벤더/화이트
  - 히어로: 좌측 대형 헤드라인("전세버스 견적, *1분*이면 충분합니다" — *1분* 골드 액센트, 소울 #3) + 우측 컴팩트 견적 위젯 카드(출발지/도착지/날짜/차량 4필드 + "예상가 확인" CTA, 소울 #1)
  - 스탯 블록: "운행 13년 · 누적 견적 4,800+ · 차량 5종" (소울 #4)
  - 이하 스펙 §5 순서: 실시간 견적현황 → 이용방법 4단계 → 차량 카드 5종(예상가 표기, 소울 #5) → 강점 그리드 → 갤러리 프리뷰 → 공지 → 푸터, 섹션은 퍼플 틴트 농도로 리듬 (소울 #6)
  - 플로팅 전화 버튼(1566-6188)
- [ ] **Step 2: browse로 검증** — `$B goto file://<abs>/mockups/variant-01-deep-purple.html` → `$B responsive /tmp/v01` → 모바일 가로 스크롤 없음, 히어로에 견적 진입점 보임, 콘솔 에러 0 확인
- [ ] **Step 3: Commit** — `git commit -m "feat: mockup variant 01 deep purple premium"`

### Task 4: 시안 2 — 화이트 + 퍼플 액센트 클린

**Files:**
- Create: `mockups/variant-02-clean-white.html`

**Interfaces:** Task 3과 동일 구조

- [ ] **Step 1: HTML 작성** — 브리프: 배경 `#FAF9FC`, 카드 화이트 + 섀도우, 액센트만 `#7C3AED`. 히어로는 풀폭 버스 사진에 화이트 오버레이 위 중앙 위젯 카드. 번호 매긴 섹션 헤더 "01 차량 선택 / 02 이용 방법 / 03 고객 후기"(소울 #6). 나머지 §5 섹션 동일. twdream보다 여백 2배.
- [ ] **Step 2: browse 검증** — Task 3 Step 2와 동일 (경로만 variant-02)
- [ ] **Step 3: Commit** — `git commit -m "feat: mockup variant 02 clean white"`

### Task 5: 시안 3 — 위저드 전면 배치형

**Files:**
- Create: `mockups/variant-03-wizard-first.html`

**Interfaces:** Task 3과 동일 구조

- [ ] **Step 1: HTML 작성** — 브리프: 히어로 자체가 위저드 1단계. 좌측 브랜드 패널(딥퍼플, 로고+카피), 우측 화이트 패널에 차량 5종 카드 선택 UI + 진행 인디케이터(1/7). 차량 카드 클릭 시 예상가 미리보기 뱃지 표시(인라인 JS, 더미 요금표). 스크롤 아래에 §5 나머지 섹션 축약 배치.
- [ ] **Step 2: browse 검증** — 동일 + 차량 카드 클릭 시 예상가 뱃지 동작 확인 (`$B click` + `$B snapshot -D`)
- [ ] **Step 3: Commit** — `git commit -m "feat: mockup variant 03 wizard-first"`

### Task 6: 시안 4 — 풀스크린 사진형

**Files:**
- Create: `mockups/variant-04-photo-hero.html`

**Interfaces:** Task 3과 동일 구조

- [ ] **Step 1: HTML 작성** — 브리프: 100vh 풀블리드 버스 사진 + 딥퍼플 그라디언트 오버레이(소울 #7), 하단에 겹쳐 올라오는 화이트 견적 위젯 바(가로형 4필드, Shuttle 오버랩 패턴의 원리만). 헤드라인은 화이트 대형 + 골드 키워드. 스크롤 후 §5 섹션 라이트 배경.
- [ ] **Step 2: browse 검증** — Task 3 Step 2와 동일
- [ ] **Step 3: Commit** — `git commit -m "feat: mockup variant 04 fullscreen photo"`

### Task 7: 시안 5 — 카드 그리드형

**Files:**
- Create: `mockups/variant-05-card-grid.html`

**Interfaces:** Task 3과 동일 구조

- [ ] **Step 1: HTML 작성** — 브리프: twdream 직계 개선형. 히어로 좌측 카피 + 우측 차량 5종 카드 그리드(사진·정원·예상가·"견적 시작" 버튼). 라벤더 `#F3EFFA` 배경. 실시간 견적현황을 히어로 바로 아래 티커(가로 슬라이드)로. 나머지 §5 순서 유지.
- [ ] **Step 2: browse 검증** — Task 3 Step 2와 동일
- [ ] **Step 3: Commit** — `git commit -m "feat: mockup variant 05 card grid"`

### Task 8: 시안 6 — 다크 프리미엄

**Files:**
- Create: `mockups/variant-06-dark-premium.html`

**Interfaces:** Task 3과 동일 구조

- [ ] **Step 1: HTML 작성** — 브리프: 배경 `#1A1523`, 골드 `#D4A843` + 바이올렛 액센트, Premier Limo의 럭셔리 절제 원리(소울 #6: 번호 섹션, 대여백). 히어로 우측 컴팩트 부킹 위젯(다크 글래스 카드). 차량 카드는 필터 탭(전체/대형/리무진/소형) 포함. 28인승 우등리무진을 "프리미엄" 뱃지로 강조.
- [ ] **Step 2: browse 검증** — Task 3 Step 2와 동일
- [ ] **Step 3: Commit** — `git commit -m "feat: mockup variant 06 dark premium"`

### Task 9: 비교 갤러리

**Files:**
- Create: `mockups/index.html`

**Interfaces:**
- Consumes: variant-01~06 HTML 파일 (iframe src 상대경로)

- [ ] **Step 1: HTML 작성** — 6개 시안을 2열(모바일 1열) 카드로 나열. 각 카드: iframe 미리보기(scale 축소, pointer-events 없음) + 시안명 + 무드 설명 1줄 + "전체 보기"(새 탭) + 핀 버튼. 핀 상태는 localStorage 저장, 핀된 카드는 상단 정렬 + 골드 테두리 (YC 파이프라인의 핀 패턴).
- [ ] **Step 2: browse 검증** — `$B goto file://<abs>/mockups/index.html` → 6개 iframe 로드 확인, 핀 클릭 → 새로고침 후 유지 확인 (`$B click` + `$B reload` + `$B snapshot`)
- [ ] **Step 3: Commit** — `git commit -m "feat: mockup comparison gallery with pin feature"`

### Task 10: 전체 QA + 사용자 제시

**Files:**
- 산출: 스크린샷 (스크래치패드)

**Interfaces:**
- Consumes: mockups/ 전체

- [ ] **Step 1: 6개 시안 데스크톱+모바일 스크린샷 일괄 촬영** — browse `responsive`로 12장 생성, Read로 직접 확인: 팔레트 이탈·한글 깨짐·레이아웃 붕괴·히어로 견적 진입점 부재 여부 점검, 발견 시 수정 후 재촬영
- [ ] **Step 2: 사용자에게 갤러리 안내** — `mockups/index.html` 여는 법 안내 + 12장 스크린샷 요약 제시 + 어떤 시안(들)을 고를지 질문
- [ ] **Step 3: Commit** — 수정분 있으면 `git commit -m "fix: mockup QA adjustments"`
