// 자동 배치 후보 선택 — 겹침 없는 배치 N가지를 미니 탑다운으로 보여주고 고르게 한다.
import { effectiveFootprint } from '../lib/geometry.js';

const CATCOLOR = {
  침대: '#b8a58a', 소파: '#8fa3b0', 테이블: '#c9bfa8', 협탁: '#c9bfa8',
  책상: '#c9b79a', 의자: '#b0a68c', 수납: '#d0c3a8', 조명: '#cfc4ad', 러그: '#e3d9c8',
};

function Mini({ room, items, width = 188 }) {
  const scale = width / room.widthM;
  const height = room.depthM * scale;
  const rugs = items.filter((it) => it.cat === '러그');
  const solids = items.filter((it) => it.cat !== '러그');
  const draw = (it, i) => {
    const { w, d } = effectiveFootprint(it.wM, it.dM, it.rotationDeg || 0);
    const isRug = it.cat === '러그';
    return (
      <rect key={it.id || i}
        x={(it.cx - w / 2) * scale} y={(it.cy - d / 2) * scale}
        width={w * scale} height={d * scale}
        fill={CATCOLOR[it.cat] || '#c3b79c'} opacity={isRug ? 0.5 : 0.92}
        stroke="rgba(0,0,0,.18)" strokeWidth={isRug ? 0 : 1} rx={2} />
    );
  };
  return (
    <svg width={width} height={height} className="minimap">
      <rect x={0} y={0} width={width} height={height} fill="#f3efe7" />
      {rugs.map(draw)}
      {solids.map(draw)}
    </svg>
  );
}

export default function LayoutPicker({ room, options, onSelect, onClose }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>배치 선택</h2>
        <p className="mockup-note">가구가 <b>겹치지 않는</b> 배치 {options.length}가지예요. 마음에 드는 걸 고르세요.</p>
        <div className="layoutgrid">
          {options.map((opt, i) => (
            <button key={i} className="layoutcard" onClick={() => onSelect(opt.items)}>
              <Mini room={room} items={opt.items} />
              <div className="layoutmeta">
                <span className="badge ok">{opt.strategy ? `${i + 1}. ${opt.strategy}` : `배치 ${i + 1}`}</span>
                <span className="chip">벽 밀착 {Math.round(opt.wallRatio * 100)}%</span>
              </div>
              {opt.rationale && <p className="layoutwhy">{opt.rationale}</p>}
            </button>
          ))}
        </div>
        <div className="selbar" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
