import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pyeongToM2, estimateRoom, estimateFromOneWall, roomFromMeasured, DEFAULT_ASPECT,
} from './roomEstimate.js';

test('pyeongToM2', () => {
  assert.ok(Math.abs(pyeongToM2(6) - 19.8348) < 1e-3);
});

test('estimateRoom: area conserves after deduction, aspect respected', () => {
  const r = estimateRoom({ pyeong: 6, deductM2: 5, aspect: DEFAULT_ASPECT });
  assert.equal(r.source, 'ESTIMATE');
  assert.equal(r.accuracy, 'ESTIMATE');
  // livable = 19.83 - 5 = 14.83; W*D ≈ livable
  assert.ok(Math.abs(r.widthM * r.depthM - r.areaLivableM2) < 0.1);
  // W/D ≈ aspect
  assert.ok(Math.abs(r.widthM / r.depthM - DEFAULT_ASPECT) < 0.05);
  assert.ok(r.widthM > r.depthM); // 가로가 긴 변
});

test('estimateRoom accepts m2 directly', () => {
  const r = estimateRoom({ m2: 20, deductM2: 5 });
  assert.equal(r.areaLivableM2, 15);
});

test('estimateFromOneWall fixes measured wall, derives other', () => {
  const r = estimateFromOneWall({ pyeong: 6, measuredWidthM: 3, deductM2: 5 });
  assert.equal(r.widthM, 3);
  assert.equal(r.accuracy, 'MEASURED_PARTIAL');
  assert.ok(Math.abs(r.widthM * r.depthM - r.areaLivableM2) < 0.1);
});

test('roomFromMeasured is exact', () => {
  const r = roomFromMeasured({ widthM: 3.2, depthM: 4.1 });
  assert.equal(r.accuracy, 'MEASURED');
  assert.equal(r.widthM, 3.2);
  assert.equal(r.depthM, 4.1);
});
