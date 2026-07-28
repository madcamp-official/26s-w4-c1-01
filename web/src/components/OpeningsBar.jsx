// 문·창문 편집기 — 2D 평면에 표시할 개구부를 추가/조정.
// 문: 90° 스윙 부채꼴(접근 불가) · 창문: 벽 표시(채광·렌더용, 배치 제약 없음). 좌표는 m, 벽 따라 중심 pos.
import { openingOnCutout } from '../lib/geometry.js';

const WALLS = [['top', '위'], ['bottom', '아래'], ['left', '왼쪽'], ['right', '오른쪽']];

const uid = () => `op-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const wallLenOf = (room, wall) => (wall === 'left' || wall === 'right' ? room.depthM : room.widthM);
const clampPos = (pos, room, wall, width) => {
  const L = wallLenOf(room, wall);
  return Math.min(Math.max(pos, width / 2), Math.max(width / 2, L - width / 2));
};

export default function OpeningsBar({ room, openings, setOpenings }) {
  const add = (kind) => {
    const wall = kind === 'door' ? 'bottom' : 'top';
    const width = kind === 'door' ? 0.9 : 1.2;
    const o = { id: uid(), kind, wall, width, pos: clampPos(wallLenOf(room, wall) / 2, room, wall, width) };
    if (kind === 'door') o.hinge = 'a';
    setOpenings((prev) => [...prev, o]);
  };
  const update = (id, patch) => setOpenings((prev) => prev.map((o) => {
    if (o.id !== id) return o;
    const next = { ...o, ...patch };
    next.pos = clampPos(next.pos, room, next.wall, next.width);   // 벽/폭 바뀌면 위치 재클램프
    // 컷아웃이 잠식한 벽 구간(그 자리는 벽이 아님)에 놓이면 이전 값 유지
    if (openingOnCutout(next, room.widthM, room.depthM, room.cutouts)) return o;
    return next;
  }));
  const remove = (id) => setOpenings((prev) => prev.filter((o) => o.id !== id));

  return (
    <div className="openbar">
      <div className="openbar-head">
        <span className="openbar-title">문·창문</span>
        <span className="openbar-hint">문=90° 스윙(접근 불가) · 창=가리면 안 됨</span>
        <div className="openbar-add">
          <button className="btn ghost sm" onClick={() => add('door')}>＋ 문</button>
          <button className="btn ghost sm" onClick={() => add('window')}>＋ 창문</button>
        </div>
      </div>
      {openings.length === 0 ? (
        <p className="mockup-note" style={{ margin: '6px 2px 0' }}>문·창문을 추가하면 평면도에 표시되고, 자동 배치가 그 앞을 비워 둬요.</p>
      ) : (
        <ul className="openlist">
          {openings.map((o) => {
            const L = wallLenOf(room, o.wall);
            return (
              <li key={o.id} className="openrow">
                <span className={'op-badge ' + o.kind}>{o.kind === 'door' ? '🚪 문' : '🪟 창'}</span>
                <select value={o.wall} onChange={(e) => update(o.id, { wall: e.target.value })} title="벽">
                  {WALLS.map(([v, l]) => <option key={v} value={v}>{l}벽</option>)}
                </select>
                <label className="op-field">위치
                  <input type="range" min={Math.round(o.width * 50)} max={Math.round((L - o.width / 2) * 100)}
                    value={Math.round(o.pos * 100)} onChange={(e) => update(o.id, { pos: Number(e.target.value) / 100 })} />
                  <span className="op-num">{Math.round(o.pos * 100)}㎝</span>
                </label>
                <label className="op-field">폭
                  <input type="number" min={40} max={Math.round(L * 100)} step={5}
                    value={Math.round(o.width * 100)} onChange={(e) => update(o.id, { width: Math.max(0.4, Number(e.target.value) / 100) })} />
                  <span className="op-num">㎝</span>
                </label>
                {o.kind === 'door' && (
                  <button className="btn ghost sm" title="경첩(스윙) 방향 바꾸기"
                    onClick={() => update(o.id, { hinge: o.hinge === 'a' ? 'b' : 'a' })}>경첩 {o.hinge === 'a' ? '◐' : '◑'}</button>
                )}
                <button className="btn ghost sm op-del" title="삭제" onClick={() => remove(o.id)}>×</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
