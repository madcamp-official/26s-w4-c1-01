// 스플래시/소개 — 카피 한 컷 + 다음. (캐러셀은 1페이지로 축약)
export default function Splash({ onNext, onSkip }) {
  return (
    <div className="vscreen splash">
      <div className="skip"><button onClick={onSkip}>건너뛰기</button></div>
      <div className="body">
        <div className="hero-img"><span>배치 완성컷 이미지</span></div>
        <div className="lead">
          <b>방 사진만 찍으면<br />가구 배치 뚝딱 ✨</b>
          <p>사이즈 재고 견적 내는 거, 이제 앱이 다 해줄게</p>
        </div>
        <div className="dots"><i className="on" /><i /><i /></div>
      </div>
      <button className="cta light" onClick={onNext}>다음</button>
    </div>
  );
}
