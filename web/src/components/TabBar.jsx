// 하단 탭바 — 배치(홈)/마켓/마이. active 탭만 강조.
const TABS = [
  { id: 'home', icon: '🏠', label: '배치' },
  { id: 'market', icon: '🛋️', label: '마켓' },
  { id: 'mypage', icon: '👤', label: '마이' },
];

export default function TabBar({ active, onNav }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button key={t.id} className={`tabbtn ${active === t.id ? 'on' : ''}`} onClick={() => onNav(t.id)}>
          <span className="ti">{t.icon}</span>
          <span className="tl">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
