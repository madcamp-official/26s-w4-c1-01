import { useEffect, useRef, useState } from 'react';
import { computeHomography, projectFootprint, billboardQuad } from '../lib/homography.js';
import { accuracyMeta } from '../lib/catalog.js';
import { relightImage } from '../lib/api.js';

const CW = 640, CH = 420;

// 합성 미리보기 — 배치 좌표를 homography로 방 사진에 접합.
// 순서(기능명세서 §3-(c) 7단계 중 클라이언트에서 되는 부분): 바닥 footprint 확정 → 접지 그림자 자작 → 빌보드 합성.
// SAM 매팅 + 저denoise 리라이팅(3090 서버)은 미연동 → 여기서는 색 플레이스홀더 목업.
export default function Composite({ room, items, roomPhoto, onClose, embedded }) {
  const canvasRef = useRef(null);
  const [relit, setRelit] = useState(null);
  const [showRelit, setShowRelit] = useState(false);
  const [busy, setBusy] = useState(false);
  const imgCache = useRef({});
  const [imgTick, setImgTick] = useState(0);

  // 배치가 바뀌면 이전 리라이팅 결과는 무효화
  useEffect(() => { setRelit(null); setShowRelit(false); }, [items, room, roomPhoto]);

  async function doRelight(st = 0.42) {
    const cv = canvasRef.current;
    if (!cv) return;
    setBusy(true);
    try {
      const r = await relightImage(cv.toDataURL('image/png'), st);
      if (r.status === 'OK' && r.image) {
        setRelit(r.image);
        setShowRelit(true);
      } else {
        alert('GPU 리라이팅 서버가 연동돼 있지 않아요.\n백엔드 SD_SERVER_URL(=camp-3 터널)을 확인하세요.\n(' + (r.reason || '') + ')');
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv.getContext('2d');

    // 기본 바닥 사각형 → 사진 사다리꼴 대응(눈높이·정면 촬영 가이드 전제). 사용자 코너 지정은 Stretch.
    const src = [[0, 0], [room.widthM, 0], [room.widthM, room.depthM], [0, room.depthM]];
    const dst = [
      [CW * 0.24, CH * 0.44], [CW * 0.76, CH * 0.44],
      [CW * 0.99, CH * 0.93], [CW * 0.01, CH * 0.93],
    ];
    const H = computeHomography(src, dst);

    // 제품 이미지(누끼 PNG) 로더 — 로드되면 리렌더로 다시 그림
    const loadImg = (s) => {
      let e = imgCache.current[s];
      if (!e) {
        const im = new Image();
        e = { im, ok: false };
        imgCache.current[s] = e;
        im.onload = () => { e.ok = true; setImgTick((t) => t + 1); };
        im.onerror = () => { e.ok = 'err'; };
        im.src = s;
      }
      return e.ok === true ? e.im : null;
    };

    const draw = (bg) => {
      ctx.clearRect(0, 0, CW, CH);
      if (bg) ctx.drawImage(bg, 0, 0, CW, CH);
      else drawPlaceholderRoom(ctx, dst);

      // 원경→근경 순으로(painter's) 그려 근접 가구가 겹치게
      const order = items.map((it, idx) => ({ it, idx })).sort((a, b) => a.it.cy - b.it.cy);

      for (const { it } of order) {
        const fp = projectFootprint(H, it);
        // 접지 그림자(자작): footprint 폴리곤 소프트 블러 Multiply
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 14;
        poly(ctx, fp, 'rgba(0,0,0,0.20)');
        ctx.restore();

        const bb = billboardQuad(H, it);
        const midX = (bb.bottomL[0] + bb.bottomR[0]) / 2;
        const baseY = (bb.bottomL[1] + bb.bottomR[1]) / 2;
        const wpx = Math.hypot(bb.bottomR[0] - bb.bottomL[0], bb.bottomR[1] - bb.bottomL[1]);
        const im = it.image ? loadImg(it.image) : null;
        if (im) {
          // 실제 제품 이미지(누끼): footprint 폭에 맞춰 바닥에 세워 배치
          const asp = im.naturalHeight / im.naturalWidth || 1;
          ctx.drawImage(im, midX - wpx / 2, baseY - wpx * asp, wpx, wpx * asp);
        } else {
          // 폴백: 색 블록 빌보드
          const body = [bb.bottomL, bb.bottomR, bb.topR, bb.topL];
          poly(ctx, body, it.color || '#b4a789');
          const grad = ctx.createLinearGradient(bb.topL[0], bb.topL[1], bb.bottomL[0], bb.bottomL[1]);
          grad.addColorStop(0, 'rgba(255,255,255,0.18)');
          grad.addColorStop(1, 'rgba(0,0,0,0.10)');
          poly(ctx, body, grad);
        }
        // 라벨
        ctx.fillStyle = 'rgba(30,26,22,0.85)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${it.name} · ${accuracyMeta(it.dimAccuracy).short}`, midX, bb.topL[1] - 4);
      }
    };

    if (roomPhoto) {
      const img = new Image();
      img.onload = () => draw(img);
      img.onerror = () => draw(null);
      img.src = roomPhoto;
    } else {
      draw(null);
    }
  }, [room, items, roomPhoto, imgTick]);

  const note = (
    <p className="mockup-note">
      <b>목업이지 포토리얼이 아닙니다.</b> 배치·치수·원근은 기하로 확정했고, 가구는 색 플레이스홀더입니다 —
      실제 제품 이미지 누끼 + 저denoise 리라이팅은 3090 이미지 서버 연동 시 대체됩니다.
    </p>
  );
  const canvas = <canvas ref={canvasRef} width={CW} height={CH} className="compose-canvas" style={{ display: showRelit && relit ? 'none' : 'block' }} />;
  const relitImg = showRelit && relit ? <img className="compose-canvas" src={relit} alt="GPU 리라이팅 결과" /> : null;
  const controls = (
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>✨ GPU 리라이팅</span>
      {[['은은', 0.28], ['보통', 0.42], ['강하게', 0.58]].map(([lbl, s]) => (
        <button key={s} className="btn sm" onClick={() => doRelight(s)} disabled={busy}>
          {busy ? '…' : lbl}
        </button>
      ))}
      {relit && (
        <button className="btn ghost sm" onClick={() => setShowRelit((v) => !v)}>
          {showRelit ? '원본 보기' : '결과 보기'}
        </button>
      )}
    </div>
  );

  if (embedded) {
    return <div>{canvas}{relitImg}{controls}{note}</div>;
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>합성 미리보기</h2>
        {note}
        {canvas}
        <div className="selbar" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function poly(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawPlaceholderRoom(ctx, floorDst) {
  const farY = floorDst[0][1];
  // 뒷벽 (은은한 세로 그라데이션)
  const wall = ctx.createLinearGradient(0, 0, 0, farY);
  wall.addColorStop(0, '#efe9dd');
  wall.addColorStop(1, '#e7e0d1');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, CW, farY);
  // 바닥 (사다리꼴, 가까울수록 살짝 어둡게 = 원근감)
  const floor = ctx.createLinearGradient(0, farY, 0, CH);
  floor.addColorStop(0, '#ddd2bc');
  floor.addColorStop(1, '#cabfa4');
  poly(ctx, floorDst, floor);
  // 걸레받이(뒷벽-바닥 경계)
  ctx.strokeStyle = '#cbbfa6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(floorDst[3][0], farY);
  ctx.lineTo(floorDst[2][0], farY);
  ctx.stroke();
}
