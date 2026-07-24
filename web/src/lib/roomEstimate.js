// 방 크기 입력 — 실측(줄자로 벽 한 변) 또는 예측(평수/㎡ → 공용면적 차감 → 종횡비).
// 모든 하드 넘버는 기능명세서 §8 단일 기준을 따른다.

export const PYEONG_TO_M2 = 3.3058;

// 예측 기본값(기능명세서 §8): 욕실·주방·현관 공용면적 차감, 원룸 표준 종횡비.
export const DEFAULT_DEDUCT_M2 = 5; // 4~6㎡ 범위의 중앙값
export const DEFAULT_ASPECT = 1.4; // 1.3~1.5 범위, 긴변/짧은변

// 평수 → ㎡
export const pyeongToM2 = (p) => p * PYEONG_TO_M2;
export const m2ToPyeong = (m2) => m2 / PYEONG_TO_M2;

// 예측: 전체면적에서 공용 차감 → 종횡비로 가로·세로 산출.
// 반환 치수는 "배치 가능한 방 사각형"이며 cm 단위 반올림.
export function estimateRoom({ pyeong, m2, deductM2 = DEFAULT_DEDUCT_M2, aspect = DEFAULT_ASPECT }) {
  const total = m2 != null ? m2 : pyeong != null ? pyeongToM2(pyeong) : 0;
  const livable = Math.max(total - deductM2, 1); // 하한 방어
  // livable = W*D, aspect = W/D  →  W = sqrt(livable*aspect), D = sqrt(livable/aspect)
  const widthM = round2(Math.sqrt(livable * aspect));
  const depthM = round2(Math.sqrt(livable / aspect));
  return {
    source: 'ESTIMATE',
    areaTotalM2: round2(total),
    areaLivableM2: round2(livable),
    widthM,
    depthM,
    // 예측치는 "추정" — UI에서 정형 실측과 구분 표기(기능명세서 §8 정직 원칙)
    accuracy: 'ESTIMATE',
  };
}

// 실측 한 변 보정: 벽 한 변을 재서 넣으면 예측 면적을 그 변에 맞춰 나머지 변을 산출.
export function estimateFromOneWall({ pyeong, m2, measuredWidthM, deductM2 = DEFAULT_DEDUCT_M2 }) {
  const total = m2 != null ? m2 : pyeong != null ? pyeongToM2(pyeong) : 0;
  const livable = Math.max(total - deductM2, 1);
  const widthM = round2(measuredWidthM);
  const depthM = round2(Math.max(livable / widthM, 0.5));
  return {
    source: 'ONE_WALL',
    areaTotalM2: round2(total),
    areaLivableM2: round2(livable),
    widthM,
    depthM,
    accuracy: 'MEASURED_PARTIAL', // 한 변 실측 + 나머지 추정
  };
}

// 두 변 완전 실측.
export function roomFromMeasured({ widthM, depthM }) {
  return {
    source: 'MEASURED',
    areaLivableM2: round2(widthM * depthM),
    widthM: round2(widthM),
    depthM: round2(depthM),
    accuracy: 'MEASURED',
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
