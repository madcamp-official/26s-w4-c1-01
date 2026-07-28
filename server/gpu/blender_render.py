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
sc.view_settings.exposure = S.get("exposure", PRE["exp"])
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
bg_hdri.inputs["Strength"].default_value = S.get("hdri_strength", PRE["hdri"] * (0.62 if any(o.get("kind") == "window" for o in S.get("openings", [])) else 1.0))
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


def mat(name, color, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
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
WALL = mat("wall", (0.90, 0.88, 0.83), rough=0.95)
CEIL = mat("ceil", (0.96, 0.95, 0.93), rough=1.0)
TRIM = mat("trim", (0.94, 0.93, 0.90), rough=0.6)  # 걸레받이/창틀 페인트
FRAME = mat("frame", (0.20, 0.16, 0.12), rough=0.5)  # 창틀 목재
DOORMAT = mat("door", (0.46, 0.31, 0.19), rough=0.55)  # 문짝 목재
HANDLE = mat("handle", (0.62, 0.60, 0.55), rough=0.35, metal=0.9)  # 문 손잡이

# hide: 카메라 쪽 벽/천장을 생략(코너 컷어웨이 — 방 안이 다 보이게). 예: ["near","left","ceil"]
hide = set(S.get("hide", []))
plane("floor", W, D, (W / 2, D / 2, 0), m=FLOOR)
if "ceil" not in hide:
    plane("ceil", W, D, (W / 2, D / 2, H), rot=(math.pi, 0, 0), m=CEIL)
if "far" not in hide:
    plane("wall_far", W, H, (W / 2, D, H / 2), rot=(math.radians(90), 0, 0), m=WALL)    # y=D
if "near" not in hide:
    plane("wall_near", W, H, (W / 2, 0, H / 2), rot=(math.radians(90), 0, 0), m=WALL)   # y=0
if "left" not in hide:
    plane("wall_left", H, D, (0, D / 2, H / 2), rot=(0, math.radians(90), 0), m=WALL)   # x=0
if "right" not in hide:
    plane("wall_right", H, D, (W, D / 2, H / 2), rot=(0, math.radians(-90), 0), m=WALL) # x=W

# ---------- 걸레받이(baseboard) — 그려진 벽 하단에 얇은 띠 ----------
BB_H, BB_T = 0.085, 0.012  # 높이 8.5cm, 두께
if "far" not in hide:
    box("bb_far", W, BB_T, BB_H, (W / 2, D - BB_T / 2, BB_H / 2), m=TRIM)
if "near" not in hide:
    box("bb_near", W, BB_T, BB_H, (W / 2, BB_T / 2, BB_H / 2), m=TRIM)
if "left" not in hide:
    box("bb_left", BB_T, D, BB_H, (BB_T / 2, D / 2, BB_H / 2), m=TRIM)
if "right" not in hide:
    box("bb_right", BB_T, D, BB_H, (W - BB_T / 2, D / 2, BB_H / 2), m=TRIM)

# ---------- 컷아웃(비직사각형 방) — 배치금지 구역을 바닥~천장 벽체 박스로 ----------
for _ci, _c in enumerate(S.get("cutouts", [])):
    box(f"cut{_ci}", _c["w"], _c["d"], H, (_c["x"], _c["y"], H / 2), m=WALL)

# ---------- 개구부(창문·문) — 벽별 임의 위치. 2D 평면의 문/창을 렌더에 반영 ----------
# 벽: far(y=D)/near(y=0)/left(x=0)/right(x=W). c=벽 따라 중심(far/near=x, left/right=y).
_sky = PRE.get("sky")
WM = window_sky_mat(_sky[0], _sky[1], PRE["win_s"]) if _sky else emission("window", PRE["win"], PRE["win_s"])
FR = 0.05  # 창틀 두께


def build_window(wall, c, w, h, z):
    if wall in ("far", "near"):
        yb = (D - 0.02) if wall == "far" else 0.02
        yf = yb + (-0.02 if wall == "far" else 0.02)   # 프레임/창살은 방 안쪽으로 살짝
        plane("win_pane", w, h, (c, yb, z), rot=(math.radians(90), 0, 0), m=WM)
        box("win_t", w + 2 * FR, 0.06, FR, (c, yf, z + h / 2 + FR / 2), m=TRIM)
        box("win_b", w + 2 * FR, 0.06, FR, (c, yf, z - h / 2 - FR / 2), m=TRIM)
        box("win_l", FR, 0.06, h + 2 * FR, (c - w / 2 - FR / 2, yf, z), m=TRIM)
        box("win_r", FR, 0.06, h + 2 * FR, (c + w / 2 + FR / 2, yf, z), m=TRIM)
        box("win_mv", 0.03, 0.05, h, (c, yf, z), m=TRIM)
        box("win_mh", w, 0.05, 0.03, (c, yf, z), m=TRIM)
    else:  # left / right
        xb = 0.02 if wall == "left" else W - 0.02
        xf = xb + (0.02 if wall == "left" else -0.02)
        plane("win_pane", h, w, (xb, c, z), rot=(0, math.radians(90), 0), m=WM)
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
        if wl not in ("far", "near", "left", "right") or wl in hide:
            continue                                    # 없는 벽/컷어웨이로 사라진 벽은 생략
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
    sd.energy = energy; sd.color = col; sd.angle = math.radians(2.5)  # 부드러운 그림자 경계
    so.rotation_euler = (math.radians(90 - alt), 0, math.radians(az))
    # 창문 키라이트(실내 직사광·그림자 담당) — 벽이 태양을 막으므로 창 안쪽에서 직접 쏜다
    for _wi, _o in enumerate(_wins):
        _ww, _wh = _o.get("width", 1.2), _o.get("h", 1.0)
        _wz = _o.get("z", 1.7)
        _wl = bpy.data.lights.new(f"winlight{_wi}", 'AREA'); _wo = bpy.data.objects.new(f"winlight{_wi}", _wl)
        sc.collection.objects.link(_wo)
        _wl.shape = 'RECTANGLE'; _wl.size = _ww; _wl.size_y = _wh
        _wl.energy = 260 * energy; _wl.color = col   # 실내 키라이트 — 그림자가 창에서 나오도록 환경광 대비 우위
        _off = 0.07
        if _o["wall"] == "far":
            _wo.location = (_o["pos"], D - _off, _wz); _wo.rotation_euler = (math.radians(90), 0, math.radians(180))
        elif _o["wall"] == "near":
            _wo.location = (_o["pos"], _off, _wz); _wo.rotation_euler = (math.radians(90), 0, 0)
        elif _o["wall"] == "left":
            _wo.location = (_off, _o["pos"], _wz); _wo.rotation_euler = (math.radians(90), 0, math.radians(-90))
        else:
            _wo.location = (W - _off, _o["pos"], _wz); _wo.rotation_euler = (math.radians(90), 0, math.radians(90))
if PRE.get("lamp", 0) > 0:  # 실내 천장등(밤 위주)
    ld = bpy.data.lights.new("lamp", 'AREA'); lo = bpy.data.objects.new("lamp", ld)
    sc.collection.objects.link(lo)
    ld.shape = 'RECTANGLE'; ld.size = min(W, 1.2); ld.size_y = min(D, 1.2)
    ld.energy = 60 * PRE["lamp"]; ld.color = (1.0, 0.86, 0.66)
    lo.location = (W / 2, D / 2, H - 0.05)


# ---------- 가구 배치 ----------
def place(path, x, y, rotdeg):
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
    obj.location = (x, y, obj.dimensions.z / 2 + 0.002)


for it in S["items"]:
    place(it["glb"], it["x"], it["y"], it.get("rot", 0))

# ---------- 카메라 ----------
cam_d = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam); sc.camera = cam
cd = S.get("camera", {})
cam.location = cd.get("pos", [W / 2, 0.15, 1.5])
cam_d.lens = cd.get("lens", 28)
tgt = cd.get("target", [W / 2, D * 0.62, 0.55])
d = mathutils.Vector(tgt) - mathutils.Vector(cam.location)
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

sc.render.filepath = out_path
bpy.ops.render.render(write_still=True)
print("RENDERED", out_path)
