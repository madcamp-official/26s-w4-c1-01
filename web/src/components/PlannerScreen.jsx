import { useState } from 'react';
import Planner from './Planner.jsx';
import Room3D from './Room3D.jsx';
import OpeningsBar from './OpeningsBar.jsx';
import LayoutChat from './LayoutChat.jsx';
import CatalogPanel from './CatalogPanel.jsx';
import ViewErrorBoundary from './ViewErrorBoundary.jsx';

// 배치 플래너 화면 — ywlee chrome + 기존 기능 컴포넌트(2D/3D/문창/자동배치/채팅/가구담기) 조립.
export default function PlannerScreen({
  room, items, setItems, selectedId, setSelectedId, openings, setOpenings,
  val, layoutBusy, onAutoLayout, moveItem, rotateItem, onDelete, onRotateSel,
  onSetDim, onAutoFillDims, dimBusy, addFurniture, cam3d, onChatSubmit, onPickChatOption, onBack, onFinish,
}) {
  const [view3d, setView3d] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const sel = items.find((it) => it.id === selectedId);
  const solid = items.filter((it) => ['정형', '사용자입력'].includes(it.dimAccuracy) || String(it.dimAccuracy).startsWith('추정(상세')).length;
  // Room3D는 '플래그된 id 목록'을 기대(Planner는 위치배열). val.flags(위치배열)를 id 배열로 변환해 3D에 전달.
  const flagIds = items.filter((_, i) => { const f = val.flags[i]; return f && (f.overlap || f.out || f.blockOpen); }).map((it) => it.id);

  return (
    <div className="vscreen planner-screen">
      <button className="backbtn" onClick={onBack}>← 뒤로</button>
      <div className="planner-head">
        <b>🧚 방꾸요정</b>
        <span className="spacer" />
        <button className="iconbtn" onClick={onAutoLayout} disabled={!items.length || layoutBusy}>
          {layoutBusy ? '🤖 배치 중…' : '✨ 자동배치'}
        </button>
        <button className={`iconbtn ${view3d ? 'on' : ''}`} onClick={() => setView3d((v) => !v)}>{view3d ? '📐 2D' : '🧊 3D'}</button>
        <button className="iconbtn" onClick={() => setDrawer(true)}>＋ 가구</button>
      </div>

      <OpeningsBar room={room} openings={openings} setOpenings={setOpenings} />

      {view3d ? (
        <ViewErrorBoundary resetKey={view3d}>
          <Room3D room={room} items={items} selectedId={selectedId} setSelectedId={setSelectedId}
            onMove={moveItem} onRotate={rotateItem} flags={flagIds} camRef={cam3d} openings={openings} />
        </ViewErrorBoundary>
      ) : (
        <Planner room={room} items={items} setItems={setItems} selectedId={selectedId}
          setSelectedId={setSelectedId} flags={val.flags} openings={openings} />
      )}

      {sel && (
        <div className="selbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {sel.image && <img className="selthumb" src={sel.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
          <span className="badge est">{sel.name}</span>
          <span className={`badge ${sel.dimAccuracy === '정형' || sel.dimAccuracy === '사용자입력' ? 'ok' : 'warn'}`}>{sel.dimAccuracy}</span>
          <span className="dimedit">
            가로<input type="number" value={Math.round(sel.wM * 100)} onChange={(e) => onSetDim('wM', e.target.value)} />
            세로<input type="number" value={Math.round(sel.dM * 100)} onChange={(e) => onSetDim('dM', e.target.value)} />
            높이<input type="number" value={Math.round(sel.hM * 100)} onChange={(e) => onSetDim('hM', e.target.value)} />cm
          </span>
          {sel.buyUrl && <button className="btn" onClick={onAutoFillDims} disabled={dimBusy}>{dimBusy ? '치수 찾는 중…' : '치수 자동 채우기'}</button>}
          <button className="btn" onClick={onRotateSel}>90° 회전</button>
          <button className="btn ghost" onClick={onDelete}>삭제</button>
        </div>
      )}

      <div className="statrow">
        {val.ok ? <span className="badge ok">맞음 문제없음</span> : <span className="badge warn">겹침/방밖 있음</span>}
        {val.blockOpen && <span className="badge warn">문/창 가림</span>}
        <span className="chip">남은 바닥 {Math.round(val.freeRatio * 100)}%</span>
        <span className="chip">치수 정형·입력 {solid} · 추정 {items.length - solid}</span>
      </div>

      {items.length === 0 && <p className="mockup-note">＋가구로 원룸에 담으면 실치수로 배치돼요. ‘자동배치’를 누르면 AI가 알아서 놓아줘요.</p>}

      <LayoutChat items={items} onSubmit={onChatSubmit} onPickOption={onPickChatOption} />

      <button className="cta footer-cta" onClick={onFinish} disabled={!items.some((it) => it.glb)}>✨ 이 배치로 방 채우기</button>

      {drawer && (
        <div className="sheet-back" onClick={() => setDrawer(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '78%' }}>
            <div className="sheet-grab" />
            <div className="stitle">가구 담기 🛋️</div>
            <div style={{ overflow: 'auto', minHeight: 0 }}>
              <CatalogPanel onAdd={(cat) => { addFurniture(cat); }} placedItems={items} />
            </div>
            <button className="cta" onClick={() => setDrawer(false)}>완료</button>
          </div>
        </div>
      )}
    </div>
  );
}
