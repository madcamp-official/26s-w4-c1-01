#!/bin/bash
# 방꾸요정 배포 — 웹 빌드 + (옵션) 백엔드 재시작. APK는 재빌드 불필요(웹을 로드하므로).
#   ./deploy.sh          # 웹만 (React 수정 시 — 대부분 이거)
#   ./deploy.sh api      # 백엔드도 재시작 (server/ 수정 시)
set -e
cd "$(dirname "$0")"
echo "▶ web build"
npm --prefix web run build | grep -E "built in|error" || true
if [ "$1" = "api" ]; then
  echo "▶ backend restart"
  systemctl restart bangkku-api
  sleep 1
fi
echo "▶ health"
curl -s -m 4 http://localhost:8000/health | head -c 120; echo
curl -s -m 4 -o /dev/null -w "web → HTTP %{http_code}\n" http://localhost:5173/
echo "✅ 반영 완료 — 폰에서 앱 새로고침(또는 재실행)하면 새 버전"
