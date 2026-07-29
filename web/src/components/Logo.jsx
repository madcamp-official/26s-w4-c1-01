// 앱 로고 — 후보 5안 중 하나를 여기서 고른다. 바꾸려면 LOGO_CHOICE 숫자 하나만 수정.
// 원본 SVG는 web/public/logo/, 아이콘(파비콘·PWA·안드로이드) 재생성은 tools/make-icons.sh.
export const LOGO_CHOICE = 2;   // 1=창문 2=요정반짝임 3=평면도 4='방'글자 5=소파

const SRC = {
  1: './logo/logo-1-window.svg',
  2: './logo/logo-2-fairy.svg',
  3: './logo/logo-3-room.svg',
  4: './logo/logo-4-bang.svg',
  5: './logo/logo-5-sofa.svg',
};

export default function Logo({ size = 72, choice = LOGO_CHOICE, style }) {
  return (
    <img
      src={SRC[choice] || SRC[2]}
      width={size}
      height={size}
      alt="방꾸요정"
      style={{ borderRadius: size * 0.23, display: 'block', ...style }}
    />
  );
}
