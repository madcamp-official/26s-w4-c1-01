import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, deriveStyle, deriveSize, accuracyMeta } from '../lib/catalog.js';
import { searchFurniture, recommendSimilar } from '../lib/api.js';
import { MARKET_CATS, MOODS, MOOD_BG, MOOD_TO_STYLE } from '../lib/appdata.js';
import { getWishlist, toggleWish } from '../lib/wishlist.js';

const SORT_OPTIONS = [['', '가격순'], ['asc', '낮은 가격순'], ['desc', '높은 가격순']];

// 마켓 — 카테고리 세그먼트 + 검색(네이버) + 필터(분위기/가격순/사이즈) + 상품 2열 그리드.
// 결과에서 '닮은 상품 찾기'로 진입하거나, 구매링크 없는 로컬 카탈로그 카드를 클릭하면 recommendSimilar 실행(네이버 실상품).
export default function MarketTab({ recommendItem, onConsumeRecommend, onBuyClick }) {
  const [cat, setCat] = useState(0);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState(null);      // {source, items} — 검색/추천 결과
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null);        // 'mood'
  const [moods, setMoods] = useState([]);
  const [sizeOnly, setSizeOnly] = useState(false);
  const [sort, setSort] = useState(null);          // null | 'asc' | 'desc' — 가격순 정렬
  const [sortOpen, setSortOpen] = useState(false);
  const [sortMenuPos, setSortMenuPos] = useState(null);   // {top,right}px — .chiprow가 overflow-x:auto라 absolute로는 잘려서 fixed+좌표계산
  const sortBtnRef = useRef(null);
  function toggleSortMenu() {
    if (sortOpen) { setSortOpen(false); return; }
    const rect = sortBtnRef.current.getBoundingClientRect();
    setSortMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    setSortOpen(true);
  }
  const [wished, setWished] = useState(() => new Set(getWishlist().map((x) => x.id)));

  function onToggleWish(e, it) {
    e.preventDefault();    // 카드 전체가 <a>/<button>이라 하트만 누른 건데 구매링크·비슷한 상품 찾기가 같이 발동되는 것 방지
    e.stopPropagation();
    const on = toggleWish(it);
    setWished((prev) => {
      const next = new Set(prev);
      if (on) next.add(it.id); else next.delete(it.id);
      return next;
    });
  }
  const reqId = useRef(0);   // 진행 중 원격요청 토큰 — 사용자가 그 사이 카테고리/검색을 바꾸면 늦게 온 응답을 무시.

  // 종류·분위기·크기가 비슷한 네이버 실상품을 찾아 결과 그리드를 채운다.
  // (buyUrl 없는 로컬 카탈로그 카드를 눌렀을 때 + 결과 화면에서 넘어온 추천 요청 둘 다 이걸로 처리)
  // item은 두 형태가 올 수 있음: 배치된 가구(wM/dM/hM, 미터) 또는 카탈로그 원본(w/d/h, cm).
  function findSimilar(item) {
    const cm = (mVal, cmVal, fallbackCm) => Math.round((mVal != null ? mVal * 100 : cmVal) || fallbackCm);
    const my = ++reqId.current;
    setBusy(true);
    return recommendSimilar({
      name: item.name, cat: item.cat,
      w: cm(item.wM, item.w, 80), d: cm(item.dM, item.d, 60), h: cm(item.hM, item.h, 50),
      style: deriveStyle(item),
    })
      .then((r) => { if (my === reqId.current) setRemote(r?.status === 'OK' && r.items?.length ? { source: 'naver', items: r.items } : null); })
      .finally(() => { if (my === reqId.current) setBusy(false); });
  }

  // 결과 화면에서 넘어온 추천 요청 처리(1회).
  useEffect(() => {
    if (!recommendItem) return;
    findSimilar(recommendItem).finally(() => onConsumeRecommend?.());
  }, [recommendItem]);

  function pickCategory(i) { reqId.current++; setCat(i); setRemote(null); setQuery(''); setBusy(false); }

  async function runSearch(q) {
    const my = ++reqId.current;
    setQuery(q);
    if (!q.trim()) { setRemote(null); return; }
    setBusy(true);
    // 선택된 카테고리 힌트를 검색어에 섞어 보내 네이버쇼핑 결과가 카테고리에서 벗어나지 않게 함.
    const kw = MARKET_CATS[cat].kw;
    const r = await searchFurniture(kw ? `${kw} ${q}` : q);
    if (my === reqId.current) { setRemote(r); setBusy(false); }
  }

  const styleWanted = useMemo(() => new Set(moods.flatMap((m) => MOOD_TO_STYLE[m] || [])), [moods]);

  const items = useMemo(() => {
    let list = remote ? remote.items : CATALOG.filter((c) => MARKET_CATS[cat].match(c.cat));
    if (styleWanted.size) list = list.filter((it) => styleWanted.has(deriveStyle(it)));
    if (sizeOnly) list = list.filter((it) => deriveSize(it) !== '대형');
    if (sort) {
      const dir = sort === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const pa = typeof a.price === 'number' ? a.price : null;
        const pb = typeof b.price === 'number' ? b.price : null;
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;     // 가격 없는 항목은 정렬 방향 상관없이 항상 맨 뒤
        if (pb === null) return -1;
        return (pa - pb) * dir;
      });
    }
    return list;
  }, [remote, cat, styleWanted, sizeOnly, sort]);

  const source = remote?.source;
  const chip = (active, count) => `fpill${active ? ' on' : ''}`;

  return (
    <div className="market">
      <div className="body">
        <div className="market-head">
          <div className="catseg">
            {MARKET_CATS.map((c, i) => (
              <button key={c.label} className={`fpill catpill ${cat === i ? 'on' : ''}`} onClick={() => pickCategory(i)}>{c.label}</button>
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
            <button className={chip(sizeOnly)} onClick={() => setSizeOnly((v) => !v)}>우리 방에 맞는 것만</button>
            <div className="sortdd">
              <button ref={sortBtnRef} type="button" className={`fpill sortsel ${sort ? 'on' : ''}`} onClick={toggleSortMenu}>
                {SORT_OPTIONS.find(([v]) => v === (sort || ''))?.[1]}
                <span className={`wall-select-arrow ${sortOpen ? 'up' : ''}`}>⌄</span>
              </button>
              {sortOpen && sortMenuPos && (
                <>
                  <div className="wall-select-backdrop" onClick={() => setSortOpen(false)} />
                  <div className="wall-select-menu" style={{ position: 'fixed', top: sortMenuPos.top, right: sortMenuPos.right }}>
                    {SORT_OPTIONS.map(([v, l]) => (
                      <button key={v || 'none'} type="button" className={`wall-select-opt ${(sort || '') === v ? 'on' : ''}`}
                        onClick={() => { setSort(v || null); setSortOpen(false); }}>{l}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
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
                    <button className={`wish-btn ${wished.has(it.id) ? 'on' : ''}`} onClick={(e) => onToggleWish(e, it)} title="찜하기">{wished.has(it.id) ? '♥' : '♡'}</button>
                  </span>
                  <div className="pnm">{it.name}</div>
                  <div className="ppr">
                    {typeof it.price === 'number' && it.price > 0 ? `${it.price.toLocaleString()}원` : '가격문의'}
                    <span className={`badge ${solid ? 'ok' : 'est'} sm`}>{solid ? '실치수' : '추정'}</span>
                  </div>
                </>
              );
              return it.buyUrl
                ? <a key={it.id || i} className="pcard" href={it.buyUrl} target="_blank" rel="noreferrer" onClick={() => onBuyClick?.(it)}>{card}</a>
                : <button key={it.id || i} className="pcard" onClick={() => findSimilar(it)} title="네이버에서 비슷한 상품 찾기">{card}</button>;
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

    </div>
  );
}
