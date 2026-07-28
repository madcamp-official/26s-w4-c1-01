#!/usr/bin/env python3
"""camp-3 포토리얼 렌더 서비스 — 앱의 3D 배치 → Blender Cycles 사진.
POST /render {room:{w,d,h}, items:[{glb,x,y,rot}], camera?, samples?} -> {status:'OK', image: dataURL}
GET /health
stdlib only(토치 불필요). blender를 요청마다 headless로 실행(직렬화). glb는 /root/glb/<name>로 매핑.
"""
import os, io, json, base64, subprocess, tempfile, threading, math
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BLENDER = os.getenv("BLENDER", "/root/blender-4.2.3-linux-x64/blender")
SCRIPT = os.getenv("RENDER_SCRIPT", "/root/blender_render.py")
HDRI = os.getenv("HDRI", "/root/hdri.hdr")
GLBDIR = os.getenv("GLBDIR", "/root/glb")
LOCK = threading.Lock()


def auto_camera(view, W, D, H):
    """자동 다각도 카메라(Blender 좌표, near-left 코너 밖에서 방 안을 봄).
    wide = 방 전체가 보이는 높은 광각 코너샷 / cozy = 눈높이에 가깝고 살짝 좁은 아늑한 3-4분면."""
    cx, cy = W * 0.5, D * 0.5
    if view == "cozy":
        cam = {"pos": [-W * 0.28, -D * 0.30, H * 0.46], "target": [cx * 1.08, cy * 1.02, 0.45], "lens": 30}
    else:  # wide (기본) — 초기 위치는 대략, 최종 프레이밍은 blender의 camera_fit_coords가 방 코너에 맞춤
        b = 0.85 + 0.42 * max(W, D)
        cam = {"pos": [-b * 0.80, -b * 0.80, min(1.65 + 0.42 * H, H * 1.0)],
               "target": [cx, cy * 0.93, 0.4], "lens": 21, "fit": True}
    return cam, ["near", "left", "ceil"]


def build_scene(p):
    room = p.get("room", {})
    W = float(room.get("w", 3.6)); D = float(room.get("d", 5.0)); H = float(room.get("h", 2.6))
    items = []
    for it in p.get("items", []):
        name = os.path.basename(str(it.get("glb", "")))          # "/glb/X.glb" → "X.glb"
        path = os.path.join(GLBDIR, name)
        if not name.endswith(".glb") or not os.path.exists(path):
            continue
        # 깊이축 뒤집기(blender_y = D - cy): three.js→Blender 손대칭 방지(렌더가 3D의 거울상이 되지 않게).
        items.append({"glb": path, "x": float(it.get("x", W / 2)),
                      "y": D - float(it.get("y", D / 2)), "rot": int(it.get("rot", 0)),
                      "elev": float(it.get("elev", 0))})
    # 카메라 결정 우선순위:
    #  1) view("wide"/"cozy") 지정 → 자동 다각도(카메라 무시)  2) 사용자 3D 시점(camera)  3) 기본 = wide 자동
    view = p.get("view")
    cam = p.get("camera")
    if cam and not view:
        # 사용자의 3D 시점 그대로. 카메라 쪽 두 벽을 생략(그 벽이 방을 가리므로).
        cxc, cyc = float(cam["pos"][0]), float(cam["pos"][1])
        hide = p.get("hide") or [
            "far" if cyc > D / 2 else "near",
            "right" if cxc > W / 2 else "left",
            "ceil",   # 3D 뷰는 오픈탑 → 위에서 내려다볼 때 천장이 안 가리게
        ]
    else:
        cam, ahide = auto_camera(view or "wide", W, D, H)
        hide = p.get("hide") or ahide
    # 2D 평면의 문/창(top/bottom/left/right) → 렌더 벽(far/near/left/right).
    # 아이템과 동일한 깊이축 뒤집기: top(y0)→far(yD), bottom(yD)→near(y0). left/right는 벽 따라 위치(y)를 D-pos로.
    WALLMAP = {"top": "far", "bottom": "near", "left": "left", "right": "right"}
    openings = []
    for o in p.get("openings", []):
        rw = WALLMAP.get(o.get("wall"))
        if not rw:
            continue
        if o.get("wall") in ("top", "bottom"):
            pos = float(o.get("pos", W / 2))               # x축(뒤집지 않음)
        else:
            pos = D - float(o.get("pos", D / 2))           # 깊이축 뒤집기
        width = float(o.get("width", 0.9))
        if o.get("kind") == "door":
            openings.append({"kind": "door", "wall": rw, "pos": pos, "width": width})
        else:
            openings.append({"kind": "window", "wall": rw, "pos": pos, "width": width, "h": 1.0, "z": 1.7})
    cutouts = []
    for c in p.get("cutouts", []):
        cw = float(c.get("w", 0)); cd = float(c.get("d", 0))
        if cw <= 0 or cd <= 0:
            continue
        ccx = float(c.get("x", 0)) + cw / 2
        ccy = float(c.get("y", 0)) + cd / 2
        cutouts.append({"x": ccx, "y": D - ccy, "w": cw, "d": cd})   # 아이템과 동일한 깊이축 뒤집기
    out = {"room": {"w": W, "d": D, "h": H}, "hdri": HDRI, "cutouts": cutouts,
           "preset": p.get("preset", "day"),           # 시간대 조명 프리셋(blender가 노출·창색·태양광 결정)
           "samples": int(p.get("samples", 96)), "rx": int(p.get("rx", 1600)), "ry": int(p.get("ry", 900)),
           "openings": openings, "camera": cam, "hide": hide, "items": items}
    # 앱/하니스가 명시 오버라이드하면 통과(프리셋 기본값을 덮어씀).
    for k in ("hdri_strength", "exposure", "rug"):
        if k in p:
            out[k] = p[k]
    return out


def render(payload):
    scene = build_scene(payload)
    if not scene["items"]:
        raise ValueError("no renderable items (glb 없음)")
    with tempfile.TemporaryDirectory() as td:
        sp, op = os.path.join(td, "scene.json"), os.path.join(td, "out.png")
        json.dump(scene, open(sp, "w"))
        with LOCK:
            r = subprocess.run([BLENDER, "--background", "--python", SCRIPT, "--", sp, op],
                               capture_output=True, timeout=300)
        if not os.path.exists(op):
            raise RuntimeError((r.stderr or r.stdout).decode(errors="ignore")[-300:])
        data = open(op, "rb").read()
    return "data:image/png;base64," + base64.b64encode(data).decode()


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
            return self._send({"status": "ok", "blender": os.path.exists(BLENDER), "glbdir": os.path.isdir(GLBDIR)})
        self._send({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/render":
            return self._send({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(n))
            return self._send({"status": "OK", "image": render(payload)})
        except Exception as e:  # noqa: BLE001
            return self._send({"status": "ERROR", "reason": str(e)[:300]}, 500)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8610"))
    print(f"[render] serving on 0.0.0.0:{port}  blender={os.path.exists(BLENDER)}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
