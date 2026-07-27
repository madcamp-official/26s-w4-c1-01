import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, deriveStyle, deriveSize, accuracyMeta } from '../lib/catalog.js';
import { searchFurniture, recommendSimilar } from '../lib/api.js';
import { MARKET_CATS, MARKET_PRICES, MOODS, MOOD_BG, MOOD_TO_STYLE } from '../lib/appdata.js';

const PRICE_RANGE = {
  '~10만': [0, 100000], '10~30': [100000, 300000], '30~50': [300000, 500000],
  '50~100': [500000, 1000000], '100+': [1000000, Infinity],
};

// 마켓 — 카테고리 세그먼트 + 검색(네이버) + 필터(분위기/가격/사이즈) + 상품 2열 그리드.
// 결과에서 '닮은 상품 찾기'로 진입하면 배치한 가구로 recommendSimilar 실행(네이버 실상품).
export default function MarketTab({ recommendItem, onConsumeRecommend }) {
  const [cat, setCat] = useState(0);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState(null);      // {source, items} — 검색/추천 결과
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null);        // 'mood' | 'price'
  const [moods, setMoods] = useState([]);
  const [price, setPrice] = useState(null);
  const [sizeOnly, setSizeOnly] = useState(false);
  const reqId = useRef(0);   // 진행 중 원격요청 토큰 — 사용자가 그 사이 카테고리/검색을 바꾸면 늦게 온 응답을 무시.

  // 결과 화면에서 넘어온 추천 요청 처리(1회).
  useEffect(() => {
    if (!recommendItem) return;
    const my = ++reqId.current;
    setBusy(true);
    recommendSimilar({ name: recommendItem.name, cat: recommendItem.cat, w: Math.round(recommendItem.wM * 100), d: Math.round(recommendItem.dM * 100), h: Math.round((recommendItem.hM || 0.5) * 100), style: deriveStyle(recommendItem) })
      .then((r) => { if (my === reqId.current) setRemote(r?.status === 'OK' && r.items?.length ? { source: 'naver', items: r.items } : null); })
      .finally(() => { if (my === reqId.current) setBusy(false); onConsumeRecommend?.(); });
  }, [recommendItem]);

  function pickCategory(i) { reqId.current++; setCat(i); setRemote(null); setQuery(''); setBusy(false); }

  async function runSearch(q) {
    const my = ++reqId.current;
    setQuery(q);
    if (!q.trim()) { setRemote(null); return; }
    setBusy(true);
    const r = await searchFurniture(q);
    if (my === reqId.current) { setRemote(r); setBusy(false); }
  }

  const styleWanted = useMemo(() => new Set(moods.flatMap((m) => MOOD_TO_STYLE[m] || [])), [moods]);

  const items = useMemo(() => {
    let list = remote ? remote.items : CATALOG.filter((c) => MARKET_CATS[cat].match(c.cat));
    if (styleWanted.size) list = list.filter((it) => styleWanted.has(deriveStyle(it)));
    if (price && PRICE_RANGE[price]) {
      const [lo, hi] = PRICE_RANGE[price];
      list = list.filter((it) => typeof it.price === 'number' && it.price >= lo && it.price < hi);
    }
    if (sizeOnly) list = list.filter((it) => deriveSize(it) !== '대형');
    return list;
  }, [remote, cat, styleWanted, price, sizeOnly]);

  const source = remote?.source;
  const chip = (active, count) => `fpill${active ? ' on' : ''}`;

  return (
    <div className="market">
      <div className="body">
        <div className="catseg">
          {MARKET_CATS.map((c, i) => (
            <button key={c.label} className={`fpill catpill ${!remote && cat === i ? 'on' : ''}`} onClick={() => pickCategory(i)}>{c.label}</button>
          ))}
        </div>

        <div className="search-fake">
          <span>🔎</span>
          <input value={query} placeholder="가구 이름으로 네이버에서 찾기" onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(query); }} />
          {query && <button className="tlink" style={{ padding: 0 }} onClick={() => { reqId.current++; setQuery(''); setRemote(null); setBusy(false); }}>지우기</button>}
        </div>

        <div className="chiprow">
          <button className={chip(moods.length)} onClick={() => setSheet('mood')}>분위기{moods.length ? <span className="cnt">{moods.length}</span> : null}</button>
          <button className={chip(!!price)} onClick={() => setSheet('price')}>가격대</button>
          <button className={chip(sizeOnly)} onClick={() => setSizeOnly((v) => !v)}>우리 방에 맞는 것만</button>
        </div>

        {busy ? (
          <div className="empty"><div className="spinner sm" /><p>불러오는 중…</p></div>
        ) : items.length === 0 ? (
          <div className="empty"><span className="emoji">🔍</span><p>조건에 맞는 상품이 없어. 필터를 풀어볼까?</p></div>
        ) : (
          <div className="pgrid">
            {items.map((it, i) => {
              const solid = accuracyMeta(it.dimAccuracy)?.tone === 'ok';
              const card = (
                <>
                  <span className="thumb">
                    {it.image ? <img src={it.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <span style={{ position: 'absolute', inset: 0, background: it.color || '#EAD7CE' }} />}
                    {source === 'naver' && <span className="nbadge">N</span>}
                  </span>
                  <div className="pnm">{it.name}</div>
                  <div className="ppr">
                    {typeof it.price === 'number' && it.price > 0 ? `${it.price.toLocaleString()}원` : '가격문의'}
                    <span className={`badge ${solid ? 'ok' : 'est'} sm`}>{solid ? '실치수' : '추정'}</span>
                  </div>
                </>
              );
              return it.buyUrl
                ? <a key={it.id || i} className="pcard" href={it.buyUrl} target="_blank" rel="noreferrer">{card}</a>
                : <div key={it.id || i} className="pcard">{card}</div>;
            })}
          </div>
        )}
        <p className="market-note">
          {source === 'naver' ? '네이버쇼핑 실시간 검색 결과예요. 배치에 쓴 가구와 정확히 같은 제품이 아닌 ‘닮은 상품’일 수 있어.'
            : source === 'local' ? '네이버 연동이 없어 예시 카탈로그를 보여주고 있어.'
            : '실측 3D 쇼룸이야. 이름으로 검색하면 네이버 닮은 상품을 찾아줄게.'}
        </p>
      </div>

      {sheet === 'mood' && (
        <div className="sheet-back" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <div className="stitle">어떤 분위기가 좋아? (최대 2개)</div>
            <div className="moodgrid c3">
              {MOODS.map((name) => (
                <button key={name} className={`moodcard ${moods.includes(name) ? 'on' : ''}`}
                  onClick={() => setMoods((p) => p.includes(name) ? p.filter((m) => m !== name) : (p.length >= 2 ? [p[1], name] : [...p, name]))}>
                  <div className="thumb" style={{ background: MOOD_BG[name] }} />
                  <div className="lbl">{name}</div>
                  {moods.includes(name) && <span className="check">✓</span>}
                </button>
              ))}
            </div>
            <button className="cta" onClick={() => setSheet(null)}>적용하기</button>
          </div>
        </div>
      )}

      {sheet === 'price' && (
        <div className="sheet-back" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <div className="stitle">가격대는 어느 정도가 좋아?</div>
            <div className="pillrow eq">
              {MARKET_PRICES.map((p) => (
                <button key={p} className={`pill ${price === p ? 'on' : ''}`} onClick={() => setPrice(price === p ? null : p)}>{p}</button>
              ))}
            </div>
            <button className="cta" onClick={() => setSheet(null)}>적용하기</button>
          </div>
        </div>
      )}
    </div>
  );
}
