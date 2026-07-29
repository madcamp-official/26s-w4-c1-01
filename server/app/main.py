"""
방꾸요정 백엔드 — LLM 래핑 + 네이버쇼핑 grounding + (3090) 합성 프록시.

정직 원칙(기능명세서 §8): 모든 외부 실패는 예외가 아니라 대체 status로 반환한다.
키/서버가 없어도 프런트가 로컬 폴백으로 성립하도록 FALLBACK/TEXT_CARD 등을 200으로 준다.

환경변수(.env):
  NAVER_CLIENT_ID / NAVER_CLIENT_SECRET  — 네이버쇼핑 검색 API(즉시·합법·grounding)
  ANTHROPIC_API_KEY                      — LLM 검색쿼리 생성/큐레이션(선택)
  SD_SERVER_URL                          — camp-4 3090 이미지 서버(선택, 저denoise 리라이팅)
"""
import os
import re
import json
from typing import Optional

try:
    import httpx
except ImportError:  # 배포 전 로컬에서 미설치일 수 있음
    httpx = None

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .dims import parse_dims, fetch_dims_from_url

app = FastAPI(title="bangkku-api", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

NAVER_ID = os.getenv("NAVER_CLIENT_ID")
NAVER_SECRET = os.getenv("NAVER_CLIENT_SECRET")
SD_SERVER_URL = os.getenv("SD_SERVER_URL")
RENDER_SERVER_URL = os.getenv("RENDER_SERVER_URL")

# 치수 파싱은 app/dims.py로 이관(FastAPI·devserver 공유, 로직 드리프트 방지).


@app.get("/health")
def health():
    return {
        "status": "ok",
        "naver": bool(NAVER_ID and NAVER_SECRET),
        "sd_server": bool(SD_SERVER_URL),
        "render": bool(RENDER_SERVER_URL),
        "llm": bool(os.getenv("GEMINI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")),
        "llm_provider": "gemini" if os.getenv("GEMINI_API_KEY") else ("anthropic" if os.getenv("ANTHROPIC_API_KEY") else None),
    }


@app.get("/api/search")
async def search(q: str = ""):
    """
    자연어 쿼리 → (LLM 검색쿼리 생성) → 네이버쇼핑 grounding → 아이템.
    LLM 단독은 URL·치수를 환각하므로 반드시 실제 상품 API를 grounding으로 깐다(기능명세서 §3-(d)).
    키 없으면 FALLBACK → 프런트가 로컬 시드 카탈로그 사용.
    """
    if not (NAVER_ID and NAVER_SECRET and httpx):
        return {"status": "FALLBACK", "reason": "no_naver_key", "items": []}
    try:
        query = await shape_query(q)  # LLM 있으면 쿼리 정제, 없으면 원문
        async with httpx.AsyncClient(timeout=5) as cx:
            r = await cx.get(
                "https://openapi.naver.com/v1/search/shop.json",
                params={"query": query or q or "가구", "display": 12},
                headers={
                    "X-Naver-Client-Id": NAVER_ID,
                    "X-Naver-Client-Secret": NAVER_SECRET,
                },
            )
            r.raise_for_status()
            data = r.json()
        items = []
        for it in data.get("items", []):
            title = re.sub(r"<[^>]+>", "", it.get("title", ""))
            dims = parse_dims(title)  # 네이버 title엔 치수가 드묾 → 대개 None → 사용자 입력/카테고리 표준으로 보완
            items.append(
                {
                    "id": it.get("productId"),
                    "name": title,
                    "cat": it.get("category3") or it.get("category2") or "가구",
                    "w": (dims or {}).get("w"),
                    "d": (dims or {}).get("d"),
                    "h": (dims or {}).get("h"),
                    "dimAccuracy": "추정" if dims else "미상",
                    "price": _to_int(it.get("lprice")),
                    "image": it.get("image"),  # 썸네일 표시용(핫링크). 누끼 합성엔 사용 금지(§8 라이선스).
                    "buyUrl": it.get("link"),  # 실구매 딥링크
                    "source": it.get("mallName") or "네이버",
                }
            )
        return {"status": "OK", "items": items}
    except Exception as e:  # noqa: BLE001 — 어떤 실패든 폴백으로
        return {"status": "FALLBACK", "reason": str(e)[:120], "items": []}


@app.get("/api/dims")
def dims(url: str = ""):
    """상품 상세페이지에서 치수 자동 추출(정규식→LLM). 동기 fetch라 threadpool에서 실행되도록 def."""
    d = fetch_dims_from_url(url, dict(os.environ))
    return {"status": "OK", "dims": d} if d else {"status": "MISS"}


class ComposeReq(BaseModel):
    room: dict
    items: list
    photo: Optional[str] = None  # dataURL 또는 URL


@app.post("/api/composite")
async def composite(req: ComposeReq):
    """
    3090 SD 서버 저denoise 리라이팅 프록시. 배치·스케일은 클라이언트 homography가 이미 확정했으므로
    여기서는 하모나이즈만. 서버 없으면 CLIENT(클라이언트 목업이 최종)로 폴백.
    """
    if not (SD_SERVER_URL and httpx):
        return {"status": "CLIENT", "reason": "no_sd_server"}
    try:
        async with httpx.AsyncClient(timeout=30) as cx:
            r = await cx.post(f"{SD_SERVER_URL}/relight", json=req.model_dump())
            r.raise_for_status()
            return {"status": "OK", "image": r.json().get("image")}
    except Exception as e:  # noqa: BLE001
        return {"status": "CLIENT", "reason": str(e)[:120]}


class RelightReq(BaseModel):
    image: str                       # 클라이언트 합성 목업 (dataURL/base64)
    strength: float = 0.3            # 저-denoise 밴드(0.28~0.35). 초과 시 형태 드리프트
    prompt: Optional[str] = None


@app.post("/api/relight")
async def relight(req: RelightReq):
    """클라이언트 합성 목업 → camp-3 3090 SD img2img 하모나이즈 → 반환.
    배치·치수는 이미 기하로 확정됨. 여기선 조명·톤만. 서버 없으면 CLIENT(목업 유지)."""
    if not (SD_SERVER_URL and httpx):
        return {"status": "CLIENT", "reason": "no_sd_server"}
    try:
        async with httpx.AsyncClient(timeout=90) as cx:
            r = await cx.post(
                SD_SERVER_URL.rstrip("/") + "/relight",
                json={"image": req.image, "strength": req.strength, "prompt": req.prompt},
            )
            r.raise_for_status()
            data = r.json()
        if data.get("status") == "OK" and data.get("image"):
            return {"status": "OK", "image": data["image"]}
        return {"status": "CLIENT", "reason": str(data.get("reason", "sd error"))[:120]}
    except Exception as e:  # noqa: BLE001
        return {"status": "CLIENT", "reason": str(e)[:120]}


@app.post("/api/card")
async def card(req: ComposeReq):
    """공유 카드 생성(Stretch). 실패 시 TEXT_CARD."""
    if not (SD_SERVER_URL and httpx):
        return {"status": "TEXT_CARD", "text": _text_card(req)}
    try:
        async with httpx.AsyncClient(timeout=30) as cx:
            r = await cx.post(f"{SD_SERVER_URL}/card", json=req.model_dump())
            r.raise_for_status()
            return {"status": "OK", "image": r.json().get("image")}
    except Exception as e:  # noqa: BLE001
        return {"status": "TEXT_CARD", "text": _text_card(req), "reason": str(e)[:120]}


_LAYOUT_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "방꾸요정-배치-LLM-프롬프트.md")
_LAYOUT_PROMPT = (open(_LAYOUT_PROMPT_PATH, encoding="utf-8").read()
                  if os.path.exists(_LAYOUT_PROMPT_PATH)
                  else "원룸 가구를 겹치지 않게 대부분 벽에 붙여 배치. candidates[] JSON으로 3개 이상. cm 정수, (cx,cy)=중심, rotation 0/90/180/270.")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-5")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")


def _layout_user_msg(payload: dict) -> str:
    return ("다음 입력에 대해 §4~§12를 준수하여 겹침 없는 서로 다른 배치 3개 이상을 "
            "§3 JSON 스키마(candidates[])로만 출력하라. 설명 없이 JSON만.\n\n"
            + json.dumps(payload, ensure_ascii=False))


def _salvage_candidates(t: str):
    """잘린 JSON에서 candidates 배열의 완결된 {..} 객체만 균형 파싱으로 회수(응답 truncation 대비)."""
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
                except Exception:  # noqa: BLE001
                    pass
                start = None
        elif ch == ']' and depth == 0:
            break
    return out


def _parse_candidates(text: str):
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        obj = json.loads(t)
        return obj.get("candidates", []) if isinstance(obj, dict) else (obj if isinstance(obj, list) else [])
    except Exception:  # noqa: BLE001
        pass
    cands = _salvage_candidates(t)                       # 잘린 배열에서 완결 후보만 회수
    if cands:
        return cands
    s, e = t.find("{"), t.rfind("}")
    if 0 <= s < e:
        try:
            obj = json.loads(t[s:e + 1])
            return obj.get("candidates", []) if isinstance(obj, dict) else []
        except Exception:  # noqa: BLE001
            pass
    return []


class RenderReq(BaseModel):
    room: dict
    items: list = []
    camera: Optional[dict] = None
    samples: Optional[int] = None
    preset: Optional[str] = "day"   # 시간대 조명(morning/day/sunset/night) — 선언 안 하면 Pydantic이 버려 항상 day로 렌더되던 회귀 버그
    openings: list = []             # 문/창 위치 — 같은 이유로 버려져 렌더에 안 그려지던 것
    view: Optional[str] = None      # 카메라 앵글(wide/cozy) — 없으면 camera/기본 프레이밍


@app.post("/api/render")
async def render(req: RenderReq):
    """3D 배치 → camp-3 Blender Cycles 포토리얼 사진. 서버 없으면 CLIENT(앱은 3D 뷰 유지)."""
    if not (RENDER_SERVER_URL and httpx):
        return {"status": "CLIENT", "reason": "no_render_server"}
    try:
        async with httpx.AsyncClient(timeout=300) as cx:
            r = await cx.post(RENDER_SERVER_URL.rstrip("/") + "/render", json=req.model_dump(exclude_none=True))
            r.raise_for_status()
            data = r.json()
        if data.get("status") == "OK" and data.get("image"):
            return {"status": "OK", "image": data["image"]}
        return {"status": "ERROR", "reason": str(data.get("reason", "render error"))[:200]}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "reason": str(e)[:200]}


class LayoutReq(BaseModel):
    room: dict
    openings: list = []
    furniture: list = []


@app.post("/api/layout")
async def layout(req: LayoutReq):
    """원룸 자동 배치 — LLM(Gemini/Claude)이 후보 생성(앱이 기하엔진으로 겹침 재검증). 키 없으면 NOKEY→앱 로컬 폴백."""
    gkey = os.getenv("GEMINI_API_KEY")
    akey = os.getenv("ANTHROPIC_API_KEY")
    provider = "gemini" if gkey else ("anthropic" if akey else None)
    if not (provider and httpx):
        return {"status": "NOKEY"}
    user = _layout_user_msg(req.model_dump())
    try:
        async with httpx.AsyncClient(timeout=90) as cx:
            if provider == "gemini":
                r = await cx.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={gkey}",
                    json={"system_instruction": {"parts": [{"text": _LAYOUT_PROMPT}]},
                          "contents": [{"role": "user", "parts": [{"text": user}]}],
                          "generationConfig": {"maxOutputTokens": 24576, "temperature": 0.7,
                                               "responseMimeType": "application/json"}},
                )
                r.raise_for_status()
                cand = (r.json().get("candidates") or [{}])[0]
                text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))
            else:
                r = await cx.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={"x-api-key": akey, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": LLM_MODEL, "max_tokens": 4096, "system": _LAYOUT_PROMPT,
                          "messages": [{"role": "user", "content": user}]},
                )
                r.raise_for_status()
                text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        return {"status": "OK", "candidates": _parse_candidates(text), "provider": provider}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "reason": str(e)[:200]}


async def shape_query(q: str) -> Optional[str]:
    """ANTHROPIC 키가 있으면 자연어를 네이버쇼핑 검색어로 정제. 없으면 원문 반환."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not (key and httpx and q):
        return q
    try:
        async with httpx.AsyncClient(timeout=6) as cx:
            r = await cx.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 40,
                    "messages": [
                        {"role": "user", "content": f"다음을 한국어 가구 쇼핑 검색어(명사구)로만 변환. 설명 금지: {q}"}
                    ],
                },
            )
            r.raise_for_status()
            return r.json()["content"][0]["text"].strip() or q
    except Exception:  # noqa: BLE001
        return q


class RecommendReq(BaseModel):
    item: dict = {}


async def _naver_items(query: str):
    async with httpx.AsyncClient(timeout=6) as cx:
        r = await cx.get("https://openapi.naver.com/v1/search/shop.json",
                         params={"query": query or "가구", "display": 12},
                         headers={"X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET})
        r.raise_for_status()
        data = r.json()
    out = []
    for it in data.get("items", []):
        title = re.sub(r"<[^>]+>", "", it.get("title", ""))
        dims = parse_dims(title)
        out.append({"id": it.get("productId"), "name": title,
                    "cat": it.get("category3") or it.get("category2") or "가구",
                    "w": (dims or {}).get("w"), "d": (dims or {}).get("d"), "h": (dims or {}).get("h"),
                    "dimAccuracy": "추정" if dims else "미상", "price": _to_int(it.get("lprice")),
                    "image": it.get("image"), "buyUrl": it.get("link"), "source": it.get("mallName") or "네이버"})
    return out


async def _recommend_queries(item: dict):
    """참조 가구 → 비슷한 상품을 찾을 한국어 네이버 검색어(LLM). 실패/키없음 시 []."""
    gkey = os.getenv("GEMINI_API_KEY")
    if not (gkey and httpx):
        return []
    sysmsg = ("너는 가구 쇼핑 추천 엔진이다. 참조 가구와 '비슷한'(같은 종류 + 비슷한 분위기/스타일 + 비슷한 크기) 상품을 "
              "네이버 쇼핑에서 찾기 위한 한국어 검색어를 서로 조금씩 다르게 3개 만들어 JSON 문자열 배열로만 출력한다. "
              "브랜드명 대신 '종류+분위기+소재+크기' 위주.")
    user = (f"참조 가구 - 이름:'{item.get('name', '')}', 종류:'{item.get('cat', '')}', "
            f"분위기:'{item.get('style', '')}', 크기:{item.get('w')}x{item.get('d')}cm")
    try:
        async with httpx.AsyncClient(timeout=30) as cx:
            r = await cx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={gkey}",
                              json={"system_instruction": {"parts": [{"text": sysmsg}]},
                                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                                    # 512는 부족 — flash 계열은 thinking 토큰(600+)을 먼저 쓰고 답을 내서 MAX_TOKENS로 잘린다.
                                    "generationConfig": {"maxOutputTokens": 2048, "temperature": 0.6, "responseMimeType": "application/json"}})
            r.raise_for_status()
            data = r.json()
        txt = "".join(p.get("text", "") for p in (data.get("candidates") or [{}])[0].get("content", {}).get("parts", []))
        m = re.search(r"\[.*\]", txt, re.S)
        arr = json.loads(m.group(0) if m else txt)
        return [str(q).strip() for q in arr if str(q).strip()][:3]
    except Exception:  # noqa: BLE001
        return []


@app.post("/api/recommend")
async def recommend(req: RecommendReq):
    """유사 가구 추천 — LLM이 네이버 검색어 생성 → 네이버 검색 병합/중복제거."""
    if not (NAVER_ID and NAVER_SECRET and httpx):
        return {"status": "FALLBACK", "reason": "no_naver_key", "items": []}
    item = req.item or {}
    queries = await _recommend_queries(item)
    if not queries:
        queries = [f"{item.get('style', '')} {item.get('cat', '가구')}".strip() or "가구"]
    seen, out = set(), []
    for q in queries[:3]:
        try:
            for it in await _naver_items(q):
                k = it.get("id") or it.get("name")
                if k and k not in seen:
                    seen.add(k)
                    out.append(it)
        except Exception:  # noqa: BLE001
            pass
    return {"status": "OK", "queries": queries, "items": out[:18]}


_CHAT_SYS = (
    "너는 원룸 가구배치 대화형 어시스턴트다. 현재 배치(방 치수, 문/창, 각 가구의 현재 위치 cx·cy(cm)·rotation)와 "
    "사용자 요청을 받아, 요청을 '이행(apply)' 또는 '기각(reject)' 판단한다.\n"
    "좌표계: 원점=방 좌상단, +x=오른쪽(너비 W), +y=아래(깊이 D), 단위 cm 정수, rotation∈{0,90,180,270}(시계방향).\n"
    "하드제약(위반하면 apply 금지): ①가구 겹침 금지 ②모든 가구 방 경계 0..W,0..D 내 ③문 스윙 부채꼴·창 앞 침범 금지.\n"
    "선호: 대형가구는 벽 밀착. TV장은 침대 정면 마주봄. 책상+의자는 의자가 책상 앞면 마주봄. 조명은 침대 헤드 옆.\n"
    "판단: 가능하면 decision=\"apply\"+요청 반영한 '모든 가구의 새 위치' items. 불가능/위험/제약위반이면 decision=\"reject\"+배치 그대로.\n"
    "어느 경우든 reason에 한국어로 친근하게 1~3문장 이유를 쓴다. 출력은 JSON만: "
    "{\"decision\":\"apply\"|\"reject\",\"reason\":\"...\",\"items\":[{\"id\":\"...\",\"cx\":0,\"cy\":0,\"rotation\":0}]} "
    "apply면 items에 모든 가구(변경없는 것 포함), id는 입력 그대로."
)


class ChatReq(BaseModel):
    room: dict = {}
    openings: list = []
    furniture: list = []
    message: str = ""
    history: list = []


@app.post("/api/chat-layout")
async def chat_layout(req: ChatReq):
    """대화형 배치 — 현재 배치 + 요청 → {decision, reason, items?}. 앱이 겹침/문·창 재검증 후 반영."""
    gkey = os.getenv("GEMINI_API_KEY")
    if not (gkey and httpx):
        return {"status": "NOKEY", "decision": "reject", "reason": "AI 연결이 안 돼 있어요(키 미설정)."}
    ctx = json.dumps({"room": req.room, "openings": req.openings, "furniture": req.furniture}, ensure_ascii=False)
    contents = []
    for h in (req.history or [])[-8:]:
        contents.append({"role": "model" if h.get("role") == "assistant" else "user", "parts": [{"text": str(h.get("text", ""))[:500]}]})
    contents.append({"role": "user", "parts": [{"text": f"[현재 배치]\n{ctx}\n\n[사용자 요청]\n{req.message}"}]})
    try:
        async with httpx.AsyncClient(timeout=60) as cx:
            r = await cx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={gkey}",
                              json={"system_instruction": {"parts": [{"text": _CHAT_SYS}]}, "contents": contents,
                                    "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.5, "responseMimeType": "application/json"}})
            r.raise_for_status()
            data = r.json()
        txt = "".join(p.get("text", "") for p in (data.get("candidates") or [{}])[0].get("content", {}).get("parts", []))
        try:
            obj = json.loads(txt)
        except Exception:  # noqa: BLE001
            s, e = txt.find("{"), txt.rfind("}")
            obj = json.loads(txt[s:e + 1]) if 0 <= s < e else {"decision": "reject", "reason": "이해하지 못했어요."}
        return {"status": "OK", "decision": obj.get("decision", "reject"), "reason": obj.get("reason", ""), "items": obj.get("items", [])}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "decision": "reject", "reason": "처리 중 문제가 생겼어요. 다시 시도해 주세요.", "error": str(e)[:150]}


def _text_card(req: ComposeReq) -> str:
    n = len(req.items)
    w = req.room.get("widthM")
    d = req.room.get("depthM")
    return f"{w}m×{d}m 원룸에 가구 {n}점 배치 완료 — 방꾸요정"


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ── 소셜 로그인(OAuth) — devserver.py와 동일 계약. 키 없으면 프론트가 데모 폴백 ──
import time as _time
import hmac as _hmac
import hashlib as _hashlib
import base64 as _base64
import urllib.parse as _uparse
from fastapi.responses import RedirectResponse
from fastapi import Request

AUTH_SECRET = os.getenv("AUTH_SECRET", "bangkku-dev-secret-rotate-me")
AUTH_BASE = os.getenv("AUTH_REDIRECT_BASE", "http://localhost:5173").rstrip("/")
OAUTH = {
    "kakao": {"id": os.getenv("KAKAO_CLIENT_ID"), "secret": os.getenv("KAKAO_CLIENT_SECRET"),
              "auth": "https://kauth.kakao.com/oauth/authorize", "token": "https://kauth.kakao.com/oauth/token",
              "profile": "https://kapi.kakao.com/v2/user/me", "scope": None},
    "naver": {"id": os.getenv("NAVER_LOGIN_CLIENT_ID"), "secret": os.getenv("NAVER_LOGIN_CLIENT_SECRET"),
              "auth": "https://nid.naver.com/oauth2.0/authorize", "token": "https://nid.naver.com/oauth2.0/token",
              "profile": "https://openapi.naver.com/v1/nid/me", "scope": None},
    "google": {"id": os.getenv("GOOGLE_CLIENT_ID"), "secret": os.getenv("GOOGLE_CLIENT_SECRET"),
               "auth": "https://accounts.google.com/o/oauth2/v2/auth", "token": "https://oauth2.googleapis.com/token",
               "profile": "https://www.googleapis.com/oauth2/v2/userinfo", "scope": "openid profile email"},
}


def _sign_token(payload: dict) -> str:
    b = _base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).decode().rstrip("=")
    sig = _hmac.new(AUTH_SECRET.encode(), b.encode(), _hashlib.sha256).hexdigest()[:32]
    return f"{b}.{sig}"


def _verify_token(token: str):
    try:
        b, sig = token.rsplit(".", 1)
        want = _hmac.new(AUTH_SECRET.encode(), b.encode(), _hashlib.sha256).hexdigest()[:32]
        if not _hmac.compare_digest(sig, want):
            return None
        p = json.loads(_base64.urlsafe_b64decode(b + "=" * (-len(b) % 4)))
        if p.get("exp") and p["exp"] < int(_time.time()):
            return None
        return p
    except Exception:  # noqa: BLE001
        return None


@app.get("/api/auth/providers")
async def auth_providers():
    return {p: bool(c.get("id")) for p, c in OAUTH.items()}


@app.get("/api/auth/me")
async def auth_me(request: Request):
    tok = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
    p = _verify_token(tok)
    return {"status": "OK", "user": p} if p else {"status": "NOAUTH"}


@app.get("/api/auth/{provider}/login")
async def auth_login(provider: str):
    conf = OAUTH.get(provider)
    if not conf or not conf.get("id"):
        return RedirectResponse(AUTH_BASE + "/#auth_error=unconfigured")
    q = {"response_type": "code", "client_id": conf["id"],
         "redirect_uri": f"{AUTH_BASE}/api/auth/{provider}/callback", "state": "bk"}
    if conf.get("scope"):
        q["scope"] = conf["scope"]
    return RedirectResponse(conf["auth"] + "?" + _uparse.urlencode(q))


@app.get("/api/auth/{provider}/callback")
async def auth_callback(provider: str, code: str = "", error: str = ""):
    conf = OAUTH.get(provider)
    if not conf or not conf.get("id") or not code or not httpx:
        return RedirectResponse(AUTH_BASE + "/#auth_error=" + (error or "denied"))
    try:
        form = {"grant_type": "authorization_code", "client_id": conf["id"],
                "redirect_uri": f"{AUTH_BASE}/api/auth/{provider}/callback", "code": code}
        if conf.get("secret"):
            form["client_secret"] = conf["secret"]
        if provider == "naver":
            form["state"] = "bk"
        async with httpx.AsyncClient(timeout=12) as cx:
            tr = await cx.post(conf["token"], data=form)
            access = tr.json().get("access_token")
            if not access:
                raise RuntimeError("token exchange failed")
            pr = (await cx.get(conf["profile"], headers={"Authorization": f"Bearer {access}"})).json()
        if provider == "kakao":
            info = (pr.get("kakao_account") or {}).get("profile") or pr.get("properties") or {}
            user = {"provider": "kakao", "id": str(pr.get("id")), "name": info.get("nickname") or "카카오 사용자",
                    "avatar": info.get("profile_image_url") or info.get("profile_image")}
        elif provider == "naver":
            r = pr.get("response") or {}
            user = {"provider": "naver", "id": r.get("id"), "name": r.get("nickname") or r.get("name") or "네이버 사용자",
                    "avatar": r.get("profile_image"), "email": r.get("email")}
        else:
            user = {"provider": "google", "id": pr.get("id") or pr.get("sub"), "name": pr.get("name") or "Google 사용자",
                    "avatar": pr.get("picture"), "email": pr.get("email")}
        user["exp"] = int(_time.time()) + 60 * 60 * 24 * 30
        return RedirectResponse(AUTH_BASE + "/#auth=" + _sign_token(user))
    except Exception as e:  # noqa: BLE001
        return RedirectResponse(AUTH_BASE + "/#auth_error=" + _uparse.quote(str(e)[:80]))


# ── 커뮤니티(방꾸 이야기) — 홈 세그먼트 전환용(design/커뮤니티.html 1c안). 이 프로젝트 첫 영구 저장소라 SQLite 파일 하나로 가볍게.
# 좋아요/댓글 집계는 다음 단계 — 지금은 글쓰기(POST)+피드 조회(GET)만. 서버 없거나 실패해도 프론트가 목업으로 폴백(정직 원칙 §8 fallback=MVP).
import sqlite3
import uuid as _uuid

COMMUNITY_DB = os.getenv("COMMUNITY_DB", os.path.join(os.path.dirname(__file__), "community.db"))
COMMUNITY_CATS = {"flex", "tip", "question"}


def _community_conn():
    conn = sqlite3.connect(COMMUNITY_DB)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS posts ("
        "id TEXT PRIMARY KEY, cat TEXT NOT NULL, title TEXT NOT NULL, image TEXT, "
        "author TEXT, meta TEXT, likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, "
        "saves INTEGER DEFAULT 0, created_at REAL NOT NULL, owner TEXT)"
    )
    try:
        conn.execute("ALTER TABLE posts ADD COLUMN owner TEXT")   # 기존 DB 마이그레이션(이미 있으면 무시)
    except sqlite3.OperationalError:
        pass
    return conn


def _owner_key(user: Optional[dict]) -> Optional[str]:
    return f"{user.get('provider')}:{user.get('id')}" if user else None


class CommunityPostReq(BaseModel):
    cat: str                        # 'flex'(자랑) | 'tip'(꿀팁) | 'question'(질문)
    title: str
    image: Optional[str] = None     # dataURL — 자랑(합성 결과 공유)만 채움
    meta: Optional[str] = None      # 평수·견적 등 한 줄 부가정보(자유 텍스트)


@app.post("/api/community/post")
async def community_post(req: CommunityPostReq, request: Request):
    if req.cat not in COMMUNITY_CATS:
        return {"status": "ERROR", "reason": "invalid cat"}
    title = req.title.strip()[:200]
    if not title:
        return {"status": "ERROR", "reason": "title required"}
    tok = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
    user = _verify_token(tok)
    owner = _owner_key(user)
    post = {
        "id": _uuid.uuid4().hex[:12], "cat": req.cat, "title": title, "image": req.image,
        "author": (user or {}).get("name") or "익명", "meta": req.meta,
        "likes": 0, "comments": 0, "saves": 0, "created_at": _time.time(),
    }
    try:
        conn = _community_conn()
        conn.execute(
            "INSERT INTO posts (id,cat,title,image,author,meta,likes,comments,saves,created_at,owner) VALUES (?,?,?,?,?,?,0,0,0,?,?)",
            (post["id"], post["cat"], post["title"], post["image"], post["author"], post["meta"], post["created_at"], owner),
        )
        conn.commit(); conn.close()
        return {"status": "OK", "post": {**post, "mine": owner is not None}}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "reason": str(e)[:150]}


@app.get("/api/community/feed")
async def community_feed(request: Request, cat: str = "all"):
    tok = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
    my_owner = _owner_key(_verify_token(tok)) if tok else None
    try:
        conn = _community_conn()
        q = "SELECT id,cat,title,image,author,meta,likes,comments,saves,created_at,owner FROM posts"
        args = ()
        if cat and cat != "all":
            q += " WHERE cat=?"; args = (cat,)
        q += " ORDER BY created_at DESC LIMIT 50"
        rows = conn.execute(q, args).fetchall()
        conn.close()
        posts = [
            {"id": r[0], "cat": r[1], "title": r[2], "image": r[3], "author": r[4], "meta": r[5],
             "likes": r[6], "comments": r[7], "saves": r[8], "created_at": r[9],
             "mine": bool(my_owner) and r[10] == my_owner}   # owner는 노출 안 하고 본인 글 여부만 전달
            for r in rows
        ]
        return {"status": "OK", "posts": posts}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "reason": str(e)[:150], "posts": []}


class CommunityEditReq(BaseModel):
    title: Optional[str] = None
    meta: Optional[str] = None


@app.put("/api/community/post/{post_id}")
async def community_edit(post_id: str, req: CommunityEditReq, request: Request):
    user = _verify_token((request.headers.get("Authorization") or "").removeprefix("Bearer ").strip())
    if not user:
        return {"status": "NOAUTH"}
    conn = _community_conn()
    row = conn.execute("SELECT owner FROM posts WHERE id=?", (post_id,)).fetchone()
    if not row:
        conn.close()
        return {"status": "ERROR", "reason": "not found"}
    if row[0] != _owner_key(user):
        conn.close()
        return {"status": "FORBIDDEN"}
    title = (req.title or "").strip()[:200]
    if title:
        conn.execute("UPDATE posts SET title=? WHERE id=?", (title, post_id))
    if req.meta is not None:
        conn.execute("UPDATE posts SET meta=? WHERE id=?", (req.meta, post_id))
    conn.commit(); conn.close()
    return {"status": "OK"}


@app.delete("/api/community/post/{post_id}")
async def community_delete(post_id: str, request: Request):
    user = _verify_token((request.headers.get("Authorization") or "").removeprefix("Bearer ").strip())
    if not user:
        return {"status": "NOAUTH"}
    conn = _community_conn()
    row = conn.execute("SELECT owner FROM posts WHERE id=?", (post_id,)).fetchone()
    if not row:
        conn.close()
        return {"status": "ERROR", "reason": "not found"}
    if row[0] != _owner_key(user):
        conn.close()
        return {"status": "FORBIDDEN"}
    conn.execute("DELETE FROM posts WHERE id=?", (post_id,))
    conn.commit(); conn.close()
    return {"status": "OK"}
