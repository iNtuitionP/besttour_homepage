/**
 * 공유 미리보기 이미지 `/og.png`(og:image · twitter:image) — 1200×630 PNG (P7-4 · 브리프 §12). Next 기본 next/og ImageResponse 로
 * **빌드 때 한 번** 만든다(force-static). 메타는 lib/share-meta.ts 가 두 로케일 모두 이 주소로 붙인다(파일 규약을 쓰지 않는 이유도 거기).
 *
 * 그리는 것은 **브랜드 자산뿐**이다 — 로고(public/brand/logo-bestour.png, 심볼이 이미 들어 있는 가로 로고 · 배경 투명)와 원장 색
 * (역할 토큰을 styles/semantic.css → tokens.css 로 풀어 쓴다 — 색을 여기 다시 적지 않는다). 흰 면 가운데 로고 + 아래 금색 선·보라 띠.
 * 가운데 배치라 카카오톡·페이스북이 2:1 로 잘라도 로고가 남는다.
 *
 * **글자는 그리지 않는다**: (1) 이미지 렌더러(satori)가 읽는 글꼴 형식(TTF·OTF·WOFF)의 한글 글꼴이 저장소에 없다(자체 호스팅 Pretendard 는
 * woff2 조각뿐 — P7-3 · next/og 기본 글꼴은 라틴 Noto Sans 뿐). 글꼴 없이 한글을 넣으면 네모로 깨진다. (2) 글자가 없으니 실증 불가 수치·
 * 확정 표기 밖 문구가 끼어들 틈도 없다. 공유 카드의 문장은 og:title·og:description(각 페이지 메타)이 맡는다. 확정 태그라인
 * ("공항 픽업·샌딩 (송영 전문)")을 이미지에 넣으려면 한글 글꼴 파일(TTF/OTF/WOFF 서브셋)을 들여야 한다 — 보고서 ⑦.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { OG_IMAGE_SIZE } from "@/lib/share-meta";

export const dynamic = "force-static";

/** 역할 토큰 → 실제 색. semantic.css 가 tokens.css 를 var() 로 가리키는 층을 끝까지 푼다. */
async function brandColors() {
  const root = process.cwd();
  const [tokens, semantic] = await Promise.all([
    readFile(path.join(root, "styles/tokens.css"), "utf8"),
    readFile(path.join(root, "styles/semantic.css"), "utf8"),
  ]);
  const props = new Map<string, string>();
  for (const css of [tokens, semantic]) {
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)) {
      if (!props.has(m[1])) props.set(m[1], m[2].trim()); // 첫 선언(:root) 우선 — 뒤의 미디어 쿼리 재정의는 화면 폭 전용이다
    }
  }
  const resolve = (name: string, depth = 0): string => {
    const v = props.get(name) ?? "";
    const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
    return m && depth < 12 ? resolve(m[1], depth + 1) : v;
  };
  return {
    surface: resolve("--bg-surface"),
    brand: resolve("--action-primary-bg"),
    accent: resolve("--accent-decorative"),
  };
}

export async function GET() {
  const [colors, logo] = await Promise.all([
    brandColors(),
    readFile(path.join(process.cwd(), "public/brand/logo-bestour.png")),
  ]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: colors.surface }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse(satori) 는 <img> 만 읽는다(next/image 아님) */}
          <img src={logoSrc} width={840} height={163} alt="" />
        </div>
        <div style={{ display: "flex", height: 8, background: colors.accent }} />
        <div style={{ display: "flex", height: 56, background: colors.brand }} />
      </div>
    ),
    { ...OG_IMAGE_SIZE },
  );
}
