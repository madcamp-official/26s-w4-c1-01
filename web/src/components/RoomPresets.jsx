import { doorSwing } from '../lib/geometry.js';

// 데모용 원룸 프리셋 — 평수별 실측 방(가로×세로 m) + 문/창 위치(2D: top/bottom/left/right, pos·width m).
// 고르면 방+개구부가 즉시 세팅되고 엔진이 배치 가능/불가를 바로 계산한다(외부 평면도 이미지 불필요).
export const ROOM_PRESETS = [
  { name: '4평 미니 원룸', widthM: 2.7, depthM: 4.9, openings: [
    { kind: 'door', wall: 'bottom', pos: 0.7, width: 0.9, hinge: 'a' },
    { kind: 'window', wall: 'top', pos: 1.35, width: 1.2 }] },
  { name: '5평 원룸', widthM: 3.0, depthM: 5.4, openings: [
    { kind: 'door', wall: 'bottom', pos: 0.8, width: 0.9, hinge: 'a' },
    { kind: 'window', wall: 'right', pos: 2.6, width: 1.4 }] },
  { name: '6평 원룸', widthM: 3.4, depthM: 5.8, openings: [
    { kind: 'door', wall: 'bottom', pos: 0.9, width: 0.9, hinge: 'a' },
    { kind: 'window', wall: 'left', pos: 3.0, width: 1.6 }] },
  { name: '6평 정사각', widthM: 4.5, depthM: 4.5, openings: [
    { kind: 'door', wall: 'bottom', pos: 0.9, width: 0.9, hinge: 'b' },
    { kind: 'window', wall: 'top', pos: 2.25, width: 1.8 }] },
  { name: '7평 원룸', widthM: 3.5, depthM: 6.6, openings: [
    { kind: 'door', wall: 'top', pos: 0.8, width: 0.9, hinge: 'b' },
    { kind: 'window', wall: 'right', pos: 3.6, width: 1.6 }] },
  { name: '8평 넓은 원룸', widthM: 4.0, depthM: 6.6, openings: [
    { kind: 'door', wall: 'bottom', pos: 1.0, width: 0.95, hinge: 'a' },
    { kind: 'window', wall: 'right', pos: 3.2, width: 1.8 },
    { kind: 'window', wall: 'top', pos: 2.0, width: 1.5 }] },
];

// 방 데이터로 그린 미니 평면도(SVG) — 문=빨강 스윙 부채꼴, 창=파랑 선.
function MiniPlan({ widthM: W, depthM: D, openings = [] }) {
  const BW = 152, BH = 112, pad = 10;
  const ppm = Math.min((BW - 2 * pad) / W, (BH - 2 * pad) / D);
  const w = W * ppm, h = D * ppm, ox = (BW - w) / 2, oy = (BH - h) / 2;
  const P = (mx, my) => [ox + mx * ppm, oy + my * ppm];
  const els = [];
  openings.forEach((o, i) => {
    const wd = o.width || (o.kind === 'door' ? 0.9 : 1.2);
    const a = o.pos - wd / 2, b = o.pos + wd / 2;
    const ends = { top: [[a, 0], [b, 0]], bottom: [[a, D], [b, D]], left: [[0, a], [0, b]], right: [[W, a], [W, b]] }[o.wall];
    const [e1, e2] = ends.map(([x, y]) => P(x, y));
    if (o.kind === 'door') {
      const { hinge, R } = doorSwing({ ...o, pos: o.pos, width: wd }, W, D);
      const [hx, hy] = P(hinge.x, hinge.y); const Rp = R * ppm;
      const into = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[o.wall];
      const vert = o.wall === 'left' || o.wall === 'right';
      const hb = o.hinge === 'b';
      const along = vert ? [0, hb ? -1 : 1] : [hb ? -1 : 1, 0];
      const F = [hx + along[0] * Rp, hy + along[1] * Rp], I = [hx + into[0] * Rp, hy + into[1] * Rp];
      let dl = Math.atan2(into[1], into[0]) - Math.atan2(along[1], along[0]);
      while (dl > Math.PI) dl -= 2 * Math.PI; while (dl < -Math.PI) dl += 2 * Math.PI;
      els.push(<path key={'da' + i} d={`M ${hx} ${hy} L ${F[0]} ${F[1]} A ${Rp} ${Rp} 0 0 ${dl > 0 ? 1 : 0} ${I[0]} ${I[1]} Z`} fill="rgba(204,91,82,0.13)" stroke="#cc5b52" strokeWidth="0.7" />);
      els.push(<line key={'dl' + i} x1={e1[0]} y1={e1[1]} x2={e2[0]} y2={e2[1]} stroke="#cc5b52" strokeWidth="2.6" />);
    } else {
      const n = { top: [0, 3], bottom: [0, -3], left: [3, 0], right: [-3, 0] }[o.wall];
      els.push(<line key={'w' + i} x1={e1[0]} y1={e1[1]} x2={e2[0]} y2={e2[1]} stroke="#3b7fb5" strokeWidth="3" />);
      els.push(<line key={'wi' + i} x1={e1[0] + n[0]} y1={e1[1] + n[1]} x2={e2[0] + n[0]} y2={e2[1] + n[1]} stroke="#7db8e0" strokeWidth="1.3" />);
    }
  });
  return (
    <svg width={BW} height={BH} className="miniplan" viewBox={`0 0 ${BW} ${BH}`}>
      <rect x={ox} y={oy} width={w} height={h} fill="#faf7f1" stroke="#cfc7b8" strokeWidth="1.2" rx="1.5" />
      {els}
    </svg>
  );
}

export default function RoomPresets({ onPick }) {
  return (
    <div className="presets card">
      <h3 style={{ marginTop: 0 }}>빠른 시작 — 데모 방 고르기</h3>
      <p className="mockup-note">평수별 원룸(문·창 포함)을 고르면 바로 배치·검증돼요. 직접 입력은 아래에서.</p>
      <div className="preset-grid">
        {ROOM_PRESETS.map((p) => (
          <button key={p.name} className="preset-card" onClick={() => onPick(p)} title="이 방으로 시작">
            <MiniPlan widthM={p.widthM} depthM={p.depthM} openings={p.openings} />
            <div className="preset-meta">
              <b>{p.name}</b>
              <span>{p.widthM}×{p.depthM}m · {Math.round(p.widthM * p.depthM * 10) / 10}㎡</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
