// 합성 결과 — camp-3 포토리얼 렌더를 After로, 업로드한 빈 방 사진을 Before로.
// 렌더 서버 미연동/실패 시 빗금 플레이스홀더로 폴백(과잉약속 금지, 흐름 유지).
import { useState } from 'react';

const TIMES = [['morning', '🌅'], ['day', '☀️'], ['sunset', '🌇'], ['night', '🌙']];
const VIEWS = [['wide', '와이드'], ['cozy', '아늑'], ['me', '내 시점']];

export default function CompositeResult({
  renderImg, renderBusy, renderTrigger, showBefore, onToggle, photo, estimate, estimateIsEst,
  timePreset, onTime, view, onView, onBack, onRerender, onFindSimilar, onShare,
}) {
  const [shareState, setShareState] = useState('idle');   // idle | busy | done | error
  async function handleShare() {
    if (!onShare || shareState === 'busy') return;
    setShareState('busy');
    const r = await onShare();
    setShareState(r?.status === 'OK' ? 'done' : 'error');
    setTimeout(() => setShareState('idle'), 2200);
  }
  const shareLabel = { idle: '방꾸 이야기에 공유', busy: '공유 중…', done: '공유 완료 ✓', error: '실패, 다시' }[shareState];

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
          <img src={photo} alt="빈 방 (Before)" />
        ) : renderImg ? (
          <img src={renderImg} alt="완성된 배치 (After)" />
        ) : (
          <div className="hatch-after">완성된 배치 이미지 (After)</div>
        )}
      </div>

      {renderBusy && renderImg && (
        <div className="rerender-veil"><div className="spinner sm" /><span>{renderTrigger === 'view' ? '새 각도로 다시 찍는 중…' : '새 조명으로 다시 찍는 중…'}</span></div>
      )}

      <div className="topbar">
        <button className="rt-circle" onClick={onBack}>←</button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {renderImg && photo && (
            <button className="rt-pill" onClick={onToggle}>{showBefore ? 'After 보기' : 'Before/After'}</button>
          )}
          {TIMES.map(([p, ic]) => (
            <button key={p} className={`rt-circle ${renderBusy ? 'busy' : ''}`}
              style={{ opacity: timePreset === p ? 1 : 0.55, fontSize: 15 }}
              title={p} onClick={() => onTime(p)}>{ic}</button>
          ))}
        </div>
      </div>

      {!showingBefore && renderImg && (
        <div className="mockup-badge">🪄 목업이야 · 실제 조명·재질은 조금 다를 수 있어</div>
      )}
      {!renderImg && (
        <div className="mockup-badge" style={{ background: 'rgba(0,0,0,.5)' }}>렌더 서버 연결 시 실제 사진이 나와요</div>
      )}

      <div className="result-sheet">
        <div className="angle-row">
          {VIEWS.map(([v, label]) => (
            <button key={v} className={`angle-pill ${view === v ? 'on' : ''}`} disabled={renderBusy} onClick={() => onView(v)}>{label}</button>
          ))}
          <span className="angle-hint">각도</span>
        </div>
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
