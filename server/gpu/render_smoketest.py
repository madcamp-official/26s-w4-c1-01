#!/usr/bin/env python3
# (레포 보관용 스모크 하니스 — 고정 5가구 씬을 /render로 던져 PNG 저장. 렌더 회귀 눈검수용.)
"""렌더 품질 반복용 하니스 — 고정 테스트 씬을 /render에 던지고 PNG로 저장.
usage: python3 render_test.py [out.png] [preset]
"""
import sys, json, base64, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else "baseline.png"
PRESET = sys.argv[2] if len(sys.argv) > 2 else ""

# 고정 원룸 세트 (3.6 x 5.0 x 2.6) — 침대/협탁/책상/커피테이블/소파
scene = {
    "room": {"w": 3.6, "d": 5.0, "h": 2.6},
    "items": [
        {"glb": "/glb/B075QDV397.glb", "x": 1.15, "y": 3.85, "rot": 0},    # king bed, 헤드보드 far벽
        {"glb": "/glb/B07HSM6C1J.glb", "x": 0.25, "y": 2.55, "rot": 0},    # 협탁
        {"glb": "/glb/B075Z8KXG7.glb", "x": 3.25, "y": 1.2, "rot": 90},    # 책상 우측벽
        {"glb": "/glb/B07GDSF3MR.glb", "x": 1.6, "y": 1.4, "rot": 0},      # 커피테이블
        {"glb": "/glb/B07B4N1RTQ.glb", "x": 1.6, "y": 0.5, "rot": 0},      # 소파 near벽
    ],
    "samples": 128, "rx": 1280, "ry": 720,
}
# 방 전체가 보이는 코너 시점 (near-left corner 컷어웨이)
scene["camera"] = {"pos": [-1.4, -1.7, 2.15], "target": [1.8, 2.6, 0.4], "lens": 24}
scene["rug"] = {"x": 1.6, "y": 1.4, "w": 1.7, "d": 1.3}
if PRESET:
    scene["preset"] = PRESET

req = urllib.request.Request("http://localhost:8610/render",
                             data=json.dumps(scene).encode(),
                             headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=300))
if r.get("status") != "OK":
    print("FAIL:", r.get("reason")); sys.exit(1)
b64 = r["image"].split(",", 1)[1]
open(OUT, "wb").write(base64.b64decode(b64))
print("OK ->", OUT)
