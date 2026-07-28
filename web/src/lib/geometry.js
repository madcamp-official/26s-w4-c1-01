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

// 가구 정면 단위벡터(rot0=앞면+y 규칙). 회전에 따른 앞면 방향.
const FRONT_DIR = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] };
const snap4 = (r) => (((Math.round((r || 0) / 90) * 90) % 360) + 360) % 360;
// 의자-책상(또는 테이블) 겹침이 '자연스러운 구도'인가: 의자가 책상 앞면 쪽 + 마주봄 + 중심축 정렬
// (= 의자가 책상 밑으로 들어간 형태). 이때만 겹침을 허용한다(hard 정책).
export function deskChairComposed(chair, desk) {
  const fd = FRONT_DIR[snap4(desk.rotationDeg)], fc = FRONT_DIR[snap4(chair.rotationDeg)];
  if (!(fd[0] === -fc[0] && fd[1] === -fc[1])) return false;      // 의자가 책상을 정면으로 마주봐야
  const dx = chair.cx - desk.cx, dy = chair.cy - desk.cy;
  if (dx * fd[0] + dy * fd[1] <= 0) return false;                 // 의자가 책상 '앞면 쪽'에 있어야(뒤/옆 금지)
  const perp = Math.abs(dx * fd[1] - dy * fd[0]);                 // 앞면과 수직 오프셋(정렬도)
  return perp <= Math.max(desk.wM || 0, chair.wM || 0) / 2 + 0.05; // 중심축 정렬
}
// ── 앞면 여유공간(front clearance) hard 정책 ──
// 기능적 '앞면'이 있는 가구는 그 앞이 비어 있어야 쓸 수 있다(서랍 열기·착석·수납 접근).
export const FRONT_NEED = { '수납': 0.55, '책상': 0.5, '소파': 0.5, '테이블': 0.35 };

// it 앞면의 빈 깊이(m): 앞 방향으로 벽 또는 (앞면 폭과 겹치는) 가장 가까운 장애물까지의 거리.
// obstacles: AABB 배열(러그 제외). 아이템 몸통과 이미 겹친 것(구도 틈입 의자 등)은 세지 않는다.
export function frontClearance(it, obstacles, roomWM, roomDM) {
  const f = FRONT_DIR[snap4(it.rotationDeg)];
  const b = itemAABB(it);
  let free;
  if (f[1] === 1) free = roomDM - b.bottom;
  else if (f[1] === -1) free = b.top;
  else if (f[0] === 1) free = roomWM - b.right;
  else free = b.left;
  for (const o of obstacles) {
    if (f[1] !== 0) {
      if (o.right <= b.left + EPS || o.left >= b.right - EPS) continue;   // 앞면 폭과 안 겹침
      if (f[1] === 1 && o.top >= b.bottom - EPS) free = Math.min(free, o.top - b.bottom);
      if (f[1] === -1 && o.bottom <= b.top + EPS) free = Math.min(free, b.top - o.bottom);
    } else {
      if (o.bottom <= b.top + EPS || o.top >= b.bottom - EPS) continue;
      if (f[0] === 1 && o.left >= b.right - EPS) free = Math.min(free, o.left - b.right);
      if (f[0] === -1 && o.right <= b.left + EPS) free = Math.min(free, b.left - o.right);
    }
  }
  return Math.max(0, free);
}

// 배치 전체에서 앞면 여유 위반 개수. 책상의 짝 의자(구도)는 책상 앞을 막은 것으로 치지 않는다.
export function frontViolations(items, roomWM, roomDM) {
  const solids = items.filter((i) => i.cat !== '러그');
  let v = 0;
  for (const it of solids) {
    const need = FRONT_NEED[it.cat];
    if (!need) continue;
    const others = solids.filter((o) => o !== it
      && !((it.cat === '책상' || it.cat === '테이블') && o.cat === '의자' && deskChairComposed(o, it)));
    if (frontClearance(it, others.map(itemAABB), roomWM, roomDM) + EPS < need) v++;
  }
  return v;
}

// 두 가구 겹침이 허용되는가: 러그(바닥 레이어) 또는 자연스러운 의자-책상 구도만.
export function pairOverlapOK(a, b) {
  if (!a || !b) return false;
  if (a.cat === '러그' || b.cat === '러그') return true;
  const chair = a.cat === '의자' ? a : (b.cat === '의자' ? b : null);
  const surf = (a.cat === '책상' || a.cat === '테이블') ? a : ((b.cat === '책상' || b.cat === '테이블') ? b : null);
  if (chair && surf && chair !== surf) return deskChairComposed(chair, surf);
  return false;
}

// 배치 전체 검증 → 각 아이템의 문제 플래그와 남은 바닥면적.
// openings: 문/창 배열(있으면 각 가구가 문 스윙/창을 가리는지 blockOpen 플래그).
export function validateLayout(items, roomWM, roomDM, openings = []) {
  const boxes = items.map(itemAABB);
  const flags = items.map(() => ({ overlap: false, out: false, blockOpen: false }));
  for (let i = 0; i < boxes.length; i++) {
    if (outOfBounds(boxes[i], roomWM, roomDM)) flags[i].out = true;
    for (const o of openings) {
      if (openingBlocksAABB(boxes[i], o, roomWM, roomDM, items[i].hM)) { flags[i].blockOpen = true; break; }
    }
    for (let j = i + 1; j < boxes.length; j++) {
      if (aabbOverlap(boxes[i], boxes[j]) && !pairOverlapOK(items[i], items[j])) {   // 의자-책상 구도 겹침은 허용
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
    ok: !anyProblem,                                  // 겹침/방밖만 '무효'. 개구부 가림은 경고(blockOpen).
    blockOpen: flags.some((f) => f.blockOpen),
  };
}

// 개구부(문/창) 앞에 비워둘 여유공간 → 가구가 침범하면 안 되는 사각존 목록.
// opening: {wall:'top'|'bottom'|'left'|'right', pos(m, 벽 따라 중심), width(m, 개구부 폭), clearance(m, 앞 여유 깊이)}.
// 좌표계: x∈[0,W], y∈[0,D]. top=y0벽, bottom=yD벽, left=x0벽, right=xW벽.
export function openingZones(openings, roomWM, roomDM) {
  const zones = [];
  for (const o of openings || []) {
    if (!o || !o.wall) continue;
    const ww = o.width ?? 0.9;
    const c = o.clearance ?? 0.6;
    const vert = o.wall === 'left' || o.wall === 'right';
    const p = o.pos ?? (vert ? roomDM / 2 : roomWM / 2);
    if (o.wall === 'bottom') zones.push({ left: p - ww / 2, right: p + ww / 2, top: roomDM - c, bottom: roomDM });
    else if (o.wall === 'top') zones.push({ left: p - ww / 2, right: p + ww / 2, top: 0, bottom: c });
    else if (o.wall === 'left') zones.push({ left: 0, right: c, top: p - ww / 2, bottom: p + ww / 2 });
    else if (o.wall === 'right') zones.push({ left: roomWM - c, right: roomWM, top: p - ww / 2, bottom: p + ww / 2 });
  }
  return zones;
}

// 문 스윙 부채꼴 기하 — 반지름 R=문폭, 힌지 코너에서 방 안쪽 90° 사분면.
// 반환: {box(사분면 바운딩 = R×R 정사각), hinge:{x,y}(힌지 코너), R}. box는 벽을 따라 [pos±폭/2], 안쪽으로 R.
export function doorSwing(o, roomWM, roomDM) {
  const w = o.width ?? 0.9, R = w;
  const a = o.pos - w / 2, b = o.pos + w / 2;   // 벽을 따라 문 양끝
  const hb = o.hinge === 'b';                    // 힌지가 b(끝)쪽인지
  let box, hinge;
  if (o.wall === 'top')         { box = { left: a, right: b, top: 0, bottom: R };          hinge = { x: hb ? b : a, y: 0 }; }
  else if (o.wall === 'bottom') { box = { left: a, right: b, top: roomDM - R, bottom: roomDM }; hinge = { x: hb ? b : a, y: roomDM }; }
  else if (o.wall === 'left')   { box = { left: 0, right: R, top: a, bottom: b };            hinge = { x: 0, y: hb ? b : a }; }
  else                          { box = { left: roomWM - R, right: roomWM, top: a, bottom: b }; hinge = { x: roomWM, y: hb ? b : a }; }
  return { box, hinge, R };
}

// AABB가 문 스윙 부채꼴(사분면)과 겹치나 — 사분면 박스∩AABB의 힌지 최근접점이 반지름 안이면 hit.
// (벽·스윙이 축정렬이라 '박스 교차 + 원 판정'만으로 정확.)
export function aabbHitsDoorSwing(aabb, o, roomWM, roomDM) {
  const { box, hinge, R } = doorSwing(o, roomWM, roomDM);
  const ix0 = Math.max(aabb.left, box.left), ix1 = Math.min(aabb.right, box.right);
  const iy0 = Math.max(aabb.top, box.top), iy1 = Math.min(aabb.bottom, box.bottom);
  if (ix0 >= ix1 - EPS || iy0 >= iy1 - EPS) return false;              // 사분면 박스와 안 겹침
  const nx = Math.max(ix0, Math.min(hinge.x, ix1));
  const ny = Math.max(iy0, Math.min(hinge.y, iy1));
  return (nx - hinge.x) ** 2 + (ny - hinge.y) ** 2 <= R * R + EPS;      // 부채꼴(원) 안
}

// 가구(AABB)가 개구부를 침범하나 — 문=스윙 부채꼴, 창문=앞 얕은 keep-clear 사각(가리면 안 됨).
// 창턱 높이(m) — 이보다 낮은 가구는 창을 안 가리므로 창 앞 배치를 허용(높은 창 아래 책상/침대 OK).
export const WINDOW_SILL_M = 1.1;
export function openingBlocksAABB(aabb, o, roomWM, roomDM, itemH) {
  if (!o || !o.wall) return false;
  if (o.kind === 'door') return aabbHitsDoorSwing(aabb, o, roomWM, roomDM);   // 문 스윙은 높이 무관 항상 회피
  // 창문: 창턱보다 높은 가구(옷장·키큰 책장 등)만 창을 가림. 낮은 가구는 창 앞 허용.
  if (itemH != null && itemH <= WINDOW_SILL_M) return false;
  const z = openingZones([{ wall: o.wall, pos: o.pos, width: o.width, clearance: o.clearance ?? 0.4 }], roomWM, roomDM)[0];
  return z ? aabbOverlap(aabb, z) : false;
}

// 동선 점수 — 바닥을 격자로 보고 '빈 칸'이 하나로 이어지는 정도(connected: 1이면 빈 공간이 통짜, 걷기 좋음).
// 가구가 바닥을 여러 섬으로 쪼개면 낮아진다. 순수 함수 → 결정론적 테스트 가능.
export function circulationScore(items, roomWM, roomDM, cell = 0.1) {
  const nx = Math.max(1, Math.round(roomWM / cell));
  const ny = Math.max(1, Math.round(roomDM / cell));
  const boxes = items.map(itemAABB);
  const occ = new Uint8Array(nx * ny);
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const x = (gx + 0.5) * cell, y = (gy + 0.5) * cell;
      for (const b of boxes) {
        if (x > b.left + EPS && x < b.right - EPS && y > b.top + EPS && y < b.bottom - EPS) { occ[gy * nx + gx] = 1; break; }
      }
    }
  }
  const seen = new Uint8Array(nx * ny);
  let freeTotal = 0, best = 0;
  for (let i = 0; i < occ.length; i++) if (!occ[i]) freeTotal++;
  const stack = [];
  for (let s = 0; s < occ.length; s++) {
    if (occ[s] || seen[s]) continue;
    let size = 0; stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop(); size++;
      const cx = c % nx, cy = (c - cx) / nx;
      for (const [ax, ay] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        if (ax < 0 || ay < 0 || ax >= nx || ay >= ny) continue;
        const ni = ay * nx + ax;
        if (occ[ni] || seen[ni]) continue;
        seen[ni] = 1; stack.push(ni);
      }
    }
    if (size > best) best = size;
  }
  return { connected: freeTotal ? best / freeTotal : 1, freeRatio: freeTotal / (nx * ny) };
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
