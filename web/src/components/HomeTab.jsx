// 배치(홈) 탭 — 새 방 배치 시작 + 이어서 진행 카드 + 방꾸 도장 + 통계.
// "방꾸 이야기"(커뮤니티)는 별도 탭바 아이템 없이 이 안에서 세그먼트 전환으로만 존재(design/커뮤니티.html 1c안).
// 피드는 서버(SQLite)에서만 불러온다 — 목업으로 폴백하면 진짜 첫 글처럼 보여서 정직 원칙에 어긋남(연결 실패/빈 글은 각각 정직하게 표시).
import { useState, useEffect } from 'react';
import ImageViewer from './ImageViewer.jsx';
import { COMMUNITY_CATS } from '../lib/appdata.js';
import { fetchCommunityFeed, postCommunity, updateCommunityPost, deleteCommunityPost, likeCommunityPost } from '../lib/api.js';
const WRITE_CATS = COMMUNITY_CATS.filter((c) => c.key !== 'all');

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
  // source: null(로딩 전) | 'server'(정상 조회, 글 0개여도 진짜) | 'local'(서버 연결 실패)
  const [feed, setFeed] = useState({ source: null, posts: [] });
  const [feedBusy, setFeedBusy] = useState(false);
  const [view, setView] = useState(null);   // {src, caption} — 피드 사진 확대 보기
  const [editingId, setEditingId] = useState(null);   // 인라인 수정 중인 글 id
  const [editTitle, setEditTitle] = useState('');
  const [writeOpen, setWriteOpen] = useState(false);
  const [writeCat, setWriteCat] = useState('flex');
  const [writeTitle, setWriteTitle] = useState('');
  const [writeBusy, setWriteBusy] = useState(false);

  useEffect(() => {
    if (tab !== 'community') return;
    let alive = true;
    setFeedBusy(true);
    fetchCommunityFeed(cat).then((r) => {
      if (!alive) return;
      setFeed({ source: r.source, posts: r.posts || [] });
      setFeedBusy(false);
    });
    return () => { alive = false; };
  }, [tab, cat]);

  const posts = feed.posts;
  const isServerFeed = feed.source === 'server';

  function startEdit(p) { setEditingId(p.id); setEditTitle(p.title); }
  function cancelEdit() { setEditingId(null); setEditTitle(''); }
  async function saveEdit(id) {
    const title = editTitle.trim();
    if (!title) return;
    const r = await updateCommunityPost(id, { title });
    if (r?.status === 'OK') {
      setFeed((prev) => ({ ...prev, posts: prev.posts.map((x) => (x.id === id ? { ...x, title } : x)) }));
      setEditingId(null);
    }
  }
  async function handleDelete(id) {
    if (!window.confirm('이 글을 삭제할까요?')) return;
    const r = await deleteCommunityPost(id);
    if (r?.status === 'OK') setFeed((prev) => ({ ...prev, posts: prev.posts.filter((x) => x.id !== id) }));
  }
  async function handleLike(p) {
    const r = await likeCommunityPost(p.id);
    if (r?.status === 'NOAUTH') { alert('로그인하면 좋아요할 수 있어요'); return; }
    if (r?.status === 'OK') {
      setFeed((prev) => ({ ...prev, posts: prev.posts.map((x) => (x.id === p.id ? { ...x, liked: r.liked, likes: r.likes } : x)) }));
    }
  }
  function openWrite() { setWriteCat(cat === 'all' ? 'flex' : cat); setWriteTitle(''); setWriteOpen(true); }
  async function submitWrite() {
    const title = writeTitle.trim();
    if (!title || writeBusy) return;
    setWriteBusy(true);
    const r = await postCommunity({ cat: writeCat, title });
    setWriteBusy(false);
    if (r?.status === 'OK' && r.post) {
      setWriteOpen(false);
      if (cat !== 'all' && cat !== writeCat) setCat(writeCat);   // 필터가 안 맞으면 방금 쓴 글이 보이는 탭으로 이동
      else setFeed((prev) => ({ source: 'server', posts: [r.post, ...prev.posts] }));
    } else {
      alert(`글 등록에 실패했어. 다시 시도해줘${r?.reason ? ` (${r.reason})` : ''}`);
    }
  }

  return (
    <div className="home">
      {view && <ImageViewer src={view.src} caption={view.caption} onClose={() => setView(null)} />}
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
                {STAMP_STEPS.map((s, i) => {
                  const done = stamps[s.key];
                  // 순서상 아직 안 된 단계 중 가장 앞(=다음 할 일)만 강조 — stamps는 이미 왼쪽부터 순서 보장된 값.
                  const isNext = !done && STAMP_STEPS.slice(0, i).every((p) => stamps[p.key]);
                  return (
                    <div key={s.key} className={`stamp ${done ? 'done' : ''} ${isNext ? 'next' : ''}`}>
                      <div className="dot">{done ? '✓' : ''}</div>
                      <span className="lbl">{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="stat2">
              <div className="cell"><div className="k">완성한 방</div><div className="v">{stats.rooms}</div></div>
              <div className="cell"><div className="k">저장한 가구</div><div className="v">{stats.savedItems}</div></div>
            </div>
          </>
        ) : (
          <>
            <div className="feed-cats" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                {COMMUNITY_CATS.map((c) => (
                  <button key={c.key} className={`fpill ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>{c.label}</button>
                ))}
              </div>
              <button className="tlink" style={{ flexShrink: 0, fontWeight: 700 }} onClick={openWrite}>+ 글쓰기</button>
            </div>

            {feedBusy && !posts.length ? (
              <div className="empty"><div className="spinner sm" /><p>불러오는 중…</p></div>
            ) : feed.source === 'local' ? (
              <div className="empty"><span className="emoji">📡</span><p>커뮤니티 서버에 연결할 수 없어. 잠시 후 다시 시도해줘.</p></div>
            ) : !posts.length ? (
              <div className="empty"><span className="emoji">🧡</span><p>아직 글이 없어. 첫 글을 써볼까?</p></div>
            ) : posts.map((p) => {
              const badge = p.badge || CAT_BADGE[p.cat];
              return (
                <div key={p.id} className="feedcard">
                  {(p.image || p.photo) && (
                    <div className="feedcard-photo" style={p.photo ? { background: p.photo } : undefined}
                      onClick={() => p.image && setView({ src: p.image, caption: p.title })}>
                      {p.image && <img src={p.image} alt="" />}
                      <span className="feed-badge on-photo">{badge}</span>
                    </div>
                  )}
                  <div className="feedcard-body">
                    {!(p.image || p.photo) && <span className="feed-badge">{badge}</span>}
                    {editingId === p.id ? (
                      <div className="feed-edit">
                        <input className="feed-edit-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} autoFocus />
                        <div className="feed-edit-acts">
                          <button className="tlink" onClick={() => saveEdit(p.id)}>저장</button>
                          <button className="tlink" onClick={cancelEdit}>취소</button>
                        </div>
                      </div>
                    ) : (
                      <div className="feed-title">{p.title}</div>
                    )}
                    {p.meta && <div className="feed-meta">{p.meta}</div>}
                    <div className="feed-meta feed-meta-row">
                      {isServerFeed ? (
                        <button className={`feed-like ${p.liked ? 'on' : ''}`} onClick={() => handleLike(p)}>
                          {p.liked ? '❤️' : '🤍'} {typeof p.likes === 'number' ? p.likes : 0}
                        </button>
                      ) : (
                        typeof p.likes === 'number' && <span>❤️ {p.likes}</span>
                      )}
                      <span>
                        {[
                          typeof p.comments === 'number' && `댓글 ${p.comments}`,
                          typeof p.saves === 'number' && `저장 ${p.saves}`,
                          p.answering && '답변 대기중',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    {p.mine && editingId !== p.id && (
                      <div className="feed-own-acts">
                        <button className="tlink" onClick={() => startEdit(p)}>수정</button>
                        <button className="tlink" onClick={() => handleDelete(p.id)}>삭제</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {writeOpen && (
        <div className="sheet-back" onClick={() => setWriteOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <div className="stitle">방꾸 이야기 글쓰기</div>
            <div className="feed-cats">
              {WRITE_CATS.map((c) => (
                <button key={c.key} className={`fpill ${writeCat === c.key ? 'on' : ''}`} onClick={() => setWriteCat(c.key)}>{c.label}</button>
              ))}
            </div>
            <textarea className="feed-edit-input" style={{ minHeight: 90, resize: 'vertical', width: '100%', fontFamily: 'inherit' }}
              placeholder="자랑하고 싶은 방꾸, 알려주고 싶은 꿀팁, 궁금한 걸 적어봐" value={writeTitle}
              onChange={(e) => setWriteTitle(e.target.value)} autoFocus />
            <button className="cta" disabled={!writeTitle.trim() || writeBusy} onClick={submitWrite}>
              {writeBusy ? '올리는 중…' : '게시하기'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
