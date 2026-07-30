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
import asyncio as _asyncio   # 429 재시도 대기
from typing import Optional

try:
    import httpx
except ImportError:  # 배포 전 로컬에서 미설치일 수 있음
    httpx = None

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .dims import parse_dims, fetch_dims_from_url


# 외부 API 에러 문구에는 요청 URL이 통째로 들어가고, 그 URL에 API 키가 쿼리로 붙어 있다.
# 그대로 프런트에 내려주면 브라우저 화면에 키가 노출된다 → 항상 이걸로 감싸서 내보낸다.
_SECRET_RE = re.compile(r"(key=)[^&\s'\"]+|(?:AIza|AQ\.)[A-Za-z0-9_\-]{8,}")


def _safe_err(e, n: int = 200) -> str:
    return _SECRET_RE.sub(lambda m: (m.group(1) or "") + "<REDACTED>", str(e))[:n]


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
        return {"status": "FALLBACK", "reason": _safe_err(e, 120), "items": []}


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
        return {"status": "CLIENT", "reason": _safe_err(e, 120)}


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
        return {"status": "CLIENT", "reason": _safe_err(e, 120)}


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
        return {"status": "TEXT_CARD", "text": _text_card(req), "reason": _safe_err(e, 120)}


_LAYOUT_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "방꾸요정-배치-LLM-프롬프트.md")
_LAYOUT_PROMPT = (open(_LAYOUT_PROMPT_PATH, encoding="utf-8").read()
                  if os.path.exists(_LAYOUT_PROMPT_PATH)
                  else "원룸 가구를 겹치지 않게 대부분 벽에 붙여 배치. candidates[] JSON으로 3개 이상. cm 정수, (cx,cy)=중심, rotation 0/90/180/270.")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-5")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

# 무료 티어 일일 한도는 '모델당' 20회(quotaId=...PerProjectPerModel) — 한 모델이 마르면
# 다음 모델이 새 버킷이다. 용도별 체인으로 예산을 분리한다:
#   비전(도면 판독) = flash 체인 — 이미지 판독 품질이 중요하고 호출 빈도가 낮다.
#   텍스트(배치·대화·추천) = lite 체인 — 호출이 잦아 flash 버킷을 아껴야 하고 lite로 충분하다.
# GEMINI_CHAIN_VISION / GEMINI_CHAIN_TEXT(쉼표 구분)로 각각 오버라이드 가능.
def _chain(envkey, default):
    return [m.strip() for m in (os.getenv(envkey) or "").split(",") if m.strip()] or default


_GEMINI_CHAIN_VISION = _chain("GEMINI_CHAIN_VISION", list(dict.fromkeys([GEMINI_MODEL, "gemini-3.5-flash"])))
_GEMINI_CHAIN_TEXT = _chain("GEMINI_CHAIN_TEXT", ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"])


def _quota_429(r):
    """429 응답 해석 → (일일 한도인가, 분당 재시도 대기초)."""
    daily, delay = False, 20.0
    try:
        for det in r.json().get("error", {}).get("details", []) or []:
            for v in det.get("violations", []) or []:
                if "PerDay" in str(v.get("quotaId", "")):
                    daily = True
            if "retryDelay" in det:
                delay = min(45.0, float(str(det["retryDelay"]).rstrip("s")) + 1)
    except Exception:  # noqa: BLE001
        pass
    return daily, delay


async def _gemini_call(body: dict, timeout: float = 60, chain=None):
    """Gemini generateContent + 폴백 체인. 일일 한도·404(모델명 회전)는 다음 모델로,
    분당 한도는 retryDelay만큼 쉬고 같은 모델 1회 재시도. 반환 (응답 JSON, 사용된 모델).
    체인 전부 실패면 RuntimeError('all_models_exhausted') — 호출부가 status로 변환한다."""
    gkey = os.getenv("GEMINI_API_KEY")
    async with httpx.AsyncClient(timeout=timeout) as cx:
        for model in (chain or _GEMINI_CHAIN_TEXT):
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gkey}"
            for attempt in (0, 1):
                r = await cx.post(url, json=body)
                if r.status_code == 429:
                    daily, delay = _quota_429(r)
                    if daily or attempt:
                        break                          # 이 모델 포기 → 체인의 다음 모델
                    await _asyncio.sleep(delay)
                    continue
                if r.status_code == 404:
                    break                              # 모델명이 사라짐 → 다음 모델
                r.raise_for_status()
                return r.json(), model
    raise RuntimeError("all_models_exhausted")


def _gemini_text(data: dict) -> str:
    cand = (data.get("candidates") or [{}])[0]
    return "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))


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
    cutouts: list = []              # 욕실·주방 등 부속실(직육면체 벽체) — 같은 이유로 버려져 렌더에 부속실이 안 서던 것
    lampOn: Optional[bool] = None   # 조명 수동 토글(null=프리셋 정책: 밤/노을 ON)
    lampColor: Optional[str] = None # 조명 색(hex) — 웜/아이보리/쿨
    view: Optional[str] = None      # 카메라 앵글(wide/cozy) — 없으면 camera/기본 프레이밍
    pano: Optional[bool] = None     # 360° 둘러보기 한 장(등장방형). 선언 안 하면 Pydantic이 버린다
    panoExp: Optional[float] = None # 파노라마 노출 보정(기본 0.7 내림)
    rx: Optional[int] = None        # 해상도 오버라이드
    ry: Optional[int] = None


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
        return {"status": "ERROR", "reason": _safe_err(e, 200)}


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
        if provider == "gemini":
            data, _m = await _gemini_call(
                {"system_instruction": {"parts": [{"text": _LAYOUT_PROMPT}]},
                 "contents": [{"role": "user", "parts": [{"text": user}]}],
                 # 자동배치는 로컬 기하 엔진이 최종 검증·후보 보충을 담당한다.
                 # 긴 자기검산 출력 때문에 90초를 다 쓰지 않도록 생성량과 대기시간을 제한한다.
                 "generationConfig": {"maxOutputTokens": 4096, "temperature": 0.7,
                                      "responseMimeType": "application/json"}}, timeout=15)
            text = _gemini_text(data)
        else:
            async with httpx.AsyncClient(timeout=90) as cx:
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
        return {"status": "ERROR", "reason": _safe_err(e, 200)}


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
        data, _m = await _gemini_call(
            {"system_instruction": {"parts": [{"text": sysmsg}]},
             "contents": [{"role": "user", "parts": [{"text": user}]}],
             # 512는 부족 — flash 계열은 thinking 토큰(600+)을 먼저 쓰고 답을 내서 MAX_TOKENS로 잘린다.
             "generationConfig": {"maxOutputTokens": 2048, "temperature": 0.6, "responseMimeType": "application/json"}}, timeout=30)
        txt = _gemini_text(data)
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
    "선호: 대형가구는 벽 밀착. TV장은 침대 헤드→발치 시선축의 맞은편 벽에 두고 앞면을 침대로 향하게 하여, 누운 사람이 목을 돌리지 않고 정면으로 보게 함(중심축 정렬, 수평각 15도 이내). 책상/테이블+의자는 의자가 앞면을 마주봄(테이블은 책상과 동급 — 의자·조명 관계 규칙 동일). 낮은 조명(h<70cm)은 책상/테이블 위, 플로어 스탠드는 침대 헤드 옆.\n"
    "판단: 가능하면 decision=\"apply\"+요청 반영한 '모든 가구의 새 위치' items. 불가능/위험/제약위반이면 decision=\"reject\"+배치 그대로.\n"
    "삭제 요청('침대 빼줘','침대만 남기고 다 빼줘')도 이행이다: decision=\"apply\", 없앨 가구의 id를 remove 배열에 넣고 "
    "items에는 '남는 가구'만 넣는다(전부 삭제면 items는 빈 배열). 위치를 안 바꾸면 items에 현재 좌표 그대로.\n"
    "어느 경우든 reason에 한국어로 친근하게 1~3문장 이유를 쓴다. 출력은 JSON만: "
    "{\"decision\":\"apply\"|\"reject\",\"reason\":\"...\",\"remove\":[\"id\"...],\"items\":[{\"id\":\"...\",\"cx\":0,\"cy\":0,\"rotation\":0}]} "
    "apply면 items에 남는 모든 가구(변경없는 것 포함), id는 입력 그대로. 삭제가 없으면 remove는 빈 배열."
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
        data, _m = await _gemini_call(
            {"system_instruction": {"parts": [{"text": _CHAT_SYS}]}, "contents": contents,
             "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.5, "responseMimeType": "application/json"}}, timeout=60)
        txt = _gemini_text(data)
        try:
            obj = json.loads(txt)
        except Exception:  # noqa: BLE001
            s, e = txt.find("{"), txt.rfind("}")
            obj = json.loads(txt[s:e + 1]) if 0 <= s < e else {"decision": "reject", "reason": "이해하지 못했어요."}
        return {"status": "OK", "decision": obj.get("decision", "reject"), "reason": obj.get("reason", ""),
                "remove": obj.get("remove", []), "items": obj.get("items", [])}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "decision": "reject", "reason": "처리 중 문제가 생겼어요. 다시 시도해 주세요.", "error": _safe_err(e, 150)}


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
OAUTH = {   # 네이버 로그인은 제외(2026-07-29) — NAVER_CLIENT_ID/SECRET은 "네이버쇼핑 검색"용이라 별개다
    "kakao": {"id": os.getenv("KAKAO_CLIENT_ID"), "secret": os.getenv("KAKAO_CLIENT_SECRET"),
              "auth": "https://kauth.kakao.com/oauth/authorize", "token": "https://kauth.kakao.com/oauth/token",
              "profile": "https://kapi.kakao.com/v2/user/me", "scope": None},
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
        else:
            user = {"provider": "google", "id": pr.get("id") or pr.get("sub"), "name": pr.get("name") or "Google 사용자",
                    "avatar": pr.get("picture"), "email": pr.get("email")}
        user["exp"] = int(_time.time()) + 60 * 60 * 24 * 30
        return RedirectResponse(AUTH_BASE + "/#auth=" + _sign_token(user))
    except Exception as e:  # noqa: BLE001
        return RedirectResponse(AUTH_BASE + "/#auth_error=" + _uparse.quote(_safe_err(e, 80)))


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
    conn.execute(
        "CREATE TABLE IF NOT EXISTS post_likes ("
        "post_id TEXT NOT NULL, owner TEXT NOT NULL, created_at REAL NOT NULL, "
        "PRIMARY KEY (post_id, owner))"
    )
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
        return {"status": "ERROR", "reason": _safe_err(e, 150)}


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
        liked_ids = set()
        if my_owner:
            liked_ids = {r[0] for r in conn.execute("SELECT post_id FROM post_likes WHERE owner=?", (my_owner,)).fetchall()}
        conn.close()
        posts = [
            {"id": r[0], "cat": r[1], "title": r[2], "image": r[3], "author": r[4], "meta": r[5],
             "likes": r[6], "comments": r[7], "saves": r[8], "created_at": r[9],
             "mine": bool(my_owner) and r[10] == my_owner,   # owner는 노출 안 하고 본인 글 여부만 전달
             "liked": r[0] in liked_ids}
            for r in rows
        ]
        return {"status": "OK", "posts": posts}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "reason": str(e)[:150], "posts": []}


@app.post("/api/community/post/{post_id}/like")
async def community_like(post_id: str, request: Request):
    """좋아요 토글 — 로그인 필요(owner 없으면 '내가 좋아요한 글'을 기록할 방법이 없음)."""
    user = _verify_token((request.headers.get("Authorization") or "").removeprefix("Bearer ").strip())
    if not user:
        return {"status": "NOAUTH"}
    owner = _owner_key(user)
    conn = _community_conn()
    if not conn.execute("SELECT 1 FROM posts WHERE id=?", (post_id,)).fetchone():
        conn.close()
        return {"status": "ERROR", "reason": "not found"}
    if conn.execute("SELECT 1 FROM post_likes WHERE post_id=? AND owner=?", (post_id, owner)).fetchone():
        conn.execute("DELETE FROM post_likes WHERE post_id=? AND owner=?", (post_id, owner))
        conn.execute("UPDATE posts SET likes = MAX(likes - 1, 0) WHERE id=?", (post_id,))
        liked = False
    else:
        conn.execute("INSERT INTO post_likes (post_id, owner, created_at) VALUES (?,?,?)", (post_id, owner, _time.time()))
        conn.execute("UPDATE posts SET likes = likes + 1 WHERE id=?", (post_id,))
        liked = True
    conn.commit()
    likes = conn.execute("SELECT likes FROM posts WHERE id=?", (post_id,)).fetchone()[0]
    conn.close()
    return {"status": "OK", "liked": liked, "likes": likes}


@app.get("/api/community/liked")
async def community_liked(request: Request):
    """내가 좋아요한 글 목록(마이 탭). 로그인 필요."""
    user = _verify_token((request.headers.get("Authorization") or "").removeprefix("Bearer ").strip())
    if not user:
        return {"status": "NOAUTH", "posts": []}
    owner = _owner_key(user)
    try:
        conn = _community_conn()
        rows = conn.execute(
            "SELECT p.id,p.cat,p.title,p.image,p.author,p.meta,p.likes,p.comments,p.saves,p.created_at,p.owner "
            "FROM posts p JOIN post_likes l ON p.id = l.post_id "
            "WHERE l.owner=? ORDER BY l.created_at DESC LIMIT 50",
            (owner,),
        ).fetchall()
        conn.close()
        posts = [
            {"id": r[0], "cat": r[1], "title": r[2], "image": r[3], "author": r[4], "meta": r[5],
             "likes": r[6], "comments": r[7], "saves": r[8], "created_at": r[9],
             "mine": r[10] == owner, "liked": True}
            for r in rows
        ]
        return {"status": "OK", "posts": posts}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "reason": _safe_err(e, 150), "posts": []}


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


# ── 도면 사진 → 편집 가능한 방(초안) ────────────────────────────────────────────
# 정직 원칙: LLM이 읽은 치수는 '초안'이다. 같은 도면을 반복 판독시키면 방 면적이 최대 46%까지
# 흔들리는 걸 실측으로 확인했다(인허가 도면 기준). 그래서 이 엔드포인트는 확정 치수를 주지 않고,
# accuracy='estimate'를 달아 돌려주며 앱이 사용자 확인(한 변 실측 보정)을 거치게 한다.
# 모든 위치는 '이미지 픽셀 박스'([ymin,xmin,ymax,xmax], 0~1000 정규화 — Gemini box 규약)로 받는다.
# 미터 좌표를 직접 받으면 언더레이(imageBox 크롭)와 컷아웃이 서로 다른 추정이라 화면에서 어긋난다.
# 픽셀 박스는 그림과 같은 좌표계라 정렬이 구조적으로 보장되고, 미터 변환은 서버가 한다.
_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "widthM": {"type": "number"}, "depthM": {"type": "number"},
        "imageBox": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
        "cutouts": {"type": "array", "items": {"type": "object", "properties": {
            "kind": {"type": "string"},
            "label": {"type": "string"},
            "box": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4}},
            "required": ["kind", "box"]}},
        "openings": {"type": "array", "items": {"type": "object", "properties": {
            "kind": {"type": "string"},
            "box": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4}},
            "required": ["kind", "box"]}},
        "printedAreaM2": {"type": "number"},
        "unitLabel": {"type": "string"},
        "unitsDetected": {"type": "number"},
        "confidence": {"type": "number"},
        "note": {"type": "string"},
    },
    "required": ["widthM", "depthM", "cutouts", "openings", "imageBox", "confidence", "note"],
}

_PLAN_SYS = (
    "너는 한국 원룸 평면도를 읽어 가구배치 앱이 쓸 방 데이터를 만드는 판독기다.\n"
    "모든 박스는 [ymin,xmin,ymax,xmax], '이미지 전체 크기' 대비 0~1000 정규화 좌표다.\n"
    "이 박스들은 도면 그림 위에 그대로 오버레이된다 — 그림과 픽셀 단위로 정렬되는 것이 치수 추정보다 중요하다.\n"
    "0) 세대 선택 — 이미지가 '한 세대'가 아닐 수 있다(층 전체 도면, 여러 세대, 계단실·복도·주차·치수선 띠 포함).\n"
    "   읽을 대상은 '주거 세대 하나'뿐이다: 세대 라벨(N호)과 전용면적이 붙은 세대를 우선하고, 여럿이면 가장 크고 완전하게\n"
    "   보이는 세대 하나만 고른다. 계단실·엘리베이터·공용복도·주차장·기계실·옆 세대는 절대 포함하지 마라.\n"
    "   (욕실·다용도실·발코니처럼 그 세대 '안'의 부속실은 세대에 포함한다.)\n"
    "   - imageBox = 고른 세대의 외곽벽 박스.\n"
    "   - unitLabel = 고른 세대의 라벨(예: '1호'). 없으면 생략. unitsDetected = 이미지에 보이는 주거 세대 수.\n"
    "1) cutouts = 세대 안에서 가구를 '놓을 수 없는' 부속실만. kind는 bath(욕실)·kitchen(주방)·entry(현관)·closet(붙박이/보일러실/다용도실).\n"
    "   침실·안방·거실·서재처럼 가구를 놓는 '생활 공간'은 절대 cutout이 아니다 — 그 공간이 배치 대상이므로 비워 둔다.\n"
    "   label = 도면에 그 실 이름이 인쇄돼 있으면 그대로(예: '다용도실'). 각 부속실의 '벽 위치 그대로' box를 준다.\n"
    "   전부 imageBox 안에 있어야 하고 서로 겹치면 안 된다.\n"
    "1-1) 세대 외곽이 L자·ㄷ자 등 '비직사각형'이면: imageBox는 세대 전체를 감싸는 바운딩 박스로 잡고,\n"
    "   박스 안에 들어온 '세대 밖' 영역(옆 세대·복도·계단실·엘리베이터·건물 외부)을 kind=\"void\" cutout으로 반드시 표시한다.\n"
    "   void를 빠뜨리면 그 자리에 가구가 놓이는 치명적 오류가 된다. 세대 경계벽을 따라가며 확인하라.\n"
    "2) openings = 세대 외곽벽 위의 문(door)/창(window) 개구부 box.\n"
    "3) widthM/depthM = imageBox(바운딩 박스)의 실제 미터 치수. 도면에 인쇄된 치수(mm)·전용면적을 근거로만 추정한다.\n"
    "   비직사각형 세대는 바운딩 박스가 전용면적보다 클 수 있다 — 전용면적에 맞추려 박스를 줄이지 마라.\n"
    "- printedAreaM2 = 그 세대에 '전용면적'이 인쇄돼 있으면 그 숫자. 없으면 생략.\n"
    "- confidence 0~1: 치수선 숫자를 직접 읽었으면 높게, 비율로 추정했으면 0.4 이하.\n"
    "- note: 사용자에게 보여줄 한 문장(어느 세대를 골랐고 무엇이 불확실한지).\n"
    "치수를 지어내지 마라. 근거가 없으면 confidence를 낮추고 note에 '치수 표기 없음'이라고 적어라."
)


class FloorplanReq(BaseModel):
    image: str                      # dataURL 또는 base64
    hintM: Optional[float] = None   # 사용자가 아는 한 변(m) — 있으면 그 값으로 비례 보정


def _box_frac(box, unit):
    """이미지 좌표 박스(0~1000) → 세대(unit) 박스 기준 0~1 비율 (fx0,fy0,fx1,fy1). 밖이면 잘라냄."""
    uy0, ux0, uy1, ux1 = unit
    uw, uh = ux1 - ux0, uy1 - uy0
    if uw <= 0 or uh <= 0:
        return None
    y0, x0, y1, x1 = [max(0.0, min(1000.0, float(v))) for v in box]
    fx0 = max(0.0, min(1.0, (x0 - ux0) / uw)); fx1 = max(0.0, min(1.0, (x1 - ux0) / uw))
    fy0 = max(0.0, min(1.0, (y0 - uy0) / uh)); fy1 = max(0.0, min(1.0, (y1 - uy0) / uh))
    if fx1 - fx0 <= 0.01 or fy1 - fy0 <= 0.01:
        return None
    return fx0, fy0, fx1, fy1


def _clean_plan(p: dict):
    """LLM 픽셀 박스 → 미터 좌표 변환 + 정규화(겹침 제거, 5cm 스냅, 개구부 벽 판정).
    컷아웃·개구부가 imageBox와 같은 좌표계에서 오므로, 언더레이(=imageBox 크롭)와의 정렬이 보장된다."""
    snap = lambda v: round(float(v) * 20) / 20
    W = max(1.2, min(12.0, snap(p.get("widthM", 3.0))))
    D = max(1.2, min(12.0, snap(p.get("depthM", 4.0))))
    unit = p.get("imageBox") or [0, 0, 1000, 1000]
    try:
        unit = [max(0.0, min(1000.0, float(v))) for v in unit]
        if unit[2] - unit[0] < 50 or unit[3] - unit[1] < 50:      # 5% 미만 박스 = 무효
            unit = [0, 0, 1000, 1000]
    except Exception:  # noqa: BLE001
        unit = [0, 0, 1000, 1000]

    kinds = {"bath", "kitchen", "entry", "closet", "void"}   # void = 세대 밖(비직사각형 외곽)
    # 생활 공간(침실·거실 등)은 '배치 대상'이지 배치금지가 아니다 — 프롬프트가 놓쳐도 여기서 거른다.
    # ('주방'의 방, '다용도실'의 실이 걸리지 않게 구체 명사만 매칭.)
    living_re = re.compile(r"침실|안방|거실|서재|응접|리빙|드레스")
    cuts = []
    # void(세대 밖)를 먼저 처리 — 부속실 박스와 겹치면 유령 바닥을 막는 void가 남는 쪽이 안전하다.
    for c in sorted(p.get("cutouts", []) or [], key=lambda c: 0 if c.get("kind") == "void" else 1):
        label = str(c.get("label", "") or "").strip()
        if label and (living_re.search(label) or label == "방"):
            continue
        f = _box_frac(c.get("box") or [], unit)
        if not f:
            continue
        fx0, fy0, fx1, fy1 = f
        x, y = snap(fx0 * W), snap(fy0 * D)
        w, d = snap((fx1 - fx0) * W), snap((fy1 - fy0) * D)
        w, d = min(w, W - x), min(d, D - y)
        if w < 0.3 or d < 0.3:
            continue
        box = {"x": x, "y": y, "w": w, "d": d, "kind": c.get("kind") if c.get("kind") in kinds else "closet"}
        if label:
            box["label"] = label[:12]                  # 도면에 적힌 실명 그대로 편집기 칩에 표시
        if any(min(a["x"] + a["w"], x + w) - max(a["x"], x) > 0.05 and
               min(a["y"] + a["d"], y + d) - max(a["y"], y) > 0.05 for a in cuts):
            continue                                              # 겹치면 버림(엔진 면적 계산이 틀어짐)
        cuts.append(box)

    ops = []
    for o in (p.get("openings", []) or [])[:6]:
        f = _box_frac(o.get("box") or [], unit)
        if not f:
            continue
        fx0, fy0, fx1, fy1 = f
        cx, cy = (fx0 + fx1) / 2, (fy0 + fy1) / 2
        ew, eh = fx1 - fx0, fy1 - fy0
        # 벽 판정: 박스가 납작한 방향 우선(가로로 길면 top/bottom), 애매하면 가장 가까운 외곽벽.
        if ew > eh * 1.3:
            wall = "top" if cy < 0.5 else "bottom"
        elif eh > ew * 1.3:
            wall = "left" if cx < 0.5 else "right"
        else:
            dists = {"top": cy, "bottom": 1 - cy, "left": cx, "right": 1 - cx}
            wall = min(dists, key=dists.get)
        kind = "door" if o.get("kind") == "door" else "window"
        if wall in ("left", "right"):
            span, pos_f, wid_f = D, cy, eh
        else:
            span, pos_f, wid_f = W, cx, ew
        wid = max(0.4, min(3.0, snap(wid_f * span)))
        pos = min(max(snap(pos_f * span), wid / 2), span - wid / 2)
        ops.append({"kind": kind, "wall": wall, "pos": pos, "width": wid,
                    **({"hinge": "a"} if kind == "door" else {})})
    return {"widthM": W, "depthM": D, "cutouts": cuts, "openings": ops}


@app.post("/api/floorplan")
async def floorplan(req: FloorplanReq):
    """도면 사진 → 편집 가능한 방 초안. 반환: {status, room, accuracy, confidence, note}."""
    gkey = os.getenv("GEMINI_API_KEY")
    if not (gkey and httpx):
        return {"status": "NOKEY", "reason": "AI 연결이 안 돼 있어요(키 미설정)."}
    raw = (req.image or "").split(",", 1)[-1]
    if len(raw) < 100:
        return {"status": "ERROR", "reason": "이미지가 비어 있어요."}
    mime = "image/png" if "image/png" in (req.image or "") else "image/jpeg"
    body = {
        "system_instruction": {"parts": [{"text": _PLAN_SYS}]},
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": mime, "data": raw}},
            {"text": "이 평면도를 위 규칙대로 읽어 JSON으로만 출력하라."},
        ]}],
        # 2048로는 부족 — flash 계열은 thinking 토큰을 먼저 쓰고 답을 낸다(추천 기능에서 겪은 문제).
        "generationConfig": {"maxOutputTokens": 16384, "temperature": 0.1,
                             "responseMimeType": "application/json", "responseSchema": _PLAN_SCHEMA},
    }
    # 429 처리(분당 재시도·일일 폴백 체인)는 _gemini_call이 담당 — 체인 전부 소진 시에만 안내.
    # 도면 판독은 '비전 체인'(flash) — 이미지 이해 품질이 중요해 lite로 내리지 않는다.
    try:
        data, _m = await _gemini_call(body, timeout=120, chain=_GEMINI_CHAIN_VISION)
        obj = json.loads(_gemini_text(data))
    except RuntimeError:
        return {"status": "RATE_LIMIT",
                "reason": "오늘의 무료 AI 한도를(예비 모델까지) 다 썼어요. 내일 다시 시도하거나, 평수/도면 프리셋으로 진행해 주세요."}
    except Exception as e:  # noqa: BLE001 — 실패는 예외가 아니라 status로(프런트가 수동 입력으로 폴백)
        return {"status": "ERROR", "reason": _safe_err(e, 150)}

    room = _clean_plan(obj)
    # 사용자가 아는 한 변이 있으면 그 비율로 전체를 보정한다(LLM 절대치수보다 실측이 우선).
    if req.hintM and req.hintM > 0.5 and room["widthM"] > 0:
        k = req.hintM / room["widthM"]
        for key in ("widthM", "depthM"):
            room[key] = round(room[key] * k, 2)
        for c in room["cutouts"]:
            for key in ("x", "y", "w", "d"):
                c[key] = round(c[key] * k, 2)
        for o in room["openings"]:
            for key in ("pos", "width"):
                o[key] = round(o[key] * k, 2)
    # imageBox([ymin,xmin,ymax,xmax] 0~1000) → 0~1 비율 {x0,y0,x1,y1}. 프런트가 이 영역만 잘라
    # 언더레이로 깐다 — 층 도면을 통째로 올려도 계단실·옆세대·치수선 띠가 배경에 안 들어가게.
    image_box = None
    try:
        b = [max(0.0, min(1000.0, float(v))) / 1000.0 for v in (obj.get("imageBox") or [])]
        if len(b) == 4 and b[2] - b[0] > 0.05 and b[3] - b[1] > 0.05:
            image_box = {"y0": round(b[0], 4), "x0": round(b[1], 4), "y1": round(b[2], 4), "x1": round(b[3], 4)}
    except Exception:  # noqa: BLE001 — 박스가 이상하면 없는 것으로(전체 이미지 폴백)
        image_box = None
    return {
        "status": "OK", "room": room,
        "accuracy": "measured" if req.hintM else "estimate",
        "confidence": float(obj.get("confidence", 0.0) or 0.0),
        "printedAreaM2": obj.get("printedAreaM2"),
        "unitLabel": str(obj.get("unitLabel", "") or "")[:20] or None,
        "unitsDetected": int(obj.get("unitsDetected", 1) or 1),
        "imageBox": image_box,
        "note": str(obj.get("note", ""))[:200],
    }


# ===== 배치함(저장한 방) — 서버 보관 =====
# 렌더 PNG는 dataURL 그대로 두면 한 장에 1~2MB다. 브라우저 localStorage(5MB)로는 서너 개면 꽉 차고,
# sqlite에 넣으면 DB가 금방 수백 MB가 된다. 그래서 이미지는 '파일'로 떨어뜨리고 DB엔 경로만 둔다.
import base64 as _b64
from fastapi import Request as _Req
from fastapi.responses import Response as _Resp

ROOMS_DIR = os.getenv("ROOMS_DIR", os.path.join(os.path.dirname(__file__), "uploads", "rooms"))
ROOM_MAX = 60                     # 계정당 보관 개수 상한(넘으면 오래된 것부터 정리)


def _rooms_conn():
    conn = sqlite3.connect(COMMUNITY_DB)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS saved_rooms ("
        "id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at REAL NOT NULL, "
        "label TEXT, estimate INTEGER DEFAULT 0, estimate_est INTEGER DEFAULT 0, "
        "room TEXT, openings TEXT, items TEXT, has_image INTEGER DEFAULT 0)"
    )
    return conn


def _room_png_path(rid: str) -> str:
    return os.path.join(ROOMS_DIR, f"{rid}.png")


def _decode_data_url(s: Optional[str]) -> Optional[bytes]:
    """dataURL(image/png;base64,...) → bytes. 형식이 아니거나 과대하면 None."""
    if not s or not isinstance(s, str) or "base64," not in s:
        return None
    try:
        raw = _b64.b64decode(s.split("base64,", 1)[1], validate=False)
    except Exception:  # noqa: BLE001
        return None
    return raw if 0 < len(raw) <= 12 * 1024 * 1024 else None


class SaveRoomReq(BaseModel):
    room: dict
    openings: list = []
    items: list = []
    renderImg: Optional[str] = None    # dataURL — 파일로 저장하고 DB엔 안 넣는다
    label: Optional[str] = None
    estimate: int = 0
    estimateIsEst: bool = False


@app.post("/api/rooms")
async def save_room(req: SaveRoomReq, request: _Req):
    """배치 저장. 로그인해야 계정에 귀속된다(비로그인은 앱이 localStorage로 폴백)."""
    user = _verify_token((request.headers.get("Authorization") or "").removeprefix("Bearer ").strip())
    owner = _owner_key(user)
    if not owner:
        return {"status": "NOAUTH"}
    rid = _uuid.uuid4().hex[:12]
    png = _decode_data_url(req.renderImg)
    try:
        if png:
            os.makedirs(ROOMS_DIR, exist_ok=True)
            with open(_room_png_path(rid), "wb") as f:
                f.write(png)
        conn = _rooms_conn()
        conn.execute(
            "INSERT INTO saved_rooms (id,owner,created_at,label,estimate,estimate_est,room,openings,items,has_image)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (rid, owner, _time.time(), (req.label or "")[:80], int(req.estimate or 0), int(bool(req.estimateIsEst)),
             json.dumps(req.room), json.dumps(req.openings), json.dumps(req.items), 1 if png else 0),
        )
        # 상한 초과분 정리 — DB 행과 PNG 파일을 같이 지운다(고아 파일 방지)
        old = conn.execute(
            "SELECT id FROM saved_rooms WHERE owner=? ORDER BY created_at DESC LIMIT -1 OFFSET ?",
            (owner, ROOM_MAX),
        ).fetchall()
        for (oid,) in old:
            conn.execute("DELETE FROM saved_rooms WHERE id=?", (oid,))
            try:
                os.remove(_room_png_path(oid))
            except OSError:
                pass
        conn.commit(); conn.close()
        return {"status": "OK", "id": rid, "image": f"/api/rooms/{rid}/image" if png else None}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "reason": _safe_err(e, 150)}


@app.get("/api/rooms")
async def list_rooms(request: _Req):
    """내 배치함 목록. 이미지는 URL로만 준다 — 목록 응답에 dataURL을 담으면 수 MB가 된다."""
    user = _verify_token((request.headers.get("Authorization") or "").removeprefix("Bearer ").strip())
    owner = _owner_key(user)
    if not owner:
        return {"status": "NOAUTH", "rooms": []}
    try:
        conn = _rooms_conn()
        rows = conn.execute(
            "SELECT id,created_at,label,estimate,estimate_est,room,openings,items,has_image"
            " FROM saved_rooms WHERE owner=? ORDER BY created_at DESC", (owner,)
        ).fetchall()
        conn.close()
        return {"status": "OK", "rooms": [
            {"id": r[0], "savedAt": r[1] * 1000, "roomLabel": r[2], "estimate": r[3], "estimateIsEst": bool(r[4]),
             "room": json.loads(r[5] or "{}"), "openings": json.loads(r[6] or "[]"), "items": json.loads(r[7] or "[]"),
             "image": f"/api/rooms/{r[0]}/image" if r[8] else None}
            for r in rows]}
    except Exception as e:  # noqa: BLE001
        return {"status": "ERROR", "reason": _safe_err(e, 150), "rooms": []}


@app.get("/api/rooms/{room_id}/image")
async def room_image(room_id: str):
    """저장된 렌더 PNG. 경로 조작 방지를 위해 id는 hex만 허용."""
    if not re.fullmatch(r"[0-9a-f]{6,32}", room_id):
        return _Resp(status_code=404)
    path = _room_png_path(room_id)
    if not os.path.exists(path):
        return _Resp(status_code=404)
    with open(path, "rb") as f:
        return _Resp(content=f.read(), media_type="image/png",
                     headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.delete("/api/rooms/{room_id}")
async def delete_room(room_id: str, request: _Req):
    user = _verify_token((request.headers.get("Authorization") or "").removeprefix("Bearer ").strip())
    owner = _owner_key(user)
    if not owner:
        return {"status": "NOAUTH"}
    conn = _rooms_conn()
    row = conn.execute("SELECT owner FROM saved_rooms WHERE id=?", (room_id,)).fetchone()
    if not row or row[0] != owner:
        conn.close()
        return {"status": "ERROR", "reason": "not found"}
    conn.execute("DELETE FROM saved_rooms WHERE id=?", (room_id,))
    conn.commit(); conn.close()
    try:
        os.remove(_room_png_path(room_id))
    except OSError:
        pass
    return {"status": "OK"}
