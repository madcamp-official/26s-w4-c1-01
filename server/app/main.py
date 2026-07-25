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

# 치수 파싱은 app/dims.py로 이관(FastAPI·devserver 공유, 로직 드리프트 방지).


@app.get("/health")
def health():
    return {
        "status": "ok",
        "naver": bool(NAVER_ID and NAVER_SECRET),
        "sd_server": bool(SD_SERVER_URL),
        "llm": bool(os.getenv("ANTHROPIC_API_KEY")),
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


def _parse_candidates(text: str):
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        obj = json.loads(t)
    except Exception:  # noqa: BLE001
        s, e = t.find("{"), t.rfind("}")
        if s < 0 or e <= s:
            return []
        obj = json.loads(t[s:e + 1])
    return obj.get("candidates", []) if isinstance(obj, dict) else []


class LayoutReq(BaseModel):
    room: dict
    openings: list = []
    furniture: list = []


@app.post("/api/layout")
async def layout(req: LayoutReq):
    """원룸 자동 배치 — Claude가 후보 생성(앱이 기하엔진으로 겹침 재검증). 키 없으면 NOKEY→앱 로컬 폴백."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not (key and httpx):
        return {"status": "NOKEY"}
    user = ("다음 입력에 대해 §4~§12를 준수하여 겹침 없는 서로 다른 배치 3개 이상을 "
            "§3 JSON 스키마(candidates[])로만 출력하라. 설명 없이 JSON만.\n\n"
            + json.dumps(req.model_dump(), ensure_ascii=False))
    try:
        async with httpx.AsyncClient(timeout=90) as cx:
            r = await cx.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": LLM_MODEL, "max_tokens": 4096, "system": _LAYOUT_PROMPT,
                      "messages": [{"role": "user", "content": user}]},
            )
            r.raise_for_status()
            text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        return {"status": "OK", "candidates": _parse_candidates(text)}
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
