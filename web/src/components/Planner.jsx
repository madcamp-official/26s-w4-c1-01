import { useLayoutEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Group, Text, Circle, Shape, Image as KImage } from 'react-konva';
import { effectiveFootprint, clampCenterToRoom, doorSwing } from '../lib/geometry.js';
import { accuracyMeta } from '../lib/catalog.js';

const PAD = 16;
const MAX_H = 470;

// 축척 2D 탑다운 플래너. 배치·스케일·맞음판정은 전부 미터 좌표계 기하(lib/geometry)로 결정.
// 회전은 90도 스냅이라 시각적 rect 회전과 effectiveFootprint 스왑이 일치한다.
export default function Planner({ room, items, setItems, selectedId, setSelectedId, flags, openings = [] }) {
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
  const toM = (px) => px / ppm;

  function moveItem(idx, xPx, yPx, node) {
    const it = items[idx];
    const raw = { cx: toM(xPx - PAD), cy: toM(yPx - PAD) };
    const c = clampCenterToRoom(it, raw.cx, raw.cy, room.widthM, room.depthM);   // 방 밖 드래그 금지
    if (node && (Math.abs(c.cx - raw.cx) > 1e-9 || Math.abs(c.cy - raw.cy) > 1e-9)) {
      node.position({ x: PAD + toPx(c.cx), y: PAD + toPx(c.cy) });               // 노드도 경계 안으로 되돌림
    }
    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, cx: c.cx, cy: c.cy } : x)));
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

          {/* 컷아웃(비직사각형 방의 벽체/욕실) — 배치금지 구역을 벽색으로 */}
          {(room.cutouts || []).map((c, i) => (
            <Rect key={`cut${i}`} x={PAD + toPx(c.x)} y={PAD + toPx(c.y)} width={toPx(c.w)} height={toPx(c.d)}
              fill="#e3ddd2" stroke="#8a8172" strokeWidth={2} cornerRadius={1} listening={false} />
          ))}

          {/* 개구부: 문(90° 스윙 부채꼴=접근불가, 빨강) · 창문(벽 표시=가리면 안 됨, 파랑) */}
          {(openings || []).map((o) => {
            const isVert = o.wall === 'left' || o.wall === 'right';
            const wallLen = isVert ? room.depthM : room.widthM;
            const w = o.width ?? (o.kind === 'door' ? 0.9 : 1.2);
            const p = Math.min(Math.max(o.pos ?? wallLen / 2, w / 2), wallLen - w / 2);
            const a = p - w / 2, b = p + w / 2;
            const P = (mx, my) => [PAD + toPx(mx), PAD + toPx(my)];
            const ends = {
              top: [P(a, 0), P(b, 0)], bottom: [P(a, room.depthM), P(b, room.depthM)],
              left: [P(0, a), P(0, b)], right: [P(room.widthM, a), P(room.widthM, b)],
            }[o.wall];
            const [e1, e2] = ends;
            if (o.kind === 'door') {
              const { hinge, R } = doorSwing({ ...o, pos: p, width: w }, room.widthM, room.depthM);
              const hx = PAD + toPx(hinge.x), hy = PAD + toPx(hinge.y), Rp = toPx(R);
              const into = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[o.wall];
              const hb = o.hinge === 'b';
              const along = isVert ? [0, hb ? -1 : 1] : [hb ? -1 : 1, 0];
              const a1 = Math.atan2(along[1], along[0]);
              const a2 = Math.atan2(into[1], into[0]);
              let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
              const acw = d < 0;
              const leaf = [hx + into[0] * Rp, hy + into[1] * Rp];
              return (
                <Group key={o.id} listening={false}>
                  <Shape sceneFunc={(ctx, sh) => { ctx.beginPath(); ctx.moveTo(hx, hy); ctx.arc(hx, hy, Rp, a1, a2, acw); ctx.closePath(); ctx.fillStrokeShape(sh); }}
                    fill="rgba(204,91,82,0.12)" stroke="#cc5b52" strokeWidth={1} dash={[4, 3]} />
                  <Line points={[e1[0], e1[1], e2[0], e2[1]]} stroke="#cc5b52" strokeWidth={4} />
                  <Line points={[hx, hy, leaf[0], leaf[1]]} stroke="#cc5b52" strokeWidth={2} />
                </Group>
              );
            }
            const off = 5;
            const n = { top: [0, off], bottom: [0, -off], left: [off, 0], right: [-off, 0] }[o.wall];
            return (
              <Group key={o.id} listening={false}>
                <Line points={[e1[0], e1[1], e2[0], e2[1]]} stroke="#3b7fb5" strokeWidth={5} />
                <Line points={[e1[0] + n[0], e1[1] + n[1], e2[0] + n[0], e2[1] + n[1]]} stroke="#7db8e0" strokeWidth={2} />
              </Group>
            );
          })}

          {items.map((it, idx) => {
            const fp = effectiveFootprint(it.wM, it.dM, it.rotationDeg || 0);
            const flag = flags[idx] || {};
            const stroke = flag.overlap ? '#cc5b52' : (flag.out || flag.blockOpen) ? '#d98a3a' : selectedId === it.id ? '#3f6a3a' : '#6f8f6a';
            const w = toPx(it.wM), h = toPx(it.dM);
            return (
              <Group
                key={it.id}
                x={PAD + toPx(it.cx)}
                y={PAD + toPx(it.cy)}
                draggable
                onDragMove={(e) => moveItem(idx, e.target.x(), e.target.y(), e.target)}
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
