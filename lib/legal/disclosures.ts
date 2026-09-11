// lib/legal/disclosures.ts — 법정 문구 단일 원장 (플랜 v4 P1-1 · ADR-5)
//
// 규칙
//   - 상수만 export 한다. 함수 export 0개 — scripts/check-legal-disclosures.sh 가 grep 으로 강제한다.
//   - 컴포넌트·페이지·i18n 은 법정 문구를 이 모듈에서만 가져온다. 다른 파일에 법정 문구를 쓰면 게이트 위반.
//   - 문안은 P1-1 브리프(.superpowers/sdd/2026-09-06-bestour-implementation-v4/P1-1-brief.md)에서
//     그대로 옮겼다. 윤문 금지 — 바꿔야 하면 브리프·스펙을 먼저 고치고 여기로 내려온다.
//   - 확인되지 않은 값은 줄 끝 TEMP 마커 주석(`CONST.field: 사유`) + scripts/gates/temp-allowlist.txt 등록.
//     값 자체가 미확정인 필드는 "" 로 둔다 — 지어내지 않는다. 소비자는 빈 값을 숨김 폴백으로 처리한다.
//   - source: 각 상수가 어디서 확정됐는지(스펙 §번호 / 사업자등록증 / 사장님 확인시트 ★번호 / 옛 사이트 bo_page).
//     배열 상수(PROCESSORS·OVERSEAS_TRANSFERS)는 객체가 아니라서 형제 상수 *_SOURCE 에 둔다.

// ── 운영사 ───────────────────────────────────────────────────────────────
export const COMPANY = {
  legalName: "합자회사 베스트투어",
  brandName: "베스트투어",
  brandNameEn: "Bestour",
  representative: "이승묵",
  representativeEn: "Lee SeungMuk",
  bizRegNo: "130-86-77328",
  mailOrderNo: "제 2020-고양일산동-1211호",
  mailOrderIssuer: "고양시", // [TEMP] COMPANY.mailOrderIssuer: 신고 기관명 — 신고증 원본 확인 전
  address: "경기도 고양시 일산동구 동국로 107(식사동)",
  branchAddress: "서울시 마포구 월드컵북로 23길 18",
  tel: "1566-6188",
  mobile: "010-2048-8585",
  fax: "0303-3443-5252",
  email: "bestour2013@naver.com", // [TEMP] COMPANY.email: P0-10 도메인 메일 개설 후 info@bestour.co.kr 로 교체
  bankAccount: "KB국민은행 690101-00-050894",
  bankHolder: "합자회사 베스트투어", // [TEMP] COMPANY.bankHolder: 예금주명 확인 전
  establishedYear: 2013,
  privacyOfficer: { name: "조선영", phone: "010-2047-8585" },
  hostingProvider: "Vercel Inc.",
  source: "사업자등록증 2021-12-14 / whois / 스펙 §13.1·§13.8 / 확인시트 ★3",
} as const;

// ── 관계사 (푸터 병기용) ─────────────────────────────────────────────────
export const RELATED_COMPANY = {
  legalName: "(주)베스트모빌리티",
  representative: "이승묵",
  bizRegNo: "342-88-03855", // 시트의 332-… 는 오기. 등록증 확대 판독으로 342 확정 (스펙 §13.8)
  address: "경기도 용인시 기흥구 용구대로 2439, 4층 2호 201호(마북동)",
  role: "관계사",
  note: "계약 · 결제 · 개인정보 처리의 주체는 합자회사 베스트투어입니다.",
  source: "사업자등록증 2026-08-18 / 스펙 §13.1",
} as const;

// ── verbatim — 한 바이트도 바꾸지 마라 (CLAUDE.md §3) ────────────────────
export const VERBATIM = {
  bookingNotice: "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다.",
  showcaseNotice: "대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정",
  source: "CLAUDE.md §3",
} as const;

// ── 견적 산정 기준 — 전자상거래법 §13②3호 (가격 미결정 시 산정 방법 표시) ──
export const QUOTE_BASIS = {
  title: "견적 산정 기준",
  factors: ["차종", "탑승 인원", "운행 거리", "운행 시간", "운행 일수", "심야/주말 할증"],
  line: "견적 산정 기준 : 차종 · 탑승 인원 · 운행 거리 · 운행 시간 · 운행 일수 · 심야/주말 할증",
  source: "스펙 §13.10 / 전자상거래법 제13조 제2항 제3호",
} as const;

// ── 지급 방법·시기 ───────────────────────────────────────────────────────
export const PAYMENT = {
  onlinePayment: false,
  depositKrw: 100000,
  line: "대금 지급 : 온라인 결제 없음 · 계약금 10만원 · 잔금과 지급 방법은 예약 확정 시 안내",
  balanceTiming: "예약 확정 시 안내", // [TEMP] PAYMENT.balanceTiming: 사장님 미회신 — 잔금 시기·지급수단 상세
  source: "확인시트 C3 / 2차 회신 2026-09-06",
} as const;

// ── 취소·환불 (기준액 재확인 중) ─────────────────────────────────────────
export const CANCELLATION = {
  basis: "deposit", // [TEMP] CANCELLATION.basis: 사장님 재확인 중 — 기존 사이트는 '총 차량금액' 기준, 시트 답변은 기준 미명시. 컨트롤러 잠정: 계약금 기준
  tiers: [
    { when: "운행일 8일 전까지", refundPct: 100, label: "계약금 전액 환불" },
    { when: "운행일 7일 전 ~ 2일 전", refundPct: 80, label: "계약금의 80% 환불" },
    { when: "운행일 전날", refundPct: 50, label: "계약금의 50% 환불" },
    { when: "운행 당일", refundPct: 0, label: "환불 불가" },
  ],
  referenceTime: "기준 시각은 운행 출발 시각입니다.",
  depositNote: "계약금은 10만원이며, 잔금과 지급 방법은 예약 확정 시 안내드립니다.",
  source: "확인시트 ★1 / 스펙 §13.11·§13.12",
} as const;

// ── 개인정보 수집·이용 4대 고지 (PIPA §15②) ─────────────────────────────
export const PRIVACY_NOTICE = {
  title: "개인정보 수집·이용 안내",
  purpose: "전세버스 견적 상담 및 예약 접수·확정",
  items: ["이름", "휴대폰 번호", "운행 희망 일시", "출발지·도착지·경유지", "탑승 인원"],
  itemsLine: "이름, 휴대폰 번호, 운행 희망 일시, 출발지·도착지·경유지, 탑승 인원",
  // 이 문구는 lib/retention/purge.ts 의 실제 파기 동작과 일치해야 한다. 배치는 확정 이력이 있는 예약을
  // created_at + CONFIRMED_KEEP_YEARS(5년) 까지 보관하므로, 그 예외가 문구에도 있어야 고지가 참이 된다.
  retention:
    "접수일로부터 1년. 다만 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 계약 또는 청약철회 등에 관한 기록과 대금결제 및 재화 등의 공급에 관한 기록은 5년간 보관합니다.", // [TEMP] PRIVACY_NOTICE.retention: 확인시트 F3 미회신 — "1년" 부분이 가정값. 법정 보존 5년 예외는 확정 사실(전자상거래법 §6③·시행령 §6①2·3호)
  retentionDays: 365, // [TEMP] PRIVACY_NOTICE.retentionDays: 위 retention 문안의 숫자값(같은 가정) — lib/reservations/consent.ts 가 retention_until 계산에 읽는다. 문안과 함께 바꾼다
  refusal: "동의를 거부하실 수 있으며, 거부 시 견적 상담과 예약 접수가 제한됩니다.",
  consentLabel: "위 내용을 확인했으며 개인정보 수집·이용에 동의합니다. (필수)",
  marketingConsentLabel: "할인·이벤트 안내 문자 수신에 동의합니다. (선택)",
  publicFeedNotice: "접수 현황은 성명 일부(예: 한**)·차종·운행일만 마스킹하여 홈에 공개됩니다.",
  source: "스펙 §13.10 / 플랜 ADR-6 / UIUX 브리프 §3-②",
} as const;

// ── 처리위탁 (PIPA §26② 실명 공개, 별도 동의 불요) ──────────────────────
export const PROCESSORS = [
  { name: "주식회사 누리고(Solapi)", task: "문자·알림톡 발송", location: "대한민국" }, // [TEMP] PROCESSORS.Solapi.name: 법인명 — solapi.com 사업자정보에서 확인 후 교체
  { name: "Vercel Inc.", task: "웹 호스팅·서버 운영", location: "미국" },
  { name: "Supabase Inc.", task: "데이터베이스·인증·파일 저장", location: "" }, // [TEMP] PROCESSORS.Supabase.location: 프로젝트 리전 확인 전
  { name: "Upstash Inc.", task: "접수 폭주 방지(요청 제한)", location: "" }, // [TEMP] PROCESSORS.Upstash.location: 리전 확인 전
  { name: "Cloudflare Inc.", task: "봇 차단(Turnstile)·DNS", location: "미국" },
] as const;
export const PROCESSORS_SOURCE = "플랜 ADR-10 / 결정 메모 1-C" as const;

// ── 국외 이전 (PIPA §28조의8② 5항목 + 시행령 §31① "이전의 근거") ────────
export const OVERSEAS_TRANSFERS = [
  {
    recipient: "Vercel Inc.",
    contact: "privacy@vercel.com",
    country: "미국",
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "접속 로그·요청 정보",
    purpose: "웹 호스팅",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
  },
  {
    recipient: "Supabase Inc.",
    contact: "privacy@supabase.io",
    country: "", // [TEMP] OVERSEAS_TRANSFERS.Supabase.country: 프로젝트 리전 확인 전
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "이름·휴대폰 번호·운행 정보",
    purpose: "데이터 저장·인증",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
  },
  {
    recipient: "Upstash Inc.",
    contact: "", // [TEMP] OVERSEAS_TRANSFERS.Upstash.contact: 개인정보 연락처 확인 전 — 지어내지 않는다
    country: "", // [TEMP] OVERSEAS_TRANSFERS.Upstash.country: 리전 확인 전
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "요청 식별자(IP 해시)",
    purpose: "요청 제한",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
  },
  {
    recipient: "Cloudflare Inc.",
    contact: "privacy@cloudflare.com",
    country: "미국",
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "접속 정보",
    purpose: "봇 차단",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
  },
] as const;
export const OVERSEAS_TRANSFERS_SOURCE = "결정 메모 1-C / PIPA §28조의8" as const;

// ── 차량 보험 — 사장님 "기존 문구 그대로" (확인시트 ★2) ───────────────────
export const INSURANCE = {
  title: "차량 보험",
  body: "전세버스의 차량보험 가입은 각 손해보험회사와 전세버스 공제조합의 보험에 가입되어 있으며 유사시 보상조건은 동일합니다. 여러분께서 이용하실 회사의 차량에 대해서는 원하시는 경우 보험 서류를 받아 보실 수 있습니다.",
  source: "옛 사이트 page.php?bo_page=intro10 / 확인시트 ★2",
} as const;

// ── 소비자 불만·분쟁 처리 (전자상거래법 §13②8호) ────────────────────────
export const DISPUTE = {
  channel: "대표전화 1566-6188 또는 이메일로 접수",
  handling: "접수 후 영업일 기준 3일 이내 처리 결과를 안내드립니다.", // [TEMP] DISPUTE.handling: 처리 기한 사장님 확인 전
  mediation: "분쟁이 해결되지 않을 경우 한국소비자원(1372) 또는 전자거래분쟁조정위원회에 조정을 신청하실 수 있습니다.",
  source: "결정 메모 1-C",
} as const;

// ── 아동 ─────────────────────────────────────────────────────────────────
export const MINORS = {
  line: "만 14세 미만 아동은 법정대리인의 동의 없이 견적을 신청하실 수 없습니다.",
  source: "PIPA §22조의2 / 전자상거래법 §13③",
} as const;

// ── 법정 링크 ─────────────────────────────────────────────────────────────
export const LEGAL_LINKS = {
  privacy: "/privacy",
  terms: "/terms",
  guide: "/guide",
  ftcBizInfo: "https://www.ftc.go.kr/bizCommPop.do?wrkr_no=1308677328",
  source: "시행규칙 §7②",
} as const;

// ── 법정 페이지 메타 (P1-6) ───────────────────────────────────────────────
export const LEGAL_PAGES = {
  privacy: { title: "개인정보 처리방침", effectiveDate: "2026-09-11" }, // [TEMP] LEGAL_PAGES.privacy.effectiveDate: 오픈일로 교체
  terms: { title: "이용약관", effectiveDate: "2026-09-11" }, // [TEMP] LEGAL_PAGES.terms.effectiveDate: 오픈일로 교체(위와 동일)
  guide: { title: "이용안내" },
  source: "플랜 P1-6",
} as const;

// ── 법정 페이지 보조 라벨 — 표 머리·연락처·조 번호 (페이지는 리터럴 대신 이것을 렌더) ──
export const LEGAL_LABELS = {
  effectiveDate: "시행일",
  home: "홈으로",
  legalNav: "법정 고지",
  articleNo: { prefix: "제", suffix: "조" },
  processor: { name: "수탁자", task: "위탁 업무", location: "처리 국가" },
  overseas: {
    recipient: "이전받는 자",
    contact: "연락처",
    country: "이전되는 국가",
    timingMethod: "이전 일시·방법",
    items: "이전 항목",
    purpose: "이용 목적",
    retention: "보유·이용 기간",
    legalBasis: "이전의 근거",
  },
  cancellation: { when: "취소 시점", label: "환불" },
  officer: { name: "성명", phone: "연락처" },
  contact: { tel: "대표전화", mobile: "휴대전화", fax: "팩스", email: "이메일", address: "주소" },
  // 푸터 사업자 정보 줄의 라벨 (P2-3). 공개 셸은 한글 리터럴을 쓰지 않고 여기서만 가져간다.
  // 관계사 배지 라벨은 RELATED_COMPANY.role 이 이미 갖고 있으므로 중복해서 두지 않는다.
  footer: {
    companyInfo: "사업자 정보",
    operator: "운영사",
    representative: "대표",
    bizRegNo: "사업자등록번호",
    mailOrder: "통신판매업신고",
    headOffice: "본사",
    branch: "지사",
    bankAccount: "계좌",
    privacyOfficer: "개인정보 보호책임자",
    hosting: "호스팅",
    ftcBizInfo: "사업자정보 확인",
  },
  source: "플랜 P1-6",
} as const;

// ── 이용약관 — 전자상거래법 §10①5호 필수 표시 (연결화면 허용, 생략 불가) ──
export const TERMS = {
  articles: [
    {
      no: 1,
      title: "목적",
      body: "이 약관은 합자회사 베스트투어(이하 \"회사\")가 운영하는 인터넷 사이트(bestour.co.kr)에서 제공하는 전세버스 견적 상담 및 예약 접수 서비스(이하 \"서비스\")의 이용 조건과 절차, 회사와 이용자의 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.",
    },
    {
      no: 2,
      title: "정의",
      body: "\"이용자\"란 사이트에 접속하여 이 약관에 따라 서비스를 이용하는 자를 말합니다. \"견적 신청\"이란 이용자가 운행 조건을 제출하여 회사에 견적 상담을 요청하는 행위를 말합니다. \"예약 확정\"이란 회사가 이용자와 상담을 거쳐 운행 조건과 대금에 합의하고 그 사실을 이용자에게 통지한 때를 말합니다.",
    },
    {
      no: 3,
      title: "약관의 효력 및 변경",
      body: "이 약관은 사이트에 게시함으로써 효력이 발생합니다. 회사는 관련 법령을 위배하지 않는 범위에서 이 약관을 변경할 수 있으며, 변경 시 적용일자 및 변경 사유를 명시하여 적용일자 7일 전부터 사이트에 공지합니다. 이용자에게 불리한 변경은 30일 전부터 공지합니다.",
    },
    {
      no: 4,
      title: "서비스의 내용",
      body: "회사는 이용자의 견적 신청을 접수하고, 상담을 거쳐 전세버스 운행 조건과 대금을 안내하며, 예약 확정 후 운행을 제공하거나 등록된 전세버스 운송사업자를 통하여 제공합니다. 사이트에 표시된 가격은 대표 노선의 예시이며 실제 견적은 상담 후 확정됩니다.",
    },
    {
      no: 5,
      title: "계약의 성립",
      body: "견적 신청은 계약의 청약이 아닌 상담 요청이며, 회사가 상담을 거쳐 예약을 확정하고 이용자에게 통지한 때에 계약이 성립합니다. 회사는 예약 확정 전까지 차량 수급 등의 사유로 접수를 거절할 수 있으며 이 경우 이용자에게 그 사실을 통지합니다.",
    },
    {
      no: 6,
      title: "대금 및 계약금",
      body: "사이트에서는 온라인 결제를 제공하지 않습니다. 예약 확정 시 계약금 10만원을 지급하며, 잔금의 금액·지급 방법·지급 시기는 예약 확정 시 회사가 안내합니다.", // [TEMP] TERMS.articles.six.body: 잔금 시기·지급수단 사장님 확정 후 교체 (PAYMENT.balanceTiming 과 함께)
    },
    {
      no: 7,
      title: "취소 및 환불",
      body: "예약 확정 후 이용자의 사정으로 취소하는 경우 이용안내에 게시된 취소·환불 규정에 따릅니다. 회사의 사정으로 운행이 불가능한 경우 회사는 지급받은 계약금 전액을 환불하며, 이용자에게 발생한 통상의 손해를 배상합니다.",
    },
    {
      no: 8,
      title: "청약철회",
      body: "전세버스 운행은 특정 일시에 제공되는 용역으로서 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제2항에 따라 청약철회가 제한될 수 있으며, 그 경우 제7조의 취소·환불 규정이 적용됩니다. 회사는 이 사실을 견적 신청 화면과 예약 확정 통지에 고지합니다.",
    },
    {
      no: 9,
      title: "회사의 의무",
      body: "회사는 관련 법령과 이 약관이 정하는 바에 따라 지속적이고 안정적으로 서비스를 제공하기 위하여 노력하며, 이용자의 개인정보를 개인정보 처리방침에 따라 보호합니다.",
    },
    {
      no: 10,
      title: "이용자의 의무",
      body: "이용자는 견적 신청 시 정확한 정보를 제공하여야 하며, 타인의 정보를 도용하거나 허위 신청을 하여서는 안 됩니다. 허위 신청으로 회사에 손해가 발생한 경우 이용자는 그 손해를 배상할 책임이 있습니다.",
    },
    {
      no: 11,
      title: "책임의 제한",
      body: "회사는 천재지변, 도로 통제, 불가항력 등 회사의 귀책사유 없는 사유로 서비스를 제공할 수 없는 경우 그에 대한 책임을 지지 않습니다. 회사는 이용자의 귀책사유로 인한 서비스 이용 장애에 대하여 책임을 지지 않습니다.",
    },
    {
      no: 12,
      title: "분쟁의 해결",
      body: "회사와 이용자 간에 발생한 분쟁은 상호 협의하여 해결하며, 협의가 이루어지지 않는 경우 이용자는 한국소비자원 또는 전자거래분쟁조정위원회에 조정을 신청할 수 있습니다. 소송이 제기되는 경우 「민사소송법」에 따른 관할법원을 전속관할로 하며, 대한민국 법을 준거법으로 합니다.",
    },
  ],
  source: "전자상거래법 §10①5호·§13②5호·§17 / 플랜 P1-6 / 컨트롤러 확정 2026-09-11",
} as const;

// ── 처리방침 필수 기재 (PIPA §30① + 시행령 §31) — 절 순서와 각 절의 출처 상수 ──
//    from: 이미 원장에 있는 상수를 그대로 가리킨다(복제하지 않는다). body: 이 절에서만 쓰는 문안.
export const PRIVACY_POLICY_SECTIONS = [
  { key: "purpose", title: "개인정보의 처리 목적", from: PRIVACY_NOTICE.purpose },
  { key: "items", title: "처리하는 개인정보의 항목", from: PRIVACY_NOTICE.items },
  { key: "retention", title: "개인정보의 처리 및 보유 기간", from: PRIVACY_NOTICE.retention },
  { key: "processors", title: "개인정보 처리업무의 위탁", from: PROCESSORS },
  { key: "overseas", title: "개인정보의 국외 이전", from: OVERSEAS_TRANSFERS },
  {
    key: "rights",
    title: "정보주체의 권리·의무 및 행사 방법",
    body: "정보주체는 회사에 대하여 언제든지 개인정보 열람·정정·삭제·처리정지를 요구할 수 있습니다. 권리 행사는 개인정보 보호책임자에게 서면, 전화 또는 이메일로 하실 수 있으며 회사는 지체 없이 조치합니다.",
  },
  {
    key: "destruction",
    title: "개인정보의 파기 절차 및 방법",
    body: "회사는 보유 기간이 경과하거나 처리 목적이 달성된 개인정보를 지체 없이 파기합니다. 전자적 파일은 복구할 수 없는 방법으로 영구 삭제하며, 종이 문서는 분쇄 또는 소각합니다.",
  },
  {
    key: "safety",
    title: "개인정보의 안전성 확보 조치",
    body: "회사는 개인정보의 안전성 확보를 위하여 접근 권한 관리, 암호화 통신(HTTPS), 접속 기록 보관, 처리 시스템의 접근 통제 등의 조치를 취하고 있습니다.",
  },
  {
    key: "cookies",
    title: "자동 수집 장치의 설치·운영 및 거부",
    body: "사이트는 팝업 \"오늘 하루 보지 않기\" 등 이용 편의를 위해 브라우저 저장소(localStorage)를 사용합니다. 이는 개인을 식별하지 않으며, 브라우저 설정에서 저장소를 삭제하거나 차단할 수 있습니다.",
  },
  { key: "publicFeed", title: "접수 현황 공개 안내", from: PRIVACY_NOTICE.publicFeedNotice },
  { key: "officer", title: "개인정보 보호책임자", from: COMPANY.privacyOfficer },
  {
    key: "remedy",
    title: "권익침해 구제 방법",
    body: "정보주체는 개인정보 침해에 대한 신고나 상담을 개인정보분쟁조정위원회(1833-6972), 개인정보침해신고센터(118), 대검찰청(1301), 경찰청(182)에 문의하실 수 있습니다.",
  },
  {
    key: "changes",
    title: "처리방침의 변경",
    body: "이 처리방침은 시행일로부터 적용되며, 법령·정책 또는 서비스 변경에 따라 내용이 추가·삭제·수정될 경우 변경 사항의 시행 7일 전부터 사이트에 공지합니다.",
  },
] as const;
export const PRIVACY_POLICY_SECTIONS_SOURCE = "PIPA §30① / 시행령 §31 / 결정 메모 1-C / 비평 §1-4" as const;

// ── 이용안내 (기존 메뉴 "이용안내" 계승 + 전자상거래법 §13② 거래조건 표시) ──
export const GUIDE_SECTIONS = [
  {
    key: "flow",
    title: "이용 절차",
    steps: ["견적 신청 (사이트 또는 전화)", "상담 (운행 조건·대금 안내)", "예약 확정 (계약금 10만원)", "운행 당일"],
  },
  { key: "quoteBasis", title: "견적 산정 기준", from: QUOTE_BASIS },
  { key: "payment", title: "대금 지급", from: PAYMENT },
  { key: "cancel", title: "취소·환불 규정", from: CANCELLATION },
  { key: "insurance", title: "차량 보험", from: INSURANCE },
  { key: "dispute", title: "문의 및 분쟁 처리", from: DISPUTE },
  { key: "minors", title: "만 14세 미만 이용 제한", from: MINORS },
  { key: "contact", title: "연락처", from: COMPANY, fields: ["tel", "mobile", "fax", "email", "address"] },
] as const;
export const GUIDE_SECTIONS_SOURCE = "플랜 P6-3 매핑표 / 전자상거래법 §13②" as const;
