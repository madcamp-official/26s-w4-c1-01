// 건축 도면 스타일 SVG 생성 — FLOORPLANS 항목 하나를 실제 부동산 도면 느낌으로 그린다.
// 순수 문자열 생성(React 무관)이라 노드에서도 실행 가능(검증/썸네일 추출용).
// 요소: 이중선 벽, 문 개구부+스윙 호, 창 3선 심볼, 욕실(타일·변기·세면대), 주방 카운터(싱크·쿡탑),
//       현관(해칭+신발장), 발코니, 치수선(mm). 색은 앱 팔레트와 어울리는 저채도 웜톤.

const C = {
  paper: '#FDFCF9', wall: '#2E2A26', room: '#FBF6EF', corridor: '#F3EEE6',
  bath: '#EAF1F3', bathLine: '#C7D6DC', balcony: '#EFF3EC', counter: '#E6E0D6',
  fixture: '#FFFFFF', fixtureLine: '#A9A29A', dim: '#A8A095', dimText: '#7A7268',
  label: '#8A7A6C', arc: '#B5A79A', glass: '#7FA8C9',
};
const T = 0.15;    // 외벽 두께(m)
const T2 = 0.09;   // 내부 칸막이 두께(m)
const EPS_M = 0.01;

export function floorplanSvg(plan, targetW = 360) {
  const W = plan.widthM, D = plan.depthM;
  const AN = plan.annex, BAL = plan.balcony;
  const balD = BAL ? BAL.d : 0;
  const totW = W + T * 2, totH = balD + (BAL ? T : 0) + D + AN.d + T * 2;
  const padL = 0.72, padR = 0.3, padT = 0.28, padB = 0.72;   // 치수선 여백(m)
  const S = targetW / (totW + padL + padR);                   // px per m
  const H = Math.round((totH + padT + padB) * S);
  const ox = (padL + T) * S, oy = (padT + T + balD + (BAL ? T : 0)) * S;  // 방(0,0)의 캔버스 좌표
  const X = (m) => ox + m * S, Y = (m) => oy + m * S;         // 방 좌표계 → px
  const px = (m) => m * S;
  const el = [];
  const rect = (x, y, w, h, fill, extra = '') => el.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}" ${extra}/>`);
  const line = (x1, y1, x2, y2, stroke, sw, extra = '') => el.push(`<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${r(sw)}" ${extra}/>`);
  const text = (x, y, s, size, fill, extra = '') => el.push(`<text x="${r(x)}" y="${r(y)}" font-size="${r(size)}" fill="${fill}" font-family="Pretendard, sans-serif" ${extra}>${s}</text>`);
  const r = (v) => Math.round(v * 10) / 10;

  // ── 바닥(구역별) ──
  if (BAL) rect(X(0), Y(-balD - T) + px(T), px(W), px(balD), C.balcony);
  rect(X(0), Y(0), px(W), px(D), C.room);
  rect(X(0), Y(D), px(W), px(AN.d), C.corridor);

  // ── 외벽(이중선 = 두꺼운 스트로크) ──
  const wx = X(0) - px(T) / 2, wy = Y(BAL ? -balD - T : 0) - px(T) / 2;
  const wallH = px((BAL ? balD + T : 0) + D + AN.d) + px(T);
  el.push(`<rect x="${r(wx)}" y="${r(wy)}" width="${r(px(W) + px(T))}" height="${r(wallH)}" fill="none" stroke="${C.wall}" stroke-width="${r(px(T))}"/>`);
  // 방/발코니 경계벽 + 방/복도 경계벽
  if (BAL) line(X(0) - px(T), Y(0) - px(T) / 2, X(W) + px(T), Y(0) - px(T) / 2, C.wall, px(T));
  line(X(0), Y(D) + px(T2) / 2, X(W), Y(D) + px(T2) / 2, C.wall, px(T2));

  // ── 욕실 렌더(타일+변기+세면대) — annex 욕실과 컷아웃 욕실이 공유 ──
  const drawBathBox = (bx, by, bw, bh) => {
    rect(bx, by, bw, bh, C.bath);
    const step = px(0.36);
    for (let gx = bx + step; gx < bx + bw; gx += step) line(gx, by, gx, by + bh, C.bathLine, 0.6);
    for (let gy = by + step; gy < by + bh; gy += step) line(bx, gy, bx + bw, gy, C.bathLine, 0.6);
    const tx = bx + bw - px(0.42), ty = by + px(0.16);
    el.push(`<rect x="${r(tx)}" y="${r(ty)}" width="${r(px(0.34))}" height="${r(px(0.14))}" rx="2" fill="${C.fixture}" stroke="${C.fixtureLine}" stroke-width="1"/>`);
    el.push(`<ellipse cx="${r(tx + px(0.17))}" cy="${r(ty + px(0.36))}" rx="${r(px(0.14))}" ry="${r(px(0.18))}" fill="${C.fixture}" stroke="${C.fixtureLine}" stroke-width="1"/>`);
    el.push(`<ellipse cx="${r(bx + px(0.3))}" cy="${r(by + px(0.3))}" rx="${r(px(0.19))}" ry="${r(px(0.14))}" fill="${C.fixture}" stroke="${C.fixtureLine}" stroke-width="1"/>`);
  };

  // ── 욕실(복도 구역 안 — annex.bath 있는 도면) ──
  const b = AN.bath;
  let bx, by, bw, bh;
  if (b) {
    bx = X(b.x); by = Y(D) + px(T2); bw = px(b.w); bh = px(AN.d) - px(T2);
    drawBathBox(bx, by, bw, bh);
    // 칸막이 벽(좌우)
    line(bx - px(T2) / 2, by, bx - px(T2) / 2, by + bh, C.wall, px(T2));
    line(bx + bw + px(T2) / 2, by, bx + bw + px(T2) / 2, by + bh, C.wall, px(T2));
  }
  // 욕실 문(복도를 향한 쪽 칸막이에 개구부+호)
  const doorPos = plan.openings.find((o) => o.kind === 'door');
  if (b) {
    const bathDoorLeft = doorPos && doorPos.pos < b.x;           // 현관이 왼쪽이면 왼쪽 칸막이에 문
    const bdx = bathDoorLeft ? bx - px(T2) / 2 : bx + bw + px(T2) / 2;
    const bdy = by + bh / 2 - px(0.3);
    line(bdx, bdy, bdx, bdy + px(0.6), C.paper, px(T2) + 1.2);   // 개구부
    el.push(`<path d="M ${r(bdx)} ${r(bdy + px(0.6))} A ${r(px(0.6))} ${r(px(0.6))} 0 0 ${bathDoorLeft ? 1 : 0} ${r(bdx + (bathDoorLeft ? -px(0.6) : px(0.6)))} ${r(bdy)}" fill="none" stroke="${C.arc}" stroke-width="1" stroke-dasharray="3 2"/>`);
    line(bdx, bdy, bdx + (bathDoorLeft ? -px(0.6) : px(0.6)), bdy, C.fixtureLine, 1.4);
  }

  // ── 컷아웃(비직사각형 방) — 방 안으로 파인 욕실: L자의 본질 ──
  for (const c of plan.cutouts || []) {
    const cx0 = X(c.x), cy0 = Y(c.y), cw = px(c.w), ch = px(c.d);
    drawBathBox(cx0, cy0, cw, ch);
    // 방을 향한 면에 칸막이 벽(바운딩 벽과 공유하는 면은 제외)
    if (c.y > EPS_M) line(cx0 - px(T2) / 2, cy0 - px(T2) / 2, cx0 + cw + px(T2) / 2, cy0 - px(T2) / 2, C.wall, px(T2));  // 윗면
    if (c.x > EPS_M) line(cx0 - px(T2) / 2, cy0 - px(T2), cx0 - px(T2) / 2, cy0 + ch, C.wall, px(T2));                    // 좌면
    if (c.x + c.w < W - EPS_M) line(cx0 + cw + px(T2) / 2, cy0 - px(T2), cx0 + cw + px(T2) / 2, cy0 + ch, C.wall, px(T2)); // 우면
    // 아랫면이 방/복도 경계에 닿으면 그 벽을 통해 복도로 문(개구부+호)
    if (Math.abs((c.y + c.d) - D) < EPS_M) {
      const ddx = cx0 + cw / 2, ddw = px(0.62);
      line(ddx - ddw / 2, Y(D) + px(T2) / 2, ddx + ddw / 2, Y(D) + px(T2) / 2, C.paper, px(T2) + 1.4);
      el.push(`<path d="M ${r(ddx - ddw / 2)} ${r(Y(D) + ddw)} A ${r(ddw)} ${r(ddw)} 0 0 0 ${r(ddx + ddw / 2)} ${r(Y(D))}" fill="none" stroke="${C.arc}" stroke-width="1" stroke-dasharray="3 2"/>`);
      line(ddx - ddw / 2, Y(D), ddx - ddw / 2, Y(D) + ddw, C.fixtureLine, 1.4);
    }
    text(cx0 + cw / 2, cy0 + ch / 2 + 4, '욕실', 9.5, C.label, 'text-anchor="middle" font-weight="700"');
  }

  // ── 주방 카운터(복도 하단 벽면) ──
  const k = AN.kitchen;
  if (k && k.w > 0) {
    const kx = X(k.x), ky = Y(D) + px(T2), kw = px(k.w);
    rect(kx, ky, kw, px(0.6), C.counter, `stroke="${C.fixtureLine}" stroke-width="1"`);
    el.push(`<rect x="${r(kx + px(0.12))}" y="${r(ky + px(0.12))}" width="${r(px(0.42))}" height="${r(px(0.34))}" rx="3" fill="${C.fixture}" stroke="${C.fixtureLine}" stroke-width="1"/>`);
    const c1 = kx + kw - px(0.34), c2 = kx + kw - px(0.7);
    if (k.w >= 1.0) for (const cx of [c1, c2]) el.push(`<circle cx="${r(cx)}" cy="${r(ky + px(0.3))}" r="${r(px(0.11))}" fill="none" stroke="${C.fixtureLine}" stroke-width="1.2"/>`);
  }

  // ── 현관(해칭 + 신발장) + 세대 현관문 ──
  const e = AN.entry;
  const ex = X(e.x), ey = Y(D + AN.d) - px(0.55), ew = px(e.w);
  for (let hx = 0; hx < ew + px(0.55); hx += px(0.16)) {
    const x1 = ex + Math.max(0, hx - px(0.55)), y1 = ey + Math.min(px(0.55), hx);
    const x2 = ex + Math.min(ew, hx), y2 = ey + Math.max(0, hx - ew);
    line(x1, y1, x2, y2, '#D8D0C4', 0.8);
  }
  // 세대 현관문: 하단 외벽 개구부 + 스윙 호(복도 안쪽)
  const edx = ex + ew / 2, edw = px(Math.min(e.w, 0.9));
  line(edx - edw / 2, Y(D + AN.d) + 0, edx + edw / 2, Y(D + AN.d), C.paper, px(T) + 1.4);
  el.push(`<path d="M ${r(edx + edw / 2)} ${r(Y(D + AN.d))} A ${r(edw)} ${r(edw)} 0 0 0 ${r(edx - edw / 2)} ${r(Y(D + AN.d) - edw)}" fill="none" stroke="${C.arc}" stroke-width="1" stroke-dasharray="3 2"/>`);
  line(edx - edw / 2, Y(D + AN.d), edx - edw / 2, Y(D + AN.d) - edw, C.fixtureLine, 1.4);

  // ── 방 문/창 (엔진 openings 그대로) ──
  for (const o of plan.openings) {
    const w = o.width;
    if (o.kind === 'door') {
      // 방↔복도 경계벽의 개구부 + 방 안쪽 스윙 호(엔진 스윙존과 동일 방향)
      const dx1 = X(o.pos - w / 2), dx2 = X(o.pos + w / 2);
      line(dx1, Y(D) + px(T2) / 2, dx2, Y(D) + px(T2) / 2, C.paper, px(T2) + 1.4);
      const hingeX = o.hinge === 'b' ? dx2 : dx1, dir = o.hinge === 'b' ? -1 : 1;
      el.push(`<path d="M ${r(hingeX)} ${r(Y(D) - px(w))} A ${r(px(w))} ${r(px(w))} 0 0 ${o.hinge === 'b' ? 0 : 1} ${r(hingeX + dir * px(w))} ${r(Y(D))}" fill="none" stroke="${C.arc}" stroke-width="1.1" stroke-dasharray="3 2"/>`);
      line(hingeX, Y(D), hingeX, Y(D) - px(w), C.fixtureLine, 1.5);
    } else {
      // 창 3선 심볼(벽 위)
      let x1, y1, x2, y2, horiz = o.wall === 'top' || o.wall === 'bottom';
      if (o.wall === 'top') { x1 = X(o.pos - w / 2); x2 = X(o.pos + w / 2); y1 = y2 = Y(0) - px(T) / 2; }
      else if (o.wall === 'bottom') { x1 = X(o.pos - w / 2); x2 = X(o.pos + w / 2); y1 = y2 = Y(D) + px(T2) / 2; }
      else if (o.wall === 'left') { y1 = Y(o.pos - w / 2); y2 = Y(o.pos + w / 2); x1 = x2 = X(0) - px(T) / 2; }
      else { y1 = Y(o.pos - w / 2); y2 = Y(o.pos + w / 2); x1 = x2 = X(W) + px(T) / 2; }
      line(x1, y1, x2, y2, C.paper, px(T) + 1.2);
      const off = px(T) * 0.28;
      if (horiz) { line(x1, y1 - off, x2, y2 - off, C.glass, 1.2); line(x1, y1, x2, y2, C.glass, 1.2); line(x1, y1 + off, x2, y2 + off, C.glass, 1.2); }
      else { line(x1 - off, y1, x2 - off, y2, C.glass, 1.2); line(x1, y1, x2, y2, C.glass, 1.2); line(x1 + off, y1, x2 + off, y2, C.glass, 1.2); }
    }
  }
  // 발코니 폴딩창(외벽 쪽 넓은 창)
  if (BAL) {
    const x1 = X(W * 0.12), x2 = X(W * 0.88), yb = Y(-balD - T) - px(T) / 2 + px(T);
    line(x1, yb - px(T), x2, yb - px(T), C.paper, px(T) + 1.2);
    for (const off of [-px(T) * 0.28, 0, px(T) * 0.28]) line(x1, yb - px(T) + off, x2, yb - px(T) + off, C.glass, 1.2);
  }

  // ── 라벨 ──
  const roomLabelY = Y(D * 0.46);
  text(X(W / 2), roomLabelY, '방', 12.5, C.label, 'text-anchor="middle" font-weight="700"');
  text(X(W / 2), roomLabelY + 15, `${W.toFixed(1)} × ${D.toFixed(1)}m`, 10, C.dimText, 'text-anchor="middle"');
  if (b) text(bx + bw / 2, by + bh / 2 + 4, '욕실', 9.5, C.label, 'text-anchor="middle" font-weight="700"');
  if (k && k.w > 0) text(X(k.x) + px(k.w) / 2, Y(D) + px(T2) + px(0.6) + 10, '주방', 9, C.label, 'text-anchor="middle" font-weight="700"');
  text(ex + ew / 2, ey + px(0.3), '현관', 9, C.label, 'text-anchor="middle" font-weight="700"');
  if (BAL) text(X(W / 2), Y(-balD / 2 - T) + px(T) + 4, '발코니', 9.5, C.label, 'text-anchor="middle" font-weight="700"');

  // ── 치수선(전폭·전깊이, mm) ──
  const mm = (m) => Math.round(m * 1000).toLocaleString();
  const dyd = Y(D + AN.d) + px(T) + px(0.34);
  dimLine(el, X(0) - px(T), dyd, X(W) + px(T), dyd, mm(totW), S);
  const dxd = X(0) - px(T) - px(0.34);
  dimLineV(el, dxd, Y(BAL ? -balD - T : 0) - px(T), dxd, Y(D + AN.d) + px(T), mm(totH), S);

  return `<svg viewBox="0 0 ${Math.round(targetW)} ${H}" width="${Math.round(targetW)}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${C.paper}"/>${el.join('')}</svg>`;
}

function dimLine(el, x1, y, x2, _y2, label, S) {
  const r = (v) => Math.round(v * 10) / 10;
  el.push(`<line x1="${r(x1)}" y1="${r(y)}" x2="${r(x2)}" y2="${r(y)}" stroke="#A8A095" stroke-width="1"/>`);
  for (const x of [x1, x2]) el.push(`<line x1="${r(x)}" y1="${r(y - 4)}" x2="${r(x)}" y2="${r(y + 4)}" stroke="#A8A095" stroke-width="1"/>`);
  el.push(`<text x="${r((x1 + x2) / 2)}" y="${r(y - 4)}" font-size="9.5" fill="#7A7268" text-anchor="middle" font-family="Pretendard, sans-serif">${label}</text>`);
}
function dimLineV(el, x, y1, _x2, y2, label, S) {
  const r = (v) => Math.round(v * 10) / 10;
  el.push(`<line x1="${r(x)}" y1="${r(y1)}" x2="${r(x)}" y2="${r(y2)}" stroke="#A8A095" stroke-width="1"/>`);
  for (const y of [y1, y2]) el.push(`<line x1="${r(x - 4)}" y1="${r(y)}" x2="${r(x + 4)}" y2="${r(y)}" stroke="#A8A095" stroke-width="1"/>`);
  el.push(`<text x="${r(x - 6)}" y="${r((y1 + y2) / 2)}" font-size="9.5" fill="#7A7268" text-anchor="middle" font-family="Pretendard, sans-serif" transform="rotate(-90 ${r(x - 6)} ${r((y1 + y2) / 2)})">${label}</text>`);
}
