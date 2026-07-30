import { useMemo, useState, useRef, useEffect } from 'react';
import { consumeAuthHash, currentUser, logout } from './lib/auth.js';
import { toPlacedItem, resolveDims, CATALOG, deriveStyle } from './lib/catalog.js';
import { validateLayout, findFreeSpot, snapRotation, clampCenterFree } from './lib/geometry.js';
import { generateLayouts, validateCandidates } from './lib/autolayout.js';
import { fetchDims, layoutFurniture, renderScene, chatLayout, postCommunity, saveRoomServer, fetchRooms, deleteRoom } from './lib/api.js';
import { parseCommand, parseRecommendCommand, hasPlaceHint } from './lib/chatcmd.js';
import { MOOD_TO_STYLE } from './lib/appdata.js';

import TabBar from './components/TabBar.jsx';
import Splash from './components/Splash.jsx';
import Login from './components/Login.jsx';
import Onboarding from './components/Onboarding.jsx';
import HomeTab from './components/HomeTab.jsx';
import RoomInput from './components/RoomInput.jsx';
import PlannerScreen from './components/PlannerScreen.jsx';
import CompositeResult from './components/CompositeResult.jsx';
import PanoViewer from './components/PanoViewer.jsx';
import MarketTab from './components/MarketTab.jsx';
import MyTab from './components/MyTab.jsx';
import LayoutPicker from './components/LayoutPicker.jsx';

// 자동 배치: Gemini 유효 후보가 LAYOUT_TARGET개 모일 때까지 재시도(최대 LAYOUT_MAX_TRIES회).
const LAYOUT_TARGET = 1;
const LAYOUT_MAX_TRIES = 20;
const layoutSig = (c) => c.items.map((i) => `${Math.round(i.cx * 100)},${Math.round(i.cy * 100)},${i.rotationDeg}`).join('|');
const TAB_SCREENS = ['home', 'market', 'mypage'];
const SAVED_ROOMS_KEY = 'bk-saved-rooms';
function loadSavedRooms() {
  try { return JSON.parse(localStorage.getItem(SAVED_ROOMS_KEY) || '[]'); } catch { return []; }
}

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
  const [furnitureBought, setFurnitureBought] = useState(false);   // 마켓 탭 방문이 아니라 실제 구매링크 클릭 시에만 true
  const [roomsDone, setRoomsDone] = useState(0);
  const [roomCounted, setRoomCounted] = useState(false);   // 현재 방을 '완성한 방'에 이미 셌는지(재배치 중복 방지)
  const [savedRooms, setSavedRooms] = useState(loadSavedRooms);   // 마이 탭 배치함 — localStorage와 동기화

  const [room, setRoom] = useState(null);
  const [openings, setOpenings] = useState([]);
  const [roomPhoto, setRoomPhoto] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [layoutOpts, setLayoutOpts] = useState(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [dimBusy, setDimBusy] = useState(false);

  const [renderImg, setRenderImg] = useState(null);
  const [panoImg, setPanoImg] = useState(null);       // 360° 둘러보기 파노라마(한 번 구우면 계속 씀)
  const [panoBusy, setPanoBusy] = useState(false);
  const [panoOpen, setPanoOpen] = useState(false);
  const panoKey = useRef(null);                        // 어떤 배치·시간대로 구운 파노라마인지
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderPreset, setRenderPreset] = useState('day');
  const [renderView, setRenderView] = useState('wide');   // 'wide' | 'cozy' | 'wide2'(반대편 와이드) — 서버 프레이밍
  // 조명 수동 제어 — on: null(자동=프리셋 정책)/true/false, color: hex. ref로 최신값 보장(연타 시 stale 방지).
  const [lampOn, setLampOn] = useState(null);
  const [lampColor, setLampColor] = useState('#FFB873');
  const lampRef = useRef({ on: null, color: '#FFB873' });
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
  // 가구 담기 목록은 토글 — 같은 상품을 다시 누르면 방금 담은 것을 도로 뺀다.
  // (담기만 되면 잘못 누른 걸 되돌리려고 평면도에서 찾아 지워야 했다)
  // 같은 상품을 여러 개 담았으면 '마지막에 담은 하나'만 뺀다 — 직전 클릭의 취소가 되게.
  function toggleFurniture(cat) {
    if (!room) return;
    const same = items.filter((it) => it.catId === cat.id);
    if (!same.length) { addFurniture(cat); return; }
    const lastId = same[same.length - 1].id;
    setItems((p) => p.filter((it) => it.id !== lastId));
    setSelectedId((cur) => (cur === lastId ? null : cur));
  }
  // 배치 도우미의 "추천" 카드에서 하나를 골랐을 때 — 이미 검증된 특정 카탈로그 아이템이라 그대로 addFurniture로.
  function pickRecommended(id) {
    const catItem = CATALOG.find((c) => c.id === id);
    if (catItem) addFurniture(catItem);
  }
  // 취향 태그 + 이미 배치된 가구들의 스타일을 모아 "이 방과 어울리는" 후보를 카테고리 안에서 추린다.
  // 매치되는 스타일이 없으면(취향 미입력·첫 가구) 카테고리 전체 풀로 폴백 — 추천이 아예 안 뜨는 것보단 나음.
  function recommendCandidates(cat, n = 3) {
    const wantedStyles = new Set([
      ...(taste?.moods || []).flatMap((m) => MOOD_TO_STYLE[m] || []),
      ...items.map((it) => deriveStyle(it)).filter(Boolean),
    ]);
    let pool = CATALOG.filter((c) => c.cat === cat);
    if (wantedStyles.size) {
      const styled = pool.filter((c) => wantedStyles.has(deriveStyle(c)));
      if (styled.length) pool = styled;
    }
    return [...pool].sort(() => Math.random() - 0.5).slice(0, n);   // 매번 같은 것만 뜨지 않게 섞기
  }
  // 사용자 편집(드래그/회전)은 방 범위를 벗어날 수 없고, 컷아웃(욕실·주방 등)도 뚫을 수 없다.
  // 러그만 예외(밟는 물건 — validateLayout의 soft 정책과 일치).
  function moveItem(id, cx, cy) {
    setItems((p) => p.map((it) => {
      if (it.id !== id) return it;
      const cuts = it.cat === '러그' ? [] : room?.cutouts || [];
      const c = room ? clampCenterFree(it, cx, cy, room.widthM, room.depthM, cuts, it) : { cx, cy };
      return { ...it, cx: c.cx, cy: c.cy };
    }));
  }
  function rotateItem(id) {
    setItems((p) => p.map((it) => {
      if (it.id !== id) return it;
      const rot = snapRotation((it.rotationDeg || 0) + 90);
      const cuts = it.cat === '러그' ? [] : room?.cutouts || [];
      const c = room ? clampCenterFree({ ...it, rotationDeg: rot }, it.cx, it.cy, room.widthM, room.depthM, cuts, it) : { cx: it.cx, cy: it.cy };
      return { ...it, rotationDeg: rot, cx: c.cx, cy: c.cy };
    }));
  }
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
      const r = await renderScene(room, its, cam3d.current, preset, viewMode, openings, lampRef.current);
      setRenderImg(r?.status === 'OK' && r.image ? r.image : null);
    } catch { setRenderImg(null); } finally {
      busyRef.current = false; setRenderBusy(false);
      const p = pendingRender.current;
      if (p) { pendingRender.current = null; setTimeout(() => doRenderItems(p.its, p.preset, p.viewMode), 0); }
    }
  }
  // 360° 둘러보기 — 배치·시간대가 그대로면 이미 구운 파노라마를 다시 쓴다(서버 재호출 없음).
  async function openPano() {
    if (!room || panoBusy) return;
    const key = `${renderPreset}|${items.map((i) => `${i.glb}${Math.round(i.cx * 100)},${Math.round(i.cy * 100)},${i.rotationDeg || 0}`).join('|')}`;
    if (panoImg && panoKey.current === key) { setPanoOpen(true); return; }
    setPanoBusy(true);
    try {
      const r = await renderScene(room, items, null, renderPreset, null, openings, lampRef.current, true);
      if (r?.status === 'OK' && r.image) {
        panoKey.current = key;
        setPanoImg(r.image);
        setPanoOpen(true);
      } else {
        alert('둘러보기 사진을 만들지 못했어 — 잠시 뒤 다시 시도해줘');
      }
    } finally { setPanoBusy(false); }
  }

  // 시간대·각도를 함께 확정해 현재 배치로 렌더 — 전부 서버 프레이밍(wide/cozy/wide2).
  // trigger는 로딩 문구 구분용(무엇이 바뀌어서 다시 찍는지) — 최초 렌더 등 구분 불필요할 땐 생략.
  function renderWith(preset, viewMode, trigger = null) {
    setRenderPreset(preset); setRenderView(viewMode); setRenderTrigger(trigger);
    doRenderItems(items, preset, viewMode);
  }
  // 조명 토글(자동→ON→OFF→자동) / 색 변경 — 즉시 같은 구도로 다시 렌더.
  function cycleLamp() {
    const next = lampRef.current.on === null ? true : lampRef.current.on ? false : null;
    lampRef.current = { ...lampRef.current, on: next };
    setLampOn(next); setRenderTrigger('lamp');
    doRenderItems(items, renderPreset, renderView);
  }
  function pickLampColor(c) {
    lampRef.current = { ...lampRef.current, color: c };
    setLampColor(c); setRenderTrigger('lamp');
    doRenderItems(items, renderPreset, renderView);
  }
  // 빠른 명령(추가/삭제/크기)을 로컬로 적용 → 새 배치 배열 반환(불가하면 null).
  // base를 받아 순수하게 동작 — "침대랑 소파 넣어줘"처럼 복수 대상을 연쇄 적용할 수 있게.
  function applyChatCommand(cmd, base = items) {
    if (cmd.op === 'add') {
      const catItem = CATALOG.find((c) => c.cat === cmd.cat);
      if (!catItem || !room) return null;
      const d = resolveDims(catItem);
      const probe = { wM: d.w / 100, dM: d.d / 100, rotationDeg: 0 };
      const spot = findFreeSpot(probe, base, room.widthM, room.depthM, 0.1, room.cutouts) || { cx: room.widthM / 2, cy: room.depthM / 2 };
      return [...base, toPlacedItem(catItem, spot.cx, spot.cy)];
    }
    if (cmd.op === 'remove') {
      if (cmd.all) {                                   // "침대 다 빼줘" — 그 카테고리 전부
        const next = base.filter((it) => it.cat !== cmd.cat);
        return next.length === base.length ? null : next;
      }
      const idx = base.map((it) => it.cat).lastIndexOf(cmd.cat);
      return idx < 0 ? null : base.filter((_, i) => i !== idx);
    }
    if (cmd.op === 'resize') {
      let hit = false;
      const next = base.map((it) => (!hit && it.cat === cmd.cat
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
    const rec = parseRecommendCommand(text);
    if (rec) {
      const candidates = recommendCandidates(rec.cat, 3);
      if (!candidates.length) return { applied: false, reply: `아직 추천할 ${rec.cat} 후보가 없어요.` };
      return {
        applied: false,
        reply: `이 방 분위기에 맞는 ${rec.cat} ${candidates.length}가지를 골라봤어. 마음에 드는 걸 눌러줘 👇`,
        options: candidates.map((c) => ({ id: c.id, name: c.name })),
      };
    }
    const cmd = parseCommand(text);
    if (cmd) {
      if (cmd.op === 'clear') {                        // "다 빼줘/전부 비워줘" — LLM 갈 것 없이 즉시
        if (!items.length) return { applied: false, reply: '방이 이미 비어 있어요.' };
        setItems([]); setSelectedId(null);
        return { applied: true, reply: '전부 비웠어! 처음부터 다시 배치해 보자 ✨' };
      }
      // 복수 대상("침대랑 소파 넣어줘") — 카테고리별로 연쇄 적용, 안 되는 것만 건너뛰고 안내.
      const cats = cmd.cats?.length ? cmd.cats : [cmd.cat];
      let next = items;
      const done = [], skipped = [];
      for (const c of cats) {
        if (cmd.op !== 'add' && !next.some((it) => it.cat === c)) { skipped.push(c); continue; }
        const r2 = applyChatCommand({ ...cmd, cat: c }, next);
        if (r2) { next = r2; done.push(c); } else skipped.push(c);
      }
      if (!done.length) {
        return { applied: false, reply: cmd.op !== 'add' ? `${skipped.join('·')}이(가) 아직 없어요.` : '그 요청은 반영하기 어려워요.' };
      }
      const label = done.join('·');
      const tail = skipped.length ? ` (${skipped.join('·')}은(는) 못 했어요)` : '';
      if (cmd.op === 'add' && hasPlaceHint(text)) {
        // 위치 표현이 있으면 LLM에게 방금 추가한 가구들을 문장대로 옮기게 함(실패해도 추가 자체는 유지).
        const added = next.slice(-done.length);
        const who = added.map((a) => `'${a.name}'(id: ${a.id})`).join(', ');
        const r = await chatLayout(room, openings, next, `${text} — 방금 추가한 ${who}의 위치를 이 문장대로 조정해줘.`, history);
        const moved = r?.decision === 'apply' ? applyLLMPositions(next, r.items) : null;
        setItems(moved || next); setSelectedId(null);   // 도면(플래너)에만 반영 — 사진은 '방 채우기' 눌렀을 때
        return { applied: true, reply: `${label} 반영했어! 도면에서 위치 확인해봐 ✏️${tail}` };
      }
      setItems(next); setSelectedId(null);
      return { applied: true, reply: cmd.op === 'add' ? `${label} 추가했어 ✏️ 위치는 드래그로 조정해봐${tail}` : `${label} 반영했어! 도면에서 확인해봐 ✏️${tail}` };
    }
    // 자연어 → LLM 재배치(기존 위치 재검증 후에만 반영)
    const r = await chatLayout(room, openings, items, text, history);
    if (r.decision === 'apply') {
      // 삭제 프로토콜(remove:[id...]) — "침대만 남기고 다 빼줘" 등. 삭제는 가구가 줄어드는
      // 변화라 기하 제약을 새로 깰 수 없으므로 검증 없이 반영한다.
      const removeIds = new Set(Array.isArray(r.remove) ? r.remove : []);
      const base = removeIds.size ? items.filter((it) => !removeIds.has(it.id)) : items;
      const hasCoords = Array.isArray(r.items) && r.items.length > 0;
      if (!hasCoords) {
        if (base.length < items.length) {              // 순수 삭제
          setItems(base); setSelectedId(null);
          return { applied: true, reply: (r.reason || '정리했어') + ' ✅ (도면에 반영)' };
        }
        // apply라면서 좌표도 삭제도 없음 — 겹침 탓으로 오진하지 말고 정직하게.
        return { applied: false, reply: (r.reason || '') + ' — 그런데 반영할 변경 내용을 못 받아서 배치는 그대로예요. 🤔 다시 말해줄래?' };
      }
      const next = applyLLMPositions(base, r.items);
      if (next) { setItems(next); setSelectedId(null); return { applied: true, reply: (r.reason || '재배치했어') + ' ✅ (도면에 반영)' }; }
      return { applied: false, reply: (r.reason || '') + ' — 다만 겹치거나 문을 막아서 반영하진 않았어요. 🚫' };
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
    setMarketRecommend(items.find((it) => it.glb || it.buyUrl) || items[0] || null);
    setScreen('market');
  }
  // 완성한 배치를 "방꾸 이야기"(홈 커뮤니티 세그먼트, design/커뮤니티.html 1c안)의 자랑(flex) 글로 공유.
  // 새 입력 폼 없이 이미 갖고 있는 값(합성 사진·평수·견적·취향 스타일)만으로 글을 만든다.
  async function shareToCommunity() {
    if (!renderImg || !room) return { status: 'ERROR', reason: '공유할 완성 사진이 없어요' };
    const sizeLabel = `${room.widthM.toFixed(1)}×${room.depthM.toFixed(1)}m`;
    const styleLabel = (taste?.moods || [])[0];
    const title = styleLabel ? `${sizeLabel} 원룸, ${styleLabel}로 꾸며봤어` : `${sizeLabel} 원룸 배치 완성!`;
    const meta = estimate > 0 ? `${sizeLabel} · ${estimateIsEst ? '약 ' : ''}${estimate.toLocaleString()}원` : sizeLabel;
    return postCommunity({ cat: 'flex', title, image: renderImg, meta });
  }
  // 배치함 저장 — 로그인했으면 서버(계정에 귀속·기기 바뀌어도 남음), 아니면 브라우저 localStorage.
  // 렌더 PNG는 1~2MB라 localStorage(5MB)엔 서너 개가 한계다. 서버는 PNG를 파일로 두고 URL만 준다.
  async function saveRoom() {
    if (!room) return { status: 'ERROR', reason: '저장할 방이 없어요' };
    const label = `${room.widthM}m × ${room.depthM}m`;
    if (user) {
      const r = await saveRoomServer({ room, openings, items, renderImg: renderImg || null, label, estimate, estimateIsEst });
      if (r?.status === 'OK') { await reloadRooms(); return { status: 'OK' }; }
      if (r?.status !== 'NOAUTH') return { status: 'ERROR', reason: r?.reason || '저장 실패' };
      // NOAUTH(토큰 만료 등)면 아래 로컬 저장으로 흘려보낸다 — 저장 자체를 잃지 않게.
    }
    try {
      const list = loadSavedRooms();
      list.unshift({
        id: `room-${Date.now()}`, savedAt: Date.now(),
        room, openings, items, image: renderImg || null,
        roomLabel: label, estimate, estimateIsEst, local: true,
      });
      const trimmed = list.slice(0, 8);   // 렌더 PNG가 커서 localStorage 한도(5MB)에 금방 닿는다
      localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(trimmed));
      setSavedRooms(trimmed);
      return { status: 'OK' };
    } catch (e) {
      // 용량 초과가 대부분 — 서버 저장을 권한다(로그인하면 개수 제한이 사실상 사라짐)
      return { status: 'ERROR', reason: user ? String(e.message || e) : '저장 공간이 꽉 찼어 — 로그인하면 서버에 저장돼' };
    }
  }

  // 저장된 배치로 되돌아가기 — 방·문창·가구가 통째로 남아 있어 그대로 편집을 이어갈 수 있다.
  // 렌더 사진도 같이 살려둔다(결과 화면으로 넘어갔을 때 빈 화면부터 다시 굽지 않게).
  function openSavedRoom(r) {
    if (!r?.room) return;
    setRoom(r.room);
    setOpenings(r.openings || []);
    setItems(r.items || []);
    setRenderImg(r.image || r.renderImg || null);
    setSelectedId(null);
    setPanoImg(null); panoKey.current = null;   // 다른 배치의 파노라마를 그대로 쓰면 안 된다
    setScreen('planner');
  }

  // 로그인 상태면 서버 배치함을 정본으로 쓴다(로컬 저장분은 로그인 전 기록이라 뒤에 붙인다).
  async function reloadRooms() {
    if (!user) { setSavedRooms(loadSavedRooms()); return; }
    const r = await fetchRooms();
    if (r?.status === 'OK') setSavedRooms([...r.rooms, ...loadSavedRooms()]);
  }
  useEffect(() => { reloadRooms(); }, [user]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 로컬 저장분(local:true)은 localStorage에서, 서버 저장분은 서버에서 지운다.
  async function deleteSavedRoom(id) {
    const target = savedRooms.find((r) => r.id === id);
    if (target?.local) {
      const next = loadSavedRooms().filter((r) => r.id !== id);
      localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(next));
      setSavedRooms((prev) => prev.filter((r) => r.id !== id));
      return;
    }
    const r = await deleteRoom(id);
    if (r?.status === 'OK') setSavedRooms((prev) => prev.filter((r2) => r2.id !== id));
  }
  function navTab(t) {
    setScreen(t);
  }

  // 도장은 왼쪽부터 순서대로만 켜져야 함(취향→방→배치→구매) — 이전 단계가 안 됐으면 뒤 단계는 실제로 달성됐어도 표시 안 함.
  const rawStamps = { taste: tasteDone, room: !!room, layout: items.length > 0, buy: furnitureBought };
  const stamps = {};
  let stampChain = true;
  for (const k of ['taste', 'room', 'layout', 'buy']) {
    stampChain = stampChain && rawStamps[k];
    stamps[k] = stampChain;
  }
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
          dimBusy={dimBusy} addFurniture={addFurniture} toggleFurniture={toggleFurniture} cam3d={cam3d}
          onChatSubmit={onChatSubmit} onPickChatOption={pickRecommended}
          onBack={() => setScreen('roominput')} onFinish={finishPlanner}
        />
      )}

      {panoOpen && panoImg && (
        <PanoViewer src={panoImg} caption="방 안에서 둘러보기" onClose={() => setPanoOpen(false)} />
      )}

      {screen === 'result' && (
        <CompositeResult
          renderImg={renderImg} renderBusy={renderBusy} renderTrigger={renderTrigger} showBefore={showBefore}
          onToggle={() => setShowBefore((v) => !v)} photo={roomPhoto} estimate={estimate} estimateIsEst={estimateIsEst}
          timePreset={renderPreset} onTime={(p) => renderWith(p, renderView, 'time')}
          view={renderView} onView={(v) => renderWith(renderPreset, v, 'view')}
          onBack={() => setScreen('planner')} onRerender={() => setScreen('planner')} onFindSimilar={findSimilar}
          onShare={shareToCommunity} onSave={saveRoom}
          onPano={openPano} panoBusy={panoBusy}
          hasLamp={items.some((it) => it.cat === '조명' && it.glb)}
          lampOn={lampOn} onLampToggle={cycleLamp} lampColor={lampColor} onLampColor={pickLampColor}
        />
      )}

      {screen === 'market' && (
        <MarketTab recommendItem={marketRecommend} onConsumeRecommend={() => setMarketRecommend(null)} onBuyClick={() => setFurnitureBought(true)} />
      )}

      {screen === 'mypage' && (
        <MyTab taste={taste} savedRooms={savedRooms} onOpenRoom={openSavedRoom} onDeleteRoom={deleteSavedRoom} user={user} onEditTaste={() => setScreen('onboarding')}
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
