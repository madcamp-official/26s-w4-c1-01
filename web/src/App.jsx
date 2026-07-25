import { useMemo, useState } from 'react';
import RoomForm from './components/RoomForm.jsx';
import CatalogPanel from './components/CatalogPanel.jsx';
import Planner from './components/Planner.jsx';
import Composite from './components/Composite.jsx';
import { toPlacedItem, resolveDims } from './lib/catalog.js';
import { validateLayout, findFreeSpot, snapRotation } from './lib/geometry.js';
import { fetchDims } from './lib/api.js';

export default function App() {
  const [room, setRoom] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showComposite, setShowComposite] = useState(false);
  const [roomPhoto, setRoomPhoto] = useState(null);

  const val = useMemo(
    () => (room ? validateLayout(items, room.widthM, room.depthM) : { flags: [], ok: true, freeArea: 0, freeRatio: 0 }),
    [items, room]
  );

  function addFurniture(cat) {
    // 치수 미상 상품이면 카테고리 표준으로 보정된 치수로 자리 탐색(0×0 방지)
    const d = resolveDims(cat);
    const probe = { wM: d.w / 100, dM: d.d / 100, rotationDeg: 0 };
    const spot = findFreeSpot(probe, items, room.widthM, room.depthM) || { cx: room.widthM / 2, cy: room.depthM / 2 };
    const it = toPlacedItem(cat, spot.cx, spot.cy);
    setItems((p) => [...p, it]);
    setSelectedId(it.id);
  }
  // 선택 가구 치수 직접 입력(cm). 사용자가 실측/스펙을 넣으면 '사용자입력'으로 승격.
  function setSelDim(field, cm) {
    const m = Math.max(Number(cm) || 0, 1) / 100;
    setItems((p) => p.map((it) => (it.id === selectedId ? { ...it, [field]: m, dimAccuracy: '사용자입력' } : it)));
  }
  const [dimBusy, setDimBusy] = useState(false);
  // 상세페이지에서 치수 자동 추출 → 선택 가구에 채움.
  async function autoFillDims() {
    if (!sel?.buyUrl) return;
    setDimBusy(true);
    try {
      const d = await fetchDims(sel.buyUrl);
      if (d && d.w && d.d) {
        setItems((p) => p.map((it) => (it.id === selectedId
          ? { ...it, wM: d.w / 100, dM: d.d / 100, hM: (d.h || it.hM * 100) / 100, dimAccuracy: d.accuracy || '추정(상세)' }
          : it)));
      } else {
        alert('상세페이지에서 치수를 찾지 못했어요. 직접 입력해 주세요.');
      }
    } finally {
      setDimBusy(false);
    }
  }
  function rotateSel() {
    setItems((p) => p.map((it) => (it.id === selectedId ? { ...it, rotationDeg: snapRotation((it.rotationDeg || 0) + 90) } : it)));
  }
  function deleteSel() {
    setItems((p) => p.filter((it) => it.id !== selectedId));
    setSelectedId(null);
  }
  function onPhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setRoomPhoto(r.result);
    r.readAsDataURL(f);
  }

  if (!room) {
    return (
      <div className="app">
        <Topbar />
        <RoomForm onDone={setRoom} />
      </div>
    );
  }

  const sel = items.find((it) => it.id === selectedId);
  return (
    <div className="app">
      <Topbar />
      <div className="workspace">
        <CatalogPanel onAdd={addFurniture} />

        <div className="col">
          <Planner room={room} items={items} setItems={setItems} selectedId={selectedId} setSelectedId={setSelectedId} flags={val.flags} />
          {sel && (
            <div className="selbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              {sel.image && <img className="selthumb" src={sel.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
              <span className="badge est">{sel.name}</span>
              <span className={`badge ${sel.dimAccuracy === '정형' || sel.dimAccuracy === '사용자입력' ? 'ok' : 'warn'}`}>
                {sel.dimAccuracy}
              </span>
              <span className="dimedit">
                가로<input type="number" value={Math.round(sel.wM * 100)} onChange={(e) => setSelDim('wM', e.target.value)} />
                세로<input type="number" value={Math.round(sel.dM * 100)} onChange={(e) => setSelDim('dM', e.target.value)} />
                높이<input type="number" value={Math.round(sel.hM * 100)} onChange={(e) => setSelDim('hM', e.target.value)} />cm
              </span>
              {sel.buyUrl && (
                <button className="btn" onClick={autoFillDims} disabled={dimBusy}>
                  {dimBusy ? '치수 찾는 중…' : '치수 자동 채우기'}
                </button>
              )}
              <button className="btn" onClick={rotateSel}>90° 회전</button>
              <button className="btn ghost" onClick={deleteSel}>삭제</button>
            </div>
          )}
        </div>

        <div className="side">
          <h3>방 · 배치</h3>
          <div className="stat">
            <div className="k">방 크기 {room.accuracy === 'MEASURED' ? '(실측)' : room.accuracy === 'MEASURED_PARTIAL' ? '(한변실측)' : '(추정)'}</div>
            <div className="v">{room.widthM}m × {room.depthM}m</div>
          </div>
          <div className="stat">
            <div className="k">맞음 판정</div>
            <div className="v">
              {val.ok ? <span className="badge ok">문제 없음</span> : <span className="badge warn">겹침/방밖 있음</span>}
            </div>
          </div>
          <div className="stat">
            <div className="k">남은 바닥</div>
            <div className="v">{Math.round(val.freeRatio * 100)}%</div>
          </div>
          <div className="stat">
            <div className="k">치수 신뢰도</div>
            <div className="v" style={{ fontSize: 13 }}>
              {(() => {
                const solid = items.filter((it) => it.dimAccuracy === '정형' || it.dimAccuracy === '사용자입력' || String(it.dimAccuracy).startsWith('추정(상세')).length;
                const est = items.length - solid;
                return items.length ? `정형·입력 ${solid} · 추정 ${est}` : '가구 없음';
              })()}
            </div>
          </div>

          <label style={{ marginTop: 8 }}>빈 방 사진(선택)</label>
          <input type="file" accept="image/*" onChange={onPhoto} />

          <button className="btn primary" style={{ width: '100%', marginTop: 12 }} disabled={items.length === 0} onClick={() => setShowComposite(true)}>
            이 배치로 방 이미지 생성
          </button>
          <button className="btn ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => { setRoom(null); setItems([]); }}>
            방 다시 만들기
          </button>
          <p className="mockup-note">치수 보장은 정형 소스(IKEA)만 · 검색결과는 추정치 라벨 · 합성은 목업</p>
        </div>
      </div>

      {showComposite && <Composite room={room} items={items} roomPhoto={roomPhoto} onClose={() => setShowComposite(false)} />}
    </div>
  );
}

function Topbar() {
  return (
    <div className="topbar">
      <h1>🧚 방꾸요정</h1>
      <span className="sub">원룸에 실제 파는 가구를 실치수로 놓아 보고 바로 사기</span>
    </div>
  );
}
