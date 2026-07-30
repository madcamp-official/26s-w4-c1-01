import { useEffect, useMemo, useState } from 'react';
import { searchFurniture, recommendSimilar } from '../lib/api.js';
import { resolveDims, accuracyMeta, CATEGORIES, STYLE_OPTIONS, SIZE_OPTIONS, PRICE_OPTIONS, deriveStyle, deriveSize, derivePriceBand } from '../lib/catalog.js';
import { bedSizeLabel } from '../lib/oneroom.js';

// 가구 팔레트 — 자연어 검색 + 분위기/사이즈/종류 필터 + 네이버 유사추천 + 클릭으로 배치에 추가.
export default function CatalogPanel({ onAdd, placedItems }) {
  // 이미 방에 담은 상품 id — 카드 썸네일에 체크 표시용(탭하면 계속 추가는 되고, 표시만 해줌).
  const placedIds = useMemo(() => new Set((placedItems || []).map((it) => it.catId).filter(Boolean)), [placedItems]);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [source, setSource] = useState(null); // 'naver' | 'catalog' | 'local'
  const [loading, setLoading] = useState(false);
  const [catF, setCatF] = useState('');   // '' = 전체
  const [moodF, setMoodF] = useState('');
  const [sizeF, setSizeF] = useState('');
  const [priceF, setPriceF] = useState('');
  const [recFor, setRecFor] = useState(null);   // 추천 기준 아이템
  const [recItems, setRecItems] = useState([]);
  const [recLoading, setRecLoading] = useState(false);

  async function openRec(c) {
    setRecFor(c); setRecItems([]); setRecLoading(true);
    try {
      const r = await recommendSimilar({ name: c.name, cat: c.cat, w: c.w, d: c.d, h: c.h, style: deriveStyle(c) });
      setRecItems(Array.isArray(r.items) ? r.items : []);
    } finally {
      setRecLoading(false);
    }
  }

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
    if (priceF && derivePriceBand(c) !== priceF) return false;
    return true;
  }), [items, catF, moodF, sizeF, priceF]);

  const Chip = ({ val, cur, set, children }) => (
    <button className={'fchip' + (cur === val ? ' on' : '')} onClick={() => set(cur === val ? '' : val)}>{children}</button>
  );
  const hasFilter = catF || moodF || sizeF || priceF;

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
        <div className="filterrow"><span className="flabel">종류</span>{CATEGORIES.map((s) => <Chip key={s} val={s} cur={catF} set={setCatF}>{s}</Chip>)}</div>
        <div className="filterrow"><span className="flabel">사이즈</span>{SIZE_OPTIONS.map((s) => <Chip key={s} val={s} cur={sizeF} set={setSizeF}>{s}</Chip>)}</div>
        <div className="filterrow"><span className="flabel">분위기</span>{STYLE_OPTIONS.map((s) => <Chip key={s} val={s} cur={moodF} set={setMoodF}>{s}</Chip>)}</div>
        <div className="filterrow"><span className="flabel">가격대</span>{PRICE_OPTIONS.map((s) => <Chip key={s} val={s} cur={priceF} set={setPriceF}>{s}</Chip>)}</div>
        {hasFilter && (
          <div className="filterrow">
            <span className="fcount">{filtered.length}종</span>
            <button className="fchip clear" onClick={() => { setCatF(''); setMoodF(''); setSizeF(''); setPriceF(''); }}>초기화 ✕</button>
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
          const placed = placedIds.has(c.id);
          return (
            <div key={c.id} className={`catrow${placed ? ' on' : ''}`}>
              {/* 토글 — 담긴 상품을 다시 누르면 방금 담은 하나를 뺀다 */}
              <button className="catitem" onClick={() => onAdd(c)} title={placed ? '방에서 빼기' : '방에 추가'}>
                {c.image ? (
                  <img className="swatch" src={c.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <span className="swatch" style={{ background: c.color || rd.color || '#c9bfa8' }} />
                )}
                <span className="meta">
                  <span className="nm">
                    <span className="nm-t">{c.name}</span>
                    {/* 침대는 폭으로 규격을 부른다 — 목록에서 '내 방에 뭐가 들어가나'가 바로 읽히게 */}
                    {bedSizeLabel(c) && <span className="bedtag">{bedSizeLabel(c)}</span>}
                    {mood && <span className="moodtag">{mood}</span>}
                  </span>
                  <span className="dm">
                    {dimText}
                    <span className={`badge sm ${acc.tone}`}>{acc.short}</span>
                    <span className="sizetag">{deriveSize(c)}</span>
                    {c.source ? ` · ${c.source}` : ''}
                    {c.note ? ` · ${c.note}` : ''}
                    {typeof c.price === 'number' && c.price > 0 ? <> · <span className="pr">{c.price.toLocaleString()}원</span></> : null}
                    {placed && <span className="placedcheck" title="담김 — 다시 누르면 빠져요">✓</span>}
                  </span>
                </span>
              </button>
              <span className="catdiv" />
              <button className="recbtn" title="네이버에서 비슷한 상품 추천" onClick={() => openRec(c)}>
                <span className="recbtn-ico">🔎</span>
                <span className="recbtn-lbl">비슷</span>
              </button>
            </div>
          );
        })}
        {!filtered.length && !loading && <div className="mockup-note">조건에 맞는 가구가 없어요. 필터를 풀거나 다르게 검색해 보세요.</div>}
        {loading && <div className="mockup-note">검색 중…</div>}
      </div>

      {recFor && (
        <div className="modal-back" onClick={() => setRecFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🔎 ‘{recFor.name}’와 비슷한 상품</h2>
            <p className="mockup-note">AI가 종류·분위기·크기를 보고 네이버 쇼핑에서 비슷한 상품을 찾았어요. 눌러서 방에 추가하거나 구매로 이동.</p>
            {recLoading ? (
              <div className="mockup-note">추천 찾는 중…</div>
            ) : recItems.length ? (
              <div className="catlist rec">
                {recItems.map((it) => (
                  <div key={it.id || it.name} className="catrow">
                    <button className="catitem" onClick={() => { onAdd(it); setRecFor(null); }} title="방에 추가">
                      {it.image ? <img className="swatch" src={it.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <span className="swatch" />}
                      <span className="meta">
                        <span className="nm">{it.name}</span>
                        <span className="dm">
                          {it.w ? `${it.w}×${it.d}cm · ` : ''}{it.source || '네이버'}
                          {typeof it.price === 'number' && it.price > 0 ? <> · <span className="pr">{it.price.toLocaleString()}원</span></> : null}
                        </span>
                      </span>
                    </button>
                    {it.buyUrl && <a className="recbtn" href={it.buyUrl} target="_blank" rel="noreferrer" title="구매 페이지">🛒<span>구매</span></a>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mockup-note">추천 결과가 없어요. (네이버 키 미연동이거나 결과 없음)</div>
            )}
            <div className="selbar" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn ghost" onClick={() => setRecFor(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
