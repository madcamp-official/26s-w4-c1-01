// 소셜 로그인 클라이언트 — 백엔드 OAuth 플로우와 연동.
// 흐름: 버튼 → /api/auth/{p}/login(302 → 플랫폼) → 콜백 → '/#auth=서명토큰' 복귀 → 여기서 파싱·보관.
const KEY = 'bk-auth';
const API_BASE = import.meta.env?.VITE_API_BASE ?? '';

function decodeUser(token) {
  try {
    const b = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(decodeURIComponent(escape(atob(b + '='.repeat((4 - (b.length % 4)) % 4)))));
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return p;
  } catch { return null; }
}

// 부팅 시 1회 — 콜백 해시(#auth=/#auth_error=)를 소비하고 URL을 정리한다.
export function consumeAuthHash() {
  const h = window.location.hash || '';
  if (h.startsWith('#auth=')) {
    const t = h.slice(6);
    const u = decodeUser(t);
    history.replaceState(null, '', window.location.pathname + window.location.search);
    if (u) { localStorage.setItem(KEY, t); return { user: u }; }
    return { error: 'badtoken' };
  }
  if (h.startsWith('#auth_error=')) {
    const err = decodeURIComponent(h.slice(12));
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return { error: err };
  }
  return null;
}

export function currentUser() {
  const t = localStorage.getItem(KEY);
  const u = t ? decodeUser(t) : null;
  if (t && !u) localStorage.removeItem(KEY);   // 만료/변조 토큰 정리
  return u;
}

export function logout() { localStorage.removeItem(KEY); }

export const loginUrl = (provider) => `${API_BASE}/api/auth/${provider}/login`;

// 어떤 플랫폼에 키가 설정돼 있는지 — 미설정이면 프론트가 데모 로그인으로 폴백.
export async function fetchProviders() {
  try {
    const r = await fetch(`${API_BASE}/api/auth/providers`);
    if (!r.ok) throw new Error();
    return await r.json();
  } catch { return { kakao: false, naver: false, google: false }; }
}
