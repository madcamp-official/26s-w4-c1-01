import { useEffect, useState } from 'react';
import { searchFurniture } from '../lib/api.js';
import { resolveDims, accuracyMeta } from '../lib/catalog.js';

// 가구 팔레트 — 자연어 검색(백엔드 grounding, 없으면 로컬 시드) + 클릭으로 배치에 추가.
export default function CatalogPanel({ onAdd }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [source, setSource] = useState(null); // 'naver' | 'local'
  const [loading, setLoading] = useState(false);

  async function run(query) {
    setLoading(true);
    try {
      const r = await searchFurniture(query);
      setItems(r.items);
      setSource(r.source);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { run(''); }, []);

  return (
    <div className="palette">
      <h3>가구</h3>
      {source === 'naver' ? (
        <div className="badge ok" style={{ marginBottom: 8 }}>● 네이버 실검색 {items.length}건 · 대표 3D로 미리보기</div>
      ) : source === 'catalog' ? (
        <div className="badge mid" style={{ marginBottom: 8 }}>● 실측 3D 가구 {items.length}종 · 검색하면 네이버 실상품</div>
      ) : source === 'local' ? (
        <div className="badge warn" style={{ marginBottom: 8 }}>● 로컬 시드 (백엔드 미연동)</div>
      ) : null}
      <div className="searchbar">
        <input
          type="text"
          placeholder="예: 3인 소파"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run(q)}
        />
        <button className="btn" onClick={() => run(q)} disabled={loading}>검색</button>
      </div>
      <div className="catlist">
        {items.map((c) => {
          const known = typeof c.w === 'number' && c.w > 0 && typeof c.d === 'number' && c.d > 0;
          const rd = resolveDims(c);
          const acc = accuracyMeta(known ? c.dimAccuracy : '추정(기본)');
          const dimText = known ? `${c.w}×${c.d}${c.h ? `×${c.h}` : ''}cm` : `≈${rd.w}×${rd.d}cm`;
          return (
            <button key={c.id} className="catitem" onClick={() => onAdd(c)} title="방에 추가">
              {c.image ? (
                <img className="swatch" src={c.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <span className="swatch" style={{ background: c.color || rd.color || '#c9bfa8' }} />
              )}
              <span className="meta">
                <span className="nm">{c.name}</span>
                <span className="dm">
                  {dimText}
                  <span className={`badge sm ${acc.tone}`}>{acc.short}</span>
                  {c.source ? ` · ${c.source}` : ''}
                  {typeof c.price === 'number' && c.price > 0 ? <> · <span className="pr">{c.price.toLocaleString()}원</span></> : null}
                </span>
              </span>
            </button>
          );
        })}
        {loading && <div className="mockup-note">검색 중…</div>}
      </div>
    </div>
  );
}
