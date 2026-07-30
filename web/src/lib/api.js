// 마켓 연동 클라이언트 — LLM 래핑 + 네이버쇼핑 grounding은 백엔드가 담당.
// 백엔드/키가 없으면 로컬 시드 카탈로그로 폴백해 앱이 단독으로 돌아간다(정직 원칙: fallback은 MVP).
import { CATALOG } from './catalog.js';
import { authToken } from './auth.js';

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
export async function renderScene(room, items, cam3d, preset = 'day', view = null, openings = [], lamp = {}, pano = false) {
  const W = room.widthM, D = room.depthM;
  const payload = {
    room: { w: W, d: D, h: 2.6 },
    preset,   // 시간대 조명: 'morning'|'day'|'sunset'|'night'
    // 2D 평면의 문/창(m). 서버가 렌더 벽 좌표로 매핑해 창·문을 그 위치에 그린다.
    openings: (openings || []).map((o) => ({ kind: o.kind, wall: o.wall, pos: o.pos, width: o.width })),
    // 비직사각형 방: 컷아웃(m) — 렌더가 바닥부터 천장까지 벽체 박스로 세운다.
    cutouts: (room.cutouts || []).map((c) => ({ x: c.x, y: c.y, w: c.w, d: c.d })),
    // 조명 수동 제어 — lampOn(null=프리셋 정책: 밤/노을 ON), lampColor(hex 색온도)
    ...(lamp.on !== undefined && lamp.on !== null ? { lampOn: lamp.on } : {}),
    ...(lamp.color ? { lampColor: lamp.color } : {}),
    items: items.filter((it) => it.glb).map((it) => ({
      glb: it.glb, x: it.cx, y: it.cy, rot: (it.rotationDeg || 0) + (it.orient || 0),   // orient=모델 정면 보정각
      ...(it.elevM ? { elev: it.elevM } : {}),   // 탁상 조명 등 '가구 위' 배치 높이(m)
      // 조명 가구 = 실제 광원 — 렌더가 전구 위치(h 기준)에 웜톤 라이트를 심는다(분위기 사진의 핵심)
      ...(it.cat === '조명' ? { lamp: true, h: it.hM || 1.5 } : {}),
    })),
  };
  if (pano) {
    // 360° 둘러보기 — 서버가 방 안 눈높이의 설 자리를 골라 등장방형 한 장을 굽는다(카메라·앵글 무시).
    payload.pano = true;
  } else if (view) {
    // 자동 다각도('wide'|'cozy') — 카메라 대신 서버가 프레이밍을 결정.
    payload.view = view;
  } else if (cam3d?.pos && cam3d?.target) {
    // 사용자의 현재 3D 시점을 렌더에 전달. three.js(x, y=up, z) → Blender(x+W/2, D/2−z, y) 손대칭 없는 변환.
    // lens=35(표준 화각): 서버 wide 프리셋(lens=18, 광각)보다 뚜렷이 좁게 잡아 '내 시점'이 더 가깝게 느껴지도록.
    payload.camera = {
      pos: [cam3d.pos[0] + W / 2, D / 2 - cam3d.pos[2], cam3d.pos[1]],
      target: [cam3d.target[0] + W / 2, D / 2 - cam3d.target[2], cam3d.target[1]],
      lens: 35,
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
    // 비직사각형 방: 배치금지 사각존(컷아웃, cm) — LLM에게 '가상 장애물'로 알림. 앱이 다시 기하 검증.
    zones: (room.cutouts || []).map((c) => ({
      x: Math.round(c.x * 100), y: Math.round(c.y * 100), w: Math.round(c.w * 100), d: Math.round(c.d * 100),
    })),
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

// 대화형 배치 — 현재 배치 + 사용자 요청 → {decision:'apply'|'reject', reason, items?}. 앱이 apply를 기하 재검증 후 반영.
export async function chatLayout(room, openings, items, message, history) {
  const payload = {
    room: { W: Math.round(room.widthM * 100), D: Math.round(room.depthM * 100) },
    zones: (room.cutouts || []).map((c) => ({
      x: Math.round(c.x * 100), y: Math.round(c.y * 100), w: Math.round(c.w * 100), d: Math.round(c.d * 100),
    })),
    openings: (openings || []).map((o) => ({
      kind: o.kind, wall: o.wall, pos: Math.round((o.pos || 0) * 100),
      width: Math.round((o.width || 0.9) * 100), ...(o.kind === 'door' ? { hinge: o.hinge || 'a' } : {}),
    })),
    furniture: items.map((it) => ({
      id: it.id, name: it.name, category: it.cat,
      w: Math.round(it.wM * 100), d: Math.round(it.dM * 100), h: Math.round((it.hM || 0.5) * 100),
      cx: Math.round(it.cx * 100), cy: Math.round(it.cy * 100), rotation: it.rotationDeg || 0,
    })),
    message,
    history: (history || []).map((h) => ({ role: h.role, text: h.text })),
  };
  try {
    const res = await fetch(`${API_BASE}/api/chat-layout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: timeout(70000),
    });
    if (!res.ok) return { status: 'ERROR', decision: 'reject', reason: `서버 오류(${res.status})` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', decision: 'reject', reason: '연결 실패: ' + String(e.message || e) };
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

// 로그인돼 있으면 Authorization 헤더를 실어 보낸다(글 소유자 판별 — 서버가 'mine' 플래그로 돌려줌).
function authHeaders() {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// 방꾸 이야기(커뮤니티) 피드 조회. 반환: { source: 'server'|'local', posts: [...] | null }.
// posts:null이면 호출부가 로컬 목업(appdata.COMMUNITY_POSTS)으로 폴백해야 한다는 뜻(searchFurniture와 동일한 폴백 계약).
export async function fetchCommunityFeed(cat = 'all') {
  try {
    const res = await fetch(`${API_BASE}/api/community/feed?cat=${encodeURIComponent(cat)}`, { headers: authHeaders(), signal: timeout(6000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = await res.json();
    if (data?.status === 'OK' && Array.isArray(data.posts)) return { source: 'server', posts: data.posts };
    throw new Error(data?.reason || data?.status || 'feed error');
  } catch (e) {
    return { source: 'local', reason: String(e.message || e), posts: null };
  }
}

// 방꾸 이야기 글쓰기. 반환: {status:'OK', post} | {status:'ERROR', reason}.
export async function postCommunity({ cat, title, image, meta }) {
  try {
    const res = await fetch(`${API_BASE}/api/community/post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ cat, title, image, meta }), signal: timeout(20000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}

// 방꾸 이야기 글 수정(제목/부가정보) — 본인 글만 서버가 허용. 반환: {status:'OK'|'FORBIDDEN'|'NOAUTH'|'ERROR', reason?}.
export async function updateCommunityPost(id, { title, meta }) {
  try {
    const res = await fetch(`${API_BASE}/api/community/post/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title, meta }), signal: timeout(20000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}

// 방꾸 이야기 글 삭제 — 본인 글만 서버가 허용. 반환: {status:'OK'|'FORBIDDEN'|'NOAUTH'|'ERROR', reason?}.
export async function deleteCommunityPost(id) {
  try {
    const res = await fetch(`${API_BASE}/api/community/post/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: authHeaders(), signal: timeout(20000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}

// 방꾸 이야기 글 좋아요 토글 — 로그인 필요. 반환: {status:'OK', liked, likes} | {status:'NOAUTH'|'ERROR', reason?}.
export async function likeCommunityPost(id) {
  try {
    const res = await fetch(`${API_BASE}/api/community/post/${encodeURIComponent(id)}/like`, {
      method: 'POST', headers: authHeaders(), signal: timeout(15000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}

// 내가 좋아요한 글 목록(마이 탭) — 로그인 필요. 반환: {status:'OK', posts:[...]} | {status:'NOAUTH'|'ERROR', posts:[]}.
export async function fetchLikedPosts() {
  try {
    const res = await fetch(`${API_BASE}/api/community/liked`, { headers: authHeaders(), signal: timeout(10000) });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}`, posts: [] };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e), posts: [] };
  }
}

// ── 배치함(저장한 방) — 서버 보관. 렌더 PNG는 서버가 파일로 떨어뜨리고 목록엔 URL만 온다.
// 로그인 안 했으면 NOAUTH → 앱이 localStorage로 폴백(정직 원칙: 되는 만큼만).
export async function saveRoomServer(payload) {
  try {
    const res = await fetch(`${API_BASE}/api/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload), signal: timeout(30000),   // 렌더 PNG가 1~2MB라 넉넉히
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}

export async function fetchRooms() {
  try {
    const res = await fetch(`${API_BASE}/api/rooms`, { headers: authHeaders(), signal: timeout(10000) });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}`, rooms: [] };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e), rooms: [] };
  }
}

export async function deleteRoom(id) {
  try {
    const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: authHeaders(), signal: timeout(10000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}

function localSearch(q) {
  if (!q) return CATALOG;
  // 카테고리 힌트 + 사용자 검색어가 함께 올 수 있어(예: "침대 원목") 단어 단위 AND 매칭.
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = CATALOG.filter((c) => {
    const hay = `${c.name} ${c.cat}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  return hit.length ? hit : CATALOG;
}

function timeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// 도면 사진 → 편집 가능한 방 초안. hintM(사용자가 줄자로 잰 가로 한 변)을 주면 그 비율로 보정된다.
// 반환: {status:'OK', room:{widthM,depthM,cutouts,openings}, accuracy, confidence, note} | {status:'NOKEY'|'ERROR'}
// 정직 원칙: LLM 판독은 확정이 아니라 초안이다. 호출부는 accuracy/confidence를 UI에 그대로 노출해야 한다.
export async function readFloorplan(dataUrl, hintM = null) {
  try {
    const res = await fetch(`${API_BASE}/api/floorplan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, ...(hintM ? { hintM } : {}) }), signal: timeout(150000),
    });
    if (!res.ok) return { status: 'ERROR', reason: `http ${res.status}` };
    return await res.json();
  } catch (e) {
    return { status: 'ERROR', reason: String(e.message || e) };
  }
}
