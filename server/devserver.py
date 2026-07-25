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
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "app"))
from dims import parse_dims, fetch_dims_from_url  # noqa: E402 (공유 치수 모듈)


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
SD_SERVER_URL = ENV.get("SD_SERVER_URL") or os.getenv("SD_SERVER_URL")
ANTHROPIC_API_KEY = ENV.get("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
LLM_MODEL = ENV.get("LLM_MODEL") or os.getenv("LLM_MODEL") or "claude-sonnet-5"
_PROMPT_PATH = os.path.join(HERE, "..", "docs", "방꾸요정-배치-LLM-프롬프트.md")
LAYOUT_PROMPT = (open(_PROMPT_PATH, encoding="utf-8").read()
                 if os.path.exists(_PROMPT_PATH)
                 else "원룸 가구를 겹치지 않게 대부분 벽에 붙여 배치. §3 JSON(candidates[])으로 3개 이상 출력. cm 정수, (cx,cy)=중심, rotation 0/90/180/270.")


def parse_layout_json(text):
    """LLM 텍스트 → candidates 리스트. 코드펜스/잡텍스트를 견고하게 벗겨낸다."""
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        obj = json.loads(t)
    except Exception:
        s, e = t.find("{"), t.rfind("}")
        if s < 0 or e <= s:
            raise
        obj = json.loads(t[s:e + 1])
    return obj.get("candidates", []) if isinstance(obj, dict) else []


def anthropic_layout(payload):
    """방/가구 입력 → Claude로 배치 후보 생성(프롬프트 md를 system으로)."""
    user = ("다음 입력에 대해 §4~§12를 준수하여 겹침 없는 서로 다른 배치 3개 이상을 "
            "§3 JSON 스키마(candidates[])로만 출력하라. 설명 없이 JSON만.\n\n"
            + json.dumps(payload, ensure_ascii=False))
    body = json.dumps({
        "model": LLM_MODEL,
        "max_tokens": 4096,
        "system": LAYOUT_PROMPT,
        "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.load(r)
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    return parse_layout_json(text)

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
            return self._json({"status": "ok", "naver": bool(CID and SEC),
                               "sd_server": bool(SD_SERVER_URL), "llm": bool(ANTHROPIC_API_KEY)})
        if u.path == "/api/search":
            if not (CID and SEC):
                return self._json({"status": "FALLBACK", "reason": "no_naver_key", "items": []})
            q = urllib.parse.parse_qs(u.query).get("q", [""])[0]
            try:
                return self._json({"status": "OK", "items": naver_search(q)})
            except Exception as e:  # noqa: BLE001 — 어떤 실패든 폴백
                return self._json({"status": "FALLBACK", "reason": str(e)[:120], "items": []})
        if u.path == "/api/dims":
            url = urllib.parse.parse_qs(u.query).get("url", [""])[0]
            d = fetch_dims_from_url(url, ENV)
            return self._json({"status": "OK", "dims": d} if d else {"status": "MISS"})
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path not in ("/api/relight", "/api/layout"):
            return self._json({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n)) if n else {}
        except Exception as e:  # noqa: BLE001
            return self._json({"status": "ERROR", "reason": "bad request"}, 400)

        # 원룸 자동 배치 — Claude가 후보 생성(앱이 겹침 재검증)
        if path == "/api/layout":
            if not ANTHROPIC_API_KEY:
                return self._json({"status": "NOKEY"})
            try:
                return self._json({"status": "OK", "candidates": anthropic_layout(body)})
            except Exception as e:  # noqa: BLE001
                return self._json({"status": "ERROR", "reason": str(e)[:200]})

        # 이하 /api/relight
        if not SD_SERVER_URL:
            return self._json({"status": "CLIENT", "reason": "no_sd_server"})
        try:
            payload = json.dumps({"image": body.get("image"), "strength": body.get("strength", 0.3),
                                  "prompt": body.get("prompt")}).encode()
            req = urllib.request.Request(SD_SERVER_URL.rstrip("/") + "/relight", data=payload,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.load(r)
            if data.get("status") == "OK" and data.get("image"):
                return self._json({"status": "OK", "image": data["image"]})
            return self._json({"status": "CLIENT", "reason": str(data.get("reason", "sd error"))[:120]})
        except Exception as e:  # noqa: BLE001
            return self._json({"status": "CLIENT", "reason": str(e)[:120]})

    def log_message(self, fmt, *args):
        print("[devserver]", fmt % args)


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    port = int(os.getenv("PORT", "8000"))
    with socketserver.TCPServer(("0.0.0.0", port), Handler) as httpd:
        print(f"stdlib devserver on http://localhost:{port}  (naver={'ON' if CID and SEC else 'OFF→로컬 시드'})")
        httpd.serve_forever()
