import { useEffect, useRef } from 'react';
import { computeHomography, projectFootprint, billboardQuad } from '../lib/homography.js';
import { accuracyMeta } from '../lib/catalog.js';

const CW = 640, CH = 420;

// 합성 미리보기 — 배치 좌표를 homography로 방 사진에 접합.
// 순서(기능명세서 §3-(c) 7단계 중 클라이언트에서 되는 부분): 바닥 footprint 확정 → 접지 그림자 자작 → 빌보드 합성.
// SAM 매팅 + 저denoise 리라이팅(3090 서버)은 미연동 → 여기서는 색 플레이스홀더 목업.
export default function Composite({ room, items, roomPhoto, onClose }) {
  const canvasRef = useRef(null);

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

        // 빌보드 몸체
        const bb = billboardQuad(H, it);
        const body = [bb.bottomL, bb.bottomR, bb.topR, bb.topL];
        poly(ctx, body, it.color || '#b4a789');
        // 상단 음영으로 입체감
        const grad = ctx.createLinearGradient(bb.topL[0], bb.topL[1], bb.bottomL[0], bb.bottomL[1]);
        grad.addColorStop(0, 'rgba(255,255,255,0.18)');
        grad.addColorStop(1, 'rgba(0,0,0,0.10)');
        poly(ctx, body, grad);
        // 라벨
        ctx.fillStyle = 'rgba(30,26,22,0.85)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        const midX = (bb.bottomL[0] + bb.bottomR[0]) / 2;
        ctx.fillText(`${it.name} · ${accuracyMeta(it.dimAccuracy).short}`, midX, bb.topL[1] - 4);
        if (!it.lowBox) {
          ctx.fillStyle = 'rgba(204,91,82,0.9)';
          ctx.fillText('⚠ 합성 부적합(판때기 위험)', midX, bb.topL[1] - 16);
        }
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
  }, [room, items, roomPhoto]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>합성 미리보기</h2>
        <p className="mockup-note">
          <b>목업이지 포토리얼이 아닙니다.</b> 배치·치수·원근은 기하로 확정했고, 가구는 색 플레이스홀더입니다 —
          실제 제품 이미지 누끼 + 저denoise 리라이팅은 3090 이미지 서버 연동 시 대체됩니다.
        </p>
        <canvas ref={canvasRef} width={CW} height={CH} className="compose-canvas" />
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
  // 벽
  ctx.fillStyle = '#efe9df';
  ctx.fillRect(0, 0, CW, CH);
  // 바닥 사다리꼴
  poly(ctx, floorDst, '#e5dcc9');
  // 뒷벽 경계
  ctx.strokeStyle = '#d8cfbd';
  ctx.beginPath();
  ctx.moveTo(floorDst[0][0], floorDst[0][1]);
  ctx.lineTo(floorDst[1][0], floorDst[1][1]);
  ctx.stroke();
}
