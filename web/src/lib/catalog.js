// 시드 카탈로그 — MVP 배치용 가구. 치수는 cm(가로 W × 세로 D × 높이 H).
// 1차 소스는 IKEA(정형 치수 + 흰배경 스튜디오컷) — 기능명세서 §8 정직 원칙: 치수 보장은 정형 소스에만.
// lowBox: 낮은 박스형/평면 → 합성(homography) 품질 좋음 / false면 합성엔 부적합(2.5D 판때기 위험).
// dimAccuracy: '정형'(IKEA 등 보장) | '추정'(네이버·중고 등).

export const CATALOG = [
  // --- 침대 (낮은 박스형: 합성 우수) ---
  { id: 'bed-ss', name: '슈퍼싱글 침대프레임', cat: '침대', w: 123, d: 208, h: 40, lowBox: true, color: '#b8a58a', source: 'IKEA', dimAccuracy: '정형' },
  { id: 'bed-s', name: '싱글 침대프레임', cat: '침대', w: 103, d: 208, h: 40, lowBox: true, color: '#c2b199', source: 'IKEA', dimAccuracy: '정형' },
  // --- 소파 ---
  { id: 'sofa-2', name: '2인 패브릭 소파', cat: '소파', w: 140, d: 88, h: 84, lowBox: true, color: '#8fa3b0', source: 'IKEA', dimAccuracy: '정형' },
  { id: 'sofa-3', name: '3인 패브릭 소파', cat: '소파', w: 182, d: 88, h: 84, lowBox: true, color: '#7d94a3', source: 'IKEA', dimAccuracy: '정형' },
  // --- 수납 (낮은 박스형) ---
  { id: 'drawer-3', name: '3단 서랍장', cat: '수납', w: 80, d: 45, h: 91, lowBox: true, color: '#d0c3a8', source: 'IKEA', dimAccuracy: '정형' },
  { id: 'tvstand', name: 'TV 수납장', cat: '수납', w: 120, d: 40, h: 45, lowBox: true, color: '#a99a83', source: 'IKEA', dimAccuracy: '정형' },
  // --- 책상 ---
  { id: 'desk-120', name: '책상 1200', cat: '책상', w: 120, d: 60, h: 74, lowBox: true, color: '#c9b79a', source: 'IKEA', dimAccuracy: '정형' },
  // --- 러그 (평면: 합성 사실상 완벽) ---
  { id: 'rug-l', name: '러그 170x240', cat: '러그', w: 170, d: 240, h: 1, lowBox: true, color: '#d8cdbb', source: 'IKEA', dimAccuracy: '정형' },
  { id: 'rug-s', name: '러그 120x180', cat: '러그', w: 120, d: 180, h: 1, lowBox: true, color: '#e0d6c6', source: 'IKEA', dimAccuracy: '정형' },
  // --- 키 큰/얇은 품목 (합성 부적합: lowBox=false, 배치 검증엔 쓰되 합성은 경고) ---
  { id: 'wardrobe', name: '옷장 행거', cat: '수납', w: 100, d: 55, h: 180, lowBox: false, color: '#bcae95', source: 'IKEA', dimAccuracy: '정형' },
  { id: 'lamp-floor', name: '플로어 스탠드', cat: '조명', w: 30, d: 30, h: 150, lowBox: false, color: '#cfc4ad', source: 'IKEA', dimAccuracy: '정형' },
];

export const CATEGORIES = [...new Set(CATALOG.map((c) => c.cat))];

// cm → m footprint 아이템으로 변환(배치 엔진 입력).
export function toPlacedItem(cat, cx, cy, rotationDeg = 0) {
  return {
    id: `${cat.id}-${Math.round(cx * 1000)}-${Math.round(cy * 1000)}`,
    catId: cat.id,
    name: cat.name,
    wM: cat.w / 100,
    dM: cat.d / 100,
    hM: cat.h / 100,
    lowBox: cat.lowBox,
    color: cat.color,
    dimAccuracy: cat.dimAccuracy,
    source: cat.source,
    cx,
    cy,
    rotationDeg,
  };
}
