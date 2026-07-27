import { useState } from 'react';
import { MOODS, MOOD_BG, BUDGETS } from '../lib/appdata.js';

// 취향·예산 온보딩(한 페이지): 무드 최대 2개 + 예산 5단계 + 반려동물 토글.
export default function Onboarding({ initial, onDone }) {
  const [moods, setMoods] = useState(initial?.moods || []);
  const [budget, setBudget] = useState(initial?.budget || '30~50만원');
  const [pet, setPet] = useState(initial?.pet || false);

  function toggleMood(name) {
    setMoods((prev) => {
      if (prev.includes(name)) return prev.filter((m) => m !== name);
      const next = [...prev, name];
      return next.length > 2 ? next.slice(1) : next;   // 최대 2개, 초과 시 가장 오래된 것 제거
    });
  }

  return (
    <div className="vscreen onb">
      <div className="h-title">취향을 알려줘 🐣</div>
      <div className="h-sub">한번에 골라두면 딱 맞는 배치를 추천해줄게</div>
      <div className="scroll">
        <div>
          <div className="h-sec">좋아하는 무드 (최대 2개)</div>
          <div className="moodgrid">
            {MOODS.map((name) => (
              <button key={name} className={`moodcard ${moods.includes(name) ? 'on' : ''}`} onClick={() => toggleMood(name)}>
                <div className="thumb" style={{ background: MOOD_BG[name] }} />
                <div className="lbl">{name}</div>
                {moods.includes(name) && <span className="check">✓</span>}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="h-sec">가구 구매에 쓸 예산은 어느 정도?</div>
          <div className="pillrow grid3">
            {BUDGETS.map((b) => (
              <button key={b} className={`pill ${budget === b ? 'on' : ''}`} onClick={() => setBudget(b)}>{b}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="h-sec">반려동물과 함께 살아?</div>
          <div className="toggle-row">
            <span className="tlbl">🐾 반려동물 있어요</span>
            <button className={`switch ${pet ? 'on' : ''}`} onClick={() => setPet((v) => !v)} aria-pressed={pet}><i /></button>
          </div>
        </div>
      </div>
      <button className="cta" onClick={() => onDone({ moods, budget, pet })}>방꾸 시작하기</button>
    </div>
  );
}
