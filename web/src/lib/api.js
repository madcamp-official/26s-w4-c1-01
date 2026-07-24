// 마켓 연동 클라이언트 — LLM 래핑 + 네이버쇼핑 grounding은 백엔드가 담당.
// 백엔드/키가 없으면 로컬 시드 카탈로그로 폴백해 앱이 단독으로 돌아간다(정직 원칙: fallback은 MVP).
import { CATALOG } from './catalog.js';

const API_BASE = import.meta.env?.VITE_API_BASE ?? '';

// 자연어 쿼리로 가구 검색. 반환: [{id,name,cat,w,d,h,lowBox,color,source,dimAccuracy,price?,buyUrl?}]
export async function searchFurniture(query) {
  const q = (query || '').trim();
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`, { signal: timeout(4000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (data?.status === 'FALLBACK' || !Array.isArray(data?.items)) throw new Error('backend fallback');
    return data.items;
  } catch (e) {
    // 로컬 폴백: 이름/카테고리 부분일치. 네이버 grounding 없으므로 dimAccuracy는 시드값 유지.
    return localSearch(q);
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
