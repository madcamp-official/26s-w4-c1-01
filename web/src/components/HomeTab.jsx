// 배치(홈) 탭 — 새 방 배치 시작 + 이어서 진행 카드 + 방꾸 도장 + 통계.
// "방꾸 이야기"(커뮤니티)는 별도 탭바 아이템 없이 이 안에서 세그먼트 전환으로만 존재(design/커뮤니티.html 1c안).
// 피드는 서버(SQLite)에서 불러오되, 서버 미연동/빈 DB일 땐 목업으로 폴백(정직 원칙: fallback은 MVP).
import { useState, useEffect } from 'react';
import { COMMUNITY_CATS, COMMUNITY_POSTS } from '../lib/appdata.js';
import { fetchCommunityFeed } from '../lib/api.js';

const STAMP_STEPS = [
  { key: 'taste', label: '취향입력' },
  { key: 'room', label: '방 입력' },
  { key: 'layout', label: '배치 완성' },
  { key: 'buy', label: '가구 구매' },
];

const CAT_BADGE = { flex: '🎀 자랑', tip: '💡 꿀팁', question: '❓ 질문' };

export default function HomeTab({ stamps, stats, draft, onStart, onResume }) {
  const [tab, setTab] = useState('mine');   // 'mine' | 'community'
  const [cat, setCat] = useState('all');
  const [serverPosts, setServerPosts] = useState(null);   // null=아직 없음/실패 → 목업 폴백. []=서버 응답했지만 글 없음 → 이때도 목업으로 데모 채움.
  const [feedBusy, setFeedBusy] = useState(false);

  useEffect(() => {
    if (tab !== 'community') return;
    let alive = true;
    setFeedBusy(true);
    fetchCommunityFeed(cat).then((r) => {
      if (!alive) return;
      setServerPosts(r.posts);
      setFeedBusy(false);
    });
    return () => { alive = false; };
  }, [tab, cat]);

  const mockPosts = cat === 'all' ? COMMUNITY_POSTS : COMMUNITY_POSTS.filter((p) => p.cat === cat);
  const posts = serverPosts && serverPosts.length ? serverPosts : mockPosts;

  return (
    <div className="home">
      <div className="head">안녕, 오늘도 방꾸해볼까? 🧡</div>
      <div className="body">
        <div className="seg2 home-seg">
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>내 배치</button>
          <button className={tab === 'community' ? 'on' : ''} onClick={() => setTab('community')}>방꾸 이야기</button>
        </div>

        {tab === 'mine' ? (
          <>
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
          </>
        ) : (
          <>
            <div className="feed-cats">
              {COMMUNITY_CATS.map((c) => (
                <button key={c.key} className={`fpill ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>{c.label}</button>
              ))}
            </div>

            {feedBusy && !posts.length ? (
              <div className="empty"><div className="spinner sm" /><p>불러오는 중…</p></div>
            ) : posts.map((p) => {
              const badge = p.badge || CAT_BADGE[p.cat];
              return (
                <div key={p.id} className="feedcard">
                  {(p.image || p.photo) && (
                    <div className="feedcard-photo" style={p.photo ? { background: p.photo } : undefined}>
                      {p.image && <img src={p.image} alt="" />}
                      <span className="feed-badge on-photo">{badge}</span>
                    </div>
                  )}
                  <div className="feedcard-body">
                    {!(p.image || p.photo) && <span className="feed-badge">{badge}</span>}
                    <div className="feed-title">{p.title}</div>
                    {p.meta && <div className="feed-meta">{p.meta}</div>}
                    <div className="feed-meta">
                      {[
                        typeof p.likes === 'number' && `❤️ ${p.likes}`,
                        typeof p.comments === 'number' && `댓글 ${p.comments}`,
                        typeof p.saves === 'number' && `저장 ${p.saves}`,
                        p.answering && '답변 대기중',
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
