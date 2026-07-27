import { useState, useRef, useEffect } from 'react';
import { chatLayout } from '../lib/api.js';
import { validateLayout } from '../lib/geometry.js';

// 대화형 배치 도우미 — "이렇게 바꿔줘" → LLM이 이행/기각 + 이유. 이행은 겹침/문·창 재검증 후에만 반영.
export default function LayoutChat({ room, openings, items, setItems }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e6 }); }, [msgs, busy]);

  async function send() {
    const m = input.trim();
    if (!m || busy || !items.length) return;
    setInput('');
    const history = msgs.slice(-8);
    setMsgs((x) => [...x, { role: 'user', text: m }]);
    setBusy(true);
    try {
      const r = await chatLayout(room, openings, items, m, history);
      let reply = r.reason || '';
      if (r.decision === 'apply' && Array.isArray(r.items) && r.items.length) {
        const map = new Map(r.items.map((it) => [it.id, it]));
        const next = items.map((it) => {
          const ni = map.get(it.id);
          if (!ni) return it;
          const rot = [0, 90, 180, 270].includes(ni.rotation) ? ni.rotation : it.rotationDeg;
          const cx = Number.isFinite(ni.cx) ? ni.cx / 100 : it.cx;
          const cy = Number.isFinite(ni.cy) ? ni.cy / 100 : it.cy;
          return { ...it, cx, cy, rotationDeg: rot };
        });
        const nonRug = next.filter((it) => it.cat !== '러그');
        const v = validateLayout(nonRug, room.widthM, room.depthM, openings);
        if (v.ok && !v.blockOpen) {
          setItems(next);
          reply = (reply || '반영했어요.') + ' ✅';
        } else {
          reply = (reply || '') + ' — 다만 그렇게 하면 가구가 겹치거나 문·창을 가려서 반영하진 않았어요. 🚫';
        }
      } else if (!reply) {
        reply = '그 요청은 반영하기 어려워요.';
      }
      setMsgs((x) => [...x, { role: 'assistant', text: reply }]);
    } catch {
      setMsgs((x) => [...x, { role: 'assistant', text: '문제가 생겼어요. 다시 시도해 주세요.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chatpanel">
      <div className="chat-head">💬 배치 도우미 <span>“이렇게 바꿔줘”라고 말하면 AI가 반영하거나 이유를 알려줘요</span></div>
      <div className="chat-msgs" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="chat-hint">예: “침대를 창문 반대쪽으로 옮겨줘” · “책상이랑 의자를 창가로” · “가구를 벽에 더 붙여줘” · “문 앞을 비워줘”</div>
        )}
        {msgs.map((m, i) => <div key={i} className={'chat-msg ' + m.role}>{m.text}</div>)}
        {busy && <div className="chat-msg assistant busy">생각 중…</div>}
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={items.length ? '배치를 어떻게 바꿀까요?' : '가구를 먼저 담아 주세요'}
          disabled={!items.length || busy}
        />
        <button className="btn primary sm" onClick={send} disabled={!items.length || busy || !input.trim()}>보내기</button>
      </div>
    </div>
  );
}
