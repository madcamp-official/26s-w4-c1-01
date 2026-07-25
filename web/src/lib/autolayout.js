// 원룸 자동 배치 — 규칙 기반, 겹침 0 보장, 다중 후보 생성.
// 원칙: 배치할 때마다 겹침/방밖을 검증해 "유효한 자리"에만 놓는다. 한 가구라도 못 놓으면 그 배치는 폐기.
// 가중치: 대부분의 가구는 벽에 밀착(벽 자리를 먼저 시도). 러그는 바닥 레이어(중앙, 충돌 제외).
// 랜덤 변주로 서로 다른 유효 배치 여러 개를 만들고, 벽밀착률 높은 순 + 다양성으로 상위 N개를 고른다.
import { effectiveFootprint, aabbOverlap, itemAABB, validateLayout } from './geometry.js';

// LLM 후보(cm 좌표) → 우리 아이템으로 매핑 + 겹침/방밖 재검증(안전망). 유효한 배치만 반환.
// LLM 산술은 틀릴 수 있으므로 여기서 반드시 재검사해 겹치는 후보를 폐기한다.
export function validateCandidates(candidates, room, items) {
  const W = room.widthM, D = room.depthM, EDGE = 0.09;
  const out = [];
  for (const c of candidates || []) {
    const list = c.items || [];
    let complete = true;
    const mapped = items.map((it) => {
      const ci = list.find((x) => x && x.id === it.id);
      if (!ci) { complete = false; return it; }
      const rot = [0, 90, 180, 270].includes(ci.rotation) ? ci.rotation : 0;
      return { ...it, cx: (Number(ci.cx) || 0) / 100, cy: (Number(ci.cy) || 0) / 100, rotationDeg: rot };
    });
    if (!complete) continue;                      // 일부 가구 누락 → 폐기
    const nonRug = mapped.filter((it) => it.cat !== '러그');
    if (!validateLayout(nonRug, W, D).ok) continue; // 겹침/방밖 → 폐기(핵심 안전망)
    const touch = nonRug.filter((it) => {
      const b = itemAABB(it);
      return b.left < EDGE || b.top < EDGE || b.right > W - EDGE || b.bottom > D - EDGE;
    }).length;
    out.push({
      items: mapped,
      wallRatio: nonRug.length ? touch / nonRug.length : 1,
      strategy: c.strategy, rationale: c.rationale,
    });
  }
  return out;
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

function boxAt(it, cx, cy, rot) {
  const { w, d } = effectiveFootprint(it.wM, it.dM, rot);
  return { left: cx - w / 2, right: cx + w / 2, top: cy - d / 2, bottom: cy + d / 2, w, d };
}

// 벽 밀착 후보 위치들 (등을 벽으로). 좌/우 벽은 90도 회전.
function wallCandidates(it, W, D) {
  const out = [];
  for (const wall of ['bottom', 'top', 'left', 'right']) {
    const rot = (wall === 'left' || wall === 'right') ? 90 : 0;
    const { w, d } = effectiveFootprint(it.wM, it.dM, rot); // w=x범위, d=y범위
    if (w > W - 2 * MARGIN || d > D - 2 * MARGIN) continue;
    if (wall === 'bottom') { const cy = D - d / 2 - MARGIN; for (let cx = w / 2 + MARGIN; cx <= W - w / 2 - MARGIN + 1e-9; cx += STEP) out.push({ cx, cy, rot }); }
    else if (wall === 'top') { const cy = d / 2 + MARGIN; for (let cx = w / 2 + MARGIN; cx <= W - w / 2 - MARGIN + 1e-9; cx += STEP) out.push({ cx, cy, rot }); }
    else if (wall === 'left') { const cx = w / 2 + MARGIN; for (let cy = d / 2 + MARGIN; cy <= D - d / 2 - MARGIN + 1e-9; cy += STEP) out.push({ cx, cy, rot }); }
    else { const cx = W - w / 2 - MARGIN; for (let cy = d / 2 + MARGIN; cy <= D - d / 2 - MARGIN + 1e-9; cy += STEP) out.push({ cx, cy, rot }); }
  }
  return out;
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
// 겹치지 않는 첫 자리(벽 먼저, 없으면 내부). 없으면 null.
function placeItem(it, placedBoxes, W, D) {
  for (const c of shuffle(wallCandidates(it, W, D))) {
    const b = boxAt(it, c.cx, c.cy, c.rot);
    if (placedBoxes.every((pb) => !aabbOverlap(b, pb))) return { ...c, box: b, onWall: true };
  }
  for (const c of shuffle(interiorCandidates(it, W, D))) {
    const b = boxAt(it, c.cx, c.cy, c.rot);
    if (placedBoxes.every((pb) => !aabbOverlap(b, pb))) return { ...c, box: b, onWall: false };
  }
  return null;
}

// 한 번의 배치 시도 → 유효하면 {items, wallRatio}, 한 가구라도 못 놓으면 null(폐기).
function attempt(room, items) {
  const W = room.widthM, D = room.depthM;
  const res = items.map((it) => ({ ...it }));
  const roles = new Map(res.map((it) => [it.id, roleOf(it)]));
  res.filter((it) => roles.get(it.id) === 'rug').forEach((it) => { it.rotationDeg = 0; it.cx = W / 2; it.cy = D / 2; });
  const solids = res.filter((it) => roles.get(it.id) !== 'rug');
  const anchors = shuffle(solids.filter((it) => ANCHOR.has(roles.get(it.id))));
  const rest = shuffle(solids.filter((it) => !ANCHOR.has(roles.get(it.id))));
  const order = [...anchors, ...rest];
  const placedBoxes = [];
  let wallCount = 0;
  for (const it of order) {
    const p = placeItem(it, placedBoxes, W, D);
    if (!p) return null;
    it.cx = p.cx; it.cy = p.cy; it.rotationDeg = p.rot;
    placedBoxes.push(p.box);
    if (p.onWall) wallCount++;
  }
  return { items: res, wallRatio: order.length ? wallCount / order.length : 1 };
}

function sig(items) {
  return items.map((it) => `${Math.round(it.cx * 3)},${Math.round(it.cy * 3)},${it.rotationDeg}`).join('|');
}
function dist(a, b) {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.hypot(a[i].cx - b[i].cx, a[i].cy - b[i].cy);
  return a.length ? s / a.length : 0;
}

// 겹침 없는 서로 다른 배치 후보 최대 count개. 없으면 [].
export function generateLayouts(room, items, count = 3, tries = 400) {
  if (!items.length) return [];
  const valid = [];
  const seen = new Set();
  for (let t = 0; t < tries && valid.length < 120; t++) {
    const r = attempt(room, items);
    if (!r) continue;
    const s = sig(r.items);
    if (seen.has(s)) continue;
    seen.add(s); valid.push(r);
  }
  if (!valid.length) return [];
  valid.sort((a, b) => b.wallRatio - a.wallRatio);
  const picked = [valid[0]];
  for (const cand of valid) {
    if (picked.length >= count) break;
    if (picked.includes(cand)) continue;
    if (picked.every((p) => dist(p.items, cand.items) > 0.5)) picked.push(cand);
  }
  for (const cand of valid) { if (picked.length >= count) break; if (!picked.includes(cand)) picked.push(cand); }
  return picked.slice(0, count).map((p) => ({ items: p.items, wallRatio: p.wallRatio }));
}
