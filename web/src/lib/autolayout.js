// 원룸 자동 배치 — 규칙 기반(결정론적, 클라이언트). 배치·판정은 기하가 결정(디퓨전 아님).
// 전략: 러그는 중앙(바닥), 큰 앵커(침대·소파·수납·책상)는 벽을 따라 패킹(등을 벽으로),
// 커피테이블은 소파 앞·의자는 책상 앞·협탁은 벽, 조명은 코너. 마지막에 겹침/방밖 검증→재배치.
import { itemAABB, aabbOverlap, outOfBounds, findFreeSpot } from './geometry.js';

const MARGIN = 0.06; // 벽에서 띄우는 여유(m)
const GAP = 0.14;    // 아이템 사이 간격(m)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 아이템 → 역할. cat 우선, 이름 키워드 보조.
function roleOf(it) {
  const n = `${it.name || ''} ${it.cat || ''}`;
  if (it.cat === '러그' || /러그|카펫/.test(n)) return 'rug';
  if (it.cat === '침대' || /침대|매트리스|베드/.test(n)) return 'bed';
  if (it.cat === '소파' || /소파/.test(n)) return 'sofa';
  if (it.cat === '책상' || /책상|데스크/.test(n)) return 'desk';
  if (it.cat === '수납' || /수납|서랍|책장|선반|옷장|장롱|드레서|캐비닛/.test(n)) return 'storage';
  if (it.cat === '조명' || /조명|스탠드|램프/.test(n)) return 'lamp';
  if (it.cat === '의자' || /의자|체어|스툴|오토만/.test(n)) return 'chair';
  // 테이블/협탁: 작으면 side(협탁), 크면 table(커피/식탁)
  if (it.wM < 0.6 && it.dM < 0.6) return 'side';
  return 'table';
}

const NORMAL = { bottom: [0, -1], top: [0, 1], left: [1, 0], right: [-1, 0] };

export function autoLayout(room, items) {
  const W = room.widthM, D = room.depthM;
  const out = items.map((it) => ({ ...it }));
  const role = new Map(out.map((it) => [it.id, roleOf(it)]));

  // 1) 러그: 중앙(충돌 제외 — 바닥 레이어)
  out.filter((it) => role.get(it.id) === 'rug').forEach((it) => {
    it.rotationDeg = 0; it.cx = W / 2; it.cy = D / 2;
  });

  // 2) 벽 커서(각 벽을 따라 순차 패킹)
  const walls = {
    bottom: { len: W, cur: MARGIN }, right: { len: D, cur: MARGIN },
    top: { len: W, cur: MARGIN }, left: { len: D, cur: MARGIN },
  };
  function wallPlace(name, span, into) {
    const wl = walls[name];
    const along = wl.cur + span / 2;
    let cx, cy, rot;
    if (name === 'bottom') { cx = along; cy = D - into / 2 - MARGIN; rot = 0; }
    else if (name === 'top') { cx = along; cy = into / 2 + MARGIN; rot = 0; }
    else if (name === 'left') { cx = into / 2 + MARGIN; cy = along; rot = 90; }
    else { cx = W - into / 2 - MARGIN; cy = along; rot = 90; }
    wl.cur = along + span / 2 + GAP;
    return { cx, cy, rotationDeg: rot };
  }
  function bestWall(span) {
    let best = null, bestRem = -1;
    for (const [name, wl] of Object.entries(walls)) {
      const rem = wl.len - wl.cur - MARGIN;
      if (rem >= span && rem > bestRem) { best = name; bestRem = rem; }
    }
    return best;
  }

  const anchor = {}; // role → {cx,cy,into,wall}
  function packWall(it) {
    const span = it.wM, into = it.dM;
    const name = bestWall(span) || 'bottom';
    Object.assign(it, wallPlace(name, span, into));
    return { wall: name, into, cx: it.cx, cy: it.cy };
  }
  function inFrontOf(a, it) {
    const [nx, ny] = NORMAL[a.wall];
    const dist = a.into / 2 + GAP + it.dM / 2;
    it.rotationDeg = 0;
    it.cx = clamp(a.cx + nx * dist, it.wM / 2, W - it.wM / 2);
    it.cy = clamp(a.cy + ny * dist, it.dM / 2, D - it.dM / 2);
  }

  // 3) 배치 순서: 큰 앵커 먼저 → 관계 아이템
  const ORDER = ['bed', 'sofa', 'storage', 'desk', 'table', 'side', 'chair', 'lamp'];
  const nonRug = out.filter((it) => role.get(it.id) !== 'rug');
  nonRug.sort((a, b) =>
    (ORDER.indexOf(role.get(a.id)) - ORDER.indexOf(role.get(b.id))) || (b.wM * b.dM - a.wM * a.dM));

  let tableDone = false, chairDone = false;
  for (const it of nonRug) {
    const r = role.get(it.id);
    if (r === 'table' && !tableDone) {
      tableDone = true;
      if (anchor.sofa) { inFrontOf(anchor.sofa, it); continue; }
      it.rotationDeg = 0; it.cx = W / 2; it.cy = D / 2; continue; // 소파 없으면 중앙
    }
    if (r === 'chair' && !chairDone && anchor.desk) {
      chairDone = true; inFrontOf(anchor.desk, it); continue;
    }
    const info = packWall(it);
    if (!anchor[r]) anchor[r] = info;
  }

  // 4) 겹침/방밖 검증 → findFreeSpot로 재배치(러그 제외)
  const solid = out.filter((it) => role.get(it.id) !== 'rug');
  for (const it of solid) {
    const others = solid.filter((o) => o !== it);
    const box = itemAABB(it);
    if (others.some((o) => aabbOverlap(box, itemAABB(o))) || outOfBounds(box, W, D)) {
      const spot = findFreeSpot(it, others, W, D, 0.1);
      if (spot) { it.cx = spot.cx; it.cy = spot.cy; }
    }
  }
  return out;
}
