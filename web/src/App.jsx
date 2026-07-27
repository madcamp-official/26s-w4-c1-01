import { useMemo, useState, useRef } from 'react';
import { toPlacedItem, resolveDims } from './lib/catalog.js';
import { validateLayout, findFreeSpot, snapRotation } from './lib/geometry.js';
import { generateLayouts, validateCandidates } from './lib/autolayout.js';
import { fetchDims, layoutFurniture, renderScene } from './lib/api.js';

import TabBar from './components/TabBar.jsx';
import Splash from './components/Splash.jsx';
import Login from './components/Login.jsx';
import Onboarding from './components/Onboarding.jsx';
import HomeTab from './components/HomeTab.jsx';
import RoomInput from './components/RoomInput.jsx';
import PlannerScreen from './components/PlannerScreen.jsx';
import CompositeResult from './components/CompositeResult.jsx';
import MarketTab from './components/MarketTab.jsx';
import MyTab from './components/MyTab.jsx';
import LayoutPicker from './components/LayoutPicker.jsx';

// 자동 배치: Gemini 유효 후보가 LAYOUT_TARGET개 모일 때까지 재시도(최대 LAYOUT_MAX_TRIES회).
const LAYOUT_TARGET = 1;
const LAYOUT_MAX_TRIES = 20;
const layoutSig = (c) => c.items.map((i) => `${Math.round(i.cx * 100)},${Math.round(i.cy * 100)},${i.rotationDeg}`).join('|');
const TAB_SCREENS = ['home', 'market', 'mypage'];

export default function App() {
  const [screen, setScreen] = useState('splash');
  const [taste, setTaste] = useState(null);           // {moods, budget, pet}
  const [tasteDone, setTasteDone] = useState(false);
  const [visitedMarket, setVisitedMarket] = useState(false);
  const [roomsDone, setRoomsDone] = useState(0);
  const [roomCounted, setRoomCounted] = useState(false);   // 현재 방을 '완성한 방'에 이미 셌는지(재배치 중복 방지)

  const [room, setRoom] = useState(null);
  const [openings, setOpenings] = useState([]);
  const [roomPhoto, setRoomPhoto] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [layoutOpts, setLayoutOpts] = useState(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [dimBusy, setDimBusy] = useState(false);

  const [renderImg, setRenderImg] = useState(null);
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderPreset, setRenderPreset] = useState('day');
  const [renderView, setRenderView] = useState('wide');   // 'wide' | 'cozy' | 'me'(내 3D 시점) — 렌더 카메라 고정
  const [showBefore, setShowBefore] = useState(false);

  const [marketRecommend, setMarketRecommend] = useState(null);
  const cam3d = useRef(null);

  const val = useMemo(
    () => (room ? validateLayout(items, room.widthM, room.depthM, openings) : { flags: [], ok: true, freeRatio: 0 }),
    [items, room, openings]
  );
  const sel = items.find((it) => it.id === selectedId);
  const estimate = useMemo(() => items.reduce((s, it) => s + (typeof it.price === 'number' && it.price > 0 ? it.price : 0), 0), [items]);

  // ── 가구/배치 조작(기존 오케스트레이션 보존) ──
  function addFurniture(cat) {
    if (!room) return;
    const d = resolveDims(cat);
    const probe = { wM: d.w / 100, dM: d.d / 100, rotationDeg: 0 };
    const spot = findFreeSpot(probe, items, room.widthM, room.depthM) || { cx: room.widthM / 2, cy: room.depthM / 2 };
    const it = toPlacedItem(cat, spot.cx, spot.cy);
    setItems((p) => [...p, it]);
    setSelectedId(it.id);
  }
  function moveItem(id, cx, cy) { setItems((p) => p.map((it) => (it.id === id ? { ...it, cx, cy } : it))); }
  function rotateItem(id) { setItems((p) => p.map((it) => (it.id === id ? { ...it, rotationDeg: snapRotation((it.rotationDeg || 0) + 90) } : it))); }
  function rotateSel() { if (selectedId) rotateItem(selectedId); }
  function deleteSel() { setItems((p) => p.filter((it) => it.id !== selectedId)); setSelectedId(null); }
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
          ? { ...it, wM: d.w / 100, dM: d.d / 100, hM: (d.h || it.hM * 100) / 100, dimAccuracy: d.accuracy || '추정(상세)' } : it)));
      } else alert('상세페이지에서 치수를 찾지 못했어요. 직접 입력해 주세요.');
    } finally { setDimBusy(false); }
  }
  async function openAutoLayout() {
    if (!room || !items.length || layoutBusy) return;
    setLayoutBusy(true);
    try {
      const seen = new Set();
      let opts = [];
      for (let t = 0; t < LAYOUT_MAX_TRIES && opts.length < LAYOUT_TARGET; t++) {
        const r = await layoutFurniture(room, items, openings);
        if (r?.status === 'OK' && Array.isArray(r.candidates)) {
          for (const c of validateCandidates(r.candidates, room, items, openings)) {
            const s = layoutSig(c);
            if (!seen.has(s)) { seen.add(s); opts.push(c); }
          }
        } else if (r?.status === 'NOKEY' || r?.status === 'CLIENT') break;
      }
      if (opts.length < 3) opts = [...opts, ...generateLayouts(room, items, 3 - opts.length, 400, openings)];
      if (!opts.length) { alert('가구가 많아 겹치지 않게 배치할 공간이 부족해요. 방을 키우거나 가구를 줄여 주세요.'); return; }
      setLayoutOpts(opts);
    } finally { setLayoutBusy(false); }
  }
  // 포토리얼 렌더(camp-3). 결과 화면 흐름을 막지 않게 실패해도 alert 없이 renderImg만 비움.
  async function doRender(preset = renderPreset, view = null) {
    if (!room || renderBusy) return;
    if (!items.some((it) => it.glb)) return;
    setRenderBusy(true);
    try {
      const r = await renderScene(room, items, cam3d.current, preset, view, openings);
      if (r?.status === 'OK' && r.image) setRenderImg(r.image);
      else setRenderImg(null);
    } catch { setRenderImg(null); } finally { setRenderBusy(false); }
  }
  // 시간대·각도를 함께 확정해 렌더(뷰를 명시적으로 고정). 'me'=내 3D 시점(cam3d), 그 외=서버 프레이밍.
  function renderWith(preset, viewMode) {
    setRenderPreset(preset); setRenderView(viewMode);
    doRender(preset, viewMode === 'me' ? null : viewMode);
  }

  // ── 네비게이션 ──
  function newRoom() {
    setRoom(null); setOpenings([]); setItems([]); setSelectedId(null); setRenderImg(null); setRoomPhoto(null);
    setRoomCounted(false);
    setScreen('roominput');
  }
  function onRoomInputNext(r, ops) {
    setRoom(r);
    setOpenings((ops || []).map((o, i) => ({ id: `op-${i}-${Date.now()}`, ...o })));
    setItems([]); setSelectedId(null); setRenderImg(null); setRoomCounted(false);
    setScreen('planner');
  }
  function finishPlanner() {
    setShowBefore(false); setRenderImg(null);
    setScreen('result');
    if (!roomCounted) { setRoomsDone((n) => n + 1); setRoomCounted(true); }   // 같은 방 재완성 시 중복 카운트 방지
    renderWith('day', 'wide');   // 항상 같은 와이드 앵글로 시작 → 매번 같은 뷰(일관성)
  }
  function findSimilar() {
    setVisitedMarket(true);
    setMarketRecommend(items.find((it) => it.glb || it.buyUrl) || items[0] || null);
    setScreen('market');
  }
  function navTab(t) {
    if (t === 'market') setVisitedMarket(true);
    setScreen(t);
  }

  const stamps = { taste: tasteDone, room: !!room, layout: items.length > 0, buy: visitedMarket };
  const showTab = TAB_SCREENS.includes(screen);

  return (
    <div className="phone">
      {screen === 'splash' && <Splash onNext={() => setScreen('login')} onSkip={() => setScreen('login')} />}
      {screen === 'login' && <Login onLogin={() => setScreen('onboarding')} onSkip={() => setScreen('home')} />}
      {screen === 'onboarding' && (
        <Onboarding initial={taste} onDone={(t) => { setTaste(t); setTasteDone(true); setScreen('home'); }} />
      )}

      {screen === 'home' && (
        <HomeTab
          stamps={stamps}
          stats={{ rooms: roomsDone, savedItems: items.length }}
          draft={room ? { roomLabel: `${room.widthM}m × ${room.depthM}m`, count: items.length } : null}
          onStart={newRoom}
          onResume={() => setScreen(room ? 'planner' : 'roominput')}
        />
      )}

      {screen === 'roominput' && (
        <RoomInput onBack={() => setScreen('home')} onNext={onRoomInputNext} photo={roomPhoto} onPhoto={setRoomPhoto} />
      )}

      {screen === 'planner' && room && (
        <PlannerScreen
          room={room} items={items} setItems={setItems} selectedId={selectedId} setSelectedId={setSelectedId}
          openings={openings} setOpenings={setOpenings} val={val} layoutBusy={layoutBusy}
          onAutoLayout={openAutoLayout} moveItem={moveItem} rotateItem={rotateItem}
          onDelete={deleteSel} onRotateSel={rotateSel} onSetDim={setSelDim} onAutoFillDims={autoFillDims}
          dimBusy={dimBusy} addFurniture={addFurniture} cam3d={cam3d}
          onBack={() => setScreen('roominput')} onFinish={finishPlanner}
        />
      )}

      {screen === 'result' && (
        <CompositeResult
          renderImg={renderImg} renderBusy={renderBusy} showBefore={showBefore}
          onToggle={() => setShowBefore((v) => !v)} photo={roomPhoto} estimate={estimate}
          timePreset={renderPreset} onTime={(p) => renderWith(p, renderView)}
          view={renderView} onView={(v) => renderWith(renderPreset, v)}
          onBack={() => setScreen('planner')} onRerender={() => setScreen('planner')} onFindSimilar={findSimilar}
        />
      )}

      {screen === 'market' && (
        <MarketTab recommendItem={marketRecommend} onConsumeRecommend={() => setMarketRecommend(null)} />
      )}

      {screen === 'mypage' && (
        <MyTab taste={taste} savedCount={roomsDone} onEditTaste={() => setScreen('onboarding')} />
      )}

      {showTab && <TabBar active={screen} onNav={navTab} />}

      {layoutOpts && (
        <LayoutPicker
          room={room}
          options={layoutOpts}
          onSelect={(newItems) => { setItems(newItems); setSelectedId(null); setLayoutOpts(null); }}
          onClose={() => setLayoutOpts(null)}
        />
      )}
    </div>
  );
}
