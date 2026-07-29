import { useEffect, useRef, useState } from 'react';

// 이미지 확대 뷰어 — 렌더 결과·배치함·커뮤니티 사진을 공통으로 크게 본다.
// 핀치(두 손가락)·더블탭·휠로 확대, 확대 상태에서 한 손가락 드래그로 이동.
// 확대 배율이 1일 때는 드래그를 가로채지 않아 뒤 화면 스크롤을 방해하지 않는다.
const MAX = 4, MIN = 1;

export default function ImageViewer({ src, alt = '', caption, onClose }) {
  const [k, setK] = useState(1);                 // 배율
  const [t, setT] = useState({ x: 0, y: 0 });    // 이동(px)
  const box = useRef(null);
  const drag = useRef(null);                     // {x,y,tx,ty} 한 손가락 이동 시작점
  const pinch = useRef(null);                    // {d,k} 두 손가락 시작 거리·배율

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 배율이 줄면 이동값도 범위 안으로 되돌린다(빈 여백이 화면에 남지 않게).
  function clamp(nk, nt) {
    const el = box.current;
    if (!el) return nt;
    const w = el.clientWidth, h = el.clientHeight;
    const mx = Math.max(0, (w * nk - w) / 2), my = Math.max(0, (h * nk - h) / 2);
    return { x: Math.min(mx, Math.max(-mx, nt.x)), y: Math.min(my, Math.max(-my, nt.y)) };
  }
  function zoomTo(nk, nt = t) {
    const c = Math.min(MAX, Math.max(MIN, nk));
    const scaled = c === k ? nt : { x: nt.x * (c / k), y: nt.y * (c / k) };
    setK(c);
    setT(c <= 1.001 ? { x: 0, y: 0 } : clamp(c, scaled));
  }

  const dist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      pinch.current = { d: dist(e.touches), k };
      drag.current = null;
    } else if (e.touches.length === 1 && k > 1) {
      drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: t.x, ty: t.y };
    }
  }
  function onTouchMove(e) {
    if (pinch.current && e.touches.length === 2) {
      e.preventDefault();
      zoomTo(pinch.current.k * (dist(e.touches) / pinch.current.d));
    } else if (drag.current && e.touches.length === 1) {
      e.preventDefault();                        // 확대 상태에서만 — 평소엔 뒤 화면 스크롤을 막지 않는다
      const d = drag.current;
      setT(clamp(k, { x: d.tx + (e.touches[0].clientX - d.x), y: d.ty + (e.touches[0].clientY - d.y) }));
    }
  }
  function onTouchEnd(e) {
    if (e.touches.length === 0) { pinch.current = null; drag.current = null; }
  }

  const lastTap = useRef(0);
  function onTap() {
    const now = Date.now();
    if (now - lastTap.current < 300) zoomTo(k > 1.05 ? 1 : 2.5);   // 더블탭 = 확대/원복 토글
    lastTap.current = now;
  }

  return (
    <div className="imgview" onClick={onClose}>
      <div className="imgview-bar" onClick={(e) => e.stopPropagation()}>
        <button className="rt-circle" onClick={onClose} aria-label="닫기">✕</button>
        {caption && <span className="imgview-cap">{caption}</span>}
        <div className="imgview-zoom">
          <button className="rt-circle" onClick={() => zoomTo(k - 0.6)} disabled={k <= MIN} aria-label="축소">−</button>
          <span>{Math.round(k * 100)}%</span>
          <button className="rt-circle" onClick={() => zoomTo(k + 0.6)} disabled={k >= MAX} aria-label="확대">＋</button>
        </div>
      </div>
      <div
        ref={box}
        className="imgview-stage"
        onClick={(e) => { e.stopPropagation(); onTap(); }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={(e) => zoomTo(k * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${k})` }}
        />
      </div>
      <div className="imgview-hint" onClick={(e) => e.stopPropagation()}>
        두 손가락으로 확대 · 더블탭으로 원복
      </div>
    </div>
  );
}
