// 원룸 자동 배치 — 규칙 기반, 겹침 0 보장, 다중 후보 생성.
// 원칙: 배치할 때마다 겹침/방밖을 검증해 "유효한 자리"에만 놓는다. 한 가구라도 못 놓으면 그 배치는 폐기.
// 가중치: 대부분의 가구는 벽에 밀착(벽 자리를 먼저 시도). 러그는 바닥 레이어(중앙, 충돌 제외).
// 랜덤 변주로 서로 다른 유효 배치 여러 개를 만들고, 벽밀착률 높은 순 + 다양성으로 상위 N개를 고른다.
import { effectiveFootprint, aabbOverlap, itemAABB, validateLayout, circulationScore, openingBlocksAABB, pairOverlapOK, frontClearance, frontViolations, FRONT_NEED, cutAABBs, wallSegments, segmentHitsAABB, EPS } from './geometry.js';

// LLM 후보(cm 좌표) → 우리 아이템으로 매핑 + 겹침/방밖 재검증(안전망). 유효한 배치만 반환.
// LLM 산술은 틀릴 수 있으므로 여기서 반드시 재검사해 겹치는 후보를 폐기한다.
export function validateCandidates(candidates, room, items, openings = []) {
  const W = room.widthM, D = room.depthM, EDGE = 0.09;
  const out = [];
  for (const c of candidates || []) {
    const list = c.items || [];
    const mapped = items.map((it) => {
      const ci = list.find((x) => x && x.id === it.id);
      if (!ci) return { ...it, _place: true };    // LLM이 빠뜨린 가구 → repair가 새로 배치
      const rot = [0, 90, 180, 270].includes(ci.rotation) ? ci.rotation : 0;
      return { ...it, cx: (Number(ci.cx) || 0) / 100, cy: (Number(ci.cy) || 0) / 100, rotationDeg: rot };
    });
    // LLM 산술 오류(겹침/방밖/개구부 침범)·누락을 '기각' 대신 '보정' — 위반/누락 가구만 유효 자리로 배치.
    const rep = repairCandidate(mapped, room, openings);   // room.cutouts는 repair 내부에서 장애물로 시딩
    if (!rep) continue;                           // 보정 불가(자리 없음) → 폐기 → 로컬 폴백이 채움
    // 품질 게이트: 보정 후에도 수납/책상/소파 앞면이 막힌 배치는 '유효하지만 나쁜' 배치 → 폐기.
    // (LLM 후보를 무조건 살리다 배치 품질이 떨어지는 문제 방지 — 미달이면 로컬 엔진이 채움)
    if (frontViolations(rep.items, W, D, room.cutouts) > 0) continue;
    const nonRug = rep.items.filter((it) => it.cat !== '러그');
    const segsW = wallSegments(room);
    const touch = nonRug.filter((it) => touchesSeg(itemAABB(it), segsW, EDGE)).length;
    out.push({
      items: rep.items,
      wallRatio: nonRug.length ? touch / nonRug.length : 1,
      strategy: c.strategy, rationale: c.rationale, repaired: rep.moved,
    });
  }
  return out;
}

// LLM 후보 보정 — 유효한 가구는 그 자리 유지, 겹침/방밖/개구부 침범 가구만 가까운 유효 자리로 스냅.
// 앵커(침대·소파·책상·수납) 먼저 처리해 큰 가구의 Gemini 판단을 최대한 살린다. 전부 못 놓으면 null(폐기).
function repairCandidate(items, room, openings = []) {
  const W = room.widthM, D = room.depthM;
  const roles = new Map(items.map((it) => [it.id, roleOf(it)]));
  const res = items.map((it) => ({ ...it }));       // rug 포함 전부 복사(rug는 바닥 레이어라 그대로 유지)
  const solids = res.filter((it) => roles.get(it.id) !== 'rug');
  const order = [...solids.filter((it) => ANCHOR.has(roles.get(it.id))), ...solids.filter((it) => !ANCHOR.has(roles.get(it.id)))];
  // 컷아웃(비직사각형 방의 벽체)을 '고정 가구'로 시딩 — 유지/재배치 검사가 자동으로 회피.
  const placed = cutAABBs(room.cutouts).map((box) => ({ box, it: { cat: '벽체' } }));
  const segs = wallSegments(room);   // Phase2: 컷아웃 안쪽 면 포함 실제 벽면
  const overlapsOther = (b, it) => placed.some((p) => aabbOverlap(b, p.box) && !pairOverlapOK(it, p.it));
  let moved = 0;
  const frontOK = (it) => {
    const need = FRONT_NEED[it.cat];
    if (!need) return true;
    const obs = placed.filter((p) => !pairOverlapOK(it, p.it)).map((p) => p.box);
    return frontClearance(it, obs, W, D) >= need;
  };
  for (const it of order) {
    const isBed = roles.get(it.id) === 'bed';
    if (!it._place) {                                // Gemini 위치가 있으면 유효한지 확인 후 유지
      const b = boxAt(it, it.cx, it.cy, it.rotationDeg);
      if (inRoom(b, W, D) && !overlapsOther(b, it) && frontOK(it)
          && !openings.some((o) => openingBlocksAABB(b, o, W, D, it.hM))
          && (!isBed || itemInCorner({ ...it }, W, D))) { placed.push({ box: b, it }); continue; }   // 침대는 코너일 때만 유지(사용자 지시)
    }
    const ox = it._place ? (it.cx || W / 2) : it.cx, oy = it._place ? (it.cy || D / 2) : it.cy;
    // 침대: 가장 가까운 코너로 스냅(사용자 지시). 실패 시 일반 보정으로 폴백.
    if (isBed) {
      const corners = cornerSlots(it, segs)
        .sort((c1, c2) => Math.hypot(c1.cx - ox, c1.cy - oy) - Math.hypot(c2.cx - ox, c2.cy - oy));
      let snapped = false;
      for (const c of corners) {
        const b = boxAt(it, c.cx, c.cy, c.rot);
        if (inRoom(b, W, D) && !overlapsOther(b, it)
            && !openings.some((o) => openingBlocksAABB(b, o, W, D, it.hM))) {
          it.cx = c.cx; it.cy = c.cy; it.rotationDeg = c.rot; delete it._place;
          placed.push({ box: b, it }); moved++; snapped = true; break;
        }
      }
      if (snapped) continue;
    }
    // 누락(_place)이거나 위치가 무효 → 원위치(누락은 방 중앙) 근처 유효 자리로 스냅.
    const p = placeItemNear(it, ox, oy, placed, W, D, openings, segs);
    if (!p) return null;                             // 배치 실패 → 후보 폐기(로컬 폴백으로)
    it.cx = p.cx; it.cy = p.cy; it.rotationDeg = p.rot; delete it._place; placed.push({ box: p.box, it }); moved++;
  }
  res.forEach((it) => delete it._place);           // 내부 플래그 정리(러그 등 미처리분 포함)
  return { items: res, moved };
}
// 원위치(ox,oy)에 가장 가까운 유효 자리(벽 우선 → 내부). placed=[{box,it}]. 없으면 null.
// FRONT_NEED 가구는 앞면 여유가 확보되는 자리만(구도 짝꿍은 장애물로 안 침).
function placeItemNear(it, ox, oy, placed, W, D, openings, segs) {
  const need = FRONT_NEED[it.cat] || 0;
  const free = (b, c) => inRoom(b, W, D)
    && !placed.some((p) => aabbOverlap(b, p.box) && !pairOverlapOK(it, p.it))
    && !openings.some((o) => openingBlocksAABB(b, o, W, D, it.hM))
    && (!need || frontClearance({ ...it, cx: c.cx, cy: c.cy, rotationDeg: c.rot },
      placed.filter((p) => !pairOverlapOK(it, p.it)).map((p) => p.box), W, D) >= need);
  const cands = [...wallCandidates(it, segs), ...interiorCandidates(it, W, D)]
    .sort((a, b) => Math.hypot(a.cx - ox, a.cy - oy) - Math.hypot(b.cx - ox, b.cy - oy));
  for (const c of cands) {
    const b = boxAt(it, c.cx, c.cy, c.rot);
    if (free(b, c)) return { ...c, box: b };
  }
  return null;
}

const MARGIN = 0.05;   // 벽에서 띄우는 여유(m)
const STEP = 0.1;      // 벽 슬롯 탐색 간격(m)
const rnd = () => Math.random();
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function roleOf(it) {
  const n = `${it.name || ''} ${it.cat || ''}`;
  if (it.cat === '러그' || /러그|카펫/.test(n)) return 'rug';
  if (it.cat === '침대' || /침대|매트리스|베드/.test(n)) return 'bed';
  if (it.cat === '소파' || /소파/.test(n)) return 'sofa';
  if (it.cat === '책상' || /책상|데스크/.test(n)) return 'desk';
  if (it.cat === '수납' || /수납|서랍|책장|선반|옷장|장롱|드레서|캐비닛/.test(n)) return 'storage';
  if (it.cat === '조명' || /조명|스탠드|램프/.test(n)) return 'lamp';
  if (it.cat === '의자' || /의자|체어|스툴|오토만/.test(n)) return 'chair';
  if (it.wM < 0.6 && it.dM < 0.6) return 'side';
  return 'table';
}
const ANCHOR = new Set(['bed', 'sofa', 'desk', 'storage']);

// 벽에 등 붙이고 앞면이 방 안쪽을 보게 하는 회전(§좌표 규칙). rot0=앞면+y, 90=−x, 180=−y, 270=+x.
const FACE_ROT = { top: 0, bottom: 180, left: 270, right: 90 };
const OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const FRONT_VEC = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] };
// TV장 식별(카탈로그에 TV 카테고리 없음 → 이름/카테고리 키워드로).
function isTV(it) {
  const n = `${it.name || ''} ${it.cat || ''}`.toLowerCase();
  return it.cat === 'TV/콘솔' || /\btv\b|티비|미디어|media|콘솔|console/.test(n);
}

function boxAt(it, cx, cy, rot) {
  const { w, d } = effectiveFootprint(it.wM, it.dM, rot);
  return { left: cx - w / 2, right: cx + w / 2, top: cy - d / 2, bottom: cy + d / 2, w, d };
}
const inRoom = (b, W, D) => b.left >= -EPS && b.top >= -EPS && b.right <= W + EPS && b.bottom <= D + EPS;

// 세그먼트 하나 위의 밀착 슬롯들(앞면 방 안쪽). Phase2: 컷아웃 안쪽 면도 벽으로 쓴다.
function segSlots(it, seg) {
  const rot = FACE_ROT[seg.kind];
  const { w, d } = effectiveFootprint(it.wM, it.dM, rot);
  const horiz = seg.kind === 'top' || seg.kind === 'bottom';
  const along = horiz ? w : d;                       // 벽 따라 놓이는 길이
  const lo = seg.a + along / 2 + MARGIN, hi = seg.b - along / 2 - MARGIN;
  if (hi < lo - EPS) return [];
  const fixed = seg.kind === 'top' ? seg.coord + d / 2 + MARGIN
    : seg.kind === 'bottom' ? seg.coord - d / 2 - MARGIN
    : seg.kind === 'left' ? seg.coord + w / 2 + MARGIN
    : seg.coord - w / 2 - MARGIN;
  const out = [];
  for (let t = lo; t <= hi + 1e-9; t += STEP) out.push(horiz ? { cx: t, cy: fixed, rot } : { cx: fixed, cy: t, rot });
  return out;
}
// 코너 슬롯 — 각 바운딩 세그먼트의 양 끝(=두 벽이 만나는 꼭짓점 자리).
// 침대는 코너 강제(R0), 책상·테이블은 코너 선호(soft) — 사용자 지시.
function cornerSlots(bed, segs) {
  const out = [];
  for (const sg of segs.filter((x) => x.src === 'bound')) {
    const rot = FACE_ROT[sg.kind];
    const { w, d } = effectiveFootprint(bed.wM, bed.dM, rot);
    const horiz = sg.kind === 'top' || sg.kind === 'bottom';
    const along = horiz ? w : d;
    const lo = sg.a + along / 2 + MARGIN, hi = sg.b - along / 2 - MARGIN;
    if (hi < lo - EPS) continue;
    const fixed = sg.kind === 'top' ? sg.coord + d / 2 + MARGIN
      : sg.kind === 'bottom' ? sg.coord - d / 2 - MARGIN
      : sg.kind === 'left' ? sg.coord + w / 2 + MARGIN
      : sg.coord - w / 2 - MARGIN;
    for (const t of lo + 1e-9 < hi ? [lo, hi] : [lo]) {
      out.push(horiz ? { cx: t, cy: fixed, rot, wall: sg.kind } : { cx: fixed, cy: t, rot, wall: sg.kind });
    }
  }
  return out;
}
// 가구가 코너에 밀착했는가 — 서로 수직인 바운딩 벽 2면에 동시 근접(tol).
function itemInCorner(bed, W, D, tol = 0.14) {
  const b = itemAABB(bed);
  const xTouch = b.left <= tol || b.right >= W - tol;
  const yTouch = b.top <= tol || b.bottom >= D - tol;
  return xTouch && yTouch;
}

// 바운딩 벽 이름으로 슬롯(경계 접촉 컷아웃이 잠식한 스팬은 세그먼트 도출에서 이미 제외됨).
function wallSlots(it, wall, segs) {
  return segs.filter((sg) => sg.src === 'bound' && sg.wall === wall).flatMap((sg) => segSlots(it, sg));
}
// 벽 밀착 후보 — 바운딩 벽 + 컷아웃 안쪽 면 전부.
function wallCandidates(it, segs) {
  return segs.flatMap((sg) => segSlots(it, sg));
}
// 박스가 어떤 벽 세그먼트에든 밀착해 있는가(wallRatio용).
function touchesSeg(box, segs, tol = MARGIN + 0.05) {
  return segs.some((sg) => {
    if (sg.kind === 'top' || sg.kind === 'bottom') {
      const edge = sg.kind === 'top' ? box.top : box.bottom;
      return Math.abs(edge - sg.coord) <= tol && box.right > sg.a + EPS && box.left < sg.b - EPS;
    }
    const edge = sg.kind === 'left' ? box.left : box.right;
    return Math.abs(edge - sg.coord) <= tol && box.bottom > sg.a + EPS && box.top < sg.b - EPS;
  });
}
// 내부(벽 안 됨) 후보
function interiorCandidates(it, W, D) {
  const out = [];
  for (const rot of [0, 90]) {
    const { w, d } = effectiveFootprint(it.wM, it.dM, rot);
    if (w > W - 2 * MARGIN || d > D - 2 * MARGIN) continue;
    for (let cy = d / 2 + MARGIN; cy <= D - d / 2 - MARGIN + 1e-9; cy += STEP * 2)
      for (let cx = w / 2 + MARGIN; cx <= W - w / 2 - MARGIN + 1e-9; cx += STEP * 2)
        out.push({ cx, cy, rot });
  }
  return out;
}
// 겹치지 않고 개구부(문 스윙/창)도 안 가리는 첫 자리(벽 먼저, 없으면 내부). 없으면 null.
// FRONT_NEED 가구(수납/책상/소파 등)는 앞면 여유공간까지 확보되는 자리만 허용(hard).
// relax(0~1): 좁은 방 폴백 — 여유 요구를 비율로 완화(1=전체, 0=검사 안 함).
function placeItem(it, placedBoxes, W, D, openings, segs, relax = 1) {
  const need = (FRONT_NEED[it.cat] || 0) * relax;
  const free = (b, c) => inRoom(b, W, D) && placedBoxes.every((pb) => !aabbOverlap(b, pb))
    && !openings.some((o) => openingBlocksAABB(b, o, W, D, it.hM))
    && (!need || frontClearance({ ...it, cx: c.cx, cy: c.cy, rotationDeg: c.rot }, placedBoxes, W, D) >= need);
  const wantCorner = it.cat === '책상' || it.cat === '테이블';   // 코너 선호(soft) — 사용자 지시
  const wcands = wantCorner
    ? [...shuffle(cornerSlots(it, segs)), ...shuffle(wallCandidates(it, segs))]
    : shuffle(wallCandidates(it, segs));
  for (const c of wcands) {
    const b = boxAt(it, c.cx, c.cy, c.rot);
    if (free(b, c)) return { ...c, box: b, onWall: true };
  }
  for (const c of shuffle(interiorCandidates(it, W, D))) {
    const b = boxAt(it, c.cx, c.cy, c.rot);
    if (free(b, c)) return { ...c, box: b, onWall: false };
  }
  return null;
}

// 아이템을 (cx,cy,rot)에 확정 배치(빈자리면 push하고 true).
function commit(it, cx, cy, rot, placed, W, D, openings) {
  const b = boxAt(it, cx, cy, rot);
  const free = placed.every((pb) => !aabbOverlap(b, pb)) && !openings.some((o) => openingBlocksAABB(b, o, W, D, it.hM));
  if (!inRoom(b, W, D) || !free) return false;
  it.cx = cx; it.cy = cy; it.rotationDeg = rot; placed.push(b);
  return true;
}
// 한 벽에 밀착 배치(랜덤 슬롯). 성공 시 그 벽 반환.
function placeOnWall(it, wall, placed, W, D, openings, segs) {
  for (const c of shuffle(wallSlots(it, wall, segs))) if (commit(it, c.cx, c.cy, c.rot, placed, W, D, openings)) return wall;
  return null;
}
// R1: TV장을 침대 반대편 벽에, 침대 중심축에 최대한 정렬해 마주보게.
function placeTVFacingBed(tv, bed, bedWall, placed, W, D, openings, segs, cuts) {
  const wall = OPP[bedWall];
  const horiz = wall === 'top' || wall === 'bottom';
  const target = horiz ? bed.cx : bed.cy;
  const slots = wallSlots(tv, wall, segs).sort((a, b) =>
    Math.abs((horiz ? a.cx : a.cy) - target) - Math.abs((horiz ? b.cx : b.cy) - target));
  for (const c of slots) {
    // Phase2: 침대↔TV 시선이 컷아웃 벽체에 막히면 그 자리는 '마주봄'이 아님
    if ((cuts || []).some((cb) => segmentHitsAABB(bed.cx, bed.cy, c.cx, c.cy, cb))) continue;
    if (commit(tv, c.cx, c.cy, c.rot, placed, W, D, openings)) return true;
  }
  return false;
}
// R2: 책상을 벽에, 의자를 책상 앞면 앞에 마주보게(세트). 의자까지 놓여야 성공.
function placeDeskChair(desk, chair, placed, W, D, openings, segs) {
  for (const wall of shuffle(['top', 'bottom', 'left', 'right'])) {
    const cornerFirst = shuffle(cornerSlots(desk, segs).filter((c) => c.wall === wall));
    for (const c of [...cornerFirst, ...shuffle(wallSlots(desk, wall, segs))]) {
      const deskBox = boxAt(desk, c.cx, c.cy, c.rot);
      const deskFree = placed.every((pb) => !aabbOverlap(deskBox, pb)) && !openings.some((o) => openingBlocksAABB(deskBox, o, W, D, desk.hM));
      if (!inRoom(deskBox, W, D) || !deskFree) continue;
      if (!chair) { desk.cx = c.cx; desk.cy = c.cy; desk.rotationDeg = c.rot; placed.push(deskBox); return { wall, chair: false }; }
      const crot = (c.rot + 180) % 360;                 // 의자 앞면이 책상 향함
      const f = FRONT_VEC[c.rot];                        // 책상 앞면 방향
      // 틈입 깊이는 의자 크기에 적응: 얇은 데스크체어(≤62cm)만 ~25cm 틈입, 암체어 등 깊은 의자는 3cm 간격.
      const gap = chair.dM <= 0.62 ? -0.25 : 0.03;
      const off = Math.max(0.05, desk.dM / 2 + chair.dM / 2 + gap);
      const chx = c.cx + f[0] * off, chy = c.cy + f[1] * off;
      const chairBox = boxAt(chair, chx, chy, crot);
      // 의자는 '다른' 가구·개구부와만 안 겹치면 OK — 책상과의 겹침(틈입)은 허용.
      const chairFree = placed.every((pb) => !aabbOverlap(chairBox, pb))
        && !openings.some((o) => openingBlocksAABB(chairBox, o, W, D, chair.hM));
      if (!inRoom(chairBox, W, D) || !chairFree) continue;
      desk.cx = c.cx; desk.cy = c.cy; desk.rotationDeg = c.rot; placed.push(deskBox);
      chair.cx = chx; chair.cy = chy; chair.rotationDeg = crot; placed.push(chairBox);
      return { wall, chair: true };
    }
  }
  return null;
}
// R3: 조명을 침대 헤드가 붙은 벽에 밀착, 침대 헤드 옆(좌우 중 빈 쪽).
function placeLampAtBedHead(lamp, bed, bedWall, placed, W, D, openings) {
  const rot = FACE_ROT[bedWall];
  const { w: lw, d: ld } = effectiveFootprint(lamp.wM, lamp.dM, rot);
  const bb = itemAABB(bed);
  let cands = [];
  if (bedWall === 'top' || bedWall === 'bottom') {
    const cy = bedWall === 'top' ? ld / 2 + 0.005 : D - ld / 2 - 0.005;
    cands = [{ cx: bb.right + lw / 2 + 0.03, cy, rot }, { cx: bb.left - lw / 2 - 0.03, cy, rot }];
  } else {
    const cx = bedWall === 'left' ? lw / 2 + 0.005 : W - lw / 2 - 0.005;
    cands = [{ cx, cy: bb.top - ld / 2 - 0.03, rot }, { cx, cy: bb.bottom + ld / 2 + 0.03, rot }];
  }
  for (const c of cands) if (commit(lamp, c.cx, c.cy, c.rot, placed, W, D, openings)) return true;
  return false;
}

// 한 번의 배치 시도 → 유효하면 {items, wallRatio, rel}, 한 가구라도 못 놓으면 null(폐기).
// 필수 관계 R1(TV↔침대)·R2(의자↔책상 세트)·R3(조명↔침대헤드)를 우선 배치하고, 나머지는 벽/내부에.
function attempt(room, items, openings = [], relax = 1) {
  const W = room.widthM, D = room.depthM;
  const cuts = cutAABBs(room.cutouts);   // 컷아웃 = 처음부터 놓여 있는 벽체
  const segs = wallSegments(room);       // Phase2: 실제 벽면(컷아웃 안쪽 면 포함)
  const res = items.map((it) => ({ ...it }));
  const roles = new Map(res.map((it) => [it.id, roleOf(it)]));
  // 러그: 컷아웃을 뺀 자유공간의 무게중심에(클램프) — L자 방에서 러그가 벽체에 얹히는 것 완화
  const freeA = W * D - cuts.reduce((sa, c) => sa + c.w * c.d, 0);
  const fcx = freeA > 0 ? (W * D * (W / 2) - cuts.reduce((sa, c) => sa + c.w * c.d * (c.left + c.right) / 2, 0)) / freeA : W / 2;
  const fcy = freeA > 0 ? (W * D * (D / 2) - cuts.reduce((sa, c) => sa + c.w * c.d * (c.top + c.bottom) / 2, 0)) / freeA : D / 2;
  res.filter((it) => roles.get(it.id) === 'rug').forEach((it) => {
    it.rotationDeg = 0;
    it.cx = Math.min(Math.max(fcx, it.wM / 2), W - it.wM / 2);
    it.cy = Math.min(Math.max(fcy, it.dM / 2), D - it.dM / 2);
  });
  const solids = res.filter((it) => roles.get(it.id) !== 'rug');
  const placed = [...cuts];
  const done = new Set();
  const rel = { r1: null, r2: null, r3: null };

  const bed = solids.find((it) => roles.get(it.id) === 'bed');
  const desk = solids.find((it) => roles.get(it.id) === 'desk');
  const chair = solids.find((it) => roles.get(it.id) === 'chair');
  const tv = solids.find((it) => isTV(it) && roles.get(it.id) !== 'bed');
  const lamp = solids.find((it) => roles.get(it.id) === 'lamp');

  // 1) 침대(최대 앵커) — 코너(꼭짓점) 밀착 우선(사용자 지시), 안 되면 벽면 폴백. 못 놓으면 폐기.
  let bedWall = null;
  if (bed) {
    for (const c of shuffle(cornerSlots(bed, segs))) {
      if (commit(bed, c.cx, c.cy, c.rot, placed, W, D, openings)) { bedWall = c.wall; break; }
    }
    if (!bedWall) {
      for (const wall of shuffle(['top', 'bottom', 'left', 'right'])) { if (placeOnWall(bed, wall, placed, W, D, openings, segs)) { bedWall = wall; break; } }
    }
    if (!bedWall) return null;
    done.add(bed.id);
  }
  // 2) R1: TV장 ↔ 침대 정면
  if (tv && bed && bedWall) { rel.r1 = placeTVFacingBed(tv, bed, bedWall, placed, W, D, openings, segs, cuts); if (rel.r1) done.add(tv.id); }
  // 3) R2: 책상+의자 세트
  if (desk) {
    const set = placeDeskChair(desk, chair, placed, W, D, openings, segs);
    if (!set) return null;                              // 책상(+의자) 못 놓으면 폐기
    done.add(desk.id); if (chair && set.chair) { done.add(chair.id); rel.r2 = true; }
  }
  // 4) R3: 조명 ↔ 침대 헤드 코너
  if (lamp && bed && bedWall) { rel.r3 = placeLampAtBedHead(lamp, bed, bedWall, placed, W, D, openings); if (rel.r3) done.add(lamp.id); }

  // 5) 나머지 — 앵커 먼저, 벽/내부 일반 배치
  const remaining = solids.filter((it) => !done.has(it.id));
  const anchors = shuffle(remaining.filter((it) => ANCHOR.has(roles.get(it.id))));
  const rest = shuffle(remaining.filter((it) => !ANCHOR.has(roles.get(it.id))));
  for (const it of [...anchors, ...rest]) {
    const p = placeItem(it, placed, W, D, openings, segs, relax);
    if (!p) return null;
    it.cx = p.cx; it.cy = p.cy; it.rotationDeg = p.rot; placed.push(p.box);
  }

  // 벽 밀착 비율(랭킹용) — 컷아웃 안쪽 면 밀착도 벽 밀착으로 인정(Phase2)
  const touch = solids.filter((it) => touchesSeg(itemAABB(it), segs)).length;
  return { items: res, wallRatio: solids.length ? touch / solids.length : 1, rel };
}

function sig(items) {
  return items.map((it) => `${Math.round(it.cx * 3)},${Math.round(it.cy * 3)},${it.rotationDeg}`).join('|');
}
function dist(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.hypot(a[i].cx - b[i].cx, a[i].cy - b[i].cy);
  return a.length ? s / a.length : 0;
}

// 겹침 없는 서로 다른 배치 후보 최대 count개. 없으면 [].
// openings: 문/창 배열(있으면 그 앞 여유공간을 비워둠). 없으면 기존과 동일 동작(하위호환).
export function generateLayouts(room, items, count = 3, tries = 400, openings = []) {
  if (!items.length) return [];
  const valid = [];
  const seen = new Set();
  // 앞면 여유(hard)를 지키며 시도 → 좁은 방이라 하나도 안 나오면 단계적으로 완화(1 → 0.5 → 0).
  // 완화는 '배치 불가'보다 낫다는 폴백일 뿐, 여유를 지킨 후보가 있으면 그것만 쓴다.
  for (const relax of [1, 0.5, 0]) {
    for (let t = 0; t < tries && valid.length < 120; t++) {
      const r = attempt(room, items, openings, relax);
      if (!r) continue;
      const s = sig(r.items);
      if (seen.has(s)) continue;
      seen.add(s); valid.push(r);
    }
    if (valid.length) break;
  }
  if (!valid.length) return [];
  // 종합 점수 랭킹 — 필수 관계(R1~R3) 만족을 최우선, 그다음 벽밀착·동선.
  const W = room.widthM, D = room.depthM;
  for (const v of valid) {
    const solids = v.items.filter((it) => roleOf(it) !== 'rug');
    v.circulation = circulationScore(solids, W, D, 0.1, room.cutouts).connected;
    v.fv = frontViolations(v.items, W, D, room.cutouts);                       // 앞면 여유 위반(컷아웃 벽체 포함)
    const rc = (v.rel.r1 ? 1 : 0) + (v.rel.r2 ? 1 : 0) + (v.rel.r3 ? 1 : 0);   // 만족한 관계 수
    const bedIt = v.items.find((it) => roleOf(it) === 'bed');
    const corner = bedIt ? (itemInCorner(bedIt, W, D) ? 1 : 0) : 1;             // 침대 코너 밀착(R0, hard 선호)
    const dtCorner = v.items.filter((it) => (it.cat === '책상' || it.cat === '테이블') && itemInCorner(it, W, D)).length;
    v.score = 10 * rc + 0.6 * v.wallRatio + 0.4 * v.circulation - 4 * v.fv + 2 * corner + 0.7 * dtCorner;
  }
  // 앞면 위반 0인 후보가 하나라도 있으면 위반 배치는 아예 제외(hard 정책).
  const clean = valid.filter((v) => v.fv === 0);
  const pool = clean.length ? clean : valid;
  pool.sort((a, b) => b.score - a.score);
  const picked = [pool[0]];
  for (const cand of pool) {
    if (picked.length >= count) break;
    if (picked.includes(cand)) continue;
    if (picked.every((p) => dist(p.items, cand.items) > 0.5)) picked.push(cand);
  }
  for (const cand of pool) { if (picked.length >= count) break; if (!picked.includes(cand)) picked.push(cand); }
  return picked.slice(0, count).map((p) => ({ items: p.items, wallRatio: p.wallRatio, circulation: p.circulation }));
}
