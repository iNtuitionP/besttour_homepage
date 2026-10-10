/**
 * SVG 레이어 — 대한민국 지도 + 노선 곡선 + 핀. **라벨 없음**(UIUX 결정 대기, 브리프 §왜 라벨을 보류하는가).
 *
 * 서버 컴포넌트. 정보는 카드 리스트(RouteCards)가 전달하고, 핀·곡선은 장식(aria-hidden)이다.
 * 좌표는 geometry.ts 가 props 의 svgX/svgY 로 계산한 것만 받는다 — 이 파일에 숫자 좌표는 없다.
 */
import { MAP_VIEWBOX, type MapGeometry, type MapPin } from "./geometry";
import { KR_MAP_LAND_PATH } from "./kr-map-path";
import s from "./KrMap.module.css";

export interface MapSvgProps {
  geometry: MapGeometry;
  /** aria-labelledby 용 id 접두사. 한 페이지에 지도를 두 번 그리면 서로 다르게 준다. */
  id?: string;
  /** SVG <title> — 문구는 호출부(KrMap)가 messages home.krmap.mapTitle 에서 넣는다(P2-6 — 이 파일에 한글 리터럴 없음). */
  title: string;
  description: string;
}

/**
 * 핀 반지름 — 목업(variant-08 §대표 노선)의 halo/dot 실측값. 허브 15/7.5 · 기본 12/6.
 * 골드 핀(13/6.5 · .pinAccent)은 사장님 요청 10(2026-10-10)으로 없앴다 — KrMap 이 입구에서 강조를 꺼 톤은 언제나 brand 다.
 * data-tone 은 남겨 둔다(톤 모델의 결과를 DOM 에서 확인하는 표지 — tests/home-owner-requests.test.ts §10).
 */
function radii(pin: MapPin): { halo: number; dot: number } {
  if (pin.hub) return { halo: 15, dot: 7.5 };
  return { halo: 12, dot: 6 };
}

function Pin({ pin }: { pin: MapPin }) {
  const r = radii(pin);
  return (
    <g
      className={s.pin}
      data-pin={pin.code}
      data-tone={pin.tone}
      data-hub={pin.hub || undefined}
    >
      <circle className={s.halo} cx={pin.svgX} cy={pin.svgY} r={r.halo} />
      <circle className={s.dot} cx={pin.svgX} cy={pin.svgY} r={r.dot} />
    </g>
  );
}

export function MapSvg({ geometry, id = "krmap", title, description }: MapSvgProps) {
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  // 그리기 순서 = 겹침 순서: 노선은 데이터 순서 그대로(골드 강조 노선을 위로 올리던 정렬은 사장님 요청 10 으로 뺐다) /
  // 일반 핀 → 허브 핀(허브가 위).
  const paths = geometry.paths;
  const pins = [...geometry.pins].sort((a, b) => Number(a.hub) - Number(b.hub));

  return (
    <svg
      className={s.svg}
      viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      focusable="false"
      data-testid="krmap-svg"
    >
      <title id={titleId}>{title}</title>
      <desc id={descId}>{description}</desc>

      <path className={s.land} d={KR_MAP_LAND_PATH} data-land="" />

      <g aria-hidden="true" data-layer="routes">
        {paths.map((p) => (
          <path
            key={p.routeId}
            className={s.route}
            d={p.d}
            data-route={p.routeId}
            data-tone={p.highlight ? "accent" : "brand"}
          />
        ))}
      </g>

      <g aria-hidden="true" data-layer="pins">
        {pins.map((pin) => (
          <Pin key={pin.code} pin={pin} />
        ))}
      </g>
    </svg>
  );
}
