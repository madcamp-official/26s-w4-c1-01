#!/usr/bin/env python3
"""방꾸요정 포토리얼 렌더 — Blender 4.2 Cycles(CPU).
scene.json(방 치수 + 배치 아이템 + 카메라) → 포토리얼 인테리어 PNG.
usage: blender --background --python blender_render.py -- scene.json out.png
좌표: x∈[0,W], y∈[0,D](깊이), z=up. 아이템 x,y=바닥 중심, rot=Z축 도(°).
"""
import bpy, sys, json, math

argv = sys.argv[sys.argv.index("--") + 1:]
scene_path, out_path = argv[0], argv[1]
S = json.load(open(scene_path))
R = S["room"]; W, D, H = R["w"], R["d"], R["h"]

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
sc.view_settings.exposure = S.get("exposure", 0.4)

# ---------- 월드 HDRI ----------
world = bpy.data.worlds.new("W"); sc.world = world
world.use_nodes = True
nt = world.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
# 조명은 HDRI로, 카메라에 보이는 배경은 깨끗한 화이트(컷어웨이 열린 면이 지저분하지 않게).
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(S["hdri"])
bg_hdri = nt.nodes.new("ShaderNodeBackground")
bg_hdri.inputs["Strength"].default_value = S.get("hdri_strength", 0.5)
nt.links.new(env.outputs["Color"], bg_hdri.inputs["Color"])
bg_white = nt.nodes.new("ShaderNodeBackground")
bg_white.inputs["Color"].default_value = (1, 1, 1, 1)
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


def plane(name, sx, sy, loc, rot=(0, 0, 0), m=None):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (sx, sy, 1)
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    if m: o.data.materials.append(m)
    return o


FLOOR = mat("floor", (0.80, 0.72, 0.58), rough=0.5)
WALL = mat("wall", (0.90, 0.88, 0.84), rough=0.95)
CEIL = mat("ceil", (0.95, 0.94, 0.92), rough=1.0)

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

# ---------- 창문(밝은 배광) : 좌측 벽 or far 벽 ----------
win = S.get("window", {"wall": "far", "w": min(2.2, W * 0.6), "h": 1.9, "z": 1.0, "strength": 18})
WM = emission("window", (1.0, 0.98, 0.94), win["strength"])
if win["wall"] == "far":
    plane("window", win["w"], win["h"], (W / 2, D - 0.03, win["z"]), rot=(math.radians(90), 0, 0), m=WM)
else:  # left
    plane("window", win["h"], win["w"], (0.03, D * 0.5, win["z"]), rot=(0, math.radians(90), 0), m=WM)

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
    # +180: three.js(Room3D)와 Blender의 상하축·회전 규약 차이 보정(ABO 모델 정면=-Z) → 3D 뷰와 일치
    obj.rotation_euler = (0, 0, math.radians(rotdeg + 180))
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
import mathutils
d = mathutils.Vector(tgt) - mathutils.Vector(cam.location)
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

sc.render.filepath = out_path
bpy.ops.render.render(write_still=True)
print("RENDERED", out_path)
