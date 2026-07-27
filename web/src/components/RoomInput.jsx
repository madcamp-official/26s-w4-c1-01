import { useState } from 'react';
import { estimateRoom, roomFromMeasured } from '../lib/roomEstimate.js';
import { ROOM_PRESETS } from './RoomPresets.jsx';
import { PYEONGS } from '../lib/appdata.js';

// 방 입력 — ① 평수 선택(estimateRoom로 실제 치수) + 예시 방(문·창 포함) / ② 도면 가져오기.
export default function RoomInput({ onBack, onNext, photo, onPhoto }) {
  const [tab, setTab] = useState('dims');       // dims | plan
  const [pyeong, setPyeong] = useState(6.5);
  const [presetIdx, setPresetIdx] = useState(null);

  const preset = presetIdx != null ? ROOM_PRESETS[presetIdx] : null;
  const room = preset ? roomFromMeasured({ widthM: preset.widthM, depthM: preset.depthM }) : estimateRoom({ pyeong });
  const sizeLabel = `약 ${room.widthM.toFixed(1)}m × ${room.depthM.toFixed(1)}m`;

  function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => onPhoto(r.result);
    r.readAsDataURL(f);
  }

  function next() {
    if (preset) onNext(roomFromMeasured({ widthM: preset.widthM, depthM: preset.depthM }), preset.openings);
    else onNext(estimateRoom({ pyeong }), []);
  }

  return (
    <div className="vscreen pad" style={{ background: '#fff' }}>
      <button className="backbtn" onClick={onBack}>← 뒤로</button>
      <div className="h-title">우리 방을 알려줘 📐</div>
      <div className="h-sub">방 치수를 고르거나 도면을 가져오면 그걸로 배치할게</div>

      <div className="seg2" style={{ marginBottom: 16 }}>
        <button className={tab === 'dims' ? 'on' : ''} onClick={() => setTab('dims')}>방 치수 선택</button>
        <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>도면 가져오기</button>
      </div>

      {tab === 'dims' ? (
        <div className="dims-panel">
          <div>
            <div className="h-sec">평수로 고르기</div>
            <div className="pillrow">
              {PYEONGS.map((p) => (
                <button key={p.label}
                  className={`pill ${!preset && pyeong === p.pyeong ? 'on' : ''}`}
                  onClick={() => { setPyeong(p.pyeong); setPresetIdx(null); }}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="est-row">
            <span className="k">예상 방 크기</span>
            <span className="v">{sizeLabel}</span>
          </div>
          <span className="badge est" style={{ alignSelf: 'flex-start' }}>추정 치수</span>

          <div style={{ marginTop: 2 }}>
            <div className="h-sec">문·창 위치까지 정할래? (예시 방)</div>
            <div className="pillrow">
              {ROOM_PRESETS.map((p, i) => (
                <button key={p.name} className={`pill sm ${presetIdx === i ? 'on' : ''}`} onClick={() => setPresetIdx(presetIdx === i ? null : i)}>
                  {p.name.replace(' 원룸', '').replace(' 미니', '')}
                </button>
              ))}
            </div>
            {preset && <div style={{ fontSize: 11.5, color: 'var(--muted2)', marginTop: 8 }}>문·창이 포함돼 AI 배치·렌더가 더 정확해져요.</div>}
          </div>
        </div>
      ) : (
        <label className="dropzone">
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
          {photo ? <img src={photo} alt="도면/방 사진" /> : (
            <>
              <div className="plus">＋</div>
              <b>도면·방 사진 가져오기</b>
              <span>평면도나 빈 방 사진이면 돼 · 치수는 평수로 추정</span>
            </>
          )}
        </label>
      )}

      <button className="cta footer-cta" onClick={next}>다음 → 배치하러 가기</button>
    </div>
  );
}
