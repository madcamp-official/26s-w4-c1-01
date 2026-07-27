import { useEffect, useMemo, useState } from 'react';
import { searchFurniture } from '../lib/api.js';
import { resolveDims, accuracyMeta, CATEGORIES, STYLE_OPTIONS, SIZE_OPTIONS, deriveStyle, deriveSize } from '../lib/catalog.js';

// 가구 팔레트 — 자연어 검색 + 분위기/사이즈/종류 필터 + 클릭으로 배치에 추가.
export default function CatalogPanel({ onAdd }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [source, setSource] = useState(null); // 'naver' | 'catalog' | 'local'
  const [loading, setLoading] = useState(false);
  const [catF, setCatF] = useState('');   // '' = 전체
  const [moodF, setMoodF] = useState('');
  const [sizeF, setSizeF] = useState('');

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

  const filtered = useMemo(() => items.filter((c) => {
    if (catF && c.cat !== catF) return false;
    if (moodF && deriveStyle(c) !== moodF) return false;
    if (sizeF && deriveSize(c) !== sizeF) return false;
    return true;
  }), [items, catF, moodF, sizeF]);

  const Chip = ({ val, cur, set, children }) => (
    <button className={'fchip' + (cur === val ? ' on' : '')} onClick={() => set(cur === val ? '' : val)}>{children}</button>
  );
  const hasFilter = catF || moodF || sizeF;

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

      <div className="filterbar">
        <div className="filterrow"><span className="flabel">분위기</span>{STYLE_OPTIONS.map((s) => <Chip key={s} val={s} cur={moodF} set={setMoodF}>{s}</Chip>)}</div>
        <div className="filterrow"><span className="flabel">사이즈</span>{SIZE_OPTIONS.map((s) => <Chip key={s} val={s} cur={sizeF} set={setSizeF}>{s}</Chip>)}</div>
        <div className="filterrow"><span className="flabel">종류</span>{CATEGORIES.map((s) => <Chip key={s} val={s} cur={catF} set={setCatF}>{s}</Chip>)}</div>
        {hasFilter && (
          <div className="filterrow">
            <span className="fcount">{filtered.length}종</span>
            <button className="fchip clear" onClick={() => { setCatF(''); setMoodF(''); setSizeF(''); }}>초기화 ✕</button>
          </div>
        )}
      </div>

      <div className="catlist">
        {filtered.map((c) => {
          const known = typeof c.w === 'number' && c.w > 0 && typeof c.d === 'number' && c.d > 0;
          const rd = resolveDims(c);
          const acc = accuracyMeta(known ? c.dimAccuracy : '추정(기본)');
          const dimText = known ? `${c.w}×${c.d}${c.h ? `×${c.h}` : ''}cm` : `≈${rd.w}×${rd.d}cm`;
          const mood = deriveStyle(c);
          return (
            <button key={c.id} className="catitem" onClick={() => onAdd(c)} title="방에 추가">
              {c.image ? (
                <img className="swatch" src={c.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <span className="swatch" style={{ background: c.color || rd.color || '#c9bfa8' }} />
              )}
              <span className="meta">
                <span className="nm">
                  {c.name}
                  {mood && <span className="moodtag">{mood}</span>}
                </span>
                <span className="dm">
                  {dimText}
                  <span className={`badge sm ${acc.tone}`}>{acc.short}</span>
                  <span className="sizetag">{deriveSize(c)}</span>
                  {c.source ? ` · ${c.source}` : ''}
                  {typeof c.price === 'number' && c.price > 0 ? <> · <span className="pr">{c.price.toLocaleString()}원</span></> : null}
                </span>
              </span>
            </button>
          );
        })}
        {!filtered.length && !loading && <div className="mockup-note">조건에 맞는 가구가 없어요. 필터를 풀거나 다르게 검색해 보세요.</div>}
        {loading && <div className="mockup-note">검색 중…</div>}
      </div>
    </div>
  );
}
