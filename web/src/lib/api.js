// 마켓 연동 클라이언트 — LLM 래핑 + 네이버쇼핑 grounding은 백엔드가 담당.
// 백엔드/키가 없으면 로컬 시드 카탈로그로 폴백해 앱이 단독으로 돌아간다(정직 원칙: fallback은 MVP).
import { CATALOG } from './catalog.js';

const API_BASE = import.meta.env?.VITE_API_BASE ?? '';

// 자연어 쿼리로 가구 검색.
// 반환: { source: 'naver' | 'local', reason?, items: [...] }
// source로 "네이버 실검색이 붙었는지"를 UI가 명시할 수 있게 한다(폴백이 조용히 일어나는 문제 방지).
export async function searchFurniture(query) {
  const q = (query || '').trim();
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
