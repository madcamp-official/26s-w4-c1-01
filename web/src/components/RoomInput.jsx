import { useState } from 'react';
import { estimateRoom, roomFromMeasured } from '../lib/roomEstimate.js';
import { FLOORPLANS } from '../lib/floorplans.js';
import FloorPlan from './FloorPlan.jsx';
import { PYEONGS } from '../lib/appdata.js';

// 방 입력 — ① 실측 도면 10종에서 고르기(기본) / ② 평수로 추정.
// 도면을 고르면 방 치수 + 문/창 위치가 실측 그대로 세팅돼 배치·렌더가 정확해진다.
export default function RoomInput({ onBack, onNext, photo, onPhoto }) {
  const [tab, setTab] = useState('plan');       // plan(도면) | dims(평수)
  const [pyeong, setPyeong] = useState(6.5);
  const [sel, setSel] = useState(null);         // 선택된 도면 id

  const plan = FLOORPLANS.find((p) => p.id === sel);

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
      onNext(r, plan.openings);
    } else {
      onNext(estimateRoom({ pyeong }), []);
    }
  }
  const ready = tab === 'dims' || !!plan;

  return (
    <div className="vscreen pad" style={{ background: '#fff' }}>
      <button className="backbtn" onClick={onBack}>← 뒤로</button>
      <div className="h-title">우리 방을 알려줘 📐</div>
      <div className="h-sub">도면을 고르면 문·창 위치까지 실측 그대로 배치할게</div>

      <div className="seg2" style={{ marginBottom: 14 }}>
        <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>도면에서 고르기</button>
        <button className={tab === 'dims' ? 'on' : ''} onClick={() => setTab('dims')}>평수로 추정</button>
      </div>

      {tab === 'plan' ? (
        <div className="fpscroll">
          <div className="fpgrid">
            {FLOORPLANS.map((p) => (
              <button key={p.id} className={`fpcard ${sel === p.id ? 'on' : ''}`} onClick={() => setSel(sel === p.id ? null : p.id)}>
                <FloorPlan plan={p} width={320} />
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
        {tab === 'plan' ? (plan ? `${plan.name}으로 배치하러 가기 →` : '도면을 골라줘') : '다음 → 배치하러 가기'}
      </button>
    </div>
  );
}
