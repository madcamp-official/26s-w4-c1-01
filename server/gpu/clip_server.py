#!/usr/bin/env python3
"""camp-3(3090) CLIP 임베딩 서비스 — 닮은꼴 매칭용.
이미지(URL 또는 dataURL) → L2정규화된 CLIP 이미지 임베딩 벡터.
카탈로그 썸네일을 미리 임베딩해 두고, 검색 시 네이버 상품 사진을 임베딩해 코사인 최근접으로 매칭.
POST /embed {images:[url|dataURL,...]} -> {vectors:[[...512]|null,...]}
GET /health
"""
import io, os, json, base64, threading, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL = os.getenv("CLIP_MODEL", "openai/clip-vit-base-patch32")
# CPU 기본 — CLIP-B/32는 CPU로도 임베딩 100~300ms/장이라 충분하고, GPU(리라이팅 점유) 경합·드라이버(cu130 804) 회피.
DEVICE = os.getenv("CLIP_DEVICE", "cpu")
torch.set_num_threads(max(2, os.cpu_count() or 4))
print(f"[clip] loading {MODEL} on {DEVICE} ...", flush=True)
model = CLIPModel.from_pretrained(MODEL).to(DEVICE).eval()
proc = CLIPProcessor.from_pretrained(MODEL)
LOCK = threading.Lock()
print("[clip] ready", flush=True)

UA = {"User-Agent": "Mozilla/5.0"}


def load_image(s):
    if s.startswith("http"):
        data = urllib.request.urlopen(urllib.request.Request(s, headers=UA), timeout=15).read()
    else:
        data = base64.b64decode(s.split(",", 1)[-1])
    return Image.open(io.BytesIO(data)).convert("RGB")


def embed(images):
    loaded, idx = [], []
    for i, s in enumerate(images):
        try:
            loaded.append(load_image(s)); idx.append(i)
        except Exception as e:  # noqa: BLE001
            print(f"[clip] load fail {i}: {str(e)[:80]}", flush=True)
    vecs = [None] * len(images)
    if loaded:
        with torch.no_grad(), LOCK:
            inp = proc(images=loaded, return_tensors="pt").to(DEVICE)
            feat = model.get_image_features(**inp)
            feat = feat / feat.norm(dim=-1, keepdim=True)
        for j, i in enumerate(idx):
            vecs[i] = [round(x, 6) for x in feat[j].cpu().tolist()]
    return vecs


class H(BaseHTTPRequestHandler):
    def _send(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/health":
            return self._send({"status": "ok", "device": DEVICE, "model": MODEL})
        self._send({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/embed":
            return self._send({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n))
            vecs = embed(data.get("images", []))
            self._send({"status": "OK", "vectors": vecs})
        except Exception as e:  # noqa: BLE001
            self._send({"status": "ERROR", "reason": str(e)[:200]}, 500)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8601"))
    print(f"[clip] serving on 0.0.0.0:{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
