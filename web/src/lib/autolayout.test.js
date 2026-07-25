// 자동배치 배치테스트 — 랜덤 가구셋 다수에 대해 불변식을 단언.
// 핵심: generateLayouts가 내놓는 모든 후보는 '겹침 0 + 방밖 0'이어야 한다(사용자 요구: 겹치면 기각).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout, circulationScore, itemAABB } from './geometry.js';
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

test('validateCandidates: 겹치는 LLM 후보는 폐기', () => {
  const room = { widthM: 3.0, depthM: 4.0 };
  const items = [
    { id: 'a', cat: '침대', name: '침대', wM: 1.6, dM: 2.0, hM: 0.5, cx: 0, cy: 0, rotationDeg: 0 },
    { id: 'b', cat: '책상', name: '책상', wM: 1.2, dM: 0.6, hM: 0.75, cx: 0, cy: 0, rotationDeg: 0 },
  ];
  // 두 가구를 같은 지점에 겹쳐 놓은 LLM 후보 → 폐기돼야 함
  const bad = [{ strategy: 'x', items: [{ id: 'a', cx: 100, cy: 100, rotation: 0 }, { id: 'b', cx: 100, cy: 100, rotation: 0 }] }];
  assert.equal(validateCandidates(bad, room, items).length, 0);
  // 떨어뜨려 놓으면 통과
  const good = [{ strategy: 'y', items: [{ id: 'a', cx: 80, cy: 100, rotation: 0 }, { id: 'b', cx: 220, cy: 300, rotation: 0 }] }];
  assert.equal(validateCandidates(good, room, items).length, 1);
});
