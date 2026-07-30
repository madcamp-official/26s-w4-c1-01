// 합성 결과 — camp-3 포토리얼 렌더를 After로, 업로드한 빈 방 사진을 Before로.
// 렌더 서버 미연동/실패 시 빗금 플레이스홀더로 폴백(과잉약속 금지, 흐름 유지).
import { useState } from 'react';
import ImageViewer from './ImageViewer.jsx';

const TIMES = [['morning', '🌅'], ['day', '☀️'], ['sunset', '🌇'], ['night', '🌙']];
const VIEWS = [['wide', '와이드'], ['cozy', '아늑'], ['wide2', '반대편']];   // wide2 = 와이드의 대각 반대 코너
// 조명 색온도 프리셋 — 웜(2700K)/쿨(5000K)
const LAMP_COLORS = [['#FFB873', '웜'], ['#DDEBFF', '쿨']];

export default function CompositeResult({
  renderImg, renderBusy, renderTrigger, showBefore, onToggle, photo, estimate, estimateIsEst,
  timePreset, onTime, view, onView, onBack, onRerender, onFindSimilar, onShare, onSave,
  hasLamp, lampOn, onLampToggle, lampColor, onLampColor, onPano, panoBusy,
}) {
  const [zoom, setZoom] = useState(false);   // 결과 사진 확대 보기
  const [shareState, setShareState] = useState('idle');   // idle | busy | done | error
  async function handleShare() {
    if (!onShare || shareState === 'busy') return;
    setShareState('busy');
    const r = await onShare();
    setShareState(r?.status === 'OK' ? 'done' : 'error');
    setTimeout(() => setShareState('idle'), 2200);
  }
  const shareLabel = { idle: '방꾸 이야기에 공유', busy: '공유 중…', done: '공유 완료 ✓', error: '실패, 다시' }[shareState];

  const [saveState, setSaveState] = useState('idle');   // idle | busy | done | error
  async function handleSave() {
    if (!onSave || saveState === 'busy') return;
    setSaveState('busy');
    const r = await onSave();
    setSaveState(r?.status === 'OK' ? 'done' : 'error');
    setTimeout(() => setSaveState('idle'), 2200);
  }
  const saveLabel = { idle: '저장', busy: '저장 중…', done: '저장 완료 ✓', error: '저장 실패, 다시' }[saveState];
  const saveTitle = { idle: '배치함에 저장', busy: '저장 중…', done: '저장 완료', error: '저장 실패, 다시' }[saveState];

  if (renderBusy && !renderImg) {
    return (
      <div className="vscreen loading">
        <div className="spinner" />
        <div className="msg">방을 예쁘게 채우는 중이야 🧚</div>
      </div>
    );
  }

  const showingBefore = showBefore && photo;
  return (
    <div className="vscreen result">
      <div className="canvas">
        {showingBefore ? (
          <img src={photo} alt="빈 방 (Before)" onClick={() => setZoom(true)} style={{ cursor: 'zoom-in' }} />
        ) : renderImg ? (
          <img src={renderImg} alt="완성된 배치 (After)" onClick={() => setZoom(true)} style={{ cursor: 'zoom-in' }} />
        ) : (
          <div className="hatch-after">완성된 배치 이미지 (After)</div>
        )}
      </div>

      {renderBusy && renderImg && (
        <div className="rerender-veil"><div className="spinner sm" /><span>{renderTrigger === 'view' ? '새 각도로 다시 찍는 중…' : '새 조명으로 다시 찍는 중…'}</span></div>
      )}

      {zoom && (
        <ImageViewer src={showingBefore ? photo : renderImg} alt="완성된 배치"
          caption={showingBefore ? '빈 방 (Before)' : '완성된 배치 (After)'} onClose={() => setZoom(false)} />
      )}

      <div className="topbar">
        <button className="rt-circle" onClick={onBack}>←</button>
        <div className="topbar-right">
          <div className="topbar-icons">
            {renderImg && photo && (
              <button className="rt-pill" onClick={onToggle}>{showBefore ? 'After 보기' : 'Before/After'}</button>
            )}
            {TIMES.map(([p, ic]) => (
              <button key={p} className={`rt-circle ${renderBusy ? 'busy' : ''}`}
                style={{ opacity: timePreset === p ? 1 : 0.55, fontSize: 15 }}
                title={p} onClick={() => onTime(p)}>{ic}</button>
            ))}
          </div>
          {renderImg && (
            <button className="rt-pill" style={{ background: 'var(--accent)' }} disabled={saveState === 'busy'} title={saveTitle} onClick={handleSave}>{saveLabel}</button>
          )}
        </div>
      </div>

      {!renderImg && (
        <div className="mockup-badge" style={{ background: 'rgba(0,0,0,.5)' }}>렌더 서버 연결 시 실제 사진이 나와요</div>
      )}

      <div className="result-sheet">
        <div className="angle-row">
          {VIEWS.map(([v, label]) => (
            <button key={v} className={`angle-pill ${view === v ? 'on' : ''}`} disabled={renderBusy} onClick={() => onView(v)}>{label}</button>
          ))}
          {/* 둘러보기 = 360° 파노라마 한 장. 처음 한 번만 굽고(약 30초) 그 뒤로는 즉시 열린다.
              별도 줄로 두면 시트가 높아져 사진이 더 가려지므로 각도 pill과 한 줄에 붙인다. */}
          {renderImg && onPano && (
            <button className="angle-pill" disabled={panoBusy || renderBusy} onClick={onPano} title="방 안에서 둘러보기">
              {panoBusy ? '🔄 만드는 중…' : '🔄 둘러보기'}
            </button>
          )}
          <span className="angle-hint">각도</span>
        </div>
        {hasLamp && (
          <div className="angle-row">
            <button className={`angle-pill ${lampOn !== null ? 'on' : ''}`} disabled={renderBusy} onClick={onLampToggle}>
              💡 {lampOn === null ? '자동' : lampOn ? 'ON' : 'OFF'}
            </button>
            {LAMP_COLORS.map(([c, label]) => (
              <button key={c} className={`angle-pill ${lampColor === c ? 'on' : ''}`} disabled={renderBusy || lampOn === false}
                title={label} onClick={() => onLampColor(c)}>
                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 999, background: c, border: '1px solid rgba(0,0,0,.15)', verticalAlign: -1, marginRight: 4 }} />{label}
              </button>
            ))}
            <span className="angle-hint">조명</span>
          </div>
        )}
        <div className="estimate">
          <span className="k">예상 견적 💰{estimateIsEst && <span className="badge est sm">추정</span>}</span>
          <span className="v">{estimate > 0 ? `${estimateIsEst ? '약 ' : ''}${estimate.toLocaleString()}원` : '추정 견적 준비 중'}</span>
        </div>
        <div className="acts">
          <button className="sheet-btn sub" onClick={onRerender}>다시 배치</button>
          {renderImg && (
            <button className="sheet-btn sub" disabled={shareState === 'busy'} onClick={handleShare}>{shareLabel}</button>
          )}
          <button className="sheet-btn main" onClick={onFindSimilar}>닮은 상품 찾기</button>
        </div>
      </div>
    </div>
  );
}
