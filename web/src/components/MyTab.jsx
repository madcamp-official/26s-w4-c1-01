import { useState } from 'react';
import { getWishlist, removeWish } from '../lib/wishlist.js';
import { fetchLikedPosts, likeCommunityPost } from '../lib/api.js';

const PROVIDER_LABEL = { kakao: '카카오', naver: '네이버', google: 'Google' };
const CAT_BADGE = { flex: '🎀 자랑', tip: '💡 꿀팁', question: '❓ 질문' };

// 마이 탭 — 프로필(소셜 로그인 연동) + 취향 태그 + 저장한 배치 + 좋아요/찜 + 계정 리스트.
export default function MyTab({ taste, savedRooms, user, onEditTaste, onLogout }) {
  const rooms = savedRooms || [];
  const tags = [...(taste?.moods || [])];
  if (taste?.budget) tags.push(`예산 ${taste.budget}`);
  if (taste?.pet) tags.push('반려동물 🐾');

  const [wishOpen, setWishOpen] = useState(false);
  const [wishlist, setWishlist] = useState(getWishlist);

  function unwish(id) {
    removeWish(id);
    setWishlist((prev) => prev.filter((x) => x.id !== id));
  }

  const [likedOpen, setLikedOpen] = useState(false);
  const [likedPosts, setLikedPosts] = useState(null);   // null=아직 서버에서 안 불러옴
  const [likedBusy, setLikedBusy] = useState(false);

  async function openLiked() {
    if (!user) { alert('로그인하면 좋아요한 글을 볼 수 있어요'); return; }
    const next = !likedOpen;
    setLikedOpen(next);
    if (next && likedPosts === null) {
      setLikedBusy(true);
      const r = await fetchLikedPosts();
      setLikedPosts(r?.status === 'OK' ? r.posts : []);
      setLikedBusy(false);
    }
  }
  async function unlike(id) {
    const r = await likeCommunityPost(id);   // 이미 좋아요한 글이라 토글하면 해제됨
    if (r?.status === 'OK') setLikedPosts((prev) => (prev || []).filter((x) => x.id !== id));
  }

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
          {rooms.length > 0 ? (
            <div className="savedgrid">
              {rooms.map((r, i) => (
                <div key={r.id || i} className="savedcard">
                  <div className="shot" style={r.renderImg ? { backgroundImage: `url(${r.renderImg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
                  <div className="cap">{r.roomLabel || `내 방꾸 #${rooms.length - i}`}</div>
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
          <button onClick={openLiked}>🎀 좋아요한 글 <span className="arr">{likedOpen ? '⌄' : '›'}</span></button>
          <button onClick={() => setWishOpen((v) => !v)}>🛋️ 찜한 상품 <span className="arr">{wishOpen ? '⌄' : '›'}</span></button>
        </div>

        {likedOpen && (
          likedBusy ? (
            <div className="empty"><div className="spinner sm" /><p>불러오는 중…</p></div>
          ) : likedPosts && likedPosts.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {likedPosts.map((p) => (
                <div key={p.id} className="feedcard">
                  {p.image && <div className="feedcard-photo"><img src={p.image} alt="" /></div>}
                  <div className="feedcard-body">
                    <span className="feed-badge">{p.badge || CAT_BADGE[p.cat] || p.cat}</span>
                    <div className="feed-title">{p.title}</div>
                    {p.meta && <div className="feed-meta">{p.meta}</div>}
                    <div className="feed-meta-row">
                      <button className="feed-like on" onClick={() => unlike(p.id)}>❤️ {p.likes}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted2)', fontSize: 13 }}>
              아직 좋아요한 글이 없어. 방꾸 이야기에서 하트를 눌러봐 🤍
            </div>
          )
        )}

        {wishOpen && (
          wishlist.length ? (
            <div className="pgrid">
              {wishlist.map((it) => (
                <div key={it.id} className="pcard wish-card">
                  <span className="thumb">
                    {it.image ? <img src={it.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <span style={{ position: 'absolute', inset: 0, background: it.color || '#EAD7CE' }} />}
                    <button className="wish-btn on" onClick={() => unwish(it.id)} title="찜 해제">♥</button>
                  </span>
                  {it.buyUrl
                    ? <a href={it.buyUrl} target="_blank" rel="noreferrer" className="pnm" style={{ display: 'block' }}>{it.name}</a>
                    : <div className="pnm">{it.name}</div>}
                  <div className="ppr">{typeof it.price === 'number' && it.price > 0 ? `${it.price.toLocaleString()}원` : '가격문의'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted2)', fontSize: 13 }}>
              아직 찜한 상품이 없어. 마켓에서 하트를 눌러봐 🤍
            </div>
          )
        )}

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
