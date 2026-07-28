// 문·창문 편집기 — 카드 캐러셀. 여러 개를 추가해도 한 번에 1개만 크게 보여줘 슬라이더·입력이 커지고 명확해짐.
// 좌우 화살표/점으로 항목 전환. 문: 90° 스윙 부채꼴(접근 불가) · 창문: 벽 표시(채광·렌더용, 배치 제약 없음). 좌표는 m, 벽 따라 중심 pos.
import { useEffect, useState } from 'react';
import { openingOnCutout } from '../lib/geometry.js';

const WALLS = [['top', '위'], ['bottom', '아래'], ['left', '왼쪽'], ['right', '오른쪽']];

const uid = () => `op-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const wallLenOf = (room, wall) => (wall === 'left' || wall === 'right' ? room.depthM : room.widthM);
const clampPos = (pos, room, wall, width) => {
  const L = wallLenOf(room, wall);
  return Math.min(Math.max(pos, width / 2), Math.max(width / 2, L - width / 2));
};

export default function OpeningsBar({ room, openings, setOpenings }) {
  const [idx, setIdx] = useState(0);

  // 항목이 추가/삭제돼 개수가 바뀌면 범위 밖으로 나가지 않게 보정.
  useEffect(() => {
    setIdx((i) => (openings.length === 0 ? 0 : Math.min(i, openings.length - 1)));
  }, [openings.length]);

  const add = (kind) => {
    const wall = kind === 'door' ? 'bottom' : 'top';
    const width = kind === 'door' ? 0.9 : 1.2;
    const o = { id: uid(), kind, wall, width, pos: clampPos(wallLenOf(room, wall) / 2, room, wall, width) };
    if (kind === 'door') o.hinge = 'a';
    setOpenings((prev) => [...prev, o]);
    setIdx(openings.length);   // 새로 추가한 카드로 바로 이동
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

  const cur = openings[idx];
  const kindLabel = cur ? (cur.kind === 'door' ? '🚪 문' : '🪟 창') : '';
  const kindNo = cur ? openings.slice(0, idx + 1).filter((o) => o.kind === cur.kind).length : 0;

  return (
    <div className="openbar">
      <div className="openbar-head">
        <span className="openbar-title">문·창문</span>
        <span className="openbar-hint">문=90° 스윙(접근 불가) · 창=가리면 안 됨</span>
        {openings.length > 0 && <span className="openbar-count">{idx + 1} / {openings.length}</span>}
      </div>

      {!cur ? (
        <p className="mockup-note" style={{ margin: '6px 2px 0' }}>문·창문을 추가하면 평면도에 표시되고, 자동 배치가 그 앞을 비워 둬요.</p>
      ) : (
        <>
          <div className="opencard">
            <div className="opencard-top">
              <span className={'op-badge ' + cur.kind}>{kindLabel} {kindNo}</span>
              <button className="opencard-del" title="삭제" onClick={() => remove(cur.id)}>×</button>
            </div>

            <label className="opencard-row">
              <span className="opencard-lbl">벽</span>
              <select value={cur.wall} onChange={(e) => update(cur.id, { wall: e.target.value })}>
                {WALLS.map(([v, l]) => <option key={v} value={v}>{l}벽</option>)}
              </select>
            </label>

            <div className="opencard-row op-slide">
              <span className="opencard-lbl">위치</span>
              <input type="range" min={Math.round(cur.width * 50)} max={Math.round((wallLenOf(room, cur.wall) - cur.width / 2) * 100)}
                value={Math.round(cur.pos * 100)} onChange={(e) => update(cur.id, { pos: Number(e.target.value) / 100 })} />
              <span className="op-num">{Math.round(cur.pos * 100)}cm</span>
              <span className="opencard-lbl">폭</span>
              <input type="number" min={40} max={Math.round(wallLenOf(room, cur.wall) * 100)} step={5}
                value={Math.round(cur.width * 100)} onChange={(e) => update(cur.id, { width: Math.max(0.4, Number(e.target.value) / 100) })} />
              <span className="op-num">cm</span>
            </div>

            {cur.kind === 'door' && (
              <button className="opencard-hinge" title="경첩(스윙) 방향 바꾸기"
                onClick={() => update(cur.id, { hinge: cur.hinge === 'a' ? 'b' : 'a' })}>경첩 {cur.hinge === 'a' ? '◐' : '◑'}</button>
            )}
          </div>

          {openings.length > 1 && (
            <div className="opencard-nav">
              <button disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹</button>
              <div className="opencard-dots">
                {openings.map((_, i) => <span key={i} className={i === idx ? 'on' : ''} />)}
              </div>
              <button disabled={idx === openings.length - 1} onClick={() => setIdx((i) => Math.min(openings.length - 1, i + 1))}>›</button>
            </div>
          )}
        </>
      )}

      <div className="opencard-add">
        <button className="btn primary" onClick={() => add('door')}>＋ 문 추가</button>
        <button className="btn ghost" onClick={() => add('window')}>＋ 창문 추가</button>
      </div>
    </div>
  );
}
