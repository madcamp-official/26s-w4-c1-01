#!/usr/bin/env python3
"""의자 정면 방향 자동 검출 — 등받이(위쪽 정점 무게중심)의 반대쪽이 앞면.
각 GLB를 rot0(place와 동일 프레임)으로 로드 → 상단 정점 무게중심으로 등받이 방향 → 앞면 축 스냅 → orient.
매핑(렌더 캘리브레이션): 앞면 +y→0 · +x→270 · -x→90 · -y→180.  usage: blender -b -P chair_orient.py -- asins.txt out.json"""
import bpy, sys, json, os

argv = sys.argv[sys.argv.index("--") + 1:]
asin_file, out_path = argv[0], argv[1]
GLBDIR = "/root/glb"
asins = [a.strip() for a in open(asin_file) if a.strip()]
ANG = {"+x": 0, "+y": 90, "-x": 180, "-y": 270}
res = {}
for asin in asins:
    path = os.path.join(GLBDIR, asin + ".glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if not os.path.exists(path):
        res[asin] = {"orient": 0, "err": "no file"}; continue
    try:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in new if o.type == 'MESH']
        if not meshes:
            res[asin] = {"orient": 0, "err": "no mesh"}; continue
        # place()와 동일: 트랜스폼 적용(월드 좌표 확정)
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes: o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        import mathutils
        xs = []; ys = []; zs = []
        for o in meshes:
            mw = o.matrix_world
            for v in o.data.vertices:
                w = mw @ v.co
                xs.append(w.x); ys.append(w.y); zs.append(w.z)
        xmin, xmax = min(xs), max(xs); ymin, ymax = min(ys), max(ys); zmin, zmax = min(zs), max(zs)
        cx = (xmin + xmax) / 2; cy = (ymin + ymax) / 2
        thr = zmin + 0.72 * (zmax - zmin)   # 상단(등받이 top, 팔걸이보다 위)
        hx = []; hy = []
        for x, y, z in zip(xs, ys, zs):
            if z >= thr:
                hx.append(x); hy.append(y)
        if not hx:
            res[asin] = {"orient": 0, "err": "no top"}; continue
        bxc = sum(hx) / len(hx); byc = sum(hy) / len(hy)
        bdx = bxc - cx; bdy = byc - cy          # 등받이 방향
        fx = -bdx; fy = -bdy                     # 앞면 방향
        w = xmax - xmin; d = ymax - ymin
        # 정규화(발자국 크기 대비 오프셋)로 대칭 판정
        rel = max(abs(bdx) / (w / 2 + 1e-6), abs(bdy) / (d / 2 + 1e-6))
        if rel < 0.12:                           # 등받이 뚜렷치 않음 → 대칭(오토만/큐브/바스툴)
            res[asin] = {"orient": 0, "axis": "sym", "rel": round(rel, 2)}; continue
        axis = ("+x" if fx > 0 else "-x") if abs(fx) >= abs(fy) else ("+y" if fy > 0 else "-y")
        orient = (ANG[axis] - 90) % 360
        res[asin] = {"orient": orient, "axis": axis, "rel": round(rel, 2)}
    except Exception as e:  # noqa
        res[asin] = {"orient": 0, "err": str(e)[:80]}
json.dump(res, open(out_path, "w"))
print("DONE", len(res))
