"""치수 파싱·추출 — FastAPI(main.py)와 stdlib(devserver.py)가 공유하는 단일 소스."""
import re
import os
import json
import urllib.request

DIM3_RE = re.compile(r"(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*(mm|cm)?", re.I)
DIM2_RE = re.compile(r"(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*(mm|cm)?", re.I)
LBL = {
    "w": re.compile(r"(?:가로|폭|너비)\s*[:=]?\s*(\d{2,4})\s*(mm|cm)?"),
    "d": re.compile(r"(?:세로|깊이)\s*[:=]?\s*(\d{2,4})\s*(mm|cm)?"),
    "h": re.compile(r"(?:높이)\s*[:=]?\s*(\d{2,4})\s*(mm|cm)?"),
}


def _scale(vals, unit):
    """단위 미표기면 크기로 추정: 300 초과 mm, 이하 cm."""
    if unit == "mm":
        return 0.1
    if unit == "cm":
        return 1.0
    return 0.1 if max(vals) > 300 else 1.0


def parse_dims(text):
    """자유텍스트에서 W/D/H(cm) 추정. 라벨형(가로/세로/높이) 우선, 없으면 WxDxH. 실패 None."""
    if not text:
        return None
    # 1) 라벨형: 가로/폭/너비 → W, 세로/깊이 → D, 높이 → H
    lab = {}
    for k, rx in LBL.items():
        m = rx.search(text)
        if m:
            lab[k] = (int(m.group(1)), (m.group(2) or "").lower())
    if "w" in lab and "d" in lab:
        vals = [v for v, _ in lab.values()]
        def conv(pair):
            v, u = pair
            return round(v * _scale([v], u) if u else v * _scale(vals, ""))
        return {"w": conv(lab["w"]), "d": conv(lab["d"]), "h": conv(lab["h"]) if "h" in lab else None, "accuracy": "추정"}
    # 2) 숫자형 WxDxH → WxD
    m = DIM3_RE.search(text)
    if m:
        g = (m.group(1), m.group(2), m.group(3))
        unit = (m.group(4) or "").lower()
    else:
        m = DIM2_RE.search(text)
        if not m:
            return None
        g = (m.group(1), m.group(2), None)
        unit = (m.group(3) or "").lower()
    vals = [int(x) for x in g if x]
    s = _scale(vals, unit)
    cm = lambda v: round(int(v) * s) if v else None
    return {"w": cm(g[0]), "d": cm(g[1]), "h": cm(g[2]), "accuracy": "추정"}


def fetch_dims_from_url(url, env=None):
    """상세페이지에서 치수 추출: 페이지 텍스트 정규식 → (키 있으면)LLM → None. best-effort."""
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; bangkku/0.1)"})
        with urllib.request.urlopen(req, timeout=8) as r:
            html = r.read(400000).decode("utf-8", errors="ignore")
    except Exception:  # noqa: BLE001 — 차단/타임아웃 등 모두 best-effort
        return None
    text = re.sub(r"<[^>]+>", " ", html)
    d = parse_dims(text)
    if d and d.get("w") and d.get("d"):
        d["accuracy"] = "추정(상세)"
        return d
    return _llm_dims(text[:6000], env)


def _llm_dims(text, env):
    key = os.getenv("ANTHROPIC_API_KEY") or (env or {}).get("ANTHROPIC_API_KEY")
    if not (key and text):
        return None
    body = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 80,
        "messages": [{
            "role": "user",
            "content": "다음 상품 상세 텍스트에서 가구 치수를 cm 숫자로 뽑아 JSON만 출력(모르면 null). "
                       "형식 {\"w\":,\"d\":,\"h\":}. 텍스트: " + text,
        }],
    }).encode()
    try:
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=body,
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            out = json.load(r)
        m = re.search(r"\{.*\}", out["content"][0]["text"], re.S)
        if not m:
            return None
        d = json.loads(m.group(0))
        if d.get("w") and d.get("d"):
            return {"w": d.get("w"), "d": d.get("d"), "h": d.get("h"), "accuracy": "추정(AI)"}
    except Exception:  # noqa: BLE001
        return None
    return None
