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
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "app"))
from dims import parse_dims, fetch_dims_from_url  # noqa: E402 (공유 치수 모듈)



# 외부 API 에러 문구에 요청 URL(=API 키 포함)이 들어가므로, 프런트로 내보내기 전에 가린다.
_SECRET_RE = re.compile(r"(key=)[^&\s'\"]+|(?:AIza|AQ\.)[A-Za-z0-9_\-]{8,}")


def _safe_err(e, n=200):
    return _SECRET_RE.sub(lambda m: (m.group(1) or "") + "<REDACTED>", str(e))[:n]


def load_env():
    env = {}
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                # 인라인 주석 제거 — .env.example을 그대로 복사하면 "KAKAO_CLIENT_ID=  # 발급처..."의
                # 주석이 값으로 잡혀, 키가 비었는데도 /api/auth/providers가 true를 반환한다.
                env[k] = v.split("#", 1)[0].strip()
    return env


ENV = load_env()
CID = ENV.get("NAVER_CLIENT_ID") or os.getenv("NAVER_CLIENT_ID")
SEC = ENV.get("NAVER_CLIENT_SECRET") or os.getenv("NAVER_CLIENT_SECRET")
SD_SERVER_URL = ENV.get("SD_SERVER_URL") or os.getenv("SD_SERVER_URL")
RENDER_SERVER_URL = ENV.get("RENDER_SERVER_URL") or os.getenv("RENDER_SERVER_URL")
ANTHROPIC_API_KEY = ENV.get("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
LLM_MODEL = ENV.get("LLM_MODEL") or os.getenv("LLM_MODEL") or "claude-sonnet-5"
GEMINI_API_KEY = ENV.get("GEMINI_API_KEY") or os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = ENV.get("GEMINI_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-flash-latest"
LLM_PROVIDER = "gemini" if GEMINI_API_KEY else ("anthropic" if ANTHROPIC_API_KEY else None)
# ── 소셜 로그인(OAuth 2.0 인가코드) — 키는 server/.env, 없으면 프론트가 데모 로그인 폴백 ──
# 네이버 '로그인' 앱 키는 쇼핑검색 키(NAVER_CLIENT_ID)와 별개 앱이라 이름을 분리한다.
AUTH_SECRET = ENV.get("AUTH_SECRET") or os.getenv("AUTH_SECRET") or "bangkku-dev-secret-rotate-me"
AUTH_BASE = (ENV.get("AUTH_REDIRECT_BASE") or os.getenv("AUTH_REDIRECT_BASE") or "http://localhost:5173").rstrip("/")
OAUTH = {
    "kakao": {"id": (ENV.get("KAKAO_CLIENT_ID") or os.getenv("KAKAO_CLIENT_ID")), "secret": (ENV.get("KAKAO_CLIENT_SECRET") or os.getenv("KAKAO_CLIENT_SECRET")),
              "auth": "https://kauth.kakao.com/oauth/authorize", "token": "https://kauth.kakao.com/oauth/token",
              "profile": "https://kapi.kakao.com/v2/user/me", "scope": None},
    "naver": {"id": (ENV.get("NAVER_LOGIN_CLIENT_ID") or os.getenv("NAVER_LOGIN_CLIENT_ID")), "secret": (ENV.get("NAVER_LOGIN_CLIENT_SECRET") or os.getenv("NAVER_LOGIN_CLIENT_SECRET")),
              "auth": "https://nid.naver.com/oauth2.0/authorize", "token": "https://nid.naver.com/oauth2.0/token",
              "profile": "https://openapi.naver.com/v1/nid/me", "scope": None},
    "google": {"id": (ENV.get("GOOGLE_CLIENT_ID") or os.getenv("GOOGLE_CLIENT_ID")), "secret": (ENV.get("GOOGLE_CLIENT_SECRET") or os.getenv("GOOGLE_CLIENT_SECRET")),
               "auth": "https://accounts.google.com/o/oauth2/v2/auth", "token": "https://oauth2.googleapis.com/token",
               "profile": "https://www.googleapis.com/oauth2/v2/userinfo", "scope": "openid profile email"},
}


def sign_token(payload):
    """HMAC 서명 세션 토큰 — base64url(json).sig32. 외부 JWT 라이브러리 없이 stdlib로."""
    import hmac as _hmac, hashlib, base64
    b = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).decode().rstrip("=")
    sig = _hmac.new(AUTH_SECRET.encode(), b.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{b}.{sig}"


def verify_token(token):
    import hmac as _hmac, hashlib, base64
    try:
        b, sig = token.rsplit(".", 1)
        want = _hmac.new(AUTH_SECRET.encode(), b.encode(), hashlib.sha256).hexdigest()[:32]
        if not _hmac.compare_digest(sig, want):
            return None
        pad = "=" * (-len(b) % 4)
        p = json.loads(base64.urlsafe_b64decode(b + pad))
        if p.get("exp") and p["exp"] < int(time.time()):
            return None
        return p
    except Exception:  # noqa: BLE001
        return None


def _http_json(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=12) as r:
        return json.load(r)


def oauth_exchange(provider, code, base=None):
    """인가코드 → access_token → 프로필({provider,id,name,avatar,email}).
    base: 인가 때 쓴 리다이렉트 베이스와 반드시 동일해야 함(요청 호스트 기준)."""
    conf = OAUTH[provider]
    form = {"grant_type": "authorization_code", "client_id": conf["id"],
            "redirect_uri": f"{base or AUTH_BASE}/api/auth/{provider}/callback", "code": code}
    if conf.get("secret"):
        form["client_secret"] = conf["secret"]
    if provider == "naver":
        form["state"] = "bk"
    tok = _http_json(conf["token"], data=urllib.parse.urlencode(form).encode(),
                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    access = tok.get("access_token")
    if not access:
        raise RuntimeError(f"token exchange failed: {str(tok)[:120]}")
    prof = _http_json(conf["profile"], headers={"Authorization": f"Bearer {access}"})
    if provider == "kakao":
        pr = (prof.get("kakao_account") or {}).get("profile") or prof.get("properties") or {}
        return {"provider": "kakao", "id": str(prof.get("id")), "name": pr.get("nickname") or "카카오 사용자",
                "avatar": pr.get("profile_image_url") or pr.get("profile_image")}
    if provider == "naver":
        r = prof.get("response") or {}
        return {"provider": "naver", "id": r.get("id"), "name": r.get("nickname") or r.get("name") or "네이버 사용자",
                "avatar": r.get("profile_image"), "email": r.get("email")}
    return {"provider": "google", "id": prof.get("id") or prof.get("sub"), "name": prof.get("name") or "Google 사용자",
            "avatar": prof.get("picture"), "email": prof.get("email")}


# 무료 일일 한도는 '모델당' 20회 — 폴백 체인(main.py와 동일 정책). 일일 한도·404는 다음 모델,
# 분당 한도는 retryDelay 후 같은 모델 1회 재시도. 전부 실패면 RuntimeError.
# 텍스트 작업(배치·대화·추천)은 lite 체인 — devserver엔 비전 엔드포인트가 없다(main.py와 정책 일치).
GEMINI_CHAIN = ([m.strip() for m in (ENV.get("GEMINI_CHAIN_TEXT") or os.getenv("GEMINI_CHAIN_TEXT") or "").split(",") if m.strip()]
                or ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"])


def gemini_call(body_dict, timeout=60):
    payload = json.dumps(body_dict).encode()
    for model in GEMINI_CHAIN:
        url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + GEMINI_API_KEY
        for attempt in (0, 1):
            req = urllib.request.Request(url, data=payload, headers={"content-type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    break
                if e.code != 429:
                    raise
                daily, delay = False, 20.0
                try:
                    for det in json.load(e).get("error", {}).get("details", []) or []:
                        for v in det.get("violations", []) or []:
                            if "PerDay" in str(v.get("quotaId", "")):
                                daily = True
                        if "retryDelay" in det:
                            delay = min(45.0, float(str(det["retryDelay"]).rstrip("s")) + 1)
                except Exception:  # noqa: BLE001
                    pass
                if daily or attempt:
                    break
                time.sleep(delay)
    raise RuntimeError("all_models_exhausted")


_PROMPT_PATH = os.path.join(HERE, "..", "docs", "방꾸요정-배치-LLM-프롬프트.md")
LAYOUT_PROMPT = (open(_PROMPT_PATH, encoding="utf-8").read()
                 if os.path.exists(_PROMPT_PATH)
                 else "원룸 가구를 겹치지 않게 대부분 벽에 붙여 배치. §3 JSON(candidates[])으로 3개 이상 출력. cm 정수, (cx,cy)=중심, rotation 0/90/180/270.")


def _salvage_candidates(t):
    """잘린 JSON에서 candidates 배열의 '완결된' {..} 객체만 균형 파싱으로 회수(응답 truncation 대비)."""
    i = t.find('"candidates"')
    if i < 0:
        return []
    b = t.find('[', i)
    if b < 0:
        return []
    out, depth, start, instr, esc = [], 0, None, False, False
    for j in range(b + 1, len(t)):
        ch = t[j]
        if instr:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch == '{':
            if depth == 0:
                start = j
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    out.append(json.loads(t[start:j + 1]))
                except Exception:
                    pass
                start = None
        elif ch == ']' and depth == 0:
            break
    return out


def parse_layout_json(text):
    """LLM 텍스트 → candidates 리스트. 코드펜스/잡텍스트를 벗기고, 잘린 응답도 최대한 복구한다."""
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        obj = json.loads(t)
        return obj.get("candidates", []) if isinstance(obj, dict) else (obj if isinstance(obj, list) else [])
    except Exception:
        pass
    cands = _salvage_candidates(t)                       # 잘린 배열에서 완결 후보만 회수
    if cands:
        return cands
    s, e = t.find("{"), t.rfind("}")                     # 최후: 첫{~마지막}
    if 0 <= s < e:
        try:
            obj = json.loads(t[s:e + 1])
            return obj.get("candidates", []) if isinstance(obj, dict) else []
        except Exception:
            pass
    return []


def _layout_user_msg(payload):
    return ("다음 입력에 대해 §4~§12를 준수하여 겹침 없는 서로 다른 배치 3개 이상을 "
            "§3 JSON 스키마(candidates[])로만 출력하라. 설명 없이 JSON만.\n\n"
            + json.dumps(payload, ensure_ascii=False))


def gemini_layout(payload):
    """방/가구 입력 → Gemini로 배치 후보 생성(프롬프트 md를 system_instruction으로). JSON 강제."""
    body = json.dumps({
        "system_instruction": {"parts": [{"text": LAYOUT_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": _layout_user_msg(payload)}]}],
        "generationConfig": {"maxOutputTokens": 24576, "temperature": 0.7, "responseMimeType": "application/json"},
    }).encode()
    data = gemini_call(json.loads(body.decode()), timeout=90)
    cand = (data.get("candidates") or [{}])[0]
    text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))
    return parse_layout_json(text)


def anthropic_layout(payload):
    """방/가구 입력 → Claude로 배치 후보 생성(프롬프트 md를 system으로)."""
    user = _layout_user_msg(payload)
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


def gemini_recommend_queries(item):
    """참조 가구 → 비슷한 상품을 찾을 한국어 네이버 검색어 3개(LLM). 실패 시 예외."""
    sysmsg = ("너는 가구 쇼핑 추천 엔진이다. 참조 가구와 '비슷한'(같은 종류 + 비슷한 분위기/스타일 + 비슷한 크기) 상품을 "
              "네이버 쇼핑에서 찾기 위한 한국어 검색어를 만든다. 서로 조금씩 다른 검색어 3개를 JSON 문자열 배열로만 출력한다. "
              "브랜드명 대신 '종류+분위기+소재+크기(1인/2인/3인 등)' 위주로. 예: [\"미드센추리 3인 패브릭 소파\",\"북유럽 원목 3인 소파\",\"모던 로우 소파 200\"]")
    user = (f"참조 가구 - 이름:'{item.get('name', '')}', 종류:'{item.get('cat', '')}', "
            f"분위기:'{item.get('style', '')}', 크기:{item.get('w')}x{item.get('d')}cm")
    body = json.dumps({
        "system_instruction": {"parts": [{"text": sysmsg}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        # 512는 부족 — flash 계열은 thinking 토큰(600+)을 먼저 쓰고 답을 내서 MAX_TOKENS로 잘린다.
        "generationConfig": {"maxOutputTokens": 2048, "temperature": 0.6, "responseMimeType": "application/json"},
    }).encode()
    data = gemini_call(json.loads(body.decode()), timeout=30)
    txt = "".join(p.get("text", "") for p in (data.get("candidates") or [{}])[0].get("content", {}).get("parts", []))
    m = re.search(r"\[.*\]", txt, re.S)
    arr = json.loads(m.group(0) if m else txt)
    return [str(q).strip() for q in arr if str(q).strip()][:3]


def recommend_similar(item):
    """LLM 검색어 생성 → 네이버 검색 병합/중복제거. LLM 없으면 분위기+종류로 폴백."""
    queries = []
    if LLM_PROVIDER == "gemini" and GEMINI_API_KEY:
        try:
            queries = gemini_recommend_queries(item)
        except Exception:  # noqa: BLE001 — LLM 실패 시 폴백 검색어
            queries = []
    if not queries:
        base = f"{item.get('style', '')} {item.get('cat', '가구')}".strip()
        queries = [base or "가구"]
    seen, out = set(), []
    for q in queries[:3]:
        try:
            for r in naver_search(q):
                key = r.get("id") or r.get("name")
                if key and key not in seen:
                    seen.add(key)
                    out.append(r)
        except Exception:  # noqa: BLE001 — 개별 쿼리 실패는 건너뜀
            pass
    return {"queries": queries, "items": out[:18]}


CHAT_SYS = (
    "너는 원룸 가구배치 대화형 어시스턴트다. 현재 배치(방 치수, 문/창, 각 가구의 현재 위치 cx·cy(cm)·rotation)와 "
    "사용자 요청을 받아, 요청을 '이행(apply)' 또는 '기각(reject)' 판단한다.\n"
    "좌표계: 원점=방 좌상단, +x=오른쪽(너비 W), +y=아래(깊이 D), 단위 cm 정수, rotation∈{0,90,180,270}(시계방향).\n"
    "하드제약(위반하면 apply 금지): ①가구 겹침 금지 ②모든 가구 방 경계 0..W,0..D 내 ③문 스윙 부채꼴·창 앞 침범 금지.\n"
    "선호: 대형가구는 벽 밀착. TV장은 침대 정면 마주봄. 책상+의자는 의자가 책상 앞면 마주봄. 조명은 침대 헤드 옆.\n"
    "판단 규칙:\n"
    "- 이행 가능(물리적 가능 + 하드제약 안 깨짐): decision=\"apply\", 요청을 반영한 '모든 가구의 새 위치'를 items로.\n"
    "- 삭제 요청('침대 빼줘','침대만 남기고 다 빼줘')도 이행: 없앨 가구 id를 remove 배열로, items에는 남는 가구만.\n"
    "- 불가능/위험/제약위반(예: 문을 막게 됨, 겹칠 수밖에 없음, 방 밖으로 나감, 모순된 요청): decision=\"reject\", 배치 그대로.\n"
    "어느 경우든 reason에 한국어로 친근하게 1~3문장으로 이유·결과를 설명한다.\n"
    "출력은 JSON만: {\"decision\":\"apply\"|\"reject\",\"reason\":\"...\",\"remove\":[\"id\"...],\"items\":[{\"id\":\"...\",\"cx\":0,\"cy\":0,\"rotation\":0}]}\n"
    "apply면 items에 모든 가구(변경 없는 것 포함)를 넣는다. reject면 items는 생략/무시. id는 입력 그대로 사용."
)


def gemini_chat_layout(payload):
    """현재 배치 + 사용자 요청 → {decision, reason, items?}. LLM이 이행/기각 판단."""
    ctx = json.dumps({"room": payload.get("room", {}), "openings": payload.get("openings", []),
                      "furniture": payload.get("furniture", [])}, ensure_ascii=False)
    contents = []
    for h in (payload.get("history") or [])[-8:]:
        contents.append({"role": "model" if h.get("role") == "assistant" else "user",
                         "parts": [{"text": str(h.get("text", ""))[:500]}]})
    contents.append({"role": "user", "parts": [{"text": f"[현재 배치]\n{ctx}\n\n[사용자 요청]\n{payload.get('message', '')}"}]})
    body = json.dumps({
        "system_instruction": {"parts": [{"text": CHAT_SYS}]},
        "contents": contents,
        "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.5, "responseMimeType": "application/json"},
    }).encode()
    data = gemini_call(json.loads(body.decode()), timeout=60)
    txt = "".join(p.get("text", "") for p in (data.get("candidates") or [{}])[0].get("content", {}).get("parts", []))
    try:
        obj = json.loads(txt)
    except Exception:
        s, e = txt.find("{"), txt.rfind("}")
        obj = json.loads(txt[s:e + 1]) if 0 <= s < e else {"decision": "reject", "reason": "이해하지 못했어요. 다시 말씀해 주세요."}
    return {"decision": obj.get("decision", "reject"), "reason": obj.get("reason", ""), "remove": obj.get("remove", []), "items": obj.get("items", [])}


class Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, url):
        self.send_response(302)
        self.send_header("Location", url)
        self.end_headers()

    def _auth_base(self):
        """요청 Host 기반 OAuth 리다이렉트 베이스 — localhost와 배포 도메인을 동시에 지원.
        (serve_build/cloudflared가 X-Forwarded-Host로 원 호스트를 전달. 허용 목록 밖이면 env 기본값.)"""
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").split(",")[0].strip()
        if host.endswith(".madcamp-kaist.org"):
            return "https://" + host
        if host.startswith("localhost") or host.startswith("127.0.0.1"):
            return "http://" + host
        return AUTH_BASE

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/health":
            return self._json({"status": "ok", "naver": bool(CID and SEC),
                               "sd_server": bool(SD_SERVER_URL), "render": bool(RENDER_SERVER_URL),
                               "llm": bool(LLM_PROVIDER), "llm_provider": LLM_PROVIDER})
        if u.path == "/api/search":
            if not (CID and SEC):
                return self._json({"status": "FALLBACK", "reason": "no_naver_key", "items": []})
            q = urllib.parse.parse_qs(u.query).get("q", [""])[0]
            try:
                return self._json({"status": "OK", "items": naver_search(q)})
            except Exception as e:  # noqa: BLE001 — 어떤 실패든 폴백
                return self._json({"status": "FALLBACK", "reason": _safe_err(e, 120), "items": []})
        if u.path == "/api/dims":
            url = urllib.parse.parse_qs(u.query).get("url", [""])[0]
            d = fetch_dims_from_url(url, ENV)
            return self._json({"status": "OK", "dims": d} if d else {"status": "MISS"})

        # ── 소셜 로그인 ──
        if u.path == "/api/auth/providers":     # 프론트가 실연동/데모 폴백을 구분
            return self._json({p: bool(c.get("id")) for p, c in OAUTH.items()})
        if u.path == "/api/auth/me":
            tok = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
            p = verify_token(tok)
            return self._json({"status": "OK", "user": p} if p else {"status": "NOAUTH"}, 200 if p else 401)
        m = re.match(r"^/api/auth/(kakao|naver|google)/(login|callback)$", u.path)
        if m:
            provider, action = m.group(1), m.group(2)
            conf = OAUTH[provider]
            base = self._auth_base()               # 요청 호스트 기준(로컬/배포 동시 지원)
            if not conf.get("id"):
                return self._redirect(base + "/#auth_error=unconfigured")
            if action == "login":
                q = {"response_type": "code", "client_id": conf["id"],
                     "redirect_uri": f"{base}/api/auth/{provider}/callback", "state": "bk"}
                if conf.get("scope"):
                    q["scope"] = conf["scope"]
                return self._redirect(conf["auth"] + "?" + urllib.parse.urlencode(q))
            # callback: 코드 교환 → 프로필 → 서명 토큰 → 프론트로(#auth=)
            code = urllib.parse.parse_qs(u.query).get("code", [""])[0]
            if not code:
                return self._redirect(base + "/#auth_error=denied")
            try:
                user = oauth_exchange(provider, code, base)
                user["exp"] = int(time.time()) + 60 * 60 * 24 * 30   # 30일
                return self._redirect(base + "/#auth=" + sign_token(user))
            except Exception as e:  # noqa: BLE001
                return self._redirect(base + "/#auth_error=" + urllib.parse.quote(_safe_err(e, 80)))
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path not in ("/api/relight", "/api/layout", "/api/render", "/api/recommend", "/api/chat-layout"):
            return self._json({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n)) if n else {}
        except Exception as e:  # noqa: BLE001
            return self._json({"status": "ERROR", "reason": "bad request"}, 400)

        # 포토리얼 렌더 — camp-3 Blender 서비스로 프록시(배치 3D → 사진).
        # Blender가 연속 렌더에서 간헐 크래시(500)하므로 1회 재시도 + 상류 에러 본문 표면화.
        if path == "/api/render":
            if not RENDER_SERVER_URL:
                return self._json({"status": "CLIENT", "reason": "no_render_server"})
            payload = json.dumps(body).encode()
            last = "render error"
            for _ in range(2):
                try:
                    req = urllib.request.Request(RENDER_SERVER_URL.rstrip("/") + "/render", data=payload,
                                                 headers={"Content-Type": "application/json"})
                    with urllib.request.urlopen(req, timeout=300) as r:
                        data = json.load(r)
                    if data.get("status") == "OK" and data.get("image"):
                        return self._json({"status": "OK", "image": data["image"]})
                    last = str(data.get("reason", "render error"))[:200]
                except urllib.error.HTTPError as e:  # 상류 500 — 본문에 blender stderr tail이 있음
                    try:
                        last = str(json.load(e).get("reason", str(e)))[:200]
                    except Exception:  # noqa: BLE001
                        last = _safe_err(e, 200)
                except Exception as e:  # noqa: BLE001
                    last = _safe_err(e, 200)
            return self._json({"status": "ERROR", "reason": last})

        # 유사 가구 추천 — LLM이 네이버 검색어 생성 → 네이버 검색 병합
        if path == "/api/recommend":
            if not (CID and SEC):
                return self._json({"status": "FALLBACK", "reason": "no_naver_key", "items": []})
            try:
                rec = recommend_similar(body.get("item") or {})
                return self._json({"status": "OK", **rec})
            except Exception as e:  # noqa: BLE001
                return self._json({"status": "ERROR", "reason": _safe_err(e, 200), "items": []})

        # 대화형 배치 — 현재 배치+사용자 요청 → 이행/기각+이유(앱이 겹침 재검증 후 반영)
        if path == "/api/chat-layout":
            if not (LLM_PROVIDER == "gemini" and GEMINI_API_KEY):
                return self._json({"status": "NOKEY", "decision": "reject",
                                   "reason": "AI 연결이 안 돼 있어요(키 미설정)."})
            try:
                return self._json({"status": "OK", **gemini_chat_layout(body)})
            except Exception as e:  # noqa: BLE001
                return self._json({"status": "ERROR", "decision": "reject",
                                   "reason": "처리 중 문제가 생겼어요. 다시 시도해 주세요.", "error": _safe_err(e, 150)})

        # 원룸 자동 배치 — LLM(Gemini/Claude)이 후보 생성(앱이 겹침 재검증)
        if path == "/api/layout":
            if not LLM_PROVIDER:
                return self._json({"status": "NOKEY"})
            try:
                cands = gemini_layout(body) if LLM_PROVIDER == "gemini" else anthropic_layout(body)
                return self._json({"status": "OK", "candidates": cands, "provider": LLM_PROVIDER})
            except Exception as e:  # noqa: BLE001
                return self._json({"status": "ERROR", "reason": _safe_err(e, 200)})

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
            return self._json({"status": "CLIENT", "reason": _safe_err(e, 120)})

    def log_message(self, fmt, *args):
        print("[devserver]", fmt % args)


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    port = int(os.getenv("PORT", "8000"))
    with socketserver.TCPServer(("0.0.0.0", port), Handler) as httpd:
        print(f"stdlib devserver on http://localhost:{port}  (naver={'ON' if CID and SEC else 'OFF→로컬 시드'})")
        httpd.serve_forever()
