import { useState } from 'react';
import { estimateRoom, estimateFromOneWall, roomFromMeasured } from '../lib/roomEstimate.js';

// 방 크기 입력 — 예측(평수/㎡) / 한변보정 / 실측. 결과 room을 onDone으로 넘긴다.
export default function RoomForm({ onDone }) {
  const [mode, setMode] = useState('estimate'); // estimate | oneWall | measured
  const [pyeong, setPyeong] = useState(6);
  const [wallM, setWallM] = useState(3);
  const [widthM, setWidthM] = useState(3.2);
  const [depthM, setDepthM] = useState(4.1);

  function submit() {
    let room;
    if (mode === 'estimate') room = estimateRoom({ pyeong: Number(pyeong) });
    else if (mode === 'oneWall') room = estimateFromOneWall({ pyeong: Number(pyeong), measuredWidthM: Number(wallM) });
    else room = roomFromMeasured({ widthM: Number(widthM), depthM: Number(depthM) });
    onDone(room);
  }

  return (
    <div className="card" style={{ maxWidth: 460, margin: '24px auto' }}>
      <h3 style={{ marginTop: 0 }}>원룸 크기 입력</h3>
      <div className="seg">
        <button className={mode === 'estimate' ? 'on' : ''} onClick={() => setMode('estimate')}>예측(평수)</button>
        <button className={mode === 'oneWall' ? 'on' : ''} onClick={() => setMode('oneWall')}>한 변 보정</button>
        <button className={mode === 'measured' ? 'on' : ''} onClick={() => setMode('measured')}>실측</button>
      </div>

      {mode === 'estimate' && (
        <>
          <label>전용 평수</label>
          <input type="number" step="0.5" value={pyeong} onChange={(e) => setPyeong(e.target.value)} />
          <p className="mockup-note">욕실·주방 공용면적을 차감하고 원룸 표준 종횡비로 방 사각형을 추정합니다. 정확한 값은 아래 실측을 권장.</p>
        </>
      )}
      {mode === 'oneWall' && (
        <>
          <label>전용 평수</label>
          <input type="number" step="0.5" value={pyeong} onChange={(e) => setPyeong(e.target.value)} />
          <label>줄자로 잰 벽 한 변 (m)</label>
          <input type="number" step="0.1" value={wallM} onChange={(e) => setWallM(e.target.value)} />
        </>
      )}
      {mode === 'measured' && (
        <>
          <label>가로 (m)</label>
          <input type="number" step="0.1" value={widthM} onChange={(e) => setWidthM(e.target.value)} />
          <label>세로 (m)</label>
          <input type="number" step="0.1" value={depthM} onChange={(e) => setDepthM(e.target.value)} />
        </>
      )}

      <button className="btn primary" style={{ marginTop: 14, width: '100%' }} onClick={submit}>방 만들기 →</button>
    </div>
  );
}
