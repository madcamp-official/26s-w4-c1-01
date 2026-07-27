// 마이 탭 — 프로필 + 취향 태그 + 저장한 배치 + 계정 리스트.
export default function MyTab({ taste, savedCount, onEditTaste }) {
  const tags = [...(taste?.moods || [])];
  if (taste?.budget) tags.push(`예산 ${taste.budget}`);
  if (taste?.pet) tags.push('반려동물 🐾');

  return (
    <div className="mypage">
      <div className="body">
        <div className="profile">
          <div className="ava" />
          <div style={{ flex: 1 }}>
            <div className="nm">soomin.room</div>
            <div className="meta">원룸 · {taste?.moods?.[0] || '나만의'} 무드</div>
          </div>
          <button className="iconbtn" onClick={onEditTaste}>수정</button>
        </div>

        <div>
          <div className="h-sec">내 취향 태그</div>
          <div className="tagwrap">
            {tags.length ? tags.map((t) => <span key={t} className="tagchip">{t}</span>)
              : <span className="tagchip" style={{ background: 'var(--muted-surface)', color: 'var(--muted2)' }}>아직 취향을 안 골랐어</span>}
          </div>
        </div>

        <div>
          <div className="h-sec">배치함</div>
          {savedCount > 0 ? (
            <div className="savedgrid">
              {Array.from({ length: savedCount }).map((_, i) => (
                <div key={i} className="savedcard">
                  <div className="shot" />
                  <div className="cap">내 방꾸 #{i + 1}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted2)', fontSize: 13 }}>
              아직 저장한 배치가 없어. 방을 꾸며보자! 🧡
            </div>
          )}
        </div>

        <div className="listcard">
          <button>계정 관리 <span className="arr">›</span></button>
          <button>알림 설정 <span className="arr">›</span></button>
          <button>로그아웃 <span className="arr">›</span></button>
        </div>
      </div>
    </div>
  );
}
