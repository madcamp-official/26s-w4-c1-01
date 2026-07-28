import { useState, useRef, useEffect } from 'react';

// 자주 쓰는 문장 칩 — 누르면 입력창에 바로 채워짐. 보내면 반영 → 결과 화면(로딩→사진).
const SUGGESTIONS = ['침대 넣어줘', '소파 빼줘', '책상 더 크게', '조명 하나 추가해줘', '침대를 창가로 옮겨줘'];

// 대화형 배치 도우미 — 문장 칩/자연어 → 추가·삭제·크기·재배치. 적용되면 App이 결과 화면으로 이동.
export default function LayoutChat({ items, onSubmit }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e6 }); }, [msgs, busy]);

  async function send(text) {
    const m = (text ?? input).trim();
    if (!m || busy) return;
    setInput('');
    setMsgs((x) => [...x, { role: 'user', text: m }]);
    setBusy(true);
    try {
      const res = await onSubmit(m, msgs.slice(-8));
      setMsgs((x) => [...x, { role: 'assistant', text: res?.reply || (res?.applied ? '반영했어! ✏️' : '반영하기 어려워요.') }]);
    } catch {
      setMsgs((x) => [...x, { role: 'assistant', text: '문제가 생겼어요. 다시 시도해 주세요.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chatpanel">
      <div className="chat-head">💬 배치 도우미 <span>문장을 고르거나 입력하면 반영하고 결과를 보여줘요</span></div>
      <div className="chat-msgs" ref={scrollRef}>
        {msgs.length === 0 && <div className="chat-hint">✨ 자주 쓰는 문장을 눌러 바로 넣어보세요</div>}
        {msgs.map((m, i) => <div key={i} className={'chat-msg ' + m.role}>{m.text}</div>)}
        {busy && <div className="chat-msg assistant busy">반영하는 중…</div>}
      </div>
      <div className="chat-chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chat-chip" onClick={() => setInput(s)} disabled={busy}>{s}</button>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={items.length ? '배치를 어떻게 바꿀까요?' : '예: 침대 넣어줘'}
          disabled={busy}
        />
        <button className="btn primary sm" onClick={() => send()} disabled={busy || !input.trim()}>보내기</button>
      </div>
    </div>
  );
}
