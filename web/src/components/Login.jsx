// 로그인 — 소셜 3종 + 나중에 할게요(모두 목업: 실제 인증 없이 온보딩/홈으로).
export default function Login({ onLogin, onSkip }) {
  return (
    <div className="vscreen login">
      <div className="brand">
        <div className="logo">LOGO</div>
        <div className="name">방꾸요정 🧚</div>
        <div className="desc">3초만에 로그인하고 바로 시작해</div>
      </div>
      <div className="actions">
        <button className="sso kakao" onClick={onLogin}>카카오로 계속하기</button>
        <button className="sso naver" onClick={onLogin}>네이버로 계속하기</button>
        <button className="sso google" onClick={onLogin}>Google로 계속하기</button>
        <button className="tlink" onClick={onSkip}>나중에 할게요</button>
      </div>
    </div>
  );
}
