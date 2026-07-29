#!/usr/bin/env python3
"""방꾸요정 포토리얼 렌더 — Blender 4.2 Cycles(CPU).
scene.json(방 치수 + 배치 아이템 + 카메라 + preset) → 포토리얼 인테리어 PNG.
usage: blender --background --python blender_render.py -- scene.json out.png
좌표: x∈[0,W], y∈[0,D](깊이), z=up. 아이템 x,y=바닥 중심, rot=Z축 도(°).
"""
import bpy, sys, json, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
scene_path, out_path = argv[0], argv[1]
S = json.load(open(scene_path))
R = S["room"]; W, D, H = R["w"], R["d"], R["h"]

# ---------- 시간대 프리셋 (조명·노출·창 색온도·보조광) ----------
# sky = (위 하늘색, 아래 수평선색) 수직 그라데이션, win_s = 창 발광세기, sun = 태양광(색,세기,고도deg,방위deg) 없으면 None,
# lamp = 실내등 세기(밤에만), hdri = 환경광 세기, exp = 노출.  (win = 폴백 단색)
PRESETS = {
    "morning": dict(exp=0.38, hdri=0.30, win=(1.0, 0.88, 0.66), win_s=17, bg=(1.0, 0.96, 0.90),
                    sky=((0.66, 0.78, 1.0), (1.0, 0.84, 0.62)),   # 위 하늘 아래 일출 웜글로우
                    sun=((1.0, 0.80, 0.50), 4.2, 12, 65), lamp=0.0),  # 낮고 따뜻한 골든 저각광(뚜렷하게)
    "day":     dict(exp=0.40, hdri=0.86, win=(0.90, 0.95, 1.0), win_s=11, bg=(1.0, 1.0, 1.0),
                    sky=((0.48, 0.68, 1.0), (0.95, 0.97, 1.0)),
                    sun=((1.0, 0.98, 0.96), 3.3, 62, 30), lamp=0.0),  # 높고 희고 청량한 정오
    "sunset":  dict(exp=0.46, hdri=0.18, win=(1.0, 0.46, 0.18), win_s=7, bg=(1.0, 0.82, 0.66),
                    sky=((0.85, 0.42, 0.36), (1.0, 0.74, 0.34)),
                    sun=((1.0, 0.46, 0.18), 5.2, 5, 80), lamp=0.5),   # 진한 주황 무드(웜 배경)
    "night":   dict(exp=0.30, hdri=0.05, win=(0.16, 0.22, 0.42), win_s=2.5, bg=(0.02, 0.03, 0.06),
                    sky=((0.04, 0.07, 0.20), (0.14, 0.19, 0.40)),
                    sun=None, lamp=1.0),
}
PRE = PRESETS.get(S.get("preset", "day"), PRESETS["day"])

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ---------- 렌더 설정 ----------
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = S.get("samples", 96)
sc.cycles.use_denoising = True
try:
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
sc.render.resolution_x = S.get("rx", 1280)
sc.render.resolution_y = S.get("ry", 720)
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'AgX'
_exp = PRE["exp"]
if S.get("preset", "day") == "night" and S.get("lampOn") is not False and any(i.get("lamp") for i in S.get("items", [])):
    _exp -= 0.22   # 조명만 켠 밤 — 어둠 유지(빛 웅덩이 대비 강화)
sc.view_settings.exposure = S.get("exposure", _exp)
sc.render.film_transparent = False

# ---------- 월드 HDRI ----------
world = bpy.data.worlds.new("W"); sc.world = world
world.use_nodes = True
nt = world.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
# 조명은 HDRI로, 카메라에 보이는 배경은 깨끗한 화이트(컷어웨이 열린 면이 지저분하지 않게).
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(S["hdri"])
bg_hdri = nt.nodes.new("ShaderNodeBackground")
bg_hdri.inputs["Strength"].default_value = S.get("hdri_strength", PRE["hdri"] * (0.95 if any(o.get("kind") == "window" for o in S.get("openings", [])) else 1.0))   # 천장·창벽이 빛을 막게 된 뒤 실내 바운스 보충
nt.links.new(env.outputs["Color"], bg_hdri.inputs["Color"])
bg_white = nt.nodes.new("ShaderNodeBackground")
# 카메라 배경은 프리셋 무드 색(bg) — 아침 웜화이트/낮 화이트/노을 주황빛/밤 어두운 남색.
_bg = PRE.get("bg") or ((1, 1, 1) if PRE["lamp"] < 0.5 else (0.02, 0.03, 0.06))
bg_white.inputs["Color"].default_value = (*_bg, 1)
bg_white.inputs["Strength"].default_value = 1.0
lp = nt.nodes.new("ShaderNodeLightPath")
mix = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])   # 카메라 광선이면 화이트
nt.links.new(bg_hdri.outputs["Background"], mix.inputs[1])     # 그 외(조명/반사)는 HDRI
nt.links.new(bg_white.outputs["Background"], mix.inputs[2])
wout = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(mix.outputs["Shader"], wout.inputs["Surface"])


def mat(name, color, rough=0.85, metal=0.0, glow=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if glow:                                    # 극미광 — 광원 각도가 다 빗나간 면이 '완전 검정'으로 무너지는 것 방지
        b.inputs["Emission Color"].default_value = (*color, 1)
        b.inputs["Emission Strength"].default_value = glow
    return m


def emission(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt2 = m.node_tree
    for n in list(nt2.nodes): nt2.nodes.remove(n)
    e = nt2.nodes.new("ShaderNodeEmission")
    o = nt2.nodes.new("ShaderNodeOutputMaterial")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    nt2.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return m


def window_sky_mat(top, bot, strength):
    """창밖 하늘 — 수직 그라데이션(위 하늘색→아래 수평선). 창 평면은 회전이 베이크돼 Generated.Z가 곧 세로축."""
    m = bpy.data.materials.new("window"); m.use_nodes = True
    nt2 = m.node_tree
    for n in list(nt2.nodes): nt2.nodes.remove(n)
    o = nt2.nodes.new("ShaderNodeOutputMaterial")
    e = nt2.nodes.new("ShaderNodeEmission")
    e.inputs["Strength"].default_value = strength
    tc = nt2.nodes.new("ShaderNodeTexCoord")
    sep = nt2.nodes.new("ShaderNodeSeparateXYZ")
    nt2.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    ramp = nt2.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*bot, 1)   # 아래 = 수평선(밝고 웜)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (*top, 1)   # 위 = 하늘
    nt2.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt2.links.new(ramp.outputs["Color"], e.inputs["Color"])
    nt2.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return m


def wood_floor_mat(long_axis='y'):
    """프로시저 원목 마루 — 판자 타일(brick) + 나뭇결(wave) + 결 범프. 바닥 가짜티 제거의 핵심."""
    m = bpy.data.materials.new("wood_floor"); m.use_nodes = True
    nt2 = m.node_tree
    for n in list(nt2.nodes): nt2.nodes.remove(n)
    out = nt2.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt2.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.38
    nt2.links.new(bsdf.outputs[0], out.inputs["Surface"])
    tc = nt2.nodes.new("ShaderNodeTexCoord")
    mp = nt2.nodes.new("ShaderNodeMapping")
    # 판자: 길이축으로 길게, 폭 ~0.16m. long_axis에 따라 스케일 방향 스왑.
    mp.inputs["Scale"].default_value = (0.9, 6.0, 1.0) if long_axis == 'x' else (6.0, 0.9, 1.0)
    nt2.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    # 판자 타일 + 판자별 톤 변주 + 어두운 그루브
    brick = nt2.nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.5; brick.offset_frequency = 2
    brick.squash = 1.0; brick.squash_frequency = 1
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Mortar Size"].default_value = 0.004
    brick.inputs["Mortar Smooth"].default_value = 0.1
    brick.inputs["Bias"].default_value = 0.0
    brick.inputs["Brick Width"].default_value = 2.0
    brick.inputs["Row Height"].default_value = 0.28
    brick.inputs["Color1"].default_value = (0.44, 0.28, 0.15, 1)
    brick.inputs["Color2"].default_value = (0.33, 0.20, 0.10, 1)
    brick.inputs["Mortar"].default_value = (0.06, 0.035, 0.02, 1)
    nt2.links.new(mp.outputs["Vector"], brick.inputs["Vector"])
    # 나뭇결 streak (wave + 왜곡)
    wave = nt2.nodes.new("ShaderNodeTexWave")
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X' if long_axis == 'x' else 'Y'
    wave.inputs["Scale"].default_value = 1.4
    wave.inputs["Distortion"].default_value = 13.0
    wave.inputs["Detail"].default_value = 3.0
    wave.inputs["Detail Scale"].default_value = 1.2
    nt2.links.new(mp.outputs["Vector"], wave.inputs["Vector"])
    grain = nt2.nodes.new("ShaderNodeMixRGB"); grain.blend_type = 'MULTIPLY'
    grain.inputs["Fac"].default_value = 0.35
    nt2.links.new(brick.outputs["Color"], grain.inputs[1])
    # wave→밝은 결 하이라이트: ColorRamp로 대비
    ramp = nt2.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.30
    ramp.color_ramp.elements[0].color = (0.55, 0.42, 0.28, 1)
    ramp.color_ramp.elements[1].position = 0.95
    ramp.color_ramp.elements[1].color = (1.0, 0.92, 0.8, 1)
    nt2.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt2.links.new(ramp.outputs["Color"], grain.inputs[2])
    nt2.links.new(grain.outputs["Color"], bsdf.inputs["Base Color"])
    # 결 범프(약)
    bump = nt2.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = 0.004
    nt2.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt2.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def plane(name, sx, sy, loc, rot=(0, 0, 0), m=None):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (sx, sy, 1)
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    if m: o.data.materials.append(m)
    return o


def box(name, sx, sy, sz, loc, m=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    if m: o.data.materials.append(m)
    return o


FLOOR = wood_floor_mat('y' if D >= W else 'x')
WALL = mat("wall", (0.90, 0.88, 0.83), rough=0.95, glow=0.05 if PRE.get("sun") else 0.004)
CEIL = mat("ceil", (0.96, 0.95, 0.93), rough=1.0)
TRIM = mat("trim", (0.94, 0.93, 0.90), rough=0.6)  # 걸레받이/창틀 페인트
FRAME = mat("frame", (0.20, 0.16, 0.12), rough=0.5)  # 창틀 목재
DOORMAT = mat("door", (0.46, 0.31, 0.19), rough=0.55)  # 문짝 목재
HANDLE = mat("handle", (0.62, 0.60, 0.55), rough=0.35, metal=0.9)  # 문 손잡이

# hide: 카메라 쪽 벽/천장 컷어웨이. 예전엔 아예 안 만들어서 태양·HDRI가 그 뚫린 면으로
# 쏟아졌다(햇빛이 엉뚱한 방향에서 들어오는 원인). 이제 전부 '얇은 박스'로 세우되 숨김 면은
# visible_camera=False — 카메라엔 안 보여도 빛은 막는다 → 빛은 오직 창 구멍으로만 들어온다.
hide = set(S.get("hide", []))

# ---------- 바닥 = '실제 방'만 ----------
# 욕실·주방·현관·보일러실(컷아웃)은 우리가 꾸미는 공간이 아니다 → 바닥에서 아예 파낸다.
# 예전엔 방 전체 사각형에 바닥을 깔아, 컷어웨이된 부속실 안쪽 바닥이 어두운 판으로 드러났다.
_CUTS = [c for c in S.get("cutouts", []) if c.get("w", 0) > 0 and c.get("d", 0) > 0]
_CBOX = [(c["x"] - c["w"] / 2, c["x"] + c["w"] / 2, c["y"] - c["d"] / 2, c["y"] + c["d"] / 2) for c in _CUTS]
_EPSB = 0.03   # 방 경계에 '닿았다'로 볼 여유(3cm)


def _rect_minus(w, d, boxes):
    """w×d 사각형 − 축정렬 boxes = 남은 사각형 목록 [(x0,x1,y0,y1)]. x 슬랩으로 자르고 슬랩마다 y구간을 뺀다."""
    xs = sorted({0.0, w} | {v for b in boxes for v in b[:2] if 0.0 < v < w})
    out = []
    for i in range(len(xs) - 1):
        x0, x1 = xs[i], xs[i + 1]
        if x1 - x0 < 1e-4:
            continue
        xm = (x0 + x1) / 2
        y = 0.0
        for (a, b1) in sorted((b[2], b[3]) for b in boxes if b[0] <= xm <= b[1]):
            if a > y + 1e-4:
                out.append((x0, x1, y, a))
            y = max(y, b1)
        if y < d - 1e-4:
            out.append((x0, x1, y, d))
    return out


def _slab(name, rects, z, m, origin):
    """여러 사각형을 '한 오브젝트'로 — Object 텍스처좌표가 이어져야 마루 판자가 조각마다 끊기지 않는다."""
    ox, oy = origin
    verts, faces = [], []
    for (x0, x1, y0, y1) in rects:
        i = len(verts)
        verts += [(x0 - ox, y0 - oy, 0), (x1 - ox, y0 - oy, 0), (x1 - ox, y1 - oy, 0), (x0 - ox, y1 - oy, 0)]
        faces.append((i, i + 1, i + 2, i + 3))
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    ob = bpy.data.objects.new(name, me); ob.location = (ox, oy, z)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(m)
    return ob


def _spans(lo, hi, blocked):
    """[lo,hi]를 blocked(컷아웃이 물고 있는 구간)로 쪼개 [(a,b,가려짐)]로 — 벽/걸레받이를 구간별로 다루려고."""
    merged = []
    for (a, b) in sorted(blocked):
        a, b = max(lo, a), min(hi, b)
        if b <= a:
            continue
        if merged and a <= merged[-1][1] + 1e-3:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    out, p = [], lo
    for (a, b) in merged:
        if a > p + 1e-3:
            out.append((p, a, False))
        out.append((max(p, a), b, True)); p = b
    if p < hi - 1e-3:
        out.append((p, hi, False))
    return out or [(lo, hi, False)]


# 각 외벽이 부속실에 '먹힌' 구간 — 그 구간의 벽은 방에서 보이지 않는다(부속실 너머라서).
_BLOCK = {
    "far":   [(b[0], b[1]) for b in _CBOX if b[3] >= D - _EPSB],
    "near":  [(b[0], b[1]) for b in _CBOX if b[2] <= _EPSB],
    "left":  [(b[2], b[3]) for b in _CBOX if b[0] <= _EPSB],
    "right": [(b[2], b[3]) for b in _CBOX if b[1] >= W - _EPSB],
}

# 컷아웃이 방을 통째로 덮는 이상 입력이면 파내지 않는다(빈 바닥 렌더 방지).
_FLOOR_RECTS = (_rect_minus(W, D, _CBOX) if _CBOX else None) or [(0.0, W, 0.0, D)]
_slab("floor", _FLOOR_RECTS, 0.0, FLOOR, (W / 2, D / 2))
# '실제 방'의 경계상자 — 카메라 프레이밍의 기준(건물 외곽이 아니라 우리가 꾸미는 공간).
LX0 = min(r[0] for r in _FLOOR_RECTS); LX1 = max(r[1] for r in _FLOOR_RECTS)
LY0 = min(r[2] for r in _FLOOR_RECTS); LY1 = max(r[3] for r in _FLOOR_RECTS)
LCX, LCY = (LX0 + LX1) / 2, (LY0 + LY1) / 2   # 보조광도 방 중심에 — 건물 중심은 욕실 안일 수 있다
# 광차단 규칙: ① 천장 항상 존재(숨김이면 카메라만 통과) ② 창 달린 벽 항상 존재(〃) — 태양이
# '창 구멍으로만' 들어온다. ③ 창 없는 숨김 벽은 생략(부드러운 앰비언트·가장자리 미관).
# 구멍은 불리언이 아니라 '창 주위 4분할 세그먼트'로 뚫는다(불리언은 무재질 검은 면을 남겼다).
_wins_by_wall = {}
for _o in S.get("openings", []):
    if _o.get("kind") == "window":
        _wins_by_wall.setdefault(_o.get("wall"), []).append(
            (float(_o.get("pos", 0)), float(_o.get("width", 1.2)), float(_o.get("z", 1.7)), float(_o.get("h", 1.0))))


def _wall_rects(L, wins):
    """벽(길이 L×높이 H)을 창 구멍을 비우고 채우는 사각형들 [(a0,a1,z0,z1)]."""
    rects, prev = [], 0.0
    for c, wd, z, hh in sorted(wins):
        a0, a1 = max(0.0, c - wd / 2), min(L, c + wd / 2)
        if a0 > prev + 1e-4:
            rects.append((prev, a0, 0.0, H))
        if z - hh / 2 > 1e-4:
            rects.append((a0, a1, 0.0, z - hh / 2))
        if z + hh / 2 < H - 1e-4:
            rects.append((a0, a1, z + hh / 2, H))
        prev = a1
    if prev < L - 1e-4:
        rects.append((prev, L, 0.0, H))
    return rects


def _build_wall(kind):
    """벽을 창 구멍 + 부속실 구간으로 쪼개 세운다. 부속실 뒤 구간은 '방의 벽'이 아니므로
    카메라에서 감춘다(빛은 계속 막는다) — 안 그러면 욕실 너머 외벽이 방 벽인 척 화면에 남는다."""
    wins = _wins_by_wall.get(kind, [])
    L = W if kind in ("far", "near") else D
    segs = _spans(0.0, L, _BLOCK.get(kind, []))
    n = 0
    for (a0, a1, z0, z1) in (_wall_rects(L, wins) if wins else [(0.0, L, 0.0, H)]):
        for (s0, s1, covered) in segs:
            b0, b1 = max(a0, s0), min(a1, s1)
            if b1 - b0 < 1e-3:
                continue
            sa, sz = b1 - b0, z1 - z0
            ca, cz = (b0 + b1) / 2, (z0 + z1) / 2
            if kind == "far":
                o = plane(f"wall_far_{n}", sa, sz, (ca, D, cz), rot=(math.radians(90), 0, 0), m=WALL)
            elif kind == "near":
                o = plane(f"wall_near_{n}", sa, sz, (ca, 0, cz), rot=(math.radians(90), 0, 0), m=WALL)
            elif kind == "left":
                o = plane(f"wall_left_{n}", sz, sa, (0, ca, cz), rot=(0, math.radians(90), 0), m=WALL)
            else:
                o = plane(f"wall_right_{n}", sz, sa, (W, ca, cz), rot=(0, math.radians(-90), 0), m=WALL)
            if covered or kind in hide:
                o.visible_camera = False
            n += 1


for _k in ("far", "near", "left", "right"):
    if _k in hide and _k not in _wins_by_wall:
        continue
    _build_wall(_k)
_ceil = plane("ceil", W, D, (W / 2, D / 2, H), rot=(math.pi, 0, 0), m=CEIL)
if "ceil" in hide:
    _ceil.visible_camera = False

# ---------- 걸레받이(baseboard) — 그려진 벽 하단에 얇은 띠 ----------
# 컷아웃이 물고 있는 구간은 건너뛴다(바닥이 없는 자리에 띠만 떠 있으면 안 되므로).
BB_H, BB_T = 0.085, 0.012  # 높이 8.5cm, 두께
_BB_WALLS = {   # 벽 → (길이, 걸레받이 박스 만드는 함수)
    "far":   (W, lambda n, a, b: box(n, b - a, BB_T, BB_H, ((a + b) / 2, D - BB_T / 2, BB_H / 2), m=TRIM)),
    "near":  (W, lambda n, a, b: box(n, b - a, BB_T, BB_H, ((a + b) / 2, BB_T / 2, BB_H / 2), m=TRIM)),
    "left":  (D, lambda n, a, b: box(n, BB_T, b - a, BB_H, (BB_T / 2, (a + b) / 2, BB_H / 2), m=TRIM)),
    "right": (D, lambda n, a, b: box(n, BB_T, b - a, BB_H, (W - BB_T / 2, (a + b) / 2, BB_H / 2), m=TRIM)),
}
for _wk, (_wl, _wfn) in _BB_WALLS.items():
    if _wk in hide:
        continue
    for _i, (_a, _b, _cov) in enumerate(_spans(0.0, _wl, _BLOCK.get(_wk, []))):
        if not _cov:
            _wfn(f"bb_{_wk}{_i}", _a, _b)

# ---------- 컷아웃(비직사각형 방)의 경계 = 방의 벽 ----------
# 부속실 '박스'를 세우는 게 아니라, 방과 맞닿는 면만 세워 그 자리가 그냥 방 벽으로 보이게 한다.
# (방 경계와 겹치는 면은 만들지 않는다 — 그 자리는 외벽·천장이 이미 담당.)
# 부속실 안쪽 바닥은 위에서 파냈으므로 벽 너머엔 아무것도 없다 = 실제 방만 남는다.
_FACE_HIDE = {"f": "near", "n": "far", "r": "left", "l": "right"}   # 그 벽이 숨겨졌다 = 카메라가 이 면의 '뒤'에 있다
for _ci, _c in enumerate(_CUTS):
    _hw, _hd = _c["w"] / 2, _c["d"] / 2
    _x0, _x1 = _c["x"] - _hw, _c["x"] + _hw
    _y0, _y1 = _c["y"] - _hd, _c["y"] + _hd
    for _nm, _cond, _at, _rng in (
        ("n", _y0 > _EPSB, _y0 - 0.02, (_x0, _x1)),
        ("f", _y1 < D - _EPSB, _y1 + 0.02, (_x0, _x1)),
        ("l", _x0 > _EPSB, _x0 - 0.02, (_y0, _y1)),
        ("r", _x1 < W - _EPSB, _x1 + 0.02, (_y0, _y1)),
    ):
        if not _cond:
            continue
        _vert = _nm in ("n", "f")
        # 이 면 바깥이 '또 다른 부속실'인 구간은 방에서 안 보이는 내부 칸막이 — 만들지 않는다.
        _adj = [((o[0], o[1]) if _vert else (o[2], o[3])) for o in _CBOX
                if (o[2] <= _at <= o[3] if _vert else o[0] <= _at <= o[1])]
        # 컷어웨이 일관성: 카메라가 면의 뒤쪽에 있으면(=대응 외벽이 숨김) 그 면도 함께 잘라낸다.
        # 통째로 숨기면 안 된다 — 욕실의 옆면은 카메라를 가려도, 안쪽 면은 '방의 벽'이기 때문.
        _fhide = _FACE_HIDE[_nm] in hide
        for _si, (_a, _b, _cov) in enumerate(_spans(_rng[0], _rng[1], _adj)):
            if _cov or _b - _a < 1e-3:
                continue
            _mid = (_a + _b) / 2
            if _vert:
                _fo = plane(f"cut{_ci}_{_nm}{_si}", _b - _a, H, (_mid, _y0 if _nm == "n" else _y1, H / 2),
                            rot=(math.radians(90), 0, 0), m=WALL)
            else:
                _fo = plane(f"cut{_ci}_{_nm}{_si}", H, _b - _a, (_x0 if _nm == "l" else _x1, _mid, H / 2),
                            rot=(0, math.radians(90 if _nm == "l" else -90), 0), m=WALL)
            if _fhide:
                _fo.visible_camera = False
                continue
            # 방 쪽 하단에 걸레받이 — 외벽과 같은 마감이라야 '떠 있는 판'이 아니라 방 벽으로 읽힌다.
            if _vert:
                box(f"cut{_ci}_{_nm}{_si}_bb", _b - _a, BB_T, BB_H,
                    (_mid, (_y0 - BB_T / 2) if _nm == "n" else (_y1 + BB_T / 2), BB_H / 2), m=TRIM)
            else:
                box(f"cut{_ci}_{_nm}{_si}_bb", BB_T, _b - _a, BB_H,
                    ((_x0 - BB_T / 2) if _nm == "l" else (_x1 + BB_T / 2), _mid, BB_H / 2), m=TRIM)
    # 윗면은 천장(z=H)과 동일 평면 — 생성하지 않는다(천장이 담당)

# ---------- 개구부(창문·문) — 벽별 임의 위치. 2D 평면의 문/창을 렌더에 반영 ----------
# 벽: far(y=D)/near(y=0)/left(x=0)/right(x=W). c=벽 따라 중심(far/near=x, left/right=y).
_sky = PRE.get("sky")
WM = window_sky_mat(_sky[0], _sky[1], PRE["win_s"]) if _sky else emission("window", PRE["win"], PRE["win_s"])
FR = 0.05  # 창틀 두께


def build_window(wall, c, w, h, z):
    # 숨김(컷어웨이) 벽의 창: 공중에 뜬 창이 구도를 가리므로 카메라에서 숨긴다 —
    # 유리는 visible_camera=False로 '빛만' 내고, 프레임·창살은 아예 만들지 않는다.
    _hidden = wall in hide
    if wall in ("far", "near"):
        yb = (D - 0.02) if wall == "far" else 0.02
        yf = yb + (-0.02 if wall == "far" else 0.02)   # 프레임/창살은 방 안쪽으로 살짝
        _pane = plane("win_pane", w, h, (c, yb, z), rot=(math.radians(90), 0, 0), m=WM)
        _pane.visible_shadow = False   # 유리는 태양을 통과시킨다(발광은 유지)
        if _hidden:
            _pane.visible_camera = False
            return
        box("win_t", w + 2 * FR, 0.06, FR, (c, yf, z + h / 2 + FR / 2), m=TRIM)
        box("win_b", w + 2 * FR, 0.06, FR, (c, yf, z - h / 2 - FR / 2), m=TRIM)
        box("win_l", FR, 0.06, h + 2 * FR, (c - w / 2 - FR / 2, yf, z), m=TRIM)
        box("win_r", FR, 0.06, h + 2 * FR, (c + w / 2 + FR / 2, yf, z), m=TRIM)
        box("win_mv", 0.03, 0.05, h, (c, yf, z), m=TRIM)
        box("win_mh", w, 0.05, 0.03, (c, yf, z), m=TRIM)
    else:  # left / right
        xb = 0.02 if wall == "left" else W - 0.02
        xf = xb + (0.02 if wall == "left" else -0.02)
        _pane = plane("win_pane", h, w, (xb, c, z), rot=(0, math.radians(90), 0), m=WM)
        _pane.visible_shadow = False
        if _hidden:
            _pane.visible_camera = False
            return
        box("win_t", 0.06, w + 2 * FR, FR, (xf, c, z + h / 2 + FR / 2), m=TRIM)
        box("win_b", 0.06, w + 2 * FR, FR, (xf, c, z - h / 2 - FR / 2), m=TRIM)
        box("win_l", 0.06, FR, h + 2 * FR, (xf, c - w / 2 - FR / 2, z), m=TRIM)
        box("win_r", 0.06, FR, h + 2 * FR, (xf, c + w / 2 + FR / 2, z), m=TRIM)
        box("win_mv", 0.05, 0.03, h, (xf, c, z), m=TRIM)
        box("win_mh", 0.05, w, 0.03, (xf, c, z), m=TRIM)


def build_door(wall, c, w):
    dh = min(2.05, H - 0.06)   # 문 높이
    fr, leaf = 0.06, 0.045     # 문틀 두께, 문짝 두께
    if wall in ("far", "near"):
        yb = (D - 0.03) if wall == "far" else 0.03
        yh = yb + (-0.03 if wall == "far" else 0.03)  # 손잡이 방 안쪽
        box("door_leaf", w, leaf, dh, (c, yb, dh / 2), m=DOORMAT)
        box("door_top", w + 2 * fr, 0.08, fr, (c, yb, dh + fr / 2), m=FRAME)
        box("door_jl", fr, 0.08, dh + fr, (c - w / 2 - fr / 2, yb, (dh + fr) / 2), m=FRAME)
        box("door_jr", fr, 0.08, dh + fr, (c + w / 2 + fr / 2, yb, (dh + fr) / 2), m=FRAME)
        box("door_hd", 0.035, 0.05, 0.10, (c + w / 2 - 0.09, yh, 1.02), m=HANDLE)
    else:  # left / right
        xb = 0.03 if wall == "left" else W - 0.03
        xh = xb + (0.03 if wall == "left" else -0.03)
        box("door_leaf", leaf, w, dh, (xb, c, dh / 2), m=DOORMAT)
        box("door_top", 0.08, w + 2 * fr, fr, (xb, c, dh + fr / 2), m=FRAME)
        box("door_jl", 0.08, fr, dh + fr, (xb, c - w / 2 - fr / 2, (dh + fr) / 2), m=FRAME)
        box("door_jr", 0.08, fr, dh + fr, (xb, c + w / 2 + fr / 2, (dh + fr) / 2), m=FRAME)
        box("door_hd", 0.05, 0.035, 0.10, (xh, c + w / 2 - 0.09, 1.02), m=HANDLE)


_openings = S.get("openings")
if _openings:
    for o in _openings:
        wl = o.get("wall")
        if wl not in ("far", "near", "left", "right"):
            continue
        if wl in hide and o.get("kind") == "door":
            continue                                    # 숨김 벽의 '문'만 생략(벽 자체가 안 보이므로).
        # 창은 숨김 벽에도 그린다 — 벽이 카메라 비가시로 '존재'하므로 유리 발광·구멍이 살아야 한다.
        c = o.get("pos", (W / 2 if wl in ("far", "near") else D / 2))
        if o.get("kind") == "door":
            build_door(wl, c, o.get("width", 0.9))
        else:
            build_window(wl, c, o.get("width", 1.4), o.get("h", 1.0), o.get("z", 1.7))
elif "far" not in hide:
    build_window("far", W / 2, min(2.2, W * 0.6), 1.0, 1.7)  # 기본: far 벽 중앙 창(sill 1.2m — 침대 위)

# ---------- 러그(옵션) : 중앙 바닥에 부드러운 패브릭 ----------
rug = S.get("rug")
if rug:
    RM = mat("rug", tuple(rug.get("color", (0.62, 0.58, 0.52))), rough=0.95)
    rw, rd = rug.get("w", min(2.0, W * 0.7)), rug.get("d", min(2.6, D * 0.5))
    rx, ry = rug.get("x", W / 2), rug.get("y", D / 2)
    plane("rug", rw, rd, (rx, ry, 0.006), m=RM)
    RB = mat("rug_b", tuple(rug.get("border", (0.42, 0.38, 0.33))), rough=0.95)
    plane("rug_border", rw + 0.12, rd + 0.12, (rx, ry, 0.004), m=RB)

# ---------- 태양광 / 실내등 ----------
# 그림자의 원천은 '창문': ① 태양 방위를 가장 큰 창의 안쪽 방향으로 정렬(+20° 사선), 고도는 창을
# 통과할 수 있게 ≤35°로 클램프. ② 각 창 안쪽에 창 크기 AREA 키라이트(포탈식) — 실내 그림자를 만든다.
sun = PRE.get("sun")
_wins = [o for o in S.get("openings", []) if o.get("kind") == "window"]
_AZ = {"far": 180, "near": 0, "left": 270, "right": 90}   # 빛의 수평 진행방향 = 창 안쪽 법선
if sun:
    col, energy, alt, az = sun
    if _wins:
        _wmax = max(_wins, key=lambda o: o.get("width", 0))
        az = _AZ.get(_wmax.get("wall"), az) + 20
        alt = min(alt, 35)
    sd = bpy.data.lights.new("sun", 'SUN'); so = bpy.data.objects.new("sun", sd)
    sc.collection.objects.link(so)
    # 창이 있으면 '진짜 태양(창 구멍 통과)'이 주광 — 세게 + 또렷한 경계. winlight는 보조 필로.
    sd.energy = energy * (3.2 if _wins else 1.0); sd.color = col
    sd.angle = math.radians(1.2 if _wins else 2.5)   # 창 투과 빛패치 경계를 또렷하게
    so.rotation_euler = (math.radians(90 - alt), 0, math.radians(az))
    # 창문 키라이트(실내 직사광·그림자 담당) — 벽이 태양을 막으므로 창 안쪽에서 직접 쏜다
    for _wi, _o in enumerate(_wins):
        _ww, _wh = _o.get("width", 1.2), _o.get("h", 1.0)
        _wz = _o.get("z", 1.7)
        _wl = bpy.data.lights.new(f"winlight{_wi}", 'AREA'); _wo = bpy.data.objects.new(f"winlight{_wi}", _wl)
        sc.collection.objects.link(_wo)
        _wl.shape = 'RECTANGLE'; _wl.size = _ww; _wl.size_y = _wh
        _wl.energy = 90 * energy; _wl.color = col    # 보조 필라이트 — 주광(진짜 태양)을 안 죽이는 선에서 음영면을 살림
        _off = 0.07
        if _o["wall"] == "far":
            _wo.location = (_o["pos"], D - _off, _wz); _wo.rotation_euler = (math.radians(90), 0, math.radians(180))
        elif _o["wall"] == "near":
            _wo.location = (_o["pos"], _off, _wz); _wo.rotation_euler = (math.radians(90), 0, 0)
        elif _o["wall"] == "left":
            _wo.location = (_off, _o["pos"], _wz); _wo.rotation_euler = (math.radians(90), 0, math.radians(-90))
        else:
            _wo.location = (W - _off, _o["pos"], _wz); _wo.rotation_euler = (math.radians(90), 0, math.radians(90))
# 태양 프리셋(낮/아침/노을): 실내 전역 바운스를 흉내내는 약한 천장 필 — 역광면이 새까맣게
# 무너지는 것 방지(천장·창벽이 빛을 막게 된 뒤 필요해짐). 무드를 해치지 않게 낮은 세기.
if PRE.get("sun") and any(o.get("kind") == "window" for o in S.get("openings", [])):
    _fd = bpy.data.lights.new("fill", 'POINT'); _fo = bpy.data.objects.new("fill", _fd)
    sc.collection.objects.link(_fo)
    _fd.energy = 120; _fd.color = (1.0, 0.97, 0.92)
    _fd.shadow_soft_size = 0.9                       # 큰 소프트 반경 — 그림자 없는 앰비언트처럼
    _fo.location = (LCX, LCY, H * 0.55)              # 방 중심 높이 — 수직면(벽체 옆면)도 밝힌다

def _hex_rgb(hx):
    try:
        hx = str(hx).lstrip("#")
        return tuple(int(hx[i:i + 2], 16) / 255.0 for i in (0, 2, 4)) if len(hx) == 6 else None
    except Exception:  # noqa: BLE001
        return None


_lampOn = S.get("lampOn", None)
_LEFF = PRE.get("lamp", 0) if _lampOn is None else (0.0 if not _lampOn else max(PRE.get("lamp", 0), 0.85))
_LC = _hex_rgb(S.get("lampColor")) or (1.0, 0.72, 0.45)   # 기본 ~2700K 웜톤

# 조명 '가구'가 있으면 그게 빛의 주인공 — 천장등은 보조로 줄인다(무드의 핵심).
LAMPS = [it for it in S["items"] if it.get("lamp")]
if PRE.get("lamp", 0) > 0:  # 실내 천장등(밤 위주)
    ld = bpy.data.lights.new("lamp", 'AREA'); lo = bpy.data.objects.new("lamp", ld)
    sc.collection.objects.link(lo)
    ld.shape = 'RECTANGLE'; ld.size = min(LX1 - LX0, 1.2); ld.size_y = min(LY1 - LY0, 1.2)
    _on = LAMPS and _LEFF >= 0.05
    # 밤(무태양)+조명ON = 천장 보조광 완전 소등 — "조명만 켠 밤"의 어둠과 빛 웅덩이를 살린다.
    # 노을(태양 있음)은 잔광이 있으니 약한 보조 유지. 조명 OFF면 기존대로(완전 암흑 방지).
    _factor = 0.0 if (_on and not PRE.get("sun")) else (0.18 if _on else 1.0)
    ld.energy = 60 * PRE["lamp"] * _factor
    ld.color = _LC if _on else (1.0, 0.86, 0.66)   # 조명 켜짐 → 보조광도 선택 색온도를 따른다
    lo.location = (LCX, LCY, H - 0.05)

# ---------- 조명 가구 = 실제 광원 ----------
# 전구를 갓 상단 림 높이(h*0.92)에 둬 위·아래로 빛이 새는 고전적 무드샷 구도.
# 세기는 프리셋 lamp 계수에 비례(밤 최대) + 낮에도 은은한 최소치 — "조명이 빛의 원천".
# 시간대 정책(기본): 밤/노을 = 조명 ON, 낮/아침 = OFF. 사용자가 lampOn(true/false)으로 강제
# 오버라이드할 수 있고(낮에 켜기·밤에 끄기), lampColor(hex)로 색온도를 고른다.
if _LEFF >= 0.05:
    for _li, _lp in enumerate(LAMPS):
        _bz = float(_lp.get("elev", 0)) + float(_lp.get("h", 1.5)) * 0.92
        _pl = bpy.data.lights.new(f"bulb{_li}", 'POINT'); _po = bpy.data.objects.new(f"bulb{_li}", _pl)
        sc.collection.objects.link(_po)
        _pl.color = _LC
        _pl.shadow_soft_size = 0.10                    # 부드러운 그림자
        _pl.energy = 25 * _LEFF                        # 스탠드 현실 밝기 — 빛 웅덩이 + 자연 감쇠
        _po.location = (_lp["x"], _lp["y"], _bz)
        # 눈에 보이는 전구 글로우(작은 발광 구) — 화면에서 조명이 '켜져 있음'이 읽히게
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, location=(_lp["x"], _lp["y"], _bz))
        _bo = bpy.context.active_object
        _glow = tuple(min(1.0, c + 0.12) for c in _LC)
        _bo.data.materials.append(emission(f"bulbmat{_li}", _glow, 6 + 30 * _LEFF))


# ---------- 가구 배치 ----------
def place(path, x, y, rotdeg, elev=0):
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as e:
        print("import fail", path, e); return
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    if not meshes:
        for o in new: bpy.data.objects.remove(o)
        return
    bpy.ops.object.select_all(action='DESELECT')
    for o in new: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for o in list(new):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    # glTF 임포터가 rotation_mode='QUATERNION'으로 만들어 rotation_euler가 무시됨 → XYZ로 바꿔야 회전이 먹힘(핵심 버그)
    obj.rotation_mode = 'XYZ'
    # three.js(Room3D, rot=-θ, Y-up) → Blender(Z-up) 손대칭 없는 변환: 깊이축 뒤집기(D-cy)와 짝 → rot=-θ
    obj.rotation_euler = (0, 0, math.radians(-rotdeg))
    obj.location = (x, y, obj.dimensions.z / 2 + 0.002 + elev)   # elev: 책상 위 조명 등
    return obj


for it in S["items"]:
    _ob = place(it["glb"], it["x"], it["y"], it.get("rot", 0), it.get("elev", 0))
    if it.get("lamp") and _ob is not None:
        _ob.visible_shadow = False   # 갓이 전구 빛을 삼키면 색온도 선택이 화면에 안 드러난다

# ---------- 카메라 ----------
cam_d = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam); sc.camera = cam
cd = S.get("camera", {})
cam.location = cd.get("pos", [W / 2, 0.15, 1.5])
cam_d.lens = cd.get("lens", 28)
tgt = cd.get("target", [W / 2, D * 0.62, 0.55])
d = mathutils.Vector(tgt) - mathutils.Vector(cam.location)
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# fit: 방 지오메트리(보이는 코너들)에 맞춰 타이트 프레이밍 — 잉여 배경 최소화, 방이 프레임을 채움.
# 컷어웨이로 숨는 near/left 벽의 '천장 코너'는 제외(빈 공간까지 여백으로 잡지 않게).
if cd.get("fit"):
    # 프레이밍 기준은 건물 외곽이 아니라 '실제 방'(부속실 제외) — 욕실·현관까지 넣으면 방이 작게 나온다.
    _hx = LX0 if "left" in hide else LX1      # 컷어웨이된 코너 = 빈 공간이라 여백으로 잡지 않는다
    _hy = LY0 if "near" in hide else LY1
    pts = [(LX0, LY0, 0), (LX1, LY0, 0), (LX0, LY1, 0), (LX1, LY1, 0)]          # 방 바닥 4코너
    pts += [(x, y, H) for x in (LX0, LX1) for y in (LY0, LY1)                    # 보이는 벽 상단 코너
            if not (abs(x - _hx) < 1e-6 and abs(y - _hy) < 1e-6)]
    flat = [c for pt in pts for c in pt]
    try:
        dg = bpy.context.evaluated_depsgraph_get()
        loc, _sc = cam.camera_fit_coords(dg, flat)
        # 5% 여백: 시선 방향 반대로 살짝 후퇴
        view = (mathutils.Vector(tgt) - loc)
        cam.location = loc - view.normalized() * (view.length * 0.05)
    except Exception as e:
        print("fit fail", e)

sc.render.filepath = out_path
bpy.ops.render.render(write_still=True)
print("RENDERED", out_path)
