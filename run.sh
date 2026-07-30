#!/usr/bin/env bash
# 방꾸요정 원클릭 실행 (camp-15)
#   ./run.sh         빌드 + 백엔드(8000) + 프런트(5173) + GPU 터널(8600) 전부 시작
#   ./run.sh stop    전부 중지 (camp-3 리라이팅 서버는 systemd로 계속 유지됨)
#
# 그다음 VS Code PORTS 탭에서 5173 열기. 코드 고치면: ./run.sh 다시(리빌드) → 브라우저 하드 새로고침.
cd "$(dirname "$0")"
KEY="${CAMP3_KEY:-$HOME/.ssh/camp3.pem}"
[ -f "$KEY" ] || KEY="server/camp3_share_20260725.pem"
CAMP3="root@172.10.5.71"
up(){ python3 -c "import socket,sys;s=socket.socket();s.settimeout(0.4);sys.exit(0 if s.connect_ex(('127.0.0.1',$1))==0 else 1)"; }
tun(){ # $1=port $2=라벨 — camp-3로 SSH 터널(멱등)
  if up "$1"; then echo "▶ 터널 $1 ($2, 이미 연결됨)"
  elif [ -f "$KEY" ]; then chmod 600 "$KEY" 2>/dev/null
    ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes -f -N -L "$1:127.0.0.1:$1" "$CAMP3" \
      && echo "▶ 터널 $1 연결 ($2)" || echo "⚠ 터널 $1 실패 — $2 폴백"
  else echo "⚠ $KEY 없음 — $2 없이 진행"; fi
}

case "${1:-start}" in
  start)
    echo "▶ 프런트 빌드..."
    (cd web && npm run build >/dev/null 2>&1) || { echo "  의존성 설치 후 재빌드"; (cd web && npm install && npm run build); }

    tun 8600 리라이팅
    tun 8610 포토리얼렌더

    if up 8000; then echo "▶ 백엔드 8000 (이미 실행 중)"
    else SD_SERVER_URL=http://127.0.0.1:8600 RENDER_SERVER_URL=http://127.0.0.1:8610 nohup python3 server/devserver.py >/tmp/bangkku-api.log 2>&1 &
      echo "▶ 백엔드 8000 시작 (log: /tmp/bangkku-api.log)"; fi

    if up 5173; then echo "▶ 프런트 5173 (이미 실행 중 — 리빌드는 브라우저 새로고침만)"
    else nohup python3 serve_build.py >/tmp/bangkku-web.log 2>&1 &
      echo "▶ 프런트 5173 시작 (log: /tmp/bangkku-web.log)"; fi

    echo ""
    echo "✅ VS Code PORTS 탭에서 5173 을 브라우저로 열기 (http://localhost:5173)"
    ;;
  stop)
    fuser -k 5173/tcp 8000/tcp 2>/dev/null
    pkill -f "8600:127.0.0.1:8600" 2>/dev/null
    pkill -f "8610:127.0.0.1:8610" 2>/dev/null
    echo "⏹ 중지됨 (camp-3 서버는 systemd로 계속 유지)"
    ;;
  *)
    echo "사용법: ./run.sh [start|stop]"
    ;;
esac
