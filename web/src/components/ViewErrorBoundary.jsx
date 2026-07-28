import { Component } from 'react';

// 3D/2D 뷰가 런타임 에러(WebGL 컨텍스트 손실·GLB 로드 실패 등)로 죽어도 앱 전체가 흰 화면이 되지 않게 격리.
export default class ViewErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (this.state.err) {
      return (
        <div className="room3d" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20 }}>
          <div>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🧊</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>3D 미리보기를 열 수 없어요.<br />다른 뷰로 전환하거나 새로고침 해주세요.</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
