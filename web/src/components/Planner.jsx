import { useLayoutEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Group, Text } from 'react-konva';
import { effectiveFootprint } from '../lib/geometry.js';

const PAD = 16;
const MAX_H = 470;

// 축척 2D 탑다운 플래너. 배치·스케일·맞음판정은 전부 미터 좌표계 기하(lib/geometry)로 결정.
// 회전은 90도 스냅이라 시각적 rect 회전과 effectiveFootprint 스왑이 일치한다.
export default function Planner({ room, items, setItems, selectedId, setSelectedId, flags }) {
  const wrapRef = useRef(null);
  const [wrapW, setWrapW] = useState(600);

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
                <Text
                  text={`${it.name}\n${Math.round(it.wM * 100)}×${Math.round(it.dM * 100)}`}
                  fontSize={11}
                  fill="#3a352e"
                  align="center"
                  width={Math.max(fp.w, 1) * ppm}
                  offsetX={(Math.max(fp.w, 1) * ppm) / 2}
                  offsetY={6}
                  listening={false}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
