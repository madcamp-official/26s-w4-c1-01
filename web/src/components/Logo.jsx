// 앱 로고 — 후보 5안 중 하나를 여기서 고른다. 바꾸려면 LOGO_CHOICE 숫자 하나만 수정.
// 원본 SVG는 web/public/logo/, 아이콘 재생성은 tools/make-icons.sh, 판단 근거는 design/logo-brief.md.
export const LOGO_CHOICE = 1;   // 1=반짝이는방 2=침대 3=L자평면도 4='방'글자 5=요정지팡이

const SRC = {
  1: './logo/logo-1-room-spark.svg',
  2: './logo/logo-2-bed.svg',
  3: './logo/logo-3-plan.svg',
  4: './logo/logo-4-bang.svg',
  5: './logo/logo-5-wand.svg',
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
