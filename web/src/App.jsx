import { useMemo, useState, useRef } from 'react';
import RoomForm from './components/RoomForm.jsx';
import CatalogPanel from './components/CatalogPanel.jsx';
import Planner from './components/Planner.jsx';
import Room3D from './components/Room3D.jsx';
import LayoutPicker from './components/LayoutPicker.jsx';
import { toPlacedItem, resolveDims } from './lib/catalog.js';
import { validateLayout, findFreeSpot, snapRotation } from './lib/geometry.js';
import { generateLayouts, validateCandidates } from './lib/autolayout.js';
import { fetchDims, layoutFurniture, renderScene } from './lib/api.js';

const TABS = [
  { id: 'room', label: '방', icon: '🏠' },
  { id: 'plan', label: '배치', icon: '📐' },
  { id: 'shop', label: '가구', icon: '🛋️' },
  { id: 'preview', label: '3D 미리보기', icon: '🧊' },
];

const accLabel = (a) => (a === 'MEASURED' ? '(실측)' : a === 'MEASURED_PARTIAL' ? '(한 변 실측)' : '(추정)');

export default function App() {
  const [room, setRoom] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [roomPhoto, setRoomPhoto] = useState(null);
  const [tab, setTab] = useState('room');
  const [dimBusy, setDimBusy] = useState(false);
  const [layoutOpts, setLayoutOpts] = useState(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderImg, setRenderImg] = useState(null);
  const [renderPreset, setRenderPreset] = useState('day');   // 시간대 조명
  const cam3d = useRef(null);   // Room3D의 현재 카메라(위치+타깃) — 렌더가 같은 시점으로

  const val = useMemo(
    () => (room ? validateLayout(items, room.widthM, room.depthM) : { flags: [], ok: true, freeRatio: 0 }),
    [items, room]
  );
  const sel = items.find((it) => it.id === selectedId);
  const solid = items.filter((it) => ['정형', '사용자입력'].includes(it.dimAccuracy) || String(it.dimAccuracy).startsWith('추정(상세')).length;

  function onRoomDone(r) {
    setRoom(r);
    setTab('plan');
  }
  function addFurniture(cat) {
    const d = resolveDims(cat);
    const probe = { wM: d.w / 100, dM: d.d / 100, rotationDeg: 0 };
    const spot = findFreeSpot(probe, items, room.widthM, room.depthM) || { cx: room.widthM / 2, cy: room.depthM / 2 };
    const it = toPlacedItem(cat, spot.cx, spot.cy);
    setItems((p) => [...p, it]);
    setSelectedId(it.id);
  }
  function rotateSel() {
    setItems((p) => p.map((it) => (it.id === selectedId ? { ...it, rotationDeg: snapRotation((it.rotationDeg || 0) + 90) } : it)));
  }
  function moveItem(id, cx, cy) {
    setItems((p) => p.map((it) => (it.id === id ? { ...it, cx, cy } : it)));
  }
  async function openAutoLayout() {
    if (!room || !items.length || layoutBusy) return;
    setLayoutBusy(true);
    try {
      let opts = [];
      // 1) LLM 후보 → 우리 기하엔진으로 겹침 재검증(안전망: 겹치는 후보 폐기)
      const r = await layoutFurniture(room, items);
      if (r?.status === 'OK' && Array.isArray(r.candidates)) {
        opts = validateCandidates(r.candidates, room, items);
      }
      // 2) 유효 후보가 3개 미만이면 로컬 규칙 배치로 채움(항상 3개 보장)
      if (opts.length < 3) opts = [...opts, ...generateLayouts(room, items, 3 - opts.length)];
      if (!opts.length) {
        alert('가구가 많아 겹치지 않게 배치할 공간이 부족해요. 방을 키우거나 가구를 줄여 주세요.');
        return;
      }
      setLayoutOpts(opts);
    } finally {
      setLayoutBusy(false);
    }
  }
  function rotateItem(id) {
    setItems((p) => p.map((it) => (it.id === id ? { ...it, rotationDeg: snapRotation((it.rotationDeg || 0) + 90) } : it)));
  }
  async function doRender(preset = renderPreset) {
    if (!room || renderBusy) return;
    const placeable = items.filter((it) => it.glb);
    if (!placeable.length) { alert('렌더할 3D 가구가 없어요. 가구를 먼저 담아 주세요.'); return; }
    setRenderBusy(true);
    try {
      const r = await renderScene(room, items, cam3d.current, preset);
      if (r?.status === 'OK' && r.image) setRenderImg(r.image);
      else if (r?.status === 'CLIENT') alert('렌더 서버(camp-3)가 아직 연결 안 됐어요. ./run.sh 로 터널을 켜 주세요.');
      else alert('렌더 실패: ' + (r?.reason || '알 수 없음'));
    } finally {
      setRenderBusy(false);
    }
  }
  function deleteSel() {
    setItems((p) => p.filter((it) => it.id !== selectedId));
    setSelectedId(null);
  }
  function setSelDim(field, cm) {
    const m = Math.max(Number(cm) || 0, 1) / 100;
    setItems((p) => p.map((it) => (it.id === selectedId ? { ...it, [field]: m, dimAccuracy: '사용자입력' } : it)));
  }
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
  function onPhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setRoomPhoto(r.result);
    r.readAsDataURL(f);
  }

  const needRoom = (
    <div className="pane center">
      <p className="mockup-note">먼저 ‘방’ 탭에서 원룸 크기를 만들어 주세요.</p>
      <button className="btn primary" onClick={() => setTab('room')}>방 만들기</button>
    </div>
  );

  const selBar = sel && (
    <div className="selbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
      {sel.image && <img className="selthumb" src={sel.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      <span className="badge est">{sel.name}</span>
      <span className={`badge ${sel.dimAccuracy === '정형' || sel.dimAccuracy === '사용자입력' ? 'ok' : 'warn'}`}>{sel.dimAccuracy}</span>
      <span className="dimedit">
        가로<input type="number" value={Math.round(sel.wM * 100)} onChange={(e) => setSelDim('wM', e.target.value)} />
        세로<input type="number" value={Math.round(sel.dM * 100)} onChange={(e) => setSelDim('dM', e.target.value)} />
        높이<input type="number" value={Math.round(sel.hM * 100)} onChange={(e) => setSelDim('hM', e.target.value)} />cm
      </span>
      {sel.buyUrl && <button className="btn" onClick={autoFillDims} disabled={dimBusy}>{dimBusy ? '치수 찾는 중…' : '치수 자동 채우기'}</button>}
      <button className="btn" onClick={rotateSel}>90° 회전</button>
      <button className="btn ghost" onClick={deleteSel}>삭제</button>
    </div>
  );

  return (
    <div className="phone">
      <header className="pbar">
        <span className="logo">🧚 방꾸요정</span>
        <span className="sub">원룸에 실제 가구를 실치수로</span>
      </header>

      <main className="screen">
        {/* 방 */}
        {tab === 'room' && (!room ? (
          <RoomForm onDone={onRoomDone} />
        ) : (
          <div className="pane">
            <div className="stat">
              <div className="k">방 크기 {accLabel(room.accuracy)}</div>
              <div className="v">{room.widthM}m × {room.depthM}m</div>
            </div>
            <label>빈 방 사진 (합성용, 선택)</label>
            <input type="file" accept="image/*" onChange={onPhoto} />
            {roomPhoto && <img className="roomphoto" src={roomPhoto} alt="빈 방" />}
            <button className="btn ghost" style={{ width: '100%', marginTop: 12 }} onClick={() => { setRoom(null); setItems([]); }}>
              방 다시 만들기
            </button>
          </div>
        ))}

        {/* 배치 */}
        {tab === 'plan' && (!room ? needRoom : (
          <div className="pane">
            <div className="autobar">
              <button className="btn primary sm" onClick={openAutoLayout} disabled={!items.length || layoutBusy}>{layoutBusy ? '🤖 AI 배치 중…' : '✨ 자동 배치'}</button>
              <span className="chip">가구를 담고 누르면 원룸에 자동으로 배치돼요</span>
            </div>
            <Planner room={room} items={items} setItems={setItems} selectedId={selectedId} setSelectedId={setSelectedId} flags={val.flags} />
            {selBar}
            <div className="statrow">
              {val.ok ? <span className="badge ok">맞음 문제없음</span> : <span className="badge warn">겹침/방밖 있음</span>}
              <span className="chip">남은 바닥 {Math.round(val.freeRatio * 100)}%</span>
              <span className="chip">치수 정형·입력 {solid} · 추정 {items.length - solid}</span>
            </div>
            {items.length === 0 && <p className="mockup-note">‘가구’ 탭에서 가구를 담으면 여기에 실치수로 배치돼요.</p>}
          </div>
        ))}

        {/* 가구 */}
        {tab === 'shop' && (!room ? needRoom : (
          <div className="pane">
            <CatalogPanel onAdd={addFurniture} />
          </div>
        ))}

        {/* 미리보기 */}
        {tab === 'preview' && (!room ? needRoom : (
          <div className="pane">
            {items.length === 0 ? (
              <p className="mockup-note">배치된 가구가 없어요. ‘가구’·‘배치’ 탭에서 먼저 놓아 주세요.</p>
            ) : (
              <>
                <div className="autobar">
                  <button className="btn primary sm" onClick={openAutoLayout} disabled={!items.length || layoutBusy}>{layoutBusy ? '🤖 AI 배치 중…' : '✨ 자동 배치'}</button>
                  <select className="preset-sel" value={renderPreset} onChange={(e) => setRenderPreset(e.target.value)} title="렌더 시간대(조명)">
                    <option value="morning">🌅 아침</option>
                    <option value="day">☀️ 한낮</option>
                    <option value="sunset">🌇 노을</option>
                    <option value="night">🌙 밤</option>
                  </select>
                  <button className="btn sm" onClick={() => doRender()} disabled={renderBusy || !items.some((it) => it.glb)}>{renderBusy ? '📸 렌더링 중… (~30초)' : '📸 고품질 렌더'}</button>
                </div>
                <Room3D
                  room={room}
                  items={items}
                  selectedId={selectedId}
                  setSelectedId={setSelectedId}
                  onMove={moveItem}
                  onRotate={rotateItem}
                  flags={val.flags}
                  camRef={cam3d}
                />
                {selBar}
                <div className="statrow">
                  {val.ok ? <span className="badge ok">맞음 문제없음</span> : <span className="badge warn">겹침/방밖 있음</span>}
                  <span className="chip">실측 GLB {items.filter((i) => i.glb).length} · 실치수 배치</span>
                </div>
                <h3 className="sec">구매</h3>
                <div className="buylist">
                  {items.map((it) => (
                    <div key={it.id} className="buyrow">
                      {it.image ? (
                        <img className="swatch" src={it.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <span className="swatch" style={{ background: it.color }} />
                      )}
                      <span className="meta">
                        <span className="nm">{it.name}</span>
                        <span className="dm">{Math.round(it.wM * 100)}×{Math.round(it.dM * 100)}cm{typeof it.price === 'number' && it.price > 0 ? ` · ${it.price.toLocaleString()}원` : ''}</span>
                      </span>
                      {it.buyUrl ? (
                        <a className="btn primary buybtn" href={it.buyUrl} target="_blank" rel="noreferrer">구매</a>
                      ) : (
                        <span className="badge est">링크없음</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={`tabbtn ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            <span className="ti">{t.icon}</span>
            <span className="tl">{t.label}{t.id === 'plan' && items.length ? ` ${items.length}` : ''}</span>
          </button>
        ))}
      </nav>

      {layoutOpts && (
        <LayoutPicker
          room={room}
          options={layoutOpts}
          onSelect={(newItems) => { setItems(newItems); setSelectedId(null); setLayoutOpts(null); }}
          onClose={() => setLayoutOpts(null)}
        />
      )}

      {renderImg && (
        <div className="modal-back" onClick={() => setRenderImg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>📸 고품질 렌더</h2>
            <p className="mockup-note">지금 배치 그대로 camp-3에서 렌더한 포토리얼 사진이에요.</p>
            <img className="renderimg" src={renderImg} alt="포토리얼 렌더" />
            <div className="selbar" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <div className="preset-row">
                {[['morning', '🌅'], ['day', '☀️'], ['sunset', '🌇'], ['night', '🌙']].map(([p, ic]) => (
                  <button key={p} className={'btn ghost sm' + (renderPreset === p ? ' on' : '')}
                    disabled={renderBusy}
                    onClick={() => { setRenderPreset(p); doRender(p); }}>{ic}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a className="btn primary" href={renderImg} download="방꾸요정-렌더.png">저장</a>
                <button className="btn ghost" onClick={() => setRenderImg(null)}>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
