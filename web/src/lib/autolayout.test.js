// 자동배치 배치테스트 — 랜덤 가구셋 다수에 대해 불변식을 단언.
// 핵심: generateLayouts가 내놓는 모든 후보는 '겹침 0 + 방밖 0'이어야 한다(사용자 요구: 겹치면 기각).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout, circulationScore, itemAABB, openingZones, aabbOverlap, doorSwing, aabbHitsDoorSwing, openingBlocksAABB, WINDOW_SILL_M, pairOverlapOK, deskChairComposed, frontClearance, frontViolations, outOfRoom, openingOnCutout, findFreeSpot } from './geometry.js';
import { generateLayouts, validateCandidates } from './autolayout.js';

// 결정론적 PRNG(가구셋 생성용) — 레이아웃 내부 랜덤과 무관하게 '입력'만 재현 가능하게.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 실측 근사 가구 풀(m)
const POOL = [
  { cat: '침대', name: '퀸 침대', wM: 1.6, dM: 2.0, hM: 0.5 },
  { cat: '침대', name: '싱글 침대', wM: 1.0, dM: 2.0, hM: 0.5 },
  { cat: '책상', name: '책상', wM: 1.2, dM: 0.6, hM: 0.75 },
  { cat: '소파', name: '2인 소파', wM: 1.6, dM: 0.85, hM: 0.85 },
  { cat: '수납', name: '옷장', wM: 1.0, dM: 0.6, hM: 1.8 },
  { cat: '수납', name: '책장', wM: 0.8, dM: 0.3, hM: 1.8 },
  { cat: '테이블', name: '협탁', wM: 0.4, dM: 0.35, hM: 0.5 },
  { cat: '테이블', name: '커피테이블', wM: 0.8, dM: 0.8, hM: 0.4 },
  { cat: '의자', name: '의자', wM: 0.5, dM: 0.5, hM: 0.9 },
  { cat: '러그', name: '러그', wM: 2.0, dM: 1.4, hM: 0.02 },
];

function makeSet(rng, n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const p = POOL[Math.floor(rng() * POOL.length)];
    items.push({ id: `it${i}`, ...p, cx: 0, cy: 0, rotationDeg: 0 });
  }
  return items;
}

// 후보 1개의 불변식 검사
function assertCandidateValid(cand, room, items, label) {
  assert.equal(cand.items.length, items.length, `${label}: 모든 가구가 배치돼야 함`);
  for (const it of cand.items) {
    assert.ok([0, 90, 180, 270].includes(it.rotationDeg), `${label}: 회전은 0/90/180/270`);
  }
  const nonRug = cand.items.filter((it) => it.cat !== '러그');
  const v = validateLayout(nonRug, room.widthM, room.depthM);
  assert.ok(v.ok, `${label}: 겹침/방밖 없어야 함`);
}

test('generateLayouts: 겹침0·방밖0 불변식 (다수 랜덤 셋)', () => {
  const rng = mulberry32(42);
  const rooms = [{ widthM: 3.0, depthM: 4.0 }, { widthM: 3.6, depthM: 5.0 }, { widthM: 2.8, depthM: 3.6 }];
  let feasibleRuns = 0;
  for (let iter = 0; iter < 60; iter++) {
    const room = rooms[iter % rooms.length];
    const items = makeSet(rng, 3 + Math.floor(rng() * 4)); // 3~6개
    const cands = generateLayouts(room, items, 3);
    for (const c of cands) assertCandidateValid(c, room, items, `iter${iter}`);
    if (cands.length) feasibleRuns++;
    assert.ok(cands.length <= 3, `iter${iter}: 후보는 최대 3개`);
  }
  // 대부분의 현실적 셋은 배치 가능해야 함(엔진이 지나치게 자주 실패하지 않음)
  assert.ok(feasibleRuns >= 45, `가능 배치 비율이 너무 낮음: ${feasibleRuns}/60`);
});

test('generateLayouts: 대표 원룸셋은 후보 3개 + 서로 다름', () => {
  const room = { widthM: 3.6, depthM: 5.0 };
  const items = [
    { id: 'bed', cat: '침대', name: '퀸 침대', wM: 1.6, dM: 2.0, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'desk', cat: '책상', name: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'ns', cat: '테이블', name: '협탁', wM: 0.4, dM: 0.35, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'shelf', cat: '수납', name: '책장', wM: 0.8, dM: 0.3, hM: 1.8, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  const cands = generateLayouts(room, items, 3);
  assert.equal(cands.length, 3, '후보 3개');
  for (const c of cands) assertCandidateValid(c, room, items, 'rep');
  // 서로 다른 배치인지(시그니처 유일)
  const sigs = new Set(cands.map((c) => c.items.map((it) => `${Math.round(it.cx * 100)},${Math.round(it.cy * 100)},${it.rotationDeg}`).join('|')));
  assert.equal(sigs.size, 3, '세 후보가 서로 달라야 함');
});

test('generateLayouts: 불가능(방보다 큰 가구)면 빈 배열', () => {
  const room = { widthM: 1.0, depthM: 1.0 };
  const items = [{ id: 'big', cat: '침대', name: '킹 침대', wM: 2.0, dM: 2.2, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 }];
  assert.deepEqual(generateLayouts(room, items, 3), []);
});

test('circulationScore: 빈 방=1, 방을 가로지르는 가구는 동선 쪼갬', () => {
  assert.equal(circulationScore([], 3, 4).connected, 1);
  // 방 전폭을 막는 띠 → 위/아래로 분리 → connected < 1
  const wall = [{ id: 'w', wM: 3.0, dM: 0.4, hM: 1.0, cx: 1.5, cy: 2.0, rotationDeg: 0 }];
  const s = circulationScore(wall, 3, 4);
  assert.ok(s.connected < 0.9, `동선이 쪼개져야 함, got ${s.connected}`);
  // 구석 가구는 동선 온전
  const corner = [{ id: 'c', wM: 0.6, dM: 0.6, hM: 1.0, cx: 0.3, cy: 0.3, rotationDeg: 0 }];
  assert.ok(circulationScore(corner, 3, 4).connected > 0.98, '구석 가구는 동선 온전');
});

test('openingZones: 벽별 존 좌표', () => {
  const z = openingZones([{ wall: 'bottom', pos: 1.5, width: 0.9, clearance: 0.7 }], 3.0, 4.0);
  assert.equal(z.length, 1);
  assert.deepEqual(z[0], { left: 1.05, right: 1.95, top: 3.3, bottom: 4.0 });
  const zl = openingZones([{ wall: 'left', pos: 2.0, width: 1.0, clearance: 0.6 }], 3.0, 4.0)[0];
  assert.deepEqual(zl, { left: 0, right: 0.6, top: 1.5, bottom: 2.5 });
});

test('generateLayouts: 창문은 창턱보다 높은 가구만 회피(낮은 가구는 창 앞 허용)', () => {
  const room = { widthM: 3.0, depthM: 4.0 };
  const items = [
    { id: 'bed', cat: '침대', name: '침대', wM: 1.6, dM: 2.0, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'desk', cat: '책상', name: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'shelf', cat: '수납', name: '책장', wM: 0.8, dM: 0.3, hM: 1.8, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  const openings = [{ kind: 'window', wall: 'bottom', pos: 1.5, width: 0.9, clearance: 0.7 }];
  const cands = generateLayouts(room, items, 3, 500, openings);
  assert.ok(cands.length >= 1, '창문이 있어도 배치는 가능해야');
  const zones = openingZones(openings, 3.0, 4.0);
  for (const c of cands) {
    // 창턱(1.1m)보다 높은 가구(책장 1.8m)만 창 앞을 비워야 함. 낮은 침대·책상은 창 앞 허용.
    for (const it of c.items.filter((x) => x.hM > WINDOW_SILL_M)) {
      for (const z of zones) assert.ok(!aabbOverlap(itemAABB(it), z), `키큰 ${it.id}가 창을 가리면 안 됨`);
    }
  }
});

test('doorSwing: 벽별 부채꼴 박스·힌지', () => {
  // bottom 벽 문(폭 0.9, 중심 1.5, 힌지 a=왼쪽끝) → 박스 [1.05,1.95]×[3.1,4.0], 힌지 (1.05,4.0)
  const s = doorSwing({ wall: 'bottom', pos: 1.5, width: 0.9, hinge: 'a' }, 3.0, 4.0);
  assert.deepEqual(s.box, { left: 1.05, right: 1.95, top: 3.1, bottom: 4.0 });
  assert.deepEqual(s.hinge, { x: 1.05, y: 4.0 });
  assert.equal(s.R, 0.9);
  // 힌지 b=오른쪽끝
  const s2 = doorSwing({ wall: 'left', pos: 2.0, width: 0.8, hinge: 'b' }, 3.0, 4.0);
  assert.deepEqual(s2.box, { left: 0, right: 0.8, top: 1.6, bottom: 2.4 });
  assert.deepEqual(s2.hinge, { x: 0, y: 2.4 });
});

test('aabbHitsDoorSwing: 부채꼴 안/밖 정확 판정', () => {
  const door = { kind: 'door', wall: 'bottom', pos: 1.5, width: 0.9, hinge: 'a' }; // 힌지(1.05,4.0), R0.9
  // 힌지 바로 앞(부채꼴 안) 작은 가구 → hit
  assert.equal(aabbHitsDoorSwing({ left: 1.05, right: 1.35, top: 3.5, bottom: 3.9 }, door, 3.0, 4.0), true);
  // 사분면 박스의 먼 코너(호 바깥, 힌지에서 대각) → miss  (박스 [1.05,1.95]×[3.1,4.0], 먼코너 (1.95,3.1))
  assert.equal(aabbHitsDoorSwing({ left: 1.85, right: 1.95, top: 3.1, bottom: 3.2 }, door, 3.0, 4.0), false);
  // 박스 밖(방 위쪽) → miss
  assert.equal(aabbHitsDoorSwing({ left: 1.2, right: 1.5, top: 1.0, bottom: 1.5 }, door, 3.0, 4.0), false);
});

test('generateLayouts/validateCandidates: 문 스윙 부채꼴을 가구가 안 침범', () => {
  const room = { widthM: 3.0, depthM: 4.0 };
  const items = [
    { id: 'bed', cat: '침대', name: '침대', wM: 1.4, dM: 2.0, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'desk', cat: '책상', name: '책상', wM: 1.0, dM: 0.55, hM: 0.75, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  const openings = [{ kind: 'door', wall: 'bottom', pos: 1.5, width: 0.9, hinge: 'a' }];
  const cands = generateLayouts(room, items, 3, 600, openings);
  assert.ok(cands.length >= 1, '문이 있어도 배치 가능해야');
  for (const c of cands) {
    for (const it of c.items) {
      for (const o of openings) assert.ok(!aabbHitsDoorSwing(itemAABB(it), o, 3.0, 4.0), `${it.id}가 문 스윙 침범`);
    }
  }
  // 문 스윙에 걸치는 LLM 후보 → 폐기 대신 '보정'되어 유효 배치로 채택(침대만 가까운 유효 자리로 스냅).
  const blocking = [{ strategy: 'x', items: [
    { id: 'bed', cx: 130, cy: 300, rotation: 0 }, { id: 'desk', cx: 250, cy: 60, rotation: 0 }] }];
  const rep = validateCandidates(blocking, room, items, openings);
  assert.equal(rep.length, 1, '보정되어 채택되어야');
  for (const it of rep[0].items) {
    for (const o of openings) assert.ok(!aabbHitsDoorSwing(itemAABB(it), o, 3.0, 4.0), `보정 후 ${it.id}가 문 스윙 침범`);
  }
});

// 로컬 폴백 엔진의 필수 관계 R1~R3 (Gemini 실패해도 규칙 보장)
const FR = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] };
const mk = (id, cat, w, d, name) => ({ id, cat, name: name || cat, wM: w, dM: d, hM: 0.7, cx: 0, cy: 0, rotationDeg: 0 });
const facing = (a, b) => FR[a][0] === -FR[b][0] && FR[a][1] === -FR[b][1];

test('로컬 R2: 책상+의자 세트 — 의자가 책상 앞면 정면 마주봄·정렬·인접', () => {
  const room = { widthM: 3.2, depthM: 3.8 };
  const items = [mk('bed', '침대', 1.5, 2.0), mk('desk', '책상', 1.2, 0.6), mk('chair', '의자', 0.55, 0.55)];
  const c = generateLayouts(room, items, 3, 800)[0];
  assert.ok(c, '후보 생성됨');
  const desk = c.items.find((x) => x.id === 'desk'), chair = c.items.find((x) => x.id === 'chair');
  assert.ok(facing(desk.rotationDeg, chair.rotationDeg), '의자 앞면이 책상 앞면 정반대(마주봄)');
  const vert = FR[desk.rotationDeg][1] !== 0;
  assert.ok((vert ? Math.abs(chair.cx - desk.cx) : Math.abs(chair.cy - desk.cy)) <= 0.35, '중심축 정렬');
  // 의자는 책상 밑으로 틈입(AABB 겹침 발생) — 자연스러운 구도이므로 겹침으로 플래그되지 않아야 함.
  assert.ok(deskChairComposed(chair, desk), '의자-책상 구도 성립');
  assert.ok(!validateLayout([desk, chair], 3.2, 3.8).flags.some((f) => f.overlap), '구도 겹침은 미플래그');
});

test('정책: 자연스러운 책상-의자 구도의 겹침만 허용', () => {
  // 책상 앞면(+y)에 의자가 마주보며(−y 향함) 밀착 → 구도 성립.
  const desk = { cat: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 1.5, cy: 1.0, rotationDeg: 0 };
  const chairOK = { cat: '의자', wM: 0.55, dM: 0.55, hM: 0.9, cx: 1.5, cy: 1.3, rotationDeg: 180 };
  assert.ok(deskChairComposed(chairOK, desk), '마주보고 앞면·정렬 → 구도');
  assert.ok(pairOverlapOK(chairOK, desk) && pairOverlapOK(desk, chairOK), '순서 무관 허용');
  // 등돌린 의자(같은 방향) → 구도 아님.
  assert.ok(!deskChairComposed({ ...chairOK, rotationDeg: 0 }, desk), '같은 방향(등돌림)은 구도 아님');
  // 책상 뒷면 쪽 의자 → 구도 아님.
  assert.ok(!deskChairComposed({ ...chairOK, cy: 0.7 }, desk), '뒷면 쪽은 구도 아님');
  // 축에서 벗어난 의자 → 구도 아님.
  assert.ok(!deskChairComposed({ ...chairOK, cx: 2.6 }, desk), '정렬 벗어나면 구도 아님');
  // 책상/의자가 아닌 쌍의 겹침은 절대 불허(러그 제외).
  const bed = { cat: '침대', wM: 1.6, dM: 2.0, hM: 0.5, cx: 1.5, cy: 1.2, rotationDeg: 0 };
  assert.ok(!pairOverlapOK(bed, desk), '침대-책상 겹침 불허');
  assert.ok(pairOverlapOK({ cat: '러그' }, bed), '러그는 어떤 것과도 겹침 허용');
});

test('validateLayout: 구도 겹침은 통과, 나쁜 겹침은 플래그', () => {
  const desk = { id: 'd', cat: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 1.5, cy: 1.0, rotationDeg: 0 };
  const chair = { id: 'c', cat: '의자', wM: 0.55, dM: 0.55, hM: 0.9, cx: 1.5, cy: 1.28, rotationDeg: 180 };
  const good = validateLayout([desk, chair], 3.0, 4.0);
  assert.ok(!good.flags.some((f) => f.overlap) && good.ok, '틈입 구도는 겹침 아님');
  // 같은 자리에 등돌린 의자 → 나쁜 겹침 플래그.
  const bad = validateLayout([desk, { ...chair, rotationDeg: 0 }], 3.0, 4.0);
  assert.ok(bad.flags.some((f) => f.overlap), '구도 아닌 겹침은 플래그');
});

test('로컬 R1: TV장이 침대 반대편 벽에서 정면 마주봄·정렬', () => {
  const room = { widthM: 3.2, depthM: 4.0 };
  const items = [mk('bed', '침대', 1.5, 2.0), mk('tv', '수납', 1.2, 0.4, '미디어 콘솔')];
  const c = generateLayouts(room, items, 3, 800)[0];
  const bed = c.items.find((x) => x.id === 'bed'), tv = c.items.find((x) => x.id === 'tv');
  assert.ok(facing(bed.rotationDeg, tv.rotationDeg), 'TV 앞면이 침대 앞면 정반대');
  const vert = FR[bed.rotationDeg][1] !== 0;
  assert.ok((vert ? Math.abs(tv.cx - bed.cx) : Math.abs(tv.cy - bed.cy)) <= 0.5, '침대 중심축 정렬');
});

test('로컬 R3: 조명이 침대 헤드 쪽·벽면 0~10cm 밀착', () => {
  const room = { widthM: 3.2, depthM: 4.0 };
  const items = [mk('bed', '침대', 1.5, 2.0), mk('lamp', '조명', 0.3, 0.3)];
  const c = generateLayouts(room, items, 3, 800)[0];
  const lamp = c.items.find((x) => x.id === 'lamp');
  const b = itemAABB(lamp);
  const wallgap = Math.min(b.left, 3.2 - b.right, b.top, 4.0 - b.bottom);
  assert.ok(wallgap <= 0.1, `벽면 0~10cm (got ${wallgap.toFixed(3)})`);
});

test('validateCandidates: 겹치는 LLM 후보는 폐기 대신 보정', () => {
  const room = { widthM: 3.0, depthM: 4.0 };
  const items = [
    { id: 'a', cat: '침대', name: '침대', wM: 1.6, dM: 2.0, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'b', cat: '책상', name: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  // 같은 지점에 겹쳐 놓은 LLM 후보 → 보정되어 겹침 없는 배치로 채택
  const bad = [{ strategy: 'x', items: [{ id: 'a', cx: 100, cy: 100, rotation: 0 }, { id: 'b', cx: 100, cy: 100, rotation: 0 }] }];
  const rb = validateCandidates(bad, room, items);
  assert.equal(rb.length, 1, '겹쳐도 보정되어 채택');
  assert.ok(!validateLayout(rb[0].items.filter((x) => x.cat !== '러그'), 3.0, 4.0).flags.some((f) => f.overlap), '보정 후 겹침 없음');
  // 이미 유효하면 그대로 통과
  const good = [{ strategy: 'y', items: [{ id: 'a', cx: 80, cy: 100, rotation: 0 }, { id: 'b', cx: 220, cy: 300, rotation: 0 }] }];
  assert.equal(validateCandidates(good, room, items).length, 1);
  // 방보다 큰 가구는 보정 불가 → 폐기(로컬 폴백으로)
  const tiny = { widthM: 1.0, depthM: 1.0 };
  const bigItems = [{ id: 'a', cat: '침대', name: '침대', wM: 2.0, dM: 2.2, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 }];
  const cand = [{ strategy: 'z', items: [{ id: 'a', cx: 50, cy: 50, rotation: 0 }] }];
  assert.equal(validateCandidates(cand, tiny, bigItems).length, 0);
});

test('validateCandidates: 책상 밑 틈입한 Gemini 의자는 보정에서 유지', () => {
  const room = { widthM: 3.0, depthM: 4.0 };
  const items = [
    { id: 'desk', cat: '책상', name: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'chair', cat: '의자', name: '의자', wM: 0.55, dM: 0.55, hM: 0.9, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  // 책상 앞면(+y)에 의자를 28cm만 띄워 틈입시킨 유효 구도(cm 단위)
  const cand = [{ strategy: 'tuck', items: [
    { id: 'desk', cx: 150, cy: 60, rotation: 0 },
    { id: 'chair', cx: 150, cy: 88, rotation: 180 },
  ] }];
  const rb = validateCandidates(cand, room, items);
  assert.equal(rb.length, 1, '구도 후보 채택');
  const d = rb[0].items.find((x) => x.id === 'desk'), c = rb[0].items.find((x) => x.id === 'chair');
  // 보정이 의자를 끌어내지 않고 틈입 위치 그대로 유지(구도 겹침 허용)
  assert.ok(deskChairComposed(c, d), '보정 후에도 구도 유지');
  assert.ok(Math.abs(c.cx - 1.5) < 1e-6 && Math.abs(c.cy - 0.88) < 1e-6, '의자 원위치 유지');
});

test('frontClearance: 앞면 빈 깊이 계산(벽·장애물)', () => {
  // 서랍장(수납)이 rot 270(앞면 +x)으로 좌벽에: 앞이 완전히 비면 W - right
  const dresser = { cat: '수납', wM: 1.0, dM: 0.5, hM: 1.8, cx: 0.25, cy: 2.0, rotationDeg: 270 };
  assert.ok(Math.abs(frontClearance(dresser, [], 3.0, 4.0) - 2.5) < 1e-6, '빈 방이면 벽까지');
  // 앞 30cm에 침대 옆구리 → 여유 0.3
  const bed = { cat: '침대', wM: 1.5, dM: 2.0, hM: 0.4, cx: 1.55, cy: 2.0, rotationDeg: 0 };
  const clr = frontClearance(dresser, [itemAABB(bed)], 3.0, 4.0);
  assert.ok(Math.abs(clr - 0.3) < 0.02, `침대가 앞 30cm를 막음 (got ${clr.toFixed(2)})`);
});

test('frontViolations: 수납 앞 막힘=위반, 책상 짝 의자는 예외', () => {
  const dresser = { cat: '수납', wM: 1.0, dM: 0.5, hM: 1.8, cx: 0.25, cy: 2.0, rotationDeg: 270 };
  const bed = { cat: '침대', wM: 1.5, dM: 2.0, hM: 0.4, cx: 1.55, cy: 2.0, rotationDeg: 0 };
  assert.equal(frontViolations([dresser, bed], 3.0, 4.0), 1, '수납 앞 30cm 침대 → 위반 1');
  // 책상 앞의 구도 의자는 위반 아님
  const desk = { cat: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 1.5, cy: 0.35, rotationDeg: 0 };
  const chair = { cat: '의자', wM: 0.5, dM: 0.5, hM: 0.9, cx: 1.5, cy: 0.85, rotationDeg: 180 };
  assert.equal(frontViolations([desk, chair], 3.0, 4.0), 0, '짝 의자는 책상 앞 침범으로 안 침');
});

test('generateLayouts: 수납/책상 앞면 여유 확보(위반 0 후보만)', () => {
  const room = { widthM: 3.2, depthM: 4.4 };
  const items = [
    { id: 'bed', cat: '침대', name: '퀸 침대', wM: 1.6, dM: 2.0, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'wr', cat: '수납', name: '옷장', wM: 1.0, dM: 0.6, hM: 1.8, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'desk', cat: '책상', name: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  const cands = generateLayouts(room, items, 3, 600);
  assert.ok(cands.length >= 1, '후보 생성됨');
  for (const c of cands) assert.equal(frontViolations(c.items, room.widthM, room.depthM), 0, '모든 후보 앞면 위반 0');
});

test('R2 적응 틈입: 얇은 의자만 틈입, 깊은 암체어는 간격 배치', () => {
  const room = { widthM: 3.4, depthM: 4.0 };
  // 암체어(깊이 87cm) — 틈입 금지: 책상과 겹치지 않아야
  const arm = [mk('desk', '책상', 1.2, 0.6), mk('chair', '의자', 0.84, 0.87)];
  const c1 = generateLayouts(room, arm, 1, 600)[0];
  assert.ok(c1, '암체어 세트 배치됨');
  const d1 = c1.items.find((x) => x.id === 'desk'), ch1 = c1.items.find((x) => x.id === 'chair');
  assert.ok(!aabbOverlap(itemAABB(d1), itemAABB(ch1)), '암체어는 책상과 겹치지 않음');
  assert.ok(facing(d1.rotationDeg, ch1.rotationDeg), '그래도 마주봄 유지');
  // 얇은 데스크체어(깊이 55cm) — 틈입 허용(겹침이 구도로 인정)
  const slim = [mk('desk', '책상', 1.2, 0.6), mk('chair', '의자', 0.55, 0.55)];
  const c2 = generateLayouts(room, slim, 1, 600)[0];
  const d2 = c2.items.find((x) => x.id === 'desk'), ch2 = c2.items.find((x) => x.id === 'chair');
  assert.ok(aabbOverlap(itemAABB(d2), itemAABB(ch2)), '얇은 의자는 틈입(겹침)');
  assert.ok(deskChairComposed(ch2, d2), '틈입은 구도로 성립');
});

test('validateCandidates: 앞면 막힌 Gemini 후보는 품질 게이트로 폐기', () => {
  const room = { widthM: 3.0, depthM: 4.0 };
  const items = [
    { id: 'bed', cat: '침대', name: '침대', wM: 1.5, dM: 2.0, hM: 0.4, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'wr', cat: '수납', name: '옷장', wM: 1.0, dM: 0.5, hM: 1.8, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  // 옷장(rot 270, 앞면 +x)이 좌벽, 침대가 바로 앞 30cm — 겹침은 없지만 서랍 못 여는 나쁜 배치
  const bad = [{ strategy: 'x', items: [
    { id: 'wr', cx: 25, cy: 200, rotation: 270 },
    { id: 'bed', cx: 155, cy: 200, rotation: 0 },
  ] }];
  const out = validateCandidates(bad, room, items);
  // 게이트: 그대로 채택되면 안 됨 — 폐기되거나, 보정으로 위반이 해소돼야 함
  for (const c of out) assert.equal(frontViolations(c.items, 3.0, 4.0), 0, '채택 후보는 앞면 위반 0');
});

// ── 비직사각형(컷아웃) 방 ──
test('컷아웃: outOfRoom·validateLayout·circulation·findFreeSpot이 컷아웃을 벽으로 취급', () => {
  const cut = [{ x: 1.8, y: 2.8, w: 1.2, d: 1.2 }];   // 우하단 코너로 파인 욕실(L자)
  // 컷아웃 위 가구 → 방밖 취급
  const onCut = { cat: '수납', wM: 0.8, dM: 0.5, hM: 1.8, cx: 2.3, cy: 3.3, rotationDeg: 0 };
  assert.equal(outOfRoom(itemAABB(onCut), 3.0, 4.0, cut), true, '컷아웃 침범 = 방밖');
  const v = validateLayout([onCut], 3.0, 4.0, [], cut);
  assert.ok(v.flags[0].out && !v.ok, 'validateLayout도 out 플래그');
  // 실면적 = 바운딩 − 컷아웃
  assert.ok(Math.abs(v.roomArea - (12 - 1.44)) < 1e-9, '면적에서 컷아웃 차감');
  // 빈 방이어도 컷아웃이 동선 차단·freeRatio 반영
  const c = circulationScore([], 3.0, 4.0, 0.1, cut);
  assert.ok(c.freeRatio < 1 && c.freeRatio > 0.8, '컷아웃 셀은 걷기 불가');
  // findFreeSpot이 컷아웃을 피해서 자리 잡음
  const spot = findFreeSpot({ wM: 1.0, dM: 1.0, rotationDeg: 0 }, [], 3.0, 4.0, 0.1, cut);
  assert.ok(spot, '자리 찾음');
  const sb = itemAABB({ wM: 1.0, dM: 1.0, cx: spot.cx, cy: spot.cy, rotationDeg: 0 });
  assert.equal(outOfRoom(sb, 3.0, 4.0, cut), false, '찾은 자리는 컷아웃 밖');
});

test('컷아웃: frontClearance가 컷아웃 벽체에 막힘 + openingOnCutout 판정', () => {
  const cut = [{ x: 1.8, y: 2.8, w: 1.2, d: 1.2 }];
  // 수납이 컷아웃을 정면(+y)으로 45cm 앞에 둠 → 앞면 여유 부족(need 0.55)
  const dresser = { cat: '수납', wM: 1.0, dM: 0.5, hM: 1.8, cx: 2.3, cy: 2.1, rotationDeg: 0 };
  assert.equal(frontViolations([dresser], 3.0, 4.0, cut), 1, '컷아웃이 서랍장 앞을 막음');
  // bottom 벽의 컷아웃 잠식 구간(1.8~3.0)에 문 → 무효, 빈 구간(0~1.8)은 유효
  assert.equal(openingOnCutout({ wall: 'bottom', pos: 2.4, width: 0.9 }, 3.0, 4.0, cut), true);
  assert.equal(openingOnCutout({ wall: 'bottom', pos: 0.8, width: 0.9 }, 3.0, 4.0, cut), false);
  assert.equal(openingOnCutout({ wall: 'top', pos: 2.4, width: 0.9 }, 3.0, 4.0, cut), false, '반대 벽은 무관');
});

test('generateLayouts: L자 방(컷아웃) — 어떤 가구도 컷아웃 침범 없음', () => {
  const room = { widthM: 3.2, depthM: 4.6, cutouts: [{ x: 1.7, y: 3.2, w: 1.5, d: 1.4 }] };  // 우하단 욕실
  const items = [
    { id: 'bed', cat: '침대', name: '퀸 침대', wM: 1.5, dM: 2.0, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'desk', cat: '책상', name: '책상', wM: 1.1, dM: 0.6, hM: 0.75, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'wr', cat: '수납', name: '옷장', wM: 0.9, dM: 0.55, hM: 1.8, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  const cands = generateLayouts(room, items, 3, 600);
  assert.ok(cands.length >= 1, 'L자 방에서도 배치 가능');
  for (const c of cands) {
    for (const it of c.items.filter((x) => x.cat !== '러그')) {
      assert.equal(outOfRoom(itemAABB(it), room.widthM, room.depthM, room.cutouts), false,
        `${it.id}가 컷아웃/방밖 침범 금지`);
    }
    const v = validateLayout(c.items.filter((x) => x.cat !== '러그'), room.widthM, room.depthM, [], room.cutouts);
    assert.ok(v.ok, '컷아웃 인지 validateLayout 통과');
  }
});

test('validateCandidates: 컷아웃 위 Gemini 후보는 보정으로 밀어냄', () => {
  const room = { widthM: 3.0, depthM: 4.0, cutouts: [{ x: 1.6, y: 2.6, w: 1.4, d: 1.4 }] };
  const items = [{ id: 'wr', cat: '수납', name: '옷장', wM: 1.0, dM: 0.5, hM: 1.8, cx: 0, cy: 0, rotationDeg: 0 }];
  // 컷아웃 한복판에 놓은 LLM 후보
  const bad = [{ strategy: 'x', items: [{ id: 'wr', cx: 230, cy: 330, rotation: 0 }] }];
  const out = validateCandidates(bad, room, items);
  for (const c of out) {
    const it = c.items.find((x) => x.id === 'wr');
    assert.equal(outOfRoom(itemAABB(it), 3.0, 4.0, room.cutouts), false, '보정 후 컷아웃 밖');
  }
});
