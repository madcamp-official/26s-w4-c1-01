#!/usr/bin/env python3
"""
무의존(stdlib only) 개발용 백엔드 — venv/pip/FastAPI 설치 없이 바로 실행.

    python3 server/devserver.py        # http://localhost:8000

server/app/main.py(FastAPI)와 동일한 /api/search·/health 계약을 제공한다.
실 배포는 FastAPI를 쓰고, 이 파일은 "설치 없이 데모 돌리기"용이다.
같은 폴더의 .env(NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)를 읽는다. 키가 없으면
FALLBACK을 반환하고 프런트가 로컬 시드 카탈로그로 동작한다.
"""
import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import re
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    env = {}
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v.strip()
    return env


ENV = load_env()
CID = ENV.get("NAVER_CLIENT_ID") or os.getenv("NAVER_CLIENT_ID")
SEC = ENV.get("NAVER_CLIENT_SECRET") or os.getenv("NAVER_CLIENT_SECRET")

DIM_RE = re.compile(r"(\d{2,4})\s*[x×*]\s*(\d{2,4})(?:\s*[x×*]\s*(\d{2,4}))?\s*(mm|cm)?", re.I)


def parse_dims(text):
    m = DIM_RE.search(text or "")
    if not m:
        return None
    vals = [int(g) for g in (m.group(1), m.group(2), m.group(3)) if g]
    unit = (m.group(4) or "").lower()
    scale = 0.1 if unit == "mm" else 1.0 if unit == "cm" else (0.1 if max(vals) > 300 else 1.0)
    cm = lambda v: round(int(v) * scale) if v else None
    return {"w": cm(m.group(1)), "d": cm(m.group(2)), "h": cm(m.group(3)), "accuracy": "추정"}


def naver_search(q):
    url = "https://openapi.naver.com/v1/search/shop.json?" + urllib.parse.urlencode(
        {"query": q or "가구", "display": 12}
    )
    req = urllib.request.Request(url, headers={"X-Naver-Client-Id": CID, "X-Naver-Client-Secret": SEC})
    with urllib.request.urlopen(req, timeout=8) as r:
        data = json.load(r)
    items = []
    for it in data.get("items", []):
        title = re.sub(r"<[^>]+>", "", it.get("title", ""))
        dims = parse_dims(title)
        items.append(
            {
                "id": it.get("productId"),
                "name": title,
                "cat": it.get("category3") or it.get("category2") or "가구",
                "w": (dims or {}).get("w"),
                "d": (dims or {}).get("d"),
                "h": (dims or {}).get("h"),
                "dimAccuracy": "추정" if dims else "미상",
                "price": int(it.get("lprice") or 0),
                "image": it.get("image"),   # 썸네일 표시용(핫링크). 누끼 합성엔 사용 금지.
                "buyUrl": it.get("link"),   # 실구매 딥링크
                "source": it.get("mallName") or "네이버",
            }
        )
    return items


class Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/health":
            return self._json({"status": "ok", "naver": bool(CID and SEC)})
        if u.path == "/api/search":
            if not (CID and SEC):
                return self._json({"status": "FALLBACK", "reason": "no_naver_key", "items": []})
            q = urllib.parse.parse_qs(u.query).get("q", [""])[0]
            try:
                return self._json({"status": "OK", "items": naver_search(q)})
            except Exception as e:  # noqa: BLE001 — 어떤 실패든 폴백
                return self._json({"status": "FALLBACK", "reason": str(e)[:120], "items": []})
        self._json({"error": "not found"}, 404)

    def log_message(self, fmt, *args):
        print("[devserver]", fmt % args)


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    port = int(os.getenv("PORT", "8000"))
    with socketserver.TCPServer(("0.0.0.0", port), Handler) as httpd:
        print(f"stdlib devserver on http://localhost:{port}  (naver={'ON' if CID and SEC else 'OFF→로컬 시드'})")
        httpd.serve_forever()
