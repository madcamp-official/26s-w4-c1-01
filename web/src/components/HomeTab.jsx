// 배치(홈) 탭 — 새 방 배치 시작 + 이어서 진행 카드 + 방꾸 도장 + 통계.
const STAMP_STEPS = [
  { key: 'taste', label: '취향입력' },
  { key: 'room', label: '방 입력' },
  { key: 'layout', label: '배치 완성' },
  { key: 'buy', label: '가구 구매' },
];

export default function HomeTab({ stamps, stats, draft, onStart, onResume }) {
  return (
    <div className="home">
      <div className="head">안녕, 오늘도 방꾸해볼까? 🧡</div>
      <div className="body">
        <button className="hero-card" onClick={onStart}>
          <b>새 방 배치 시작하기</b>
          <p>방 치수만 알려주면 AI가 알아서 채워줄게</p>
          <span className="chip-go">시작하기 →</span>
        </button>

        {draft && (
          <button className="panel-card" style={{ textAlign: 'left', cursor: 'pointer', width: '100%', border: 0 }} onClick={onResume}>
            <div className="h-sec" style={{ marginBottom: 6 }}>이어서 진행하기</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {draft.roomLabel} · 가구 {draft.count}개 배치 중
            </div>
          </button>
        )}

        <div className="panel-card">
          <div className="h-sec">나의 방꾸 도장</div>
          <div className="stamprow">
            {STAMP_STEPS.map((s) => (
              <div key={s.key} className={`stamp ${stamps[s.key] ? 'done' : ''}`}>
                <div className="dot">{stamps[s.key] ? '✓' : ''}</div>
                <span className="lbl">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="stat2">
          <div className="cell"><div className="k">완성한 방</div><div className="v">{stats.rooms}</div></div>
          <div className="cell"><div className="k">저장한 가구</div><div className="v">{stats.savedItems}</div></div>
        </div>
      </div>
    </div>
  );
}
