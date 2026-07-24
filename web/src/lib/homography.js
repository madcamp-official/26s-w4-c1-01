// 합성 접합 — 배치 좌표(미터, 바닥 평면) → 빈 방 사진 픽셀 좌표.
// 기능명세서 §3-(c): 배치·스케일은 여기서 기하로 확정한다. 디퓨전은 이 결과 위에서 리라이팅만.
// 4점 대응(방 바닥 사각형 네 모서리 ↔ 사진 속 바닥 네 점)으로 homography H를 풀고,
// 가구 footprint를 바닥에 정확 투영한다. 가구 몸체는 그 위에 빌보드로 세운다(2.5D 근사).
//
// 한계(정직 원칙): homography는 바닥 평면만 정확히 워프한다. 가구 수직면은 근사이므로
// 제품컷 시점과 방 촬영각이 어긋나면 '판때기'로 보인다 → 촬영 가이드로 선제 통제(기능명세서 §8).

// 4점 대응에서 homography 계산(DLT, 8x8 선형해).
// src/dst: [[x,y],...] 길이 4. 반환: 길이 9 배열 [h11..h33].
export function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solve8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// 점 [x,y]에 H 적용 → [u,v].
export function applyH(H, [x, y]) {
  const denom = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / denom, (H[3] * x + H[4] * y + H[5]) / denom];
}

// 회전 반영 footprint 네 모서리(미터) — 순서: 좌상, 우상, 우하, 좌하 (방 좌표계, y+ = 카메라 근접).
export function footprintCorners(item) {
  const r = ((Math.round((item.rotationDeg || 0) / 90) * 90) % 360 + 360) % 360;
  const w = r % 180 === 0 ? item.wM : item.dM;
  const d = r % 180 === 0 ? item.dM : item.wM;
  const { cx, cy } = item;
  return [
    [cx - w / 2, cy - d / 2],
    [cx + w / 2, cy - d / 2],
    [cx + w / 2, cy + d / 2],
    [cx - w / 2, cy + d / 2],
  ];
}

// 바닥 footprint를 이미지로 투영(접지 그림자용 사각형).
export function projectFootprint(H, item) {
  return footprintCorners(item).map((p) => applyH(H, p));
}

// 가구 몸체 빌보드 사각형. 앞모서리(카메라 근접, y 큰 쪽)를 baseline으로 세운다.
// heightPx = 실제 높이 × baseline 로컬 수직스케일(근사). 위 방향은 스크린 수직.
export function billboardQuad(H, item) {
  const c = footprintCorners(item); // [LT, RT, RB, LB]
  const bottomL = applyH(H, c[3]); // 좌하(앞)
  const bottomR = applyH(H, c[2]); // 우하(앞)
  const r = ((Math.round((item.rotationDeg || 0) / 90) * 90) % 360 + 360) % 360;
  const frontWidthM = r % 180 === 0 ? item.wM : item.dM;
  const baselineLenPx = Math.hypot(bottomR[0] - bottomL[0], bottomR[1] - bottomL[1]);
  const vPxPerM = frontWidthM > 0 ? baselineLenPx / frontWidthM : 0;
  const heightPx = (item.hM || 0) * vPxPerM;
  return {
    bottomL,
    bottomR,
    topL: [bottomL[0], bottomL[1] - heightPx],
    topR: [bottomR[0], bottomR[1] - heightPx],
    heightPx,
    baselineLenPx,
  };
}

// --- 8x8 선형계 Gaussian elimination (부분 피벗) ---
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('degenerate correspondence (collinear points?)');
    [M[col], M[piv]] = [M[piv], M[col]];
    const pivVal = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}
