const PROVIDER_LABEL = { kakao: '카카오', naver: '네이버', google: 'Google' };

// 마이 탭 — 프로필(소셜 로그인 연동) + 취향 태그 + 저장한 배치 + 계정 리스트.
export default function MyTab({ taste, savedCount, user, onEditTaste, onLogout }) {
  const tags = [...(taste?.moods || [])];
  if (taste?.budget) tags.push(`예산 ${taste.budget}`);
  if (taste?.pet) tags.push('반려동물 🐾');

  return (
    <div className="mypage">
      <div className="body">
        <div className="profile">
          {user?.avatar
            ? <img className="ava" src={user.avatar} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            : <div className="ava" />}
          <div style={{ flex: 1 }}>
            <div className="nm">{user?.name || '게스트'}</div>
            <div className="meta">
              {user ? `${PROVIDER_LABEL[user.provider] || user.provider} 로그인` : '로그인 안 함'} · {taste?.moods?.[0] || '나만의'} 무드
            </div>
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
          {user
            ? <button onClick={onLogout}>로그아웃 <span className="arr">›</span></button>
            : <button onClick={onLogout}>로그인 하러 가기 <span className="arr">›</span></button>}
        </div>
      </div>
    </div>
  );
}
