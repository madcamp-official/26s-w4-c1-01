import { useEffect, useState } from 'react';
import { searchFurniture } from '../lib/api.js';

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
        <div className="badge ok" style={{ marginBottom: 8 }}>● 네이버 실검색 {items.length}건</div>
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
        {items.map((c) => (
          <button key={c.id} className="catitem" onClick={() => onAdd(c)} title="방에 추가">
            <span className="swatch" style={{ background: c.color || '#c9bfa8' }} />
            <span className="meta">
              <span className="nm">{c.name}</span>
              <span className="dm">
                {c.w}×{c.d}×{c.h}cm · {c.dimAccuracy === '정형' ? '정형치수' : '추정치수'}
                {c.source ? ` · ${c.source}` : ''}
              </span>
            </span>
          </button>
        ))}
        {loading && <div className="mockup-note">검색 중…</div>}
      </div>
    </div>
  );
}
