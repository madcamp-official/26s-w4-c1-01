import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapRotation, effectiveFootprint, itemAABB, aabbOverlap, outOfBounds, validateLayout, findFreeSpot,
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
