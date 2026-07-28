// 시드 카탈로그 — MVP 배치용 가구. 치수는 cm(가로 W × 세로 D × 높이 H).
// 1차 소스는 IKEA(정형 치수 + 흰배경 스튜디오컷) — 기능명세서 §8 정직 원칙: 치수 보장은 정형 소스에만.
// lowBox: 낮은 박스형/평면 → 합성(homography) 품질 좋음 / false면 합성엔 부적합(2.5D 판때기 위험).
// dimAccuracy: '정형'(IKEA 등 보장) | '추정'(네이버·중고 등).
import { ABO } from './abo.js';
import { ABO3D } from './abo3d.js';

// 로컬 카탈로그는 ABO(실제 제품 이미지 누끼 + 정형 치수) 우선, 없으면 색상 시드로 폴백.
const SEED = [
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

// ABO 카탈로그에는 판매가가 없다 → 카테고리·크기 기반 추정가(KRW)를 채워 견적·가격필터가 동작하게.
// 면적만으로는 동일 카테고리 내 동치수 상품(예: 소파 5종 동일 w×d)이 전부 같은 값으로 수렴해
// 분산이 사라지는 문제가 있었음 → 소재/스타일 키워드 배율 + 상품별 결정적 지터를 곱해 분산을 되살림.
// 천원 단위 반올림, priceEst=true로 '추정가'임을 표시(정직 원칙 — UI가 추정임을 밝힘).
const PRICE_MODEL = { '침대': [250000, 8], '소파': [180000, 10], '책상': [90000, 6], '의자': [60000, 8], '수납': [80000, 6], '조명': [45000, 15], '러그': [30000, 1.2], '테이블': [50000, 8] };

// 소재/스타일 신호 → 가격 배율(프리미엄 소재는 웃돈, 저가 신호는 할인). 이름에 여러 개 매치되면 첫 매치만 적용.
const MATERIAL_MULT = [
  [/leather/i, 1.35],
  [/marble/i, 1.3],
  [/velvet|tufted/i, 1.2],
  [/solid (wood|pine|oak)|walnut|teak|brass/i, 1.15],
  [/rattan|wicker/i, 1.1],
  [/metal|industrial/i, 0.95],
  [/basic|budget/i, 0.85],
];
function materialMult(name) {
  const n = name || '';
  for (const [re, m] of MATERIAL_MULT) if (re.test(n)) return m;
  return 1;
}

// id/name을 시드로 한 결정적 해시(0~1) — 같은 상품은 항상 같은 지터(재렌더/새로고침에도 안정).
function hash01(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return ((h >>> 0) % 10000) / 10000;
}

function estimatePrice(it) {
  const [base, k] = PRICE_MODEL[it.cat] || [50000, 5];
  const area = ((it.w || 60) * (it.d || 60)) / 100;          // cm²/100
  const raw = base + area * k * 100;
  const jitter = 0.85 + hash01(String(it.id || it.name || '')) * 0.3; // 상품별 ±15%
  return Math.max(10000, Math.round((raw * materialMult(it.name) * jitter) / 1000) * 1000);
}
const withPrice = (list) => list.map((it) => (typeof it.price === 'number' ? it : { ...it, price: estimatePrice(it), priceEst: true }));

// 3D 피벗: 실측 GLB 카탈로그(ABO3D) 우선 → 없으면 누끼 이미지(ABO) → 색상 시드(SEED)
// (사진→3D 생성은 가구 품질이 폐급이라 폐기 — 아키스케치처럼 큐레이션 실측 카탈로그로.)
export const CATALOG = withPrice(ABO3D.length ? ABO3D : (ABO.length ? ABO : SEED));
export const CATEGORIES = [...new Set(CATALOG.map((c) => c.cat))];

// 카테고리별 표준 치수(cm) — 실제 치수가 미상인 실상품(네이버 등)의 기본값.
// 정형 소스(IKEA)만 치수를 "보장"하고, 여기 기본값은 '추정(기본)'으로 명시한다(정직 원칙).
export const CATEGORY_DEFAULTS = [
  { kw: ['침대', '베드', '매트리스'], w: 120, d: 200, h: 40, color: '#b8a58a', lowBox: true },
  { kw: ['소파'], w: 160, d: 85, h: 80, color: '#8fa3b0', lowBox: true },
  { kw: ['책상', '데스크'], w: 120, d: 60, h: 74, color: '#c9b79a', lowBox: true },
  { kw: ['의자', '체어', '스툴', '의자'], w: 50, d: 52, h: 90, color: '#b0a68c', lowBox: false },
  { kw: ['서랍', '수납', '책장', '선반', '장'], w: 80, d: 45, h: 90, color: '#d0c3a8', lowBox: true },
  { kw: ['옷장', '행거', '드레스룸'], w: 100, d: 55, h: 180, color: '#bcae95', lowBox: false },
  { kw: ['러그', '카펫', '매트'], w: 150, d: 200, h: 1, color: '#d8cdbb', lowBox: true },
  { kw: ['테이블', '식탁', '탁자'], w: 120, d: 70, h: 73, color: '#c9bfa8', lowBox: true },
  { kw: ['조명', '스탠드', '램프'], w: 35, d: 35, h: 150, color: '#cfc4ad', lowBox: false },
];
const GENERIC_DEFAULT = { w: 80, d: 60, h: 70, color: '#c3b79c', lowBox: true };

// 치수 해결: 상품에 정형/추정 치수가 있으면 그대로, 없으면 카테고리 표준으로 채운다.
// 항상 w·d > 0을 보장한다(0×0 렌더 방지).
export function resolveDims(item) {
  const ok = (v) => typeof v === 'number' && v > 0;
  if (ok(item.w) && ok(item.d)) {
    return { w: item.w, d: item.d, h: ok(item.h) ? item.h : 40, accuracy: item.dimAccuracy || '추정', color: item.color, lowBox: item.lowBox };
  }
  const name = `${item.name || ''} ${item.cat || ''}`;
  const base = CATEGORY_DEFAULTS.find((c) => c.kw.some((k) => name.includes(k))) || GENERIC_DEFAULT;
  return { w: base.w, d: base.d, h: base.h, accuracy: '추정(기본)', color: item.color || base.color, lowBox: base.lowBox };
}

// 분위기(스타일) — 제품명 키워드에서 도출. 없으면 null. 미드센추리를 모던보다 먼저(더 구체적).
const STYLE_MAP = [
  ['미드센추리', /mid-?century/i],
  ['인더스트리얼', /industrial/i],
  ['북유럽', /scandinav|nordic/i],
  ['내추럴', /rustic|farmhouse|stone\s*&\s*beam|solid pine/i],
  ['클래식', /classic|traditional|tufted/i],
  ['모던', /\bmodern\b|contemporary/i],
];
export const STYLE_OPTIONS = ['미드센추리', '모던', '북유럽', '내추럴', '인더스트리얼', '클래식'];
export function deriveStyle(item) {
  const n = `${item?.name || ''}`;
  for (const [label, re] of STYLE_MAP) if (re.test(n)) return label;
  return null;
}
// 사이즈 — 발자국 최대 변(cm)으로 소/중/대(방에 맞춰 고르기용).
export const SIZE_OPTIONS = ['소형', '중형', '대형'];
export function deriveSize(item) {
  const rd = resolveDims(item);
  const m = Math.max(rd.w, rd.d);
  return m <= 90 ? '소형' : m <= 155 ? '중형' : '대형';
}

// 치수 신뢰도 → 표시용 {short, tone, hex}. tone: ok(정형·입력) / mid(상세·AI) / warn(추정·미상)
export function accuracyMeta(a) {
  if (a === '정형') return { short: '정형', tone: 'ok', hex: '#3f6a3a' };
  if (a === '사용자입력') return { short: '입력', tone: 'ok', hex: '#3f6a3a' };
  if (a === '추정(상세)') return { short: '상세', tone: 'mid', hex: '#3a6b8a' };
  if (a === '추정(AI)') return { short: 'AI', tone: 'mid', hex: '#3a6b8a' };
  if (a === '미상') return { short: '미상', tone: 'warn', hex: '#a9691f' };
  return { short: a && a.includes('기본') ? '기본' : '추정', tone: 'warn', hex: '#a9691f' };
}

// 3D 모델 매핑 — 카탈로그 아이템은 자체 glb, 그 외(네이버·시드)는 카테고리 대표 GLB로 채워 3D 렌더.
const GLB_REP = {};
for (const it of ABO3D) if (it.glb && !GLB_REP[it.cat]) GLB_REP[it.cat] = it.glb;
const CAT_ALIAS = {
  침대: '침대', 매트리스: '침대', 베드: '침대', 프레임: '침대',
  소파: '소파',
  테이블: '테이블', 식탁: '테이블', 탁자: '테이블', 협탁: '테이블',
  책상: '책상', 데스크: '책상',
  의자: '의자', 체어: '의자', 스툴: '의자', 벤치: '의자',
  수납: '수납', 수납장: '수납', 서랍: '수납', 서랍장: '수납', 책장: '수납', 선반: '수납', 옷장: '수납', 장롱: '수납', 행거: '수납', 드레서: '수납', 캐비닛: '수납',
  조명: '조명', 스탠드: '조명', 램프: '조명', 전등: '조명',
};
// 아이템에 붙일 GLB 경로를 고른다. 자체 glb > 카테고리 정확매칭 > 이름/카테고리 키워드 매칭 > null(박스 폴백).
export function glbForItem(item) {
  if (item?.glb) return item.glb;
  const cat = item?.cat || '';
  if (GLB_REP[cat]) return GLB_REP[cat];
  if (CAT_ALIAS[cat] && GLB_REP[CAT_ALIAS[cat]]) return GLB_REP[CAT_ALIAS[cat]];
  const hay = `${item?.name || ''} ${cat}`;
  for (const [kw, c] of Object.entries(CAT_ALIAS)) if (hay.includes(kw) && GLB_REP[c]) return GLB_REP[c];
  return null;
}

let _seq = 0;
// cm → m footprint 아이템으로 변환(배치 엔진 입력). 치수 미상이면 카테고리 표준으로 보정.
export function toPlacedItem(cat, cx, cy, rotationDeg = 0) {
  const d = resolveDims(cat);
  const glb = glbForItem(cat);
  // ABO GLB 정면 보정각. Blender 지오메트리 검출(chair_orient.py, 비대칭 82종 전수)로 확정:
  // 모든 비대칭 ABO 모델은 Blender 프레임 정면 −y로 저작 → 렌더/3D의 깊이축 뒤집기(y_B=D−cy)를
  // 거치면 2D 규칙(rot0=앞면+y)과 정확히 일치 = 보정 불필요(orient 0). 과거 180은 뒤집힘 오진.
  // (실증: 암체어 raw rot0 렌더가 카메라 쪽을 정면으로 봄. 대칭 가구는 어느 값이든 무해.)
  const orient = cat.orient != null ? cat.orient : 0;
  return {
    id: `${cat.id ?? cat.name ?? 'item'}-${++_seq}`,
    catId: cat.id,
    cat: cat.cat,          // 카테고리 문자열 보존 — 러그/의자·책상 겹침정책·역할판정·유사추천이 .cat으로 판정
    name: cat.name,
    wM: d.w / 100,
    dM: d.d / 100,
    hM: d.h / 100,
    lowBox: d.lowBox !== undefined ? d.lowBox : true,
    color: d.color || '#c3b79c',
    dimAccuracy: d.accuracy,
    source: cat.source,
    price: cat.price,
    priceEst: cat.priceEst,   // 추정가 여부(견적 표시에 '추정' 명시)
    buyUrl: cat.buyUrl,
    image: cat.image,
    glb,
    orient,
    cx,
    cy,
    rotationDeg,
  };
}
