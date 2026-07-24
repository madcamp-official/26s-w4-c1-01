// 축척 2D 배치의 순수 기하 — 배치·스케일·맞음판정은 여기서 결정론적으로 확정한다.
// (기능명세서 §8: 배치는 기하가 결정, 디퓨전이 결정하지 않음)
// 회전은 0/90/180/270도로만 스냅하므로 모든 footprint가 축정렬(axis-aligned)로 유지되어
// 겹침·방밖이탈을 AABB(사각형 4좌표 비교)만으로 판정한다 — 임의각도 SAT를 회피한다.

export const EPS = 1e-6;

// 미터 ↔ 픽셀. px_per_meter 단일 스케일 상수(기능명세서 §8 하드 넘버).
export const mToPx = (m, pxPerMeter) => m * pxPerMeter;
export const pxToM = (px, pxPerMeter) => px / pxPerMeter;

// 90도 스냅. 임의 각도를 가장 가까운 0/90/180/270으로.
export function snapRotation(deg) {
  const n = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return n;
}

// 회전을 반영한 footprint(가로/세로) — 90/270도면 w/d가 스왑된다.
export function effectiveFootprint(wM, dM, rotationDeg) {
  const r = snapRotation(rotationDeg);
  return r % 180 === 0 ? { w: wM, d: dM } : { w: dM, d: wM };
}

// 중심(cx,cy)·footprint(wM,dM)·회전으로 AABB 경계를 만든다. 좌표계: 미터, 방 좌상단 원점.
export function itemAABB(item) {
  const { w, d } = effectiveFootprint(item.wM, item.dM, item.rotationDeg || 0);
  return {
    left: item.cx - w / 2,
    right: item.cx + w / 2,
    top: item.cy - d / 2,
    bottom: item.cy + d / 2,
    w,
    d,
  };
}

// 두 AABB가 겹치는가(맞닿음은 겹침 아님).
export function aabbOverlap(a, b) {
  return !(a.right <= b.left + EPS || a.left >= b.right - EPS || a.bottom <= b.top + EPS || a.top >= b.bottom - EPS);
}

// 아이템이 방(0..roomW, 0..roomD)을 벗어나는가.
export function outOfBounds(aabb, roomWM, roomDM) {
  return aabb.left < -EPS || aabb.top < -EPS || aabb.right > roomWM + EPS || aabb.bottom > roomDM + EPS;
}

// 배치 전체 검증 → 각 아이템의 문제 플래그와 남은 바닥면적.
export function validateLayout(items, roomWM, roomDM) {
  const boxes = items.map(itemAABB);
  const flags = items.map(() => ({ overlap: false, out: false }));
  for (let i = 0; i < boxes.length; i++) {
    if (outOfBounds(boxes[i], roomWM, roomDM)) flags[i].out = true;
    for (let j = i + 1; j < boxes.length; j++) {
      if (aabbOverlap(boxes[i], boxes[j])) {
        flags[i].overlap = true;
        flags[j].overlap = true;
      }
    }
  }
  const roomArea = roomWM * roomDM;
  const usedArea = boxes.reduce((s, b) => s + b.w * b.d, 0);
  const anyProblem = flags.some((f) => f.overlap || f.out);
  return {
    flags,
    roomArea,
    usedArea,
    freeArea: Math.max(0, roomArea - usedArea),
    freeRatio: roomArea > 0 ? Math.max(0, 1 - usedArea / roomArea) : 0,
    ok: !anyProblem,
  };
}

// 겹치지 않는 초기 배치 지점 찾기(간단 그리드 탐색) — "다중 배치 자동 정리"의 씨앗.
export function findFreeSpot(newItem, placed, roomWM, roomDM, step = 0.1) {
  const { w, d } = effectiveFootprint(newItem.wM, newItem.dM, newItem.rotationDeg || 0);
  const boxes = placed.map(itemAABB);
  for (let cy = d / 2; cy <= roomDM - d / 2 + EPS; cy += step) {
    for (let cx = w / 2; cx <= roomWM - w / 2 + EPS; cx += step) {
      const cand = { left: cx - w / 2, right: cx + w / 2, top: cy - d / 2, bottom: cy + d / 2 };
      if (!boxes.some((b) => aabbOverlap(cand, b))) return { cx, cy };
    }
  }
  return null; // 자리 없음
}
