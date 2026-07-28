#!/usr/bin/env python3
"""카탈로그 GLB 무결성 감사 — 각 GLB를 로드해 바운딩박스/메시/재질/텍스처를 잰다.
usage: blender --background --python glb_audit.py -- /root/glb out.json
출력 JSON: {name: {ok, dims_cm:[x,y,z], meshes, mats, images, err}}
"""
import bpy, sys, json, os, math

argv = sys.argv[sys.argv.index("--") + 1:]
glbdir, out_path = argv[0], argv[1]
res = {}
for fn in sorted(os.listdir(glbdir)):
    if not fn.endswith(".glb"):
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rec = {"ok": False}
    try:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(glbdir, fn))
        new = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in new if o.type == 'MESH']
        rec["meshes"] = len(meshes)
        # 월드 바운딩박스(모든 메시)
        lo = [1e9, 1e9, 1e9]; hi = [-1e9, -1e9, -1e9]
        for o in meshes:
            for c in o.bound_box:
                w = o.matrix_world @ __import__("mathutils").Vector(c)
                for i in range(3):
                    lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
        dims = [round((hi[i] - lo[i]) * 100, 1) for i in range(3)]  # cm
        rec["dims_cm"] = dims
        mats = set(); imgs = set()
        for o in meshes:
            for s in o.material_slots:
                if s.material:
                    mats.add(s.material.name)
                    if s.material.use_nodes:
                        for n in s.material.node_tree.nodes:
                            if n.type == 'TEX_IMAGE' and n.image:
                                imgs.add(n.image.name)
        rec["mats"] = len(mats); rec["images"] = len(imgs)
        rec["ok"] = len(meshes) > 0 and all(d > 0 for d in dims)
    except Exception as e:  # noqa: BLE001
        rec["err"] = str(e)[:200]
    res[fn] = rec

json.dump(res, open(out_path, "w"), ensure_ascii=False, indent=0)
print("AUDITED", len(res), "->", out_path)
