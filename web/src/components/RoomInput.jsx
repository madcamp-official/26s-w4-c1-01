import { useState } from 'react';
import { estimateRoom, roomFromMeasured } from '../lib/roomEstimate.js';
import { FLOORPLANS } from '../lib/floorplans.js';
import FloorPlan from './FloorPlan.jsx';
import { PYEONGS } from '../lib/appdata.js';
import { readFloorplan } from '../lib/api.js';

// 방 입력 — ① 실측 도면에서 고르기(기본) / ② 평수로 추정 / ③ 내 도면 사진 올리기(AI 판독).
// 도면을 고르면 방 치수 + 문/창 위치가 실측 그대로 세팅돼 배치·렌더가 정확해진다.
export default function RoomInput({ onBack, onNext, photo, onPhoto }) {
  const [tab, setTab] = useState('plan');       // plan(도면) | dims(평수) | scan(도면 사진)
  const [pyeong, setPyeong] = useState(6.5);
  const [sel, setSel] = useState(null);         // 선택된 도면 id
  // ── 도면 사진 판독 상태 ──
  const [scanImg, setScanImg] = useState(null);   // 업로드한 도면 dataURL(편집기 배경으로도 씀)
  const [scan, setScan] = useState(null);         // 판독 결과 {room, confidence, note, printedAreaM2}
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [hint, setHint] = useState('');           // 사용자가 줄자로 잰 가로 한 변(m)

  const plan = FLOORPLANS.find((p) => p.id === sel);

  async function runScan(dataUrl, hintM) {
    setScanning(true); setScanErr('');
    const r = await readFloorplan(dataUrl, hintM);
    setScanning(false);
    if (r.status === 'OK') setScan(r);
    else if (r.status === 'NOKEY') setScanErr('AI 연결이 안 돼 있어요. 평수 추정으로 진행해 주세요.');
    else if (r.status === 'RATE_LIMIT') setScanErr(r.reason);   // 서버가 이미 한 번 기다렸다 재시도한 뒤다
    else setScanErr('도면을 읽지 못했어요. 도면이 잘 보이게 다시 찍거나, 평수로 진행해 주세요.');
  }

  // 도면 사진은 대개 수 MB다. 그대로 보내면 업로드도 느리고 LLM 토큰(=분당 한도)도 크게 먹어
  // 429가 잘 난다. 긴 변 1600px로 줄여도 치수 글자는 읽히므로 축소해서 보낸다.
  function downscale(dataUrl, maxPx = 1600) {
    return new Promise((resolve) => {
      const im = new window.Image();
      im.onload = () => {
        const k = Math.min(1, maxPx / Math.max(im.width, im.height));
        if (k === 1) return resolve(dataUrl);
        const cv = document.createElement('canvas');
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.9));
      };
      im.onerror = () => resolve(dataUrl);
      im.src = dataUrl;
    });
  }

  function handleScanFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      const small = await downscale(r.result);
      setScanImg(small); setScan(null); runScan(small, null);
    };
    r.readAsDataURL(f);
  }

  function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => onPhoto(r.result);
    r.readAsDataURL(f);
  }

  function next() {
    if (tab === 'plan' && plan) {
      const r = roomFromMeasured({ widthM: plan.widthM, depthM: plan.depthM });
      r.cutouts = plan.cutouts || [];   // 비직사각형(L자) 도면의 배치금지 구역
      if (plan.underlay) r.underlay = plan.underlay;   // 편집기에 실제 도면을 깔기(방 bbox에 1:1)
      onNext(r, plan.openings);
    } else if (tab === 'scan' && scan) {
      const sr = scan.room;
      const r = roomFromMeasured({ widthM: sr.widthM, depthM: sr.depthM });
      r.cutouts = sr.cutouts || [];
      r.underlay = scanImg;             // 내가 올린 도면을 그대로 깔고 그 위에서 배치
      r.accuracy = scan.accuracy;       // 'estimate' = AI 판독 초안(사용자 실측 전)
      onNext(r, sr.openings || []);
    } else {
      onNext(estimateRoom({ pyeong }), []);
    }
  }
  const ready = tab === 'dims' || (tab === 'plan' && !!plan) || (tab === 'scan' && !!scan);
  // 판독 결과를 기존 도면 미리보기 컴포넌트로 그대로 보여준다(annex 없는 방).
  const scanPlan = scan && {
    ...scan.room, annex: { d: 0, bath: null, kitchen: { x: 0, w: 0 }, entry: { x: 0, w: 0 } },
  };

  return (
    <div className="vscreen pad" style={{ background: '#fff' }}>
      <button className="backbtn" onClick={onBack}>← 뒤로</button>
      <div className="h-title">우리 방을 알려줘 📐</div>
      <div className="h-sub">도면을 고르면 문·창 위치까지 실측 그대로 배치할게</div>

      <div className="seg2" style={{ marginBottom: 14 }}>
        <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>도면에서 고르기</button>
        <button className={tab === 'scan' ? 'on' : ''} onClick={() => setTab('scan')}>내 도면 올리기</button>
        <button className={tab === 'dims' ? 'on' : ''} onClick={() => setTab('dims')}>평수로 추정</button>
      </div>

      {tab === 'plan' ? (
        <div className="fpscroll">
          <div className="fpgrid">
            {FLOORPLANS.map((p) => (
              <button key={p.id} className={`fpcard ${sel === p.id ? 'on' : ''}`} onClick={() => setSel(sel === p.id ? null : p.id)}>
                <FloorPlan plan={p} width={320} />
                {/* 실제 인허가 도면에서 실측한 세대는 원본 도면을 함께 보여준다(치수 출처를 눈으로 확인). */}
                {p.real && (
                  <div className="fpreal">
                    <img src={`./plans/${p.id.replace('fp-', '')}.png`} alt={`${p.name} 원본 도면`} loading="lazy" />
                    <span className="badge real">실제 도면 · 전용 {p.real.areaM2}㎡ ({p.real.unitMm}mm)</span>
                  </div>
                )}
                <div className="fpmeta">
                  <b>{p.name}</b>
                  <span>{p.widthM}×{p.depthM}m · 창 {p.openings.filter((o) => o.kind === 'window').length}개</span>
                  <em>{p.desc}</em>
                </div>
                {sel === p.id && <span className="fpcheck">✓</span>}
              </button>
            ))}
          </div>
          <label className="upload-mini">
            <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
            {photo ? '📷 내 방 사진 첨부됨 (Before 비교용)' : '📷 내 방 사진 올리기 (선택 — Before/After 비교용)'}
          </label>
        </div>
      ) : tab === 'scan' ? (
        <div className="dims-panel">
          <label className="upload-mini">
            <input type="file" accept="image/*" onChange={handleScanFile} style={{ display: 'none' }} />
            {scanImg ? '📐 다른 도면으로 바꾸기' : '📐 방 도면 사진 올리기 (부동산 매물 도면·건축 도면)'}
          </label>

          {scanning && <p className="mockup-note">도면을 읽는 중… (10초쯤 걸려요)</p>}
          {scanErr && <p className="mockup-note" style={{ color: 'var(--bad)' }}>{scanErr}</p>}

          {scanImg && !scanning && (
            <img src={scanImg} alt="올린 도면" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
          )}

          {scan && (
            <>
              <div className="est-row">
                <span className="k">읽어낸 방 크기</span>
                <span className="v">{scan.room.widthM}m × {scan.room.depthM}m</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="badge est">AI 판독 초안</span>
                <span className="badge mid">확신도 {Math.round((scan.confidence || 0) * 100)}%</span>
                {scan.printedAreaM2 && <span className="badge real">도면 표기 {scan.printedAreaM2}㎡</span>}
              </div>
              {scan.note && <p className="mockup-note">{scan.note}</p>}
              <FloorPlan plan={scanPlan} width={300} />
              {/* 치수 확정은 사람이 한다 — LLM 판독은 반복하면 크게 흔들려서 확정 근거로 못 쓴다. */}
              <div className="est-row" style={{ gap: 8 }}>
                <span className="k">가로 한 변을 재서 넣으면 정확해져요</span>
                <span className="v" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" step="0.1" min="1" max="12" value={hint} placeholder={String(scan.room.widthM)}
                    onChange={(e) => setHint(e.target.value)} style={{ width: 90 }} />
                  <button className="btn sm" disabled={!hint || scanning}
                    onClick={() => runScan(scanImg, Number(hint))}>보정</button>
                </span>
              </div>
              <p className="mockup-note">
                올린 도면이 배치 화면 바탕에 깔려요. 가구는 그 위에 실치수로 놓입니다.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="dims-panel">
          <div>
            <div className="h-sec">평수로 고르기</div>
            <div className="pillrow">
              {PYEONGS.map((p) => (
                <button key={p.label} className={`pill ${pyeong === p.pyeong ? 'on' : ''}`} onClick={() => setPyeong(p.pyeong)}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="est-row">
            <span className="k">예상 방 크기</span>
            <span className="v">약 {estimateRoom({ pyeong }).widthM.toFixed(1)}m × {estimateRoom({ pyeong }).depthM.toFixed(1)}m</span>
          </div>
          <span className="badge est" style={{ alignSelf: 'flex-start' }}>추정 치수</span>
          <p className="mockup-note">문·창 위치까지 반영하려면 ‘도면에서 고르기’를 써보세요.</p>
        </div>
      )}

      <button className="cta footer-cta" onClick={next} disabled={!ready}>
        {tab === 'plan' ? (plan ? `${plan.name}으로 배치하러 가기 →` : '도면을 골라줘')
          : tab === 'scan' ? (scan ? '이 도면 위에서 배치하기 →' : (scanning ? '읽는 중…' : '도면 사진을 올려줘'))
            : '다음 → 배치하러 가기'}
      </button>
    </div>
  );
}
