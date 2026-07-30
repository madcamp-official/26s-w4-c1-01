import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Group, Text, Circle, Shape, Image as KImage } from 'react-konva';
import { effectiveFootprint, clampCenterFree, doorSwing, cutAABBs } from '../lib/geometry.js';
import { accuracyMeta } from '../lib/catalog.js';

const PAD = 16;
const MAX_H = 470;
// 컷아웃 구역 이름 — 도면(floorplanSvg)과 같은 어휘를 쓴다. 없으면 '배치금지'로만 보인다.
const CUT_LABEL = { bath: '욕실', closet: '보일러실', kitchen: '주방', entry: '현관' };
// ABO 로컬 상품 사진의 배경 제거본(오프라인 생성, /glb/*.cut.png) — 2D에서 3D 에셋처럼 쓴다.
const cutSrc = (it) => (it.image || '').replace(/\.jpg$/, '.cut.png');
const hasCut = (it) => /^\.?\/glb\/.+\.jpg$/.test(it.image || '');
const ZONE_FILL = { bath: '#E7EFF2', kitchen: '#EAE3D8', closet: '#E9E2D6', entry: '#EFE8DE' };

// 구역을 도면 표기법으로 그린다 — 욕실=타일 격자, 주방=카운터(싱크·화구), 현관/보일러실=사선 해칭.
// Konva Shape sceneFunc 하나로 클리핑까지 처리(노드 수 절약). dim=언더레이 위에서는 살짝 비치게.
function drawZone(kctx, kind, x, y, w, h, ppm, dim, chipHalf = 0) {
  const ctx = kctx._context || kctx;          // roundRect 등 네이티브 API 사용
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalAlpha = dim ? 0.93 : 1;
  ctx.fillStyle = ZONE_FILL[kind] || ZONE_FILL.closet;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  if (kind === 'bath') {
    ctx.strokeStyle = '#C9D8DE';
    const step = Math.max(12, 0.35 * ppm);
    for (let gx = x + step; gx < x + w; gx += step) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
    for (let gy = y + step; gy < y + h; gy += step) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
  } else if (kind === 'kitchen') {
    // 카운터 상판(안쪽 인셋) — 기본 구역색(ZONE_FILL.kitchen)이 바닥·격자선과 너무 가까운 톤이라
    // 테두리만 그리면 '안 채워진 빈 칸'처럼 보인다. 상판 안쪽을 한 톤 더 진하게 채워 대비를 준다.
    // 싱크 사각형은 어수선해서 뺐다. 화구 2구만, 라벨 칩과 안 겹칠 때.
    ctx.fillStyle = '#DDD1BC';
    ctx.fillRect(x + 4.5, y + 4.5, w - 9, h - 9);
    ctx.strokeStyle = '#C7BCAB';
    ctx.strokeRect(x + 4.5, y + 4.5, w - 9, h - 9);
    const horiz = w >= h, T = horiz ? h : w;
    const r = Math.min(0.085 * ppm, T * 0.26);
    if (r > 3.5) {
      ctx.strokeStyle = '#A9A29A';
      const cxm = horiz ? x + w / 2 : y + h / 2;              // 긴 축의 중앙(칩 자리)
      for (const off of [0.26, 0.52]) {
        const bx = horiz ? x + w - off * ppm : x + w / 2;
        const by = horiz ? y + h / 2 : y + h - off * ppm;
        const along = horiz ? bx : by;
        if (along - r > cxm + chipHalf + 3 && along + r < (horiz ? x + w : y + h) - 3) {
          ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
  } else {                                    // closet(성근 사선) / entry(촘촘한 반대 사선 = 현관 매트)
    ctx.strokeStyle = kind === 'entry' ? '#DCCFBE' : '#DCD2C2';
    const s = kind === 'entry' ? 9 : 13;
    for (let k = x - h; k < x + w; k += s) {
      ctx.beginPath();
      if (kind === 'entry') { ctx.moveTo(k, y + h); ctx.lineTo(k + h, y); }
      else { ctx.moveTo(k, y); ctx.lineTo(k + h, y + h); }
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = '#4A423A'; ctx.lineWidth = 3;  // 내부 칸막이 벽(외벽보다 한 톤 가볍게)
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

// 실제 도면 이미지를 방 좌표에 1:1로 깔기 위한 로더(use-image 의존성 없이).
function useImageSrc(src) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!src) { setImg(null); return; }
    const im = new window.Image();
    im.onload = () => setImg(im);
    im.src = src;
    return () => { im.onload = null; };
  }, [src]);
  return img;
}

// 축척 2D 탑다운 플래너. 배치·스케일·맞음판정은 전부 미터 좌표계 기하(lib/geometry)로 결정.
// 회전은 90도 스냅이라 시각적 rect 회전과 effectiveFootprint 스왑이 일치한다.
export default function Planner({ room, items, setItems, selectedId, setSelectedId, flags, openings = [] }) {
  const wrapRef = useRef(null);
  const [wrapW, setWrapW] = useState(600);
  const planImg = useImageSrc(room.underlay);   // 실측 도면 배경(없으면 null)
  const imgCache = useRef({});
  const [, setImgTick] = useState(0);
  const [draggingId, setDraggingId] = useState(null);   // 배지 색이 '집는 동안'만 초록이 되게
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
  const wallT = Math.max(5, Math.min(12, room.widthM * ppm * 0.028));   // 외벽 밴드 두께(px) — 도면 느낌의 핵심

  // 빈 상태 안내 위치 — 방 bbox 중앙이 아니라 '배치 가능한 빈 공간'의 중심.
  // 컷아웃·벽에서 가장 먼 지점(pole of inaccessibility)을 0.15m 격자로 근사한다.
  const hintPos = useMemo(() => {
    const W = room.widthM, D = room.depthM;
    const cuts = cutAABBs(room.cutouts || []);
    if (!cuts.length) return { cx: W / 2, cy: D / 2 };
    let best = { cx: W / 2, cy: D / 2, d: -1 };
    for (let y = 0.2; y < D - 0.1; y += 0.15) {
      for (let x = 0.2; x < W - 0.1; x += 0.15) {
        let d = Math.min(x, W - x, y, D - y);
        for (const b of cuts) {
          if (x > b.left && x < b.right && y > b.top && y < b.bottom) { d = -1; break; }
          const dx = Math.max(b.left - x, 0, x - b.right);
          const dy = Math.max(b.top - y, 0, y - b.bottom);
          d = Math.min(d, Math.hypot(dx, dy));
        }
        if (d > best.d) best = { cx: x, cy: y, d };
      }
    }
    return best;
  }, [room]);

  const toPx = (m) => m * ppm;
  const toM = (px) => px / ppm;

  function moveItem(idx, xPx, yPx, node) {
    const it = items[idx];
    const raw = { cx: toM(xPx - PAD), cy: toM(yPx - PAD) };
    // 방 밖 + 컷아웃(욕실·주방 등) 드래그 금지 — 러그만 예외(soft 정책과 일치)
    const cuts = it.cat === '러그' ? [] : room.cutouts || [];
    const c = clampCenterFree(it, raw.cx, raw.cy, room.widthM, room.depthM, cuts, it);
    if (node && (Math.abs(c.cx - raw.cx) > 1e-9 || Math.abs(c.cy - raw.cy) > 1e-9)) {
      node.position({ x: PAD + toPx(c.cx), y: PAD + toPx(c.cy) });               // 노드도 경계 안으로 되돌림
    }
    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, cx: c.cx, cy: c.cy } : x)));
  }

  // 0.5m 격자
  const grid = [];
  for (let m = 0.5; m < room.widthM; m += 0.5) grid.push(['v', m]);
  for (let m = 0.5; m < room.depthM; m += 0.5) grid.push(['h', m]);

  // 가구 라벨 — 사각형 바깥 좌상단에 뜨는 작은 배지. 침대는 강조색, 나머진 코퍼.
  // 위쪽 벽에 붙어 바깥에 놓을 공간이 없으면 사각형 안쪽 상단으로 폴백하고,
  // 앞서 배치한 라벨과 겹치면 순서대로 오른쪽으로 밀어낸다(그리드가 커도 O(n²)로 충분히 가벼움).
  // 라벨 배지는 '항상 제 가구에 붙어 있어야' 한다 — 겹친다고 옆으로 밀어내면
  // 라벨이 남의 가구 위에 떠서 무엇의 라벨인지 알 수 없게 된다. 그래서 가구에 맞닿은
  // 후보 자리(위/아래 바깥, 안쪽 상/하단)만 두고 그중 덜 겹치는 곳을 고른다.
  const GAP = 3;   // 사각형과 배지 사이 — 딱 붙는 느낌이 나게 최소로
  const labelPlacements = useMemo(() => {
    const placedBoxes = [];   // 캔버스 절대좌표 기준 이미 놓인 라벨들(겹침 판정용)
    return items.map((it) => {
      const fp = effectiveFootprint(it.wM, it.dM, it.rotationDeg || 0);
      const hw = (fp.w * ppm) / 2, hd = (fp.d * ppm) / 2;   // 축정렬 바운딩박스 반폭/반깊이(px)
      const fontSize = it.cat === '침대' ? 8.5 : 8;
      // 상품명(영문 원문·긴 표기)이 아니라 카테고리로 — 배지는 한 줄 고정폭이라 짧은 이름이 전제.
      const text = `${it.cat || it.name} ${Math.round(it.wM * 100)}×${Math.round(it.dM * 100)}`;
      // 캔버스에 실제 폰트 측정 없이 근사(칩 라벨과 같은 방식) — 배지 배경 크기·겹침판정용.
      const padX = 6, padY = 2.5;
      const w = text.length * fontSize * 0.92 + padX * 2;
      const h = fontSize * 1.25 + padY * 2;

      const cxPx = PAD + toPx(it.cx), cyPx = PAD + toPx(it.cy);
      // 전부 가구 경계에 맞닿은 자리. 순서 = 선호도(위 바깥 > 아래 바깥 > 안쪽).
      const cands = [
        { x: -hw + 2, y: -hd - GAP - h },
        { x: hw - w - 2, y: -hd - GAP - h },
        { x: -hw + 2, y: hd + GAP },
        { x: hw - w - 2, y: hd + GAP },
        { x: -hw - GAP - w, y: -h / 2 },     // 왼쪽 바깥(세로 중앙)
        { x: hw + GAP, y: -h / 2 },          // 오른쪽 바깥
        { x: -hw + 2, y: -hd + 2 },          // 안쪽 상단
        { x: -hw + 2, y: hd - h - 2 },       // 안쪽 하단
      ];
      const overlapOf = (gx, gy) => placedBoxes.reduce((sum, p) => {
        const ox = Math.min(gx + w, p.x + p.w) - Math.max(gx, p.x);
        const oy = Math.min(gy + h, p.y + p.h) - Math.max(gy, p.y);
        return sum + (ox > 0 && oy > 0 ? ox * oy : 0);
      }, 0);

      let best = null;
      for (const c of cands) {
        const gx = cxPx + c.x, gy = cyPx + c.y;
        // 캔버스 밖으로 나가는 자리는 후보에서 제외(잘려 보인다)
        if (gx < 2 || gy < 2 || gx + w > stageW - 2 || gy + h > stageH - 2) continue;
        const ov = overlapOf(gx, gy);
        if (!best || ov < best.ov) best = { ...c, gx, gy, ov };
        if (ov === 0) break;      // 안 겹치는 첫 자리면 더 볼 것 없다
      }
      // 모든 후보가 캔버스를 벗어나는 극단(아주 큰 가구)에서는 안쪽 상단으로.
      if (!best) best = { x: -hw + 2, y: -hd + 2, gx: cxPx - hw + 2, gy: cyPx - hd + 2 };
      placedBoxes.push({ x: best.gx, y: best.gy, w, h });

      return { id: it.id, x: best.x, y: best.y, w, h, text, fontSize };
    });
  }, [items, ppm, stageW, stageH]);

  return (
    <div className="stagewrap" ref={wrapRef}>
      <Stage width={stageW} height={stageH} onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelectedId(null); }}
        onTouchStart={(e) => { if (e.target === e.target.getStage()) setSelectedId(null); }}>
        <Layer>
          {/* 바닥 — 도면 카드(floorplanSvg)와 같은 웜 페이퍼 톤. 테두리는 아래 벽체 밴드가 담당. */}
          <Rect x={PAD} y={PAD} width={toPx(room.widthM)} height={toPx(room.depthM)} fill="#FBF6EF" />
          {/* 0.5m 격자 — 정수 미터는 살짝 진하게(도면의 보조선 위계) */}
          {grid.map(([dir, m], i) => {
            const whole = Math.abs(m - Math.round(m)) < 1e-9;
            const col = whole ? '#EADFCE' : '#F2EBDF';
            return dir === 'v' ? (
              <Line key={i} points={[PAD + toPx(m), PAD, PAD + toPx(m), PAD + toPx(room.depthM)]} stroke={col} strokeWidth={1} />
            ) : (
              <Line key={i} points={[PAD, PAD + toPx(m), PAD + toPx(room.widthM), PAD + toPx(m)]} stroke={col} strokeWidth={1} />
            );
          })}

          {/* 실제 도면(있으면) — 방 사각형에 1:1로 깔아 그 위에서 배치한다. 가구·판정은 그대로 기하가 결정.
              불투명도 0.16: 도면은 윤곽만 은은하게 — 배치 요소가 주인공. */}
          {planImg && (
            <KImage image={planImg} x={PAD} y={PAD} width={toPx(room.widthM)} height={toPx(room.depthM)}
              opacity={0.16} listening={false} />
          )}

          {/* 외벽 — 도면의 두꺼운 벽체 밴드(경계선 중심). 개구부가 이 밴드를 바닥색으로 뚫는다. */}
          <Rect x={PAD} y={PAD} width={toPx(room.widthM)} height={toPx(room.depthM)}
            stroke="#3A332B" strokeWidth={wallT} listening={false} />

          {/* 빈 상태 — 그리드만 있으면 허전하니 도면 라벨처럼 안내를 얹는다(가구가 생기면 사라짐) */}
          {items.length === 0 && (
            <Group listening={false}>
              <Text x={PAD + toPx(hintPos.cx) - 110} y={PAD + toPx(hintPos.cy) - 16} width={220}
                text="가구를 담아 배치해 보세요" fontSize={13} fontStyle="bold" fill="#A8957F" align="center" />
              <Text x={PAD + toPx(hintPos.cx) - 110} y={PAD + toPx(hintPos.cy) + 4} width={220}
                text={`${room.widthM.toFixed(1)} × ${room.depthM.toFixed(1)} m`} fontSize={11} fill="#C0B3A2" align="center" />
            </Group>
          )}

          {/* 컷아웃(부속실) — 도면 표기법으로: 욕실 타일, 주방 카운터, 현관/보일러실 해칭 + 라벨 칩.
              void(세대 밖)는 마지막에 그려 '바깥'으로 비우고 외곽 벽띠가 L자를 따라가게 한다. */}
          {[...(room.cutouts || [])].sort((a, b) => (a.kind === 'void') - (b.kind === 'void')).map((c, i) => {
            const kind = c.kind || 'bath';
            if (kind === 'void') {
              const zx = PAD + toPx(c.x), zy = PAD + toPx(c.y), zw = toPx(c.w), zh = toPx(c.d);
              const RX = PAD + toPx(room.widthM), BY = PAD + toPx(room.depthM);
              const touch = { l: zx - PAD < 2, t: zy - PAD < 2, r: RX - (zx + zw) < 2, b: BY - (zy + zh) < 2 };
              const o = wallT / 2 + 2, E = wallT / 2;      // o=바깥 밴드까지 지우는 여유, E=모서리 맞물림
              return (
                <Group key={`cut${i}`} listening={false}>
                  {/* 세대 밖 = 배경으로 비움(맞닿은 외벽 밴드까지) → 실루엣이 진짜 L자가 된다 */}
                  <Rect x={zx - (touch.l ? o : 0)} y={zy - (touch.t ? o : 0)}
                    width={zw + (touch.l ? o : 0) + (touch.r ? o : 0)}
                    height={zh + (touch.t ? o : 0) + (touch.b ? o : 0)} fill="#FFFFFF" />
                  {/* 방을 향한 면에만 외벽과 같은 벽띠 */}
                  {!touch.t && <Line points={[zx - E, zy, zx + zw + E, zy]} stroke="#3A332B" strokeWidth={wallT} />}
                  {!touch.b && <Line points={[zx - E, zy + zh, zx + zw + E, zy + zh]} stroke="#3A332B" strokeWidth={wallT} />}
                  {!touch.l && <Line points={[zx, zy - E, zx, zy + zh + E]} stroke="#3A332B" strokeWidth={wallT} />}
                  {!touch.r && <Line points={[zx + zw, zy - E, zx + zw, zy + zh + E]} stroke="#3A332B" strokeWidth={wallT} />}
                </Group>
              );
            }
            const label = c.label || CUT_LABEL[kind] || '';
            const zx = PAD + toPx(c.x), zy = PAD + toPx(c.y), zw = toPx(c.w), zh = toPx(c.d);
            const chipW = label.length * 12 + 18, chipH = 21;
            const chip = label && zw > chipW + 8 && zh > chipH + 6;   // 칩이 들어갈 때만
            const tiny = !chip && label && zw > 34 && zh > 16;        // 좁으면 글자만
            return (
              <Group key={`cut${i}`} listening={false}>
                <Shape sceneFunc={(ctx) => drawZone(ctx, kind, zx, zy, zw, zh, ppm, !!planImg, chip ? chipW / 2 : 0)} />
                {chip && (
                  <Group>
                    <Rect x={zx + zw / 2 - chipW / 2} y={zy + zh / 2 - chipH / 2} width={chipW} height={chipH}
                      fill="rgba(253,252,249,0.95)" stroke="#D8CDBE" strokeWidth={1} cornerRadius={10} />
                    <Text x={zx} y={zy + zh / 2 - 5.5} width={zw} text={label}
                      fontSize={11} fontStyle="bold" fill="#5A4F42" align="center" />
                  </Group>
                )}
                {tiny && (
                  <Text x={zx} y={zy + zh / 2 - 6} width={zw} text={label}
                    fontSize={11} fontStyle="bold" fill="#54493d" align="center" />
                )}
              </Group>
            );
          })}

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
                  {/* 벽체 개구부(바닥색으로 뚫기) + 도면식 스윙 호 — 상시 경고색 대신 웜 뉴트럴,
                      침범하면 가구 쪽이 빨갛게 물들므로 신호는 유지된다 */}
                  <Line points={[e1[0], e1[1], e2[0], e2[1]]} stroke="#FBF6EF" strokeWidth={wallT + 2} />
                  <Shape sceneFunc={(ctx, sh) => { ctx.beginPath(); ctx.moveTo(hx, hy); ctx.arc(hx, hy, Rp, a1, a2, acw); ctx.closePath(); ctx.fillStrokeShape(sh); }}
                    fill="rgba(190,160,138,0.14)" stroke="#B5A79A" strokeWidth={1.1} dash={[4, 3]} />
                  <Line points={[hx, hy, leaf[0], leaf[1]]} stroke="#835151" strokeWidth={2.2} lineCap="round" />
                </Group>
              );
            }
            // 창 — 도면의 3선 유리 심볼(벽 밴드 위)
            const off = Math.max(2.6, wallT * 0.3);
            const n = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[o.wall];
            return (
              <Group key={o.id} listening={false}>
                <Line points={[e1[0], e1[1], e2[0], e2[1]]} stroke="#FBF6EF" strokeWidth={wallT + 2} />
                {[-off, 0, off].map((k) => (
                  <Line key={k} points={[e1[0] + n[0] * k, e1[1] + n[1] * k, e2[0] + n[0] * k, e2[1] + n[1] * k]}
                    stroke="#7FA8C9" strokeWidth={1.4} />
                ))}
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
                onDragStart={() => setDraggingId(it.id)}
                onDragEnd={() => setDraggingId(null)}
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
                  opacity={hasCut(it) ? 0.28 : 0.9}   /* 누끼가 있으면 타일은 옅은 발자국만 — 사진이 주인공 */
                  stroke={stroke}
                  strokeWidth={selectedId === it.id ? 3 : 2}
                  cornerRadius={3}
                />
                {(() => {
                  // ABO 로컬 상품은 배경 제거본(.cut.png)을 우선 — 3D 에셋처럼 형태만 뜬다.
                  // (외부 네이버 썸네일은 원본 그대로 — 사전 처리 대상이 아님)
                  const im = (hasCut(it) && getImg(cutSrc(it))) || getImg(it.image);
                  if (!im) return null;
                  const asp = im.naturalWidth / im.naturalHeight || 1;
                  const fillK = hasCut(it) ? 0.92 : 0.74;   // 누끼는 여백 없이 크게
                  let iw = w * fillK, ih = iw / asp;
                  const maxh = h * fillK;
                  if (ih > maxh) { ih = maxh; iw = ih * asp; }
                  return <KImage image={im} width={iw} height={ih} offsetX={iw / 2} offsetY={ih / 2} listening={false} />;
                })()}
                {/* 치수 신뢰도 점 (좌상단) */}
                <Circle x={-w / 2 + 6} y={-h / 2 + 6} radius={4} fill={accuracyMeta(it.dimAccuracy).hex} listening={false} />
                {(() => {
                  // 이름+치수 배지 — 사각형 바깥 좌상단(공간 없으면 안쪽 상단 폴백, labelPlacements에서 계산).
                  // 그룹째 드래그되므로 라벨도 가구를 자동으로 따라간다. 장식 요소라 클릭은 사각형이 받는다.
                  const lp = labelPlacements[idx];
                  if (!lp) return null;
                  return (
                    <Group x={lp.x} y={lp.y} listening={false}>
                      {/* 색은 종류가 아니라 '상태'를 말한다 — 집고 있는 동안만 초록(선택 테두리와 같은 계열) */}
                      <Rect width={lp.w} height={lp.h} cornerRadius={6}
                        fill={draggingId === it.id ? '#3f6a3a' : '#4A4038'} />
                      <Text text={lp.text} width={lp.w} height={lp.h} fontSize={lp.fontSize}
                        align="center" verticalAlign="middle" fontStyle="700" fill="#fff" wrap="none" />
                    </Group>
                  );
                })()}
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
