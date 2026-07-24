import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHomography, applyH, footprintCorners, billboardQuad } from './homography.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('identity correspondence yields identity mapping', () => {
  const pts = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const H = computeHomography(pts, pts);
  for (const p of [[0.3, 0.7], [0.9, 0.1], [0.5, 0.5]]) {
    const q = applyH(H, p);
    assert.ok(close(q[0], p[0]) && close(q[1], p[1]), `${q} != ${p}`);
  }
});

test('affine scale+translate maps correctly', () => {
  // room [0..4]x[0..3] meters → image [100..900]x[600..100] (y flipped, near=bottom)
  const src = [[0, 0], [4, 0], [4, 3], [0, 3]];
  const dst = [[100, 100], [900, 100], [900, 600], [100, 600]];
  const H = computeHomography(src, dst);
  assert.deepEqual(applyH(H, [0, 0]).map(Math.round), [100, 100]);
  assert.deepEqual(applyH(H, [4, 3]).map(Math.round), [900, 600]);
  assert.deepEqual(applyH(H, [2, 1.5]).map(Math.round), [500, 350]); // 중앙
});

test('perspective (trapezoid floor) maps corners exactly', () => {
  // 원근: 방 뒤쪽(far, y=0)이 좁고 앞쪽(near, y=3)이 넓은 사다리꼴
  const src = [[0, 0], [4, 0], [4, 3], [0, 3]];
  const dst = [[350, 200], [650, 200], [900, 600], [100, 600]];
  const H = computeHomography(src, dst);
  for (let i = 0; i < 4; i++) {
    const q = applyH(H, src[i]);
    assert.ok(close(q[0], dst[i][0], 1e-4) && close(q[1], dst[i][1], 1e-4));
  }
});

test('footprintCorners swaps with 90deg rotation', () => {
  const a = footprintCorners({ cx: 1, cy: 1, wM: 2, dM: 1, rotationDeg: 0 });
  assert.deepEqual(a[0], [0, 0.5]);
  assert.deepEqual(a[2], [2, 1.5]);
  const b = footprintCorners({ cx: 1, cy: 1, wM: 2, dM: 1, rotationDeg: 90 });
  assert.deepEqual(b[0], [0.5, 0]);
  assert.deepEqual(b[2], [1.5, 2]);
});

test('billboardQuad stands up from front baseline with positive height', () => {
  const src = [[0, 0], [4, 0], [4, 3], [0, 3]];
  const dst = [[350, 200], [650, 200], [900, 600], [100, 600]];
  const H = computeHomography(src, dst);
  const q = billboardQuad(H, { cx: 2, cy: 2.5, wM: 1.8, dM: 0.9, hM: 0.84, rotationDeg: 0 });
  assert.ok(q.heightPx > 0);
  assert.ok(q.topL[1] < q.bottomL[1]); // top is above bottom (smaller image-y)
  assert.ok(q.bottomR[0] > q.bottomL[0]); // right is right of left
});
