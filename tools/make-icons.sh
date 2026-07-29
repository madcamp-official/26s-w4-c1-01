#!/bin/bash
# 고른 로고 한 장(SVG)에서 앱이 쓰는 아이콘을 전부 만든다.
#   usage: tools/make-icons.sh 2        (1~5, web/src/components/Logo.jsx의 LOGO_CHOICE와 맞출 것)
# 만드는 것: PWA 192/512 + 마스커블, 파비콘, 안드로이드 런처(mdpi~xxxhdpi)
set -e
N="${1:-2}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVG=$(ls "$ROOT/web/public/logo/logo-$N-"*.svg 2>/dev/null | head -1)
[ -f "$SVG" ] || { echo "logo-$N-*.svg 없음"; exit 1; }
command -v rsvg-convert >/dev/null || { echo "rsvg-convert 필요: apt-get install -y librsvg2-bin"; exit 1; }
echo "로고: $(basename "$SVG")"

ICONS="$ROOT/web/public/icons"; mkdir -p "$ICONS"
for s in 192 512; do
  rsvg-convert -w $s -h $s "$SVG" -o "$ICONS/icon-$s.png"
  # 마스커블: 안드로이드가 원형·스쿼클로 잘라내므로 안전영역(80%)만 쓰도록 여백을 준다
  rsvg-convert -w $((s*8/10)) -h $((s*8/10)) "$SVG" -o /tmp/_m.png
  python3 - "$ICONS/icon-maskable-$s.png" $s <<'PY'
import sys
from PIL import Image
out, s = sys.argv[1], int(sys.argv[2])
inner = Image.open("/tmp/_m.png").convert("RGBA")
bg = inner.resize((1, 1)).getpixel((0, 0))          # 아이콘 자체 배경색으로 여백을 채운다
canvas = Image.new("RGBA", (s, s), bg)
canvas.paste(inner, ((s - inner.width) // 2, (s - inner.height) // 2), inner)
canvas.save(out)
PY
done
rsvg-convert -w 64 -h 64 "$SVG" -o "$ROOT/web/public/favicon.png"

AND="$ROOT/android/app/src/main/res"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  name="${d%%:*}"; px="${d##*:}"
  mkdir -p "$AND/mipmap-$name"
  rsvg-convert -w $px -h $px "$SVG" -o "$AND/mipmap-$name/ic_launcher.png"
done
echo "완료: PWA 아이콘 · 파비콘 · 안드로이드 런처 5종"
