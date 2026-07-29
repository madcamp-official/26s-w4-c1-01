// 문·창문 편집기 — 카드 캐러셀. 여러 개를 추가해도 한 번에 1개만 크게 보여줘 슬라이더·입력이 커지고 명확해짐.
// 좌우 화살표/점으로 항목 전환. 문: 90° 스윙 부채꼴(접근 불가) · 창문: 벽 표시(채광·렌더용, 배치 제약 없음). 좌표는 m, 벽 따라 중심 pos.
import { useEffect, useRef, useState } from 'react';
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
  const [expanded, setExpanded] = useState(true);
  const [wallOpen, setWallOpen] = useState(false);   // 벽 선택 커스텀 드롭다운(네이티브 select는 스타일을 못 입혀서 자체 구현)
  const [wallMenuPos, setWallMenuPos] = useState(null);   // {top,right}px — fixed 좌표(부모가 overflow여도 안 잘리게)
  const wallBtnRef = useRef(null);

  // 항목이 추가/삭제돼 개수가 바뀌면 범위 밖으로 나가지 않게 보정.
  useEffect(() => {
    setIdx((i) => (openings.length === 0 ? 0 : Math.min(i, openings.length - 1)));
  }, [openings.length]);
  useEffect(() => setWallOpen(false), [idx]);   // 카드 넘기면 열려있던 드롭다운 닫기

  function toggleWallMenu() {
    if (wallOpen) { setWallOpen(false); return; }
    const rect = wallBtnRef.current.getBoundingClientRect();
    setWallMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    setWallOpen(true);
  }

  const add = (kind) => {
    const wall = kind === 'door' ? 'bottom' : 'top';
    const width = kind === 'door' ? 0.9 : 1.2;
    const o = { id: uid(), kind, wall, width, pos: clampPos(wallLenOf(room, wall) / 2, room, wall, width) };
    if (kind === 'door') o.hinge = 'a';
    setOpenings((prev) => [...prev, o]);
    setIdx(openings.length);   // 새로 추가한 카드로 바로 이동
    setExpanded(true);         // 접혀있었어도 방금 추가한 카드가 바로 보이게
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
  const doorCount = openings.filter((o) => o.kind === 'door').length;
  const windowCount = openings.filter((o) => o.kind === 'window').length;

  return (
    <div className="openbar">
      <div className="openbar-head">
        {cur && (
          <button className="openbar-toggle" onClick={() => setExpanded((v) => !v)} title={expanded ? '접기' : '펼치기'}>
            <span className={expanded ? 'ic-down' : 'ic-right'}>{expanded ? '⌄' : '›'}</span>
          </button>
        )}
        <span className="openbar-title">문·창문</span>
        {(!cur || expanded) && <span className="openbar-hint">문=90° 스윙(접근 불가) · 창=가리면 안 됨</span>}
        {openings.length > 0 && <span className="openbar-count">{idx + 1} / {openings.length}</span>}
      </div>

      {!cur ? (
        <p className="mockup-note" style={{ margin: '6px 2px 0' }}>문·창문을 추가하면 평면도에 표시되고, 자동 배치가 그 앞을 비워 둬요.</p>
      ) : !expanded ? (
        <p className="mockup-note openbar-summary" style={{ margin: '6px 2px 0' }} onClick={() => setExpanded(true)}>
          문 {doorCount}개 · 창문 {windowCount}개 접혀 있어요 — 펼쳐서 위치/폭을 조절해줘
        </p>
      ) : (
        <>
          <div className="opencard">
            <div className="opencard-top">
              <span className={'op-badge ' + cur.kind}>{kindLabel} {kindNo}</span>
              <button className="opencard-del" title="삭제" onClick={() => remove(cur.id)}>×</button>
            </div>

            <div className="opencard-row wall-select">
              <span className="opencard-lbl">벽</span>
              <button ref={wallBtnRef} type="button" className="wall-select-btn" onClick={toggleWallMenu}>
                {WALLS.find(([v]) => v === cur.wall)?.[1]}벽 <span className={`wall-select-arrow ${wallOpen ? 'up' : ''}`}>⌄</span>
              </button>
              {wallOpen && wallMenuPos && (
                <>
                  <div className="wall-select-backdrop" onClick={() => setWallOpen(false)} />
                  <div className="wall-select-menu" style={{ position: 'fixed', top: wallMenuPos.top, right: wallMenuPos.right }}>
                    {WALLS.map(([v, l]) => (
                      <button key={v} type="button" className={`wall-select-opt ${cur.wall === v ? 'on' : ''}`}
                        onClick={() => { update(cur.id, { wall: v }); setWallOpen(false); }}>{l}벽</button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="opencard-row op-slide">
              <span className="opencard-lbl">위치</span>
              <input type="range" min={Math.round(cur.width * 50)} max={Math.round((wallLenOf(room, cur.wall) - cur.width / 2) * 100)}
                value={Math.round(cur.pos * 100)} onChange={(e) => update(cur.id, { pos: Number(e.target.value) / 100 })} />
              <span className="op-num">{Math.round(cur.pos * 100)}cm</span>
            </div>

            <div className="opencard-row op-width">
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
