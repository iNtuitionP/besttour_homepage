import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

// 기본 경로 ./i18n/request.ts 를 그대로 쓴다.
const withNextIntl = createNextIntlPlugin();

/**
 * P7-1 — 옛 사이트(GnuBoard) URL → 새 라우트 영구 리다이렉트.
 *
 * 목적지 근거는 `.superpowers/sdd/2026-09-06-bestour-implementation-v4/P7-1-2-report.md` 의 표에
 * 한 행씩 적어 뒀다(인벤토리 절 번호 또는 크롤한 페이지의 breadcrumb). `tests/redirects.test.ts` 가
 * 이 배열과 그 표를 1:1 로 대조한다 — 한쪽만 고치면 빨간불이다.
 *
 * 규칙
 *   - 목적지는 **로케일 prefix 없는 경로**다. `/ko/about` 로 보내면 next-intl 미들웨어가 307 을 한 번 더 태운다.
 *   - 목적지는 `lib/legacy-menu-map.ts` 의 ready 항목(또는 홈)뿐이다. 살아 있지 않은 곳으로 보내지 않는다.
 *   - `/css/*` 는 옮기지 않는다 — 자산 404 는 정상이다. HTML 문서만 옮긴다.
 *   - 목적지를 확정하지 못한 옛 URL 은 **표에서 뺀다**. 매칭 없는 404(정상 문서)가 잘못된 리다이렉트보다 낫다.
 *
 * 상태코드: `permanent: true` 를 쓰면 Next 는 **308** 을 낸다. 여기서는 문자 그대로의 **301** 을 쓴다
 *   — 옛 URL 은 전부 GET 문서이고, 국내 유입의 큰 축인 Naver(Yeti)의 308 처리는 공개 문서로 확인되지 않는다.
 *   308 이 낫다고 판단하면 `statusCode: 301` 을 `permanent: true` 로 바꾸고 테스트 상수 한 줄을 바꾸면 된다.
 */
const LEGACY_PAGE = "/page/page.php";
const LEGACY_BOARD = "/bbs/board.php";

type LegacyRedirect = {
  /** 옛 경로 */
  source: string;
  /** 쿼리 매칭. 없으면 경로만 본다(옛 홈은 `?from=` 유무와 무관하게 홈이다). */
  query?: { key: string; value: string };
  /** 새 경로 — 로케일 prefix 없음 */
  destination: string;
};

/** 차량소개 하위 9종 + 보험 안내는 전부 `/fleet` 한 장으로 모인다. */
const FLEET_PAGES = ["intro1", "intro2", "intro3", "intro4", "intro5", "intro6", "intro7", "intro8", "intro9", "intro10"];

const LEGACY_URLS: readonly LegacyRedirect[] = [
  // 옛 홈 (`/index.php?from=` 포함 — 쿼리를 보지 않는다)
  { source: "/index.php", destination: "/" },

  // 회사소개
  { source: LEGACY_PAGE, query: { key: "bo_page", value: "greeting" }, destination: "/about" },
  { source: LEGACY_PAGE, query: { key: "bo_page", value: "map" }, destination: "/about#location" },

  // 차량소개 (전세버스 소개 · 차종 8종 · 보험내용)
  ...FLEET_PAGES.map((value) => ({
    source: LEGACY_PAGE,
    query: { key: "bo_page", value },
    destination: "/fleet",
  })),

  // 차량운임료 (옛 요금표 → 견적 산정 기준 페이지)
  { source: LEGACY_PAGE, query: { key: "bo_page", value: "intro11" }, destination: "/fares" },

  // 견적의뢰 > 이용안내 (이용 절차 + 운송약관)
  { source: LEGACY_PAGE, query: { key: "bo_page", value: "estimate" }, destination: "/guide" },

  // 게시판
  { source: LEGACY_BOARD, query: { key: "bo_table", value: "notice" }, destination: "/notices" },
  { source: LEGACY_BOARD, query: { key: "bo_table", value: "thema1" }, destination: "/gallery" },

  // 크롤하지 않은 게시판 2종 — HTML 은 없지만 인벤토리가 정체를 적어 둔 것만 옮긴다.
  //   estimate: 인벤토리 머리말 "견적 게시판(bo_table=estimate)은 개인정보 우려로 크롤링하지 않았다" — 정체는 확실하다.
  //   confirm : 인벤토리 §5 는 "예약확인으로 **추정**" 이다. 추정이지만, 틀려도 방문자는 404 가 아니라 실재하는 페이지를 만난다.
  //             (컨트롤러 결정 2026-09-13. 사장님 확인 대기 — 보고서 §미확정 Q2)
  { source: LEGACY_BOARD, query: { key: "bo_table", value: "estimate" }, destination: "/quote" },
  { source: LEGACY_BOARD, query: { key: "bo_table", value: "confirm" }, destination: "/reservation/check" },

  // 남겨 두는 것: bo_table=free(자유게시판 — 후신 없음) · story · rentcar(정체 불명). 지어낸 목적지보다 404 가 낫다.
];

const nextConfig: NextConfig = {
  images: {
    // P2-4: 갤러리·팝업 이미지는 Supabase Storage 공개 객체 URL 이다 (components/home/image-url.ts 가 만든다).
    // 원격 프로젝트(*.supabase.co)와 로컬 스택(127.0.0.1:54321) 둘 다 — 경로는 공개 버킷 객체만 허용한다.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "54321", pathname: "/storage/v1/object/public/**" },
    ],
  },
  async redirects() {
    return LEGACY_URLS.map(({ source, query, destination }) => ({
      source,
      destination,
      statusCode: 301,
      ...(query ? { has: [{ type: "query" as const, key: query.key, value: query.value }] } : {}),
    }));
  },
};

export default withNextIntl(nextConfig);
