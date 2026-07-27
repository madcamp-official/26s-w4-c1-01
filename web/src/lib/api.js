// 마켓 연동 클라이언트 — LLM 래핑 + 네이버쇼핑 grounding은 백엔드가 담당.
// 백엔드/키가 없으면 로컬 시드 카탈로그로 폴백해 앱이 단독으로 돌아간다(정직 원칙: fallback은 MVP).
import { CATALOG } from './catalog.js';

const API_BASE = import.meta.env?.VITE_API_BASE ?? '';

// 자연어 쿼리로 가구 검색.
// 반환: { source: 'naver' | 'local', reason?, items: [...] }
// source로 "네이버 실검색이 붙었는지"를 UI가 명시할 수 있게 한다(폴백이 조용히 일어나는 문제 방지).
export async function searchFurniture(query) {
  const q = (query || '').trim();
  // 기본(빈 검색) = 실측 3D 쇼룸(ABO GLB). 검색어를 넣으면 네이버 실상품으로.
  if (!q) return { source: 'catalog', items: CATALOG };
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`, { signal: timeout(4000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = await res.json();
    if (data?.status === 'OK' && Array.isArray(data.items) && data.items.length) {
      return { source: 'naver', items: data.items };
    }
    throw new Error(data?.reason || data?.status || 'no items');
  } catch (e) {
    // 로컬 폴백: 백엔드 미연동/키 없음/네트워크 실패. 시드 카탈로그로 앱이 계속 동작.
    return { source: 'local', reason: String(e.message || e), items: localSearch(q) };
  }
}

// 유사 가구 추천 — LLM이 네이버 검색어를 만들어 비슷한 상품을 찾아준다.
// item: {name, cat, w, d, h, style}. 반환: {status, queries?, items:[네이버상품]}.
export async function recommendSimilar(item) {
  try {
    const res = await fetch(`${API_BASE}/api/recommend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item }), signal: timeout(30000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}`, items: [] };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e), items: [] };
  }
}

// 합성 목업 → GPU 리라이팅(camp-3 SD). 반환: {status:'OK',image} | {status:'CLIENT'}(서버 미연동).
export async function relightImage(dataUrl, strength = 0.3) {
  try {
    const res = await fetch(`${API_BASE}/api/relight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, strength }),
      signal: timeout(120000),
    });
    if (!res.ok) return { status: 'CLIENT', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'CLIENT', reason: String(e.message || e) };
  }
}

// 포토리얼 렌더 — 현재 3D 배치 → camp-3 Blender 사진. 반환: {status:'OK'|'CLIENT'|'ERROR', image}.
// glb 있는 아이템만 보낸다(치수·위치는 미터·room 좌표 그대로 → 서버가 blender 좌표로 사용).
export async function renderScene(room, items, cam3d, preset = 'day', view = null, openings = []) {
  const W = room.widthM, D = room.depthM;
  const payload = {
    room: { w: W, d: D, h: 2.6 },
    preset,   // 시간대 조명: 'morning'|'day'|'sunset'|'night'
    // 2D 평면의 문/창(m). 서버가 렌더 벽 좌표로 매핑해 창·문을 그 위치에 그린다.
    openings: (openings || []).map((o) => ({ kind: o.kind, wall: o.wall, pos: o.pos, width: o.width })),
    items: items.filter((it) => it.glb).map((it) => ({
      glb: it.glb, x: it.cx, y: it.cy, rot: it.rotationDeg || 0,
    })),
  };
  if (view) {
    // 자동 다각도('wide'|'cozy') — 카메라 대신 서버가 프레이밍을 결정.
    payload.view = view;
  } else if (cam3d?.pos && cam3d?.target) {
    // 사용자의 현재 3D 시점을 렌더에 전달. three.js(x, y=up, z) → Blender(x+W/2, D/2−z, y) 손대칭 없는 변환.
    payload.camera = {
      pos: [cam3d.pos[0] + W / 2, D / 2 - cam3d.pos[2], cam3d.pos[1]],
      target: [cam3d.target[0] + W / 2, D / 2 - cam3d.target[2], cam3d.target[1]],
      lens: 22,
    };
  }
  try {
    const res = await fetch(`${API_BASE}/api/render`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: timeout(300000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}

// 원룸 자동 배치 — 백엔드(Claude)로 후보 생성. 반환: {status:'OK'|'NOKEY'|'ERROR', candidates}.
// 치수는 cm 정수로 보낸다(LLM이 정수 좌표를 잘 다룸). 앱이 받은 후보를 기하엔진으로 재검증한다.
export async function layoutFurniture(room, items, openings = []) {
  const payload = {
    room: { W: Math.round(room.widthM * 100), D: Math.round(room.depthM * 100) },
    // 문/창을 cm로 전달(문=90° 스윙 앞을 비우고, 창은 가리지 말라고 LLM에 알림). 앱이 다시 기하 검증.
    openings: openings.map((o) => ({
      kind: o.kind, wall: o.wall, pos: Math.round((o.pos || 0) * 100),
      width: Math.round((o.width || 0.9) * 100), ...(o.kind === 'door' ? { hinge: o.hinge || 'a' } : {}),
    })),
    furniture: items.map((it) => ({
      id: it.id, name: it.name, category: it.cat,   // name: TV장 등 종류 식별에 활용
      w: Math.round(it.wM * 100), d: Math.round(it.dM * 100), h: Math.round((it.hM || 0.5) * 100),
    })),
  };
  try {
    const res = await fetch(`${API_BASE}/api/layout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: timeout(90000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}

// 상품 상세페이지에서 치수 자동 추출. 성공 시 {w,d,h,accuracy}, 실패/미상 시 null.
export async function fetchDims(url) {
  if (!url) return null;
  try {
    const res = await fetch(`${API_BASE}/api/dims?url=${encodeURIComponent(url)}`, { signal: timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.status === 'OK' ? data.dims : null;
  } catch {
    return null;
  }
}

function localSearch(q) {
  if (!q) return CATALOG;
  const low = q.toLowerCase();
  const hit = CATALOG.filter((c) => c.name.toLowerCase().includes(low) || c.cat.toLowerCase().includes(low));
  return hit.length ? hit : CATALOG;
}

function timeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
