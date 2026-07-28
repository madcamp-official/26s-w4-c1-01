import { useMemo, useState, useRef } from 'react';
import { consumeAuthHash, currentUser, logout } from './lib/auth.js';
import { toPlacedItem, resolveDims, CATALOG } from './lib/catalog.js';
import { validateLayout, findFreeSpot, snapRotation } from './lib/geometry.js';
import { generateLayouts, validateCandidates } from './lib/autolayout.js';
import { fetchDims, layoutFurniture, renderScene, chatLayout } from './lib/api.js';
import { parseCommand, hasPlaceHint } from './lib/chatcmd.js';

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

// 부팅 시 1회: OAuth 콜백 해시 소비(로그인 복귀) 또는 보관된 세션 복원.
const bootAuth = consumeAuthHash();
const bootUser = bootAuth?.user || currentUser();

export default function App() {
  // 로그인 복귀면 온보딩으로, 기존 세션 있으면 홈으로, 처음이면 스플래시.
  const [screen, setScreen] = useState(bootAuth?.user ? 'onboarding' : bootUser ? 'home' : 'splash');
  const [user, setUser] = useState(bootUser);
  const [authError] = useState(bootAuth?.error || null);
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
  const [renderTrigger, setRenderTrigger] = useState(null);   // 'time' | 'view' | null — 로딩 문구를 원인별로 구분하는 용도
  const [showBefore, setShowBefore] = useState(false);

  const [marketRecommend, setMarketRecommend] = useState(null);
  const cam3d = useRef(null);

  const val = useMemo(
    () => (room ? validateLayout(items, room.widthM, room.depthM, openings, room.cutouts) : { flags: [], ok: true, freeRatio: 0 }),
    [items, room, openings]
  );
  const sel = items.find((it) => it.id === selectedId);
  const estimate = useMemo(() => items.reduce((s, it) => s + (typeof it.price === 'number' && it.price > 0 ? it.price : 0), 0), [items]);
  const estimateIsEst = useMemo(() => items.some((it) => it.priceEst), [items]);   // 추정가 포함 여부

  // ── 가구/배치 조작(기존 오케스트레이션 보존) ──
  function addFurniture(cat) {
    if (!room) return;
    const d = resolveDims(cat);
    const probe = { wM: d.w / 100, dM: d.d / 100, rotationDeg: 0 };
    const spot = findFreeSpot(probe, items, room.widthM, room.depthM, 0.1, room.cutouts) || { cx: room.widthM / 2, cy: room.depthM / 2 };
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
  // 포토리얼 렌더(camp-3) — 지정 아이템 배열로. 결과 화면 흐름을 막지 않게 실패해도 renderImg만 비움.
  // its를 인자로 받아 방금 바뀐 배치(setItems 직후 stale state)로도 정확히 렌더.
  // 렌더 중 새 요청(시간대/각도 연타)은 버리지 않고 '마지막 요청'을 큐에 보관 → 끝나면 이어 실행(latest-wins).
  const pendingRender = useRef(null);
  const busyRef = useRef(false);           // 상태 클로저 지연과 무관한 즉시 가드
  async function doRenderItems(its, preset, viewMode) {
    if (!room) return;
    if (busyRef.current) { pendingRender.current = { its, preset, viewMode }; return; }
    if (!its.some((it) => it.glb)) { setRenderImg(null); return; }
    busyRef.current = true; setRenderBusy(true);
    try {
      const r = await renderScene(room, its, cam3d.current, preset, viewMode === 'me' ? null : viewMode, openings);
      setRenderImg(r?.status === 'OK' && r.image ? r.image : null);
    } catch { setRenderImg(null); } finally {
      busyRef.current = false; setRenderBusy(false);
      const p = pendingRender.current;
      if (p) { pendingRender.current = null; setTimeout(() => doRenderItems(p.its, p.preset, p.viewMode), 0); }
    }
  }
  // 시간대·각도를 함께 확정해 현재 배치로 렌더. 'me'=내 3D 시점(cam3d), 그 외=서버 프레이밍.
  // trigger는 로딩 문구 구분용(무엇이 바뀌어서 다시 찍는지) — 최초 렌더 등 구분 불필요할 땐 생략.
  function renderWith(preset, viewMode, trigger = null) {
    setRenderPreset(preset); setRenderView(viewMode); setRenderTrigger(trigger);
    doRenderItems(items, preset, viewMode);
  }
  // 배치를 바꾼 뒤 결과 화면으로(로딩 스피너 → 렌더 사진). 방금 만든 next 배치로 즉시 렌더.
  function goResultWith(next) {
    setItems(next); setSelectedId(null);
    setShowBefore(false); setRenderImg(null);
    setRenderPreset('day'); setRenderView('wide'); setRenderTrigger(null);
    setScreen('result');
    doRenderItems(next, 'day', 'wide');
  }
  // 빠른 명령(추가/삭제/크기)을 로컬로 적용 → 새 배치 배열 반환(불가하면 null).
  function applyChatCommand(cmd) {
    if (cmd.op === 'add') {
      const catItem = CATALOG.find((c) => c.cat === cmd.cat);
      if (!catItem || !room) return null;
      const d = resolveDims(catItem);
      const probe = { wM: d.w / 100, dM: d.d / 100, rotationDeg: 0 };
      const spot = findFreeSpot(probe, items, room.widthM, room.depthM, 0.1, room.cutouts) || { cx: room.widthM / 2, cy: room.depthM / 2 };
      return [...items, toPlacedItem(catItem, spot.cx, spot.cy)];
    }
    if (cmd.op === 'remove') {
      const idx = items.map((it) => it.cat).lastIndexOf(cmd.cat);
      return idx < 0 ? null : items.filter((_, i) => i !== idx);
    }
    if (cmd.op === 'resize') {
      let hit = false;
      const next = items.map((it) => (!hit && it.cat === cmd.cat
        ? (hit = true, { ...it, wM: it.wM * cmd.factor, dM: it.dM * cmd.factor, hM: it.hM * cmd.factor, dimAccuracy: '사용자입력' })
        : it));
      return hit ? next : null;
    }
    return null;
  }
  // LLM 좌표 응답(cm)을 base 배치에 적용 → 검증 통과 시 새 배열, 실패 시 null.
  function applyLLMPositions(base, rItems) {
    if (!Array.isArray(rItems) || !rItems.length) return null;
    const map = new Map(rItems.map((it) => [it.id, it]));
    const next = base.map((it) => {
      const ni = map.get(it.id);
      if (!ni) return it;
      const rot = [0, 90, 180, 270].includes(ni.rotation) ? ni.rotation : it.rotationDeg;
      const cx = Number.isFinite(ni.cx) ? ni.cx / 100 : it.cx;
      const cy = Number.isFinite(ni.cy) ? ni.cy / 100 : it.cy;
      return { ...it, cx, cy, rotationDeg: rot };
    });
    const v = validateLayout(next.filter((it) => it.cat !== '러그'), room.widthM, room.depthM, openings, room.cutouts);
    return v.ok && !v.blockOpen ? next : null;
  }
  // 배치 도우미 제출 — 빠른 명령이면 로컬 적용, 아니면 LLM 재배치. 적용되면 결과 화면으로.
  // '창가에 조명 추가해줘'처럼 위치가 있는 추가는 2단계: 로컬 추가 → LLM이 문장대로 위치 조정.
  // 반환: { applied, reply } — applied면 결과로 이동(칩/문장 전송 → 로딩 → 결과).
  async function onChatSubmit(text, history = []) {
    if (!room) return { applied: false, reply: '먼저 방을 만들어 주세요.' };
    const cmd = parseCommand(text);
    if (cmd) {
      const catLabel = cmd.cat;
      if (cmd.op !== 'add' && !items.some((it) => it.cat === catLabel)) {
        return { applied: false, reply: `${catLabel}이(가) 아직 없어요.` };
      }
      const next = applyChatCommand(cmd);
      if (!next) return { applied: false, reply: '그 요청은 반영하기 어려워요.' };
      if (cmd.op === 'add' && hasPlaceHint(text)) {
        // 위치 표현이 있으면 LLM에게 방금 추가한 가구를 문장대로 옮기게 함(실패해도 추가 자체는 유지).
        const added = next[next.length - 1];
        const r = await chatLayout(room, openings, next, `${text} — 방금 추가한 '${added.name}'(id: ${added.id})의 위치를 이 문장대로 조정해줘.`, history);
        const moved = r?.decision === 'apply' ? applyLLMPositions(next, r.items) : null;
        goResultWith(moved || next);
        return { applied: true };
      }
      goResultWith(next);
      return { applied: true };
    }
    // 자연어 → LLM 재배치(기존 위치 재검증 후에만 반영)
    const r = await chatLayout(room, openings, items, text, history);
    if (r.decision === 'apply') {
      const next = applyLLMPositions(items, r.items);
      if (next) { goResultWith(next); return { applied: true }; }
      return { applied: false, reply: (r.reason || '') + ' — 다만 겹치거나 문·창을 가려서 반영하진 않았어요. 🚫' };
    }
    return { applied: false, reply: r.reason || '그 요청은 반영하기 어려워요.' };
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
      {screen === 'login' && <Login onLogin={() => setScreen('onboarding')} onSkip={() => setScreen('home')} authError={authError} />}
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
          onChatSubmit={onChatSubmit}
          onBack={() => setScreen('roominput')} onFinish={finishPlanner}
        />
      )}

      {screen === 'result' && (
        <CompositeResult
          renderImg={renderImg} renderBusy={renderBusy} renderTrigger={renderTrigger} showBefore={showBefore}
          onToggle={() => setShowBefore((v) => !v)} photo={roomPhoto} estimate={estimate} estimateIsEst={estimateIsEst}
          timePreset={renderPreset} onTime={(p) => renderWith(p, renderView, 'time')}
          view={renderView} onView={(v) => renderWith(renderPreset, v, 'view')}
          onBack={() => setScreen('planner')} onRerender={() => setScreen('planner')} onFindSimilar={findSimilar}
        />
      )}

      {screen === 'market' && (
        <MarketTab recommendItem={marketRecommend} onConsumeRecommend={() => setMarketRecommend(null)} />
      )}

      {screen === 'mypage' && (
        <MyTab taste={taste} savedCount={roomsDone} user={user} onEditTaste={() => setScreen('onboarding')}
          onLogout={() => { logout(); setUser(null); setScreen('login'); }} />
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
