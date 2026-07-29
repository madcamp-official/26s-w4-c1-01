import { useEffect, useState } from 'react';
import { fetchProviders, loginUrl } from '../lib/auth.js';
import Logo from './Logo.jsx';

// 로그인 — 키가 설정된 플랫폼은 실제 OAuth로, 아니면 데모 로그인(온보딩 진행) 폴백.
export default function Login({ onLogin, onSkip, authError }) {
  const [prov, setProv] = useState(null);   // {kakao,google} | null(조회 중)

  useEffect(() => {
    let live = true;
    fetchProviders().then((p) => { if (live) setProv(p); });
    return () => { live = false; };
  }, []);

  function go(p) {
    if (prov?.[p]) window.location.href = loginUrl(p);   // 실제 OAuth 리다이렉트
    else onLogin();                                       // 키 미설정 → 데모 로그인
  }
  const demo = prov && !prov.kakao && !prov.google;

  return (
    <div className="vscreen login">
      <div className="brand">
        <Logo size={84} />
        <div className="name">방꾸요정 🧚</div>
        <div className="desc">3초만에 로그인하고 바로 시작해</div>
        {authError && <div className="auth-err">로그인에 실패했어 ({authError}) — 다시 시도해줘</div>}
      </div>
      <div className="actions">
        <button className="sso kakao" onClick={() => go('kakao')}>카카오로 계속하기</button>
        <button className="sso google" onClick={() => go('google')}>Google로 계속하기</button>
        <button className="tlink" onClick={onSkip}>나중에 할게요</button>
        {demo && <div className="demo-note">지금은 데모 모드야 — 버튼을 누르면 로그인 없이 진행돼</div>}
      </div>
    </div>
  );
}
