#!/bin/bash
# 아이콘 원본 한 장에서 앱이 쓰는 아이콘을 전부 만든다.
#   usage: tools/make-icons.sh                 # 확정 아이콘(web/public/logo/app-icon.png)
#          tools/make-icons.sh 3               # 시안 3번(web/public/logo/logo-3-*.svg)
#          tools/make-icons.sh path/to/x.png   # 임의 파일(png/svg)
# 만드는 것: PWA 192/512 + 마스커블, 파비콘, iOS 터치아이콘, 안드로이드 런처(mdpi~xxxhdpi)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARG="${1:-app}"
if [ -f "$ARG" ]; then SRC="$ARG"
elif [ "$ARG" = "app" ]; then SRC="$ROOT/web/public/logo/app-icon.png"
else SRC=$(ls "$ROOT/web/public/logo/logo-$ARG-"*.* 2>/dev/null | head -1); fi
[ -f "$SRC" ] || { echo "원본을 못 찾음: $ARG"; exit 1; }
echo "원본: $(basename "$SRC")"

# 임의 크기로 뽑기 — SVG는 벡터 렌더, 래스터는 LANCZOS 축소
emit() {   # emit <px> <out>
  case "$SRC" in
    *.svg) rsvg-convert -w "$1" -h "$1" "$SRC" -o "$2" ;;
    *) python3 -c "
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA').resize((int(sys.argv[3]),)*2, Image.LANCZOS)
im.save(sys.argv[2])" "$SRC" "$2" "$1" ;;
  esac
}

ICONS="$ROOT/web/public/icons"; mkdir -p "$ICONS"
for s in 192 512; do
  emit "$s" "$ICONS/icon-$s.png"
  # 마스커블: 안드로이드가 원형·스쿼클로 잘라내므로 내용을 안전영역(80%)에 넣고
  # 남는 테두리는 원본 가장자리 색으로 채운다(투명/흰 모서리가 검게 잘리는 것 방지).
  emit "$((s*8/10))" /tmp/_m.png
  python3 - "$ICONS/icon-maskable-$s.png" "$s" <<'PY'
import sys
from PIL import Image
out, s = sys.argv[1], int(sys.argv[2])
inner = Image.open("/tmp/_m.png").convert("RGBA")
px = inner.load()
w, h = inner.size
edge = [px[x, 0] for x in range(0, w, 8)] + [px[x, h - 1] for x in range(0, w, 8)] \
     + [px[0, y] for y in range(0, h, 8)] + [px[w - 1, y] for y in range(0, h, 8)]
bg = tuple(sum(c[i] for c in edge) // len(edge) for i in range(3)) + (255,)
canvas = Image.new("RGBA", (s, s), bg)
canvas.paste(inner, ((s - w) // 2, (s - h) // 2), inner)
canvas.convert("RGB").save(out)
PY
done
emit 64 "$ROOT/web/public/favicon.png"
emit 180 "$ICONS/apple-touch-icon.png"

AND="$ROOT/android/app/src/main/res"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  mkdir -p "$AND/mipmap-${d%%:*}"
  emit "${d##*:}" "$AND/mipmap-${d%%:*}/ic_launcher.png"
done
echo "완료: PWA 2종 + 마스커블 2종 · 파비콘 · iOS · 안드로이드 런처 5종"
