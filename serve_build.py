#!/usr/bin/env python3
"""web/dist(프로덕션 빌드) 정적 서빙 + /api → 백엔드 프록시.
Vite dev는 모듈을 수십 개 개별 요청으로 쪼개 보내서 VS Code 포트포워딩 터널에서 잘 멈춘다.
빌드본은 요청 3개(html+js+css)라 터널로도 안정적으로 뜬다.

    npm --prefix web run build      # dist 먼저 빌드
    python3 serve_build.py          # http://0.0.0.0:5173  (/api 는 :8000 으로 프록시)
"""
import os
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "web", "dist")
BACKEND = os.getenv("BACKEND", "http://localhost:8000")
PORT = int(os.getenv("PORT", "5173"))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """3xx를 따라가지 않는다 — OAuth 로그인(302→kauth)은 프록시가 아니라 '브라우저'가 따라가야 함."""
    def redirect_request(self, *a, **k):  # noqa: D102
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIST, **k)

    def _proxy(self, method):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n) if n else None
        url = BACKEND.rstrip("/") + self.path
        headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
        if self.headers.get("Authorization"):                       # /api/auth/me 토큰 전달
            headers["Authorization"] = self.headers["Authorization"]
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        loc = None
        try:
            with _OPENER.open(req, timeout=300) as r:
                data, code, ct = r.read(), r.status, r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:                         # 3xx 포함(리다이렉트는 브라우저에 넘김)
            data, code, ct = e.read(), e.code, e.headers.get("Content-Type", "application/json")
            loc = e.headers.get("Location")
        except Exception:  # noqa: BLE001 — 백엔드 꺼져 있으면 프런트가 로컬 폴백
            data, code, ct = b'{"status":"FALLBACK","reason":"backend down"}', 200, "application/json"
        self.send_response(code)
        self.send_header("Content-Type", ct)
        if loc:
            self.send_header("Location", loc)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._proxy("GET")
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._proxy("POST")
        self.send_response(404)
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"serving {DIST} on http://0.0.0.0:{PORT}  (/api → {BACKEND})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
