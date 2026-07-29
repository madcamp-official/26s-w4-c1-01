import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapRotation, effectiveFootprint, itemAABB, aabbOverlap, outOfBounds, validateLayout, findFreeSpot, clampCenterFree,
} from './geometry.js';

test('snapRotation snaps to 0/90/180/270', () => {
  assert.equal(snapRotation(0), 0);
  assert.equal(snapRotation(44), 0);
  assert.equal(snapRotation(46), 90);
  assert.equal(snapRotation(135), 180);
  assert.equal(snapRotation(-90), 270);
  assert.equal(snapRotation(360), 0);
});

test('effectiveFootprint swaps at 90/270', () => {
  assert.deepEqual(effectiveFootprint(1.8, 0.9, 0), { w: 1.8, d: 0.9 });
  assert.deepEqual(effectiveFootprint(1.8, 0.9, 90), { w: 0.9, d: 1.8 });
  assert.deepEqual(effectiveFootprint(1.8, 0.9, 180), { w: 1.8, d: 0.9 });
  assert.deepEqual(effectiveFootprint(1.8, 0.9, 270), { w: 0.9, d: 1.8 });
});

test('itemAABB centers footprint', () => {
  const b = itemAABB({ cx: 1, cy: 1, wM: 2, dM: 1, rotationDeg: 0 });
  assert.deepEqual(b, { left: 0, right: 2, top: 0.5, bottom: 1.5, w: 2, d: 1 });
});

test('aabbOverlap: touching is not overlap, penetrating is', () => {
  const a = itemAABB({ cx: 0.5, cy: 0.5, wM: 1, dM: 1, rotationDeg: 0 }); // 0..1
  const touch = itemAABB({ cx: 1.5, cy: 0.5, wM: 1, dM: 1, rotationDeg: 0 }); // 1..2 (맞닿음)
  const pen = itemAABB({ cx: 1.4, cy: 0.5, wM: 1, dM: 1, rotationDeg: 0 }); // 0.9..1.9 (침투)
  assert.equal(aabbOverlap(a, touch), false);
  assert.equal(aabbOverlap(a, pen), true);
});

test('outOfBounds detects room escape', () => {
  const inside = itemAABB({ cx: 1, cy: 1, wM: 1, dM: 1, rotationDeg: 0 });
  const escaping = itemAABB({ cx: 2.9, cy: 1, wM: 1, dM: 1, rotationDeg: 0 });
  assert.equal(outOfBounds(inside, 3, 3), false);
  assert.equal(outOfBounds(escaping, 3, 3), true);
});

test('validateLayout flags overlap and out, computes free area', () => {
  const room = { w: 4, d: 3 };
  const items = [
    { cx: 1, cy: 1, wM: 2, dM: 1, rotationDeg: 0 }, // ok
    { cx: 1.2, cy: 1, wM: 2, dM: 1, rotationDeg: 0 }, // overlaps #0
    { cx: 3.9, cy: 2.8, wM: 1, dM: 1, rotationDeg: 0 }, // out of bounds
  ];
  const r = validateLayout(items, room.w, room.d);
  assert.equal(r.flags[0].overlap, true);
  assert.equal(r.flags[1].overlap, true);
  assert.equal(r.flags[2].out, true);
  assert.equal(r.ok, false);
  assert.equal(r.roomArea, 12);
  assert.ok(r.freeArea >= 0 && r.freeArea <= 12);
});

test('validateLayout ok when clean', () => {
  const items = [
    { cx: 1, cy: 1, wM: 1.5, dM: 1, rotationDeg: 0 },
    { cx: 3, cy: 2, wM: 1, dM: 1, rotationDeg: 0 },
  ];
  const r = validateLayout(items, 4, 3);
  assert.equal(r.ok, true);
});

test('findFreeSpot returns non-overlapping placement or null', () => {
  const placed = [{ cx: 0.5, cy: 0.5, wM: 1, dM: 1, rotationDeg: 0 }];
  const spot = findFreeSpot({ wM: 1, dM: 1, rotationDeg: 0 }, placed, 4, 3, 0.25);
  assert.ok(spot);
  const box = itemAABB({ ...spot, wM: 1, dM: 1, rotationDeg: 0 });
  assert.equal(outOfBounds(box, 4, 3), false);
  // 방보다 큰 가구는 자리 없음
  const none = findFreeSpot({ wM: 10, dM: 10, rotationDeg: 0 }, [], 4, 3, 0.5);
  assert.equal(none, null);
});

test('clampCenterFree pushes item out of a cutout (nearest edge)', () => {
  // 방 5x5, 컷아웃 (2,2)~(3,3). 컷아웃 왼쪽 근처를 노리면 왼쪽으로 밀려나야 한다.
  const it = { wM: 1, dM: 1, rotationDeg: 0 };
  const cuts = [{ x: 2, y: 2, w: 1, d: 1 }];
  const c = clampCenterFree(it, 2.1, 2.5, 5, 5, cuts);
  assert.ok(c.cx <= 1.5 + 1e-6, `왼쪽 탈출 기대, got cx=${c.cx}`);
  // 탈출 후엔 컷아웃과 안 겹친다
  const b = itemAABB({ ...c, ...it });
  assert.ok(b.right <= 2 + 1e-6 || b.left >= 3 - 1e-6 || b.bottom <= 2 + 1e-6 || b.top >= 3 - 1e-6);
});

test('clampCenterFree keeps prev when item cannot fit (stuck)', () => {
  // 방 3x3을 컷아웃이 거의 다 덮음 — 2x2 가구는 어디로도 탈출 불가 → prev 유지
  const it = { wM: 2, dM: 2, rotationDeg: 0 };
  const cuts = [{ x: 0, y: 0, w: 3, d: 3 }];
  const c = clampCenterFree(it, 1.5, 1.5, 3, 3, cuts, { cx: 9, cy: 9 });
  assert.deepEqual(c, { cx: 9, cy: 9 });
});

test('clampCenterFree respects walls while escaping', () => {
  // 컷아웃이 왼벽에 붙음 — 왼쪽 탈출은 방 밖이라 불가, 오른쪽으로 나와야 한다.
  const it = { wM: 1, dM: 1, rotationDeg: 0 };
  const cuts = [{ x: 0, y: 0, w: 1.5, d: 5 }];
  const c = clampCenterFree(it, 0.6, 2.5, 5, 5, cuts);
  assert.ok(c.cx >= 2 - 1e-6, `오른쪽 탈출 기대, got cx=${c.cx}`);
});

test('clampCenterFree without cutouts equals wall clamp', () => {
  const it = { wM: 1, dM: 1, rotationDeg: 0 };
  const a = clampCenterFree(it, -3, 9, 4, 3, []);
  assert.deepEqual(a, { cx: 0.5, cy: 2.5 });
});
