import { useLayoutEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Group, Text, Circle, Image as KImage } from 'react-konva';
import { effectiveFootprint } from '../lib/geometry.js';
import { accuracyMeta } from '../lib/catalog.js';

const PAD = 16;
const MAX_H = 470;

// 축척 2D 탑다운 플래너. 배치·스케일·맞음판정은 전부 미터 좌표계 기하(lib/geometry)로 결정.
// 회전은 90도 스냅이라 시각적 rect 회전과 effectiveFootprint 스왑이 일치한다.
export default function Planner({ room, items, setItems, selectedId, setSelectedId, flags }) {
  const wrapRef = useRef(null);
  const [wrapW, setWrapW] = useState(600);
  const imgCache = useRef({});
  const [, setImgTick] = useState(0);
  // 제품 썸네일 로더(탑다운 타일 위 오버레이). 로드되면 리렌더.
  function getImg(src) {
    if (!src) return null;
    let e = imgCache.current[src];
    if (!e) {
      const im = new window.Image();
      e = { im, ok: false };
      imgCache.current[src] = e;
      im.onload = () => { e.ok = true; setImgTick((t) => t + 1); };
      im.onerror = () => { e.ok = 'err'; };
      im.src = src;
    }
    return e.ok === true ? e.im : null;
  }

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth || 600));
    ro.observe(el);
    setWrapW(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);

  const availW = Math.max(240, wrapW - 16);
  const ppm = Math.min((availW - 2 * PAD) / room.widthM, (MAX_H - 2 * PAD) / room.depthM);
  const stageW = room.widthM * ppm + 2 * PAD;
  const stageH = room.depthM * ppm + 2 * PAD;

  const toPx = (m) => m * ppm;

  function moveItem(idx, xPx, yPx) {
    const cx = (xPx - PAD) / ppm;
    const cy = (yPx - PAD) / ppm;
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, cx, cy } : it)));
  }

  // 0.5m 격자
  const grid = [];
  for (let m = 0.5; m < room.widthM; m += 0.5) grid.push(['v', m]);
  for (let m = 0.5; m < room.depthM; m += 0.5) grid.push(['h', m]);

  return (
    <div className="stagewrap" ref={wrapRef}>
      <Stage width={stageW} height={stageH} onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelectedId(null); }}
        onTouchStart={(e) => { if (e.target === e.target.getStage()) setSelectedId(null); }}>
        <Layer>
          {/* 바닥 */}
          <Rect x={PAD} y={PAD} width={toPx(room.widthM)} height={toPx(room.depthM)} fill="#faf7f1" stroke="#cfc7b8" strokeWidth={1.5} cornerRadius={2} />
          {grid.map(([dir, m], i) =>
            dir === 'v' ? (
              <Line key={i} points={[PAD + toPx(m), PAD, PAD + toPx(m), PAD + toPx(room.depthM)]} stroke="#ece5d8" strokeWidth={1} />
            ) : (
              <Line key={i} points={[PAD, PAD + toPx(m), PAD + toPx(room.widthM), PAD + toPx(m)]} stroke="#ece5d8" strokeWidth={1} />
            )
          )}

          {items.map((it, idx) => {
            const fp = effectiveFootprint(it.wM, it.dM, it.rotationDeg || 0);
            const flag = flags[idx] || {};
            const stroke = flag.overlap ? '#cc5b52' : flag.out ? '#d98a3a' : selectedId === it.id ? '#3f6a3a' : '#6f8f6a';
            const w = toPx(it.wM), h = toPx(it.dM);
            return (
              <Group
                key={it.id}
                x={PAD + toPx(it.cx)}
                y={PAD + toPx(it.cy)}
                draggable
                onDragMove={(e) => moveItem(idx, e.target.x(), e.target.y())}
                onClick={() => setSelectedId(it.id)}
                onTap={() => setSelectedId(it.id)}
              >
                {/* 회전은 rect 자체를 돌린다(90도 스냅이라 effectiveFootprint 스왑과 일치) */}
                <Rect
                  width={w}
                  height={h}
                  offsetX={w / 2}
                  offsetY={h / 2}
                  rotation={it.rotationDeg || 0}
                  fill={it.color || '#c9bfa8'}
                  opacity={0.9}
                  stroke={stroke}
                  strokeWidth={selectedId === it.id ? 3 : 2}
                  cornerRadius={3}
                />
                {(() => {
                  const im = getImg(it.image);
                  if (!im) return null;
                  const asp = im.naturalWidth / im.naturalHeight || 1;
                  let iw = w * 0.74, ih = iw / asp;
                  const maxh = h * 0.74;
                  if (ih > maxh) { ih = maxh; iw = ih * asp; }
                  return <KImage image={im} width={iw} height={ih} offsetX={iw / 2} offsetY={ih / 2} listening={false} opacity={0.95} />;
                })()}
                <Text
                  text={`${it.name}\n${Math.round(it.wM * 100)}×${Math.round(it.dM * 100)} · ${accuracyMeta(it.dimAccuracy).short}`}
                  fontSize={11}
                  fill="#3a352e"
                  align="center"
                  width={Math.max(fp.w, 1) * ppm}
                  offsetX={(Math.max(fp.w, 1) * ppm) / 2}
                  offsetY={6}
                  listening={false}
                />
                {/* 치수 신뢰도 점 (좌상단) */}
                <Circle x={-w / 2 + 6} y={-h / 2 + 6} radius={4} fill={accuracyMeta(it.dimAccuracy).hex} listening={false} />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
