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


def living_bbox(W, D, cutouts):
    """부속실(욕실·주방·현관)을 뺀 '실제 방'의 경계상자. 카메라는 건물 외곽이 아니라 이걸 기준으로 잡는다 —
    도면형 원룸은 오른쪽 절반이 통째로 욕실+현관인 경우가 있어, 외곽 기준이면 방이 구석에 조그맣게 찍힌다."""
    boxes = [(c["x"] - c["w"] / 2, c["x"] + c["w"] / 2, c["y"] - c["d"] / 2, c["y"] + c["d"] / 2)
             for c in (cutouts or [])]
    if not boxes:
        return 0.0, W, 0.0, D
    xs = sorted({0.0, W} | {v for b in boxes for v in b[:2] if 0.0 < v < W})
    x0 = y0 = float("inf"); x1 = y1 = float("-inf")
    for i in range(len(xs) - 1):
        ax, bx = xs[i], xs[i + 1]
        if bx - ax < 1e-4:
            continue
        xm = (ax + bx) / 2
        y = 0.0
        for (a, b1) in sorted((b[2], b[3]) for b in boxes if b[0] <= xm <= b[1]):
            if a > y + 1e-4:
                x0, x1, y0, y1 = min(x0, ax), max(x1, bx), min(y0, y), max(y1, a)
            y = max(y, b1)
        if y < D - 1e-4:
            x0, x1, y0, y1 = min(x0, ax), max(x1, bx), min(y0, y), max(y1, D)
    return (0.0, W, 0.0, D) if x1 <= x0 or y1 <= y0 else (x0, x1, y0, y1)


def _hits(px, py, qx, qy, r):
    """선분 (px,py)-(qx,qy)가 축정렬 사각형 r=(x0,x1,y0,y1)을 지나는가 — slab test."""
    a, b, c, d = r
    dx, dy = qx - px, qy - py
    t0, t1 = 0.0, 1.0
    for p, q, lo, hi in ((dx, px, a, b), (dy, py, c, d)):
        if abs(p) < 1e-9:
            if q < lo or q > hi:
                return False
            continue
        s0, s1 = (lo - q) / p, (hi - q) / p
        if s0 > s1:
            s0, s1 = s1, s0
        t0, t1 = max(t0, s0), min(t1, s1)
        if t0 > t1:
            return False
    return t1 - t0 > 1e-6      # 스치듯 접하는 건 가림으로 치지 않는다


def auto_camera(view, W, D, H, cutouts=None):
    """자동 다각도 카메라(Blender 좌표) — '컷아웃(부속실 벽체)이 가장 적은 코너' 밖에서 방 안을 봄.
    고정 near-left 코너를 쓰면 그 코너에 욕실·주방 벽체가 있을 때 화면이 벽으로 가득 찬다.
    wide = 방 전체가 보이는 높은 광각 코너샷 / cozy = 눈높이에 가깝고 살짝 좁은 아늑한 3-4분면."""
    x0, x1, y0, y1 = living_bbox(W, D, cutouts)
    LW, LD = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    corners = {("near", "left"): (x0, y0), ("near", "right"): (x1, y0),
               ("far", "left"): (x0, y1), ("far", "right"): (x1, y1)}
    rects = [(c["x"] - c["w"] / 2, c["x"] + c["w"] / 2, c["y"] - c["d"] / 2, c["y"] + c["d"] / 2)
             for c in (cutouts or [])]

    def visible(px, py):
        """그 지점에서 실제로 보이는 바닥 비율 — 부속실 벽체(전고)는 시선을 막는다.
        '가까운 컷아웃 면적'만 세던 예전 방식은 방을 가로지르는 칸막이를 못 봤다.
        판정은 코너가 아니라 '실제 카메라 위치'(뒤로 뺀 자리)에서 한다 — 뒤로 물러나면
        각도가 눕고 칸막이가 더 많이 겹친다(1호: 코너 100% → 실제 위치 42%)."""
        step, seen, tot = 0.25, 0, 0
        gy = y0 + step / 2
        while gy < y1:
            gx = x0 + step / 2
            while gx < x1:
                if not any(a <= gx <= b and c <= gy <= d for (a, b, c, d) in rects):
                    tot += 1
                    if not any(_hits(px, py, gx, gy, r) for r in rects):
                        seen += 1
                gx += step
            gy += step
        return seen / tot if tot else 0.0

    back = 0.85 + 0.42 * max(LW, LD)      # wide 카메라가 코너에서 물러나는 거리(아래와 동일 식)

    def campos(k):
        kx, ky = corners[k]
        return (kx - (back * 0.8 if k[1] == "left" else -back * 0.8),
                ky - (back * 0.8 if k[0] == "near" else -back * 0.8))

    yside, xside = max(corners, key=lambda k: visible(*campos(k)))
    if view == "wide2":   # '반대편' = 최적 코너의 대각 — 카메라 쪽 부속실 면은 blender가 컷어웨이한다
        yside = "near" if yside == "far" else "far"
        xside = "left" if xside == "right" else "right"
    kx, ky = corners[(yside, xside)]
    mx = 1.0 if xside == "left" else -1.0     # 코너 → 방 안쪽 단위방향
    my = 1.0 if yside == "near" else -1.0
    if view == "cozy":
        cam = {"pos": [kx - mx * LW * 0.28, ky - my * LD * 0.30, H * 0.46],
               "target": [cx + mx * 0.04 * LW, cy + my * 0.01 * LD, 0.45], "lens": 30}
    else:  # wide (기본) — 초기 위치는 대략, 최종 프레이밍은 blender의 camera_fit_coords가 방 코너에 맞춤
        b = 0.85 + 0.42 * max(LW, LD)
        cam = {"pos": [kx - mx * b * 0.80, ky - my * b * 0.80, min(1.65 + 0.42 * H, H * 1.0)],
               "target": [cx, cy - my * 0.07 * cy, 0.4], "lens": 21, "fit": True}
    return cam, [yside, xside, "ceil"]


def _clearance(gx, gy, W, D, rects):
    """점에서 가장 가까운 장애물(외벽 또는 부속실 벽체)까지 거리. 안에 있으면 0."""
    d = min(gx, W - gx, gy, D - gy)
    for (a, b, c, e) in rects:
        if a <= gx <= b and c <= gy <= e:
            return 0.0
        dx = max(a - gx, 0.0, gx - b)
        dy = max(c - gy, 0.0, gy - e)
        d = min(d, math.hypot(dx, dy))
    return d


def pano_spot(W, D, cutouts, items):
    """파노라마에서 '서 있을 자리' — 벽·부속실에서 충분히 떨어지고 가구와도 겹치지 않는 점.
    빈 공간의 한가운데를 그냥 쓰면 침대 한복판에 서서 매트리스만 보이고,
    가구에서 멀기만 따지면 벽에 코를 박은 구석이 뽑힌다. 둘 다 본다."""
    x0, x1, y0, y1 = living_bbox(W, D, cutouts)
    rects = [(c["x"] - c["w"] / 2, c["x"] + c["w"] / 2, c["y"] - c["d"] / 2, c["y"] + c["d"] / 2)
             for c in (cutouts or [])]
    pts = [(it["x"], it["y"]) for it in (items or [])]
    best, bestscore = ((x0 + x1) / 2, (y0 + y1) / 2), -1.0
    step = 0.15
    gy = y0 + step
    while gy < y1:
        gx = x0 + step
        while gx < x1:
            clear = _clearance(gx, gy, W, D, rects)
            if clear >= 0.35:                       # 벽에 붙어 서지 않는다
                far_item = min((math.hypot(gx - px, gy - py) for px, py in pts), default=1.5)
                score = min(clear, 1.3) + 0.6 * min(far_item, 1.5)
                if score > bestscore:
                    best, bestscore = (gx, gy), score
            gx += step
        gy += step
    return best, ((x0 + x1) / 2, (y0 + y1) / 2)


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
                      "elev": float(it.get("elev", 0)),
                      # 선언 치수(m) — 있으면 blender가 GLB를 이 크기로 늘린다(3D 뷰와 동일 규칙)
                      **({"dims": [float(it["w"]), float(it["d"]), float(it["h"])]}
                         if all(it.get(k) for k in ("w", "d", "h")) else {}),
                      # 조명 가구 마커 — blender가 전구 위치에 실제 광원을 심는다
                      **({"lamp": True, "h": float(it.get("h", 1.5))} if it.get("lamp") else {})})
    # 컷아웃(부속실 벽체)을 카메라 결정 '전에' 계산 — 자동 카메라가 가림이 적은 코너를 고르는 근거.
    cutouts = []
    for c in p.get("cutouts", []):
        cw = float(c.get("w", 0)); cd = float(c.get("d", 0))
        if cw <= 0 or cd <= 0:
            continue
        ccx = float(c.get("x", 0)) + cw / 2
        ccy = float(c.get("y", 0)) + cd / 2
        cutouts.append({"x": ccx, "y": D - ccy, "w": cw, "d": cd})   # 아이템과 동일한 깊이축 뒤집기
    # 카메라 결정 우선순위:
    #  1) view("wide"/"cozy") 지정 → 자동 다각도(카메라 무시)  2) 사용자 3D 시점(camera)  3) 기본 = wide 자동
    view = p.get("view")
    cam = p.get("camera")
    if p.get("pano"):
        # 360° 둘러보기: 방 안 눈높이에 서서 사방을 한 장에 담는다. 벽은 blender가 전부 세운다.
        (sx, sy), (cxr, cyr) = pano_spot(W, D, cutouts, items)
        # 첫 화면이 향할 곳 = 가구가 모여 있는 쪽. 방의 기하중심을 보면 좁은 방일수록
        # 맨 벽만 잡힌다(가구는 대개 벽에 붙어 있으니 중심에는 아무것도 없다).
        if items:
            tx = sum(i["x"] for i in items) / len(items)
            ty = sum(i["y"] for i in items) / len(items)
            if math.hypot(tx - sx, ty - sy) < 0.8:      # 내가 선 자리와 겹치면 가장 먼 가구를 본다
                far = max(items, key=lambda i: math.hypot(i["x"] - sx, i["y"] - sy))
                tx, ty = far["x"], far["y"]
        else:
            tx, ty = cxr, cyr
        if math.hypot(tx - sx, ty - sy) < 0.5:
            tx, ty = (sx + (1.0 if sx < W / 2 else -1.0), sy)
        cam = {"pos": [sx, sy, min(1.55, H - 0.35)], "target": [tx, ty, 1.0]}
        hide = []
    elif cam and not view:
        # 사용자의 3D 시점 그대로. 카메라 쪽 두 벽을 생략(그 벽이 방을 가리므로).
        cxc, cyc = float(cam["pos"][0]), float(cam["pos"][1])
        hide = p.get("hide") or [
            "far" if cyc > D / 2 else "near",
            "right" if cxc > W / 2 else "left",
            "ceil",   # 3D 뷰는 오픈탑 → 위에서 내려다볼 때 천장이 안 가리게
        ]
    else:
        cam, ahide = auto_camera(view or "wide", W, D, H, cutouts)
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
    out = {"room": {"w": W, "d": D, "h": H}, "hdri": HDRI, "cutouts": cutouts,
           "preset": p.get("preset", "day"),           # 시간대 조명 프리셋(blender가 노출·창색·태양광 결정)
           # 파노라마는 화소가 커 시간이 길어진다 — 샘플을 32로(48과 PSNR 53dB, 육안 동일)
           # 낮춰 클라우드플레어 100초 제한 안에 여유를 둔다.
           "samples": int(p.get("samples", 32 if p.get("pano") else 96)),
           "rx": int(p.get("rx", 3072 if p.get("pano") else 1400)),
           "ry": int(p.get("ry", 1536 if p.get("pano") else 1050)),
           "openings": openings, "camera": cam, "hide": hide, "items": items}
    # 앱/하니스가 명시 오버라이드하면 통과(프리셋 기본값을 덮어씀).
    if p.get("pano"):
        out["pano"] = True
    for k in ("hdri_strength", "exposure", "rug", "lampOn", "lampColor", "panoExp"):
        if k in p:
            out[k] = p[k]
    return out


def render(payload):
    scene = build_scene(payload)
    if not scene["items"]:
        raise ValueError("no renderable items (glb 없음)")
    with tempfile.TemporaryDirectory() as td:
        # 파노라마는 JPEG(고해상도라 PNG면 4MB+) · 나머지는 무손실 PNG
        _jpg = bool(scene.get("pano"))
        sp = os.path.join(td, "scene.json")
        op = os.path.join(td, "out.jpg" if _jpg else "out.png")
        json.dump(scene, open(sp, "w"))
        with LOCK:
            r = subprocess.run([BLENDER, "--background", "--python", SCRIPT, "--", sp, op],
                               capture_output=True, timeout=300)
        if not os.path.exists(op):
            raise RuntimeError((r.stderr or r.stdout).decode(errors="ignore")[-300:])
        data = open(op, "rb").read()
    return ("data:image/jpeg;base64," if _jpg else "data:image/png;base64,") + base64.b64encode(data).decode()


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
