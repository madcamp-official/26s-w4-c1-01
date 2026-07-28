#!/usr/bin/env python3
"""camp-3(3090) 리라이팅 서버 — 클라이언트 합성 목업을 SD1.5 img2img 저-denoise로 하모나이즈.
설계(기능명세서 §3-c): 배치·치수는 이미 기하로 확정됨. 여기서는 조명·톤·그림자만 정합(저 strength).
POST /relight {image: dataURL|base64, strength?, prompt?} -> {status, image}
GET /health
"""
import io, os, json, base64, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch
from PIL import Image
from diffusers import StableDiffusionImg2ImgPipeline

MODEL = os.getenv("MODEL_ID", "stable-diffusion-v1-5/stable-diffusion-v1-5")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.float16 if DEVICE == "cuda" else torch.float32
print(f"[relight] loading {MODEL} on {DEVICE} ...", flush=True)
pipe = StableDiffusionImg2ImgPipeline.from_pretrained(MODEL, torch_dtype=DTYPE, safety_checker=None)
pipe = pipe.to(DEVICE)
pipe.set_progress_bar_config(disable=True)
LOCK = threading.Lock()
print("[relight] model ready", flush=True)

PROMPT = "cozy sunlit studio apartment interior, real photograph, soft natural window light, realistic materials, grounded soft shadows, warm tones, high detail, interior magazine photo"
NEG = "cartoon, illustration, distorted, extra furniture, duplicated, text, watermark, blurry, deformed"


def relight(img, strength=0.28, prompt=PROMPT):
    w, h = img.size
    scale = 640.0 / max(w, h)                      # SD1.5 안정 영역으로 리사이즈
    nw, nh = (max(8, round(w * scale) // 8 * 8), max(8, round(h * scale) // 8 * 8))
    im = img.convert("RGB").resize((nw, nh))
    with LOCK:                                      # 단일 파이프라인 직렬화
        out = pipe(prompt=prompt, negative_prompt=NEG, image=im,
                   strength=float(strength), guidance_scale=6.0, num_inference_steps=24).images[0]
    return out.resize((w, h))


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
        if self.path != "/relight":
            return self._send({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n))
            raw = data["image"].split(",", 1)[-1]
            img = Image.open(io.BytesIO(base64.b64decode(raw)))
            out = relight(img, float(data.get("strength", 0.28)), data.get("prompt") or PROMPT)
            buf = io.BytesIO(); out.save(buf, "PNG")
            self._send({"status": "OK", "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()})
        except Exception as e:  # noqa: BLE001
            self._send({"status": "ERROR", "reason": str(e)[:200]}, 500)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8600"))
    print(f"[relight] serving on 0.0.0.0:{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
