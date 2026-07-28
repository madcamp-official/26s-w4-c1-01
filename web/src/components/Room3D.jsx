// 진짜 3D 미리보기 — 원룸(바닥+벽) 안에 ABO 실측 GLB 가구를 실치수로 배치.
// 브라우저 WebGL(three.js/R3F)만으로 동작(GPU 서버 불필요). 아키스케치식 orbit + 바닥 드래그 + R키 회전.
import { Suspense, useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, ContactShadows, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 배치 좌표(top-down, m) → 3D 월드. 방을 원점 중앙에 둔다: x=cx-W/2, z=cy-D/2, y=up.
function toWorld(cx, cy, W, D) {
  return [cx - W / 2, 0, cy - D / 2];
}

// GLB 한 점 — bbox로 발자국 중심/바닥 정렬 + 아이템 실치수(m)에 맞춰 스케일.
function Piece({ item, W, D, selected, flagged, onSelect, onDragStart }) {
  const { scene } = useGLTF(item.glb);
  const obj = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return c;
  }, [scene]);

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const sx = (item.wM || 0.5) / (size.x || 1);
    const sy = (item.hM || 0.5) / (size.y || 1);
    const sz = (item.dM || 0.5) / (size.z || 1);
    // 발자국 중심을 원점으로, 바닥(min.y)을 0으로
    return { scale: [sx, sy, sz], offset: [-center.x, -box.min.y, -center.z] };
  }, [obj, item.wM, item.dM, item.hM]);

  const [x, , z] = toWorld(item.cx, item.cy, W, D);
  // 배치 회전 + 모델 정면 보정각(orient) — GLB별 저작 방향 불일치 교정.
  const rot = (-(((item.rotationDeg || 0) + (item.orient || 0))) * Math.PI) / 180;

  return (
    <group
      position={[x, item.elevM || 0, z]}
      rotation={[0, rot, 0]}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(item.id); onDragStart(item.id); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'grab'; }}
      onPointerOut={() => { document.body.style.cursor = 'auto'; }}
    >
      <group scale={fit.scale}>
        <primitive object={obj} position={fit.offset} />
      </group>
      {/* 실치수 발자국 표시 + 선택/경고 하이라이트 */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[item.wM, item.dM]} />
        <meshBasicMaterial
          color={flagged ? '#cc5b52' : selected ? '#6f8f6a' : '#000000'}
          transparent
          opacity={flagged ? 0.28 : selected ? 0.22 : 0}
          depthWrite={false}
        />
      </mesh>
      {(selected || flagged) && (
        <lineSegments position={[0, 0.008, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(item.wM, item.hM, item.dM)]} />
          <lineBasicMaterial color={flagged ? '#cc5b52' : '#6f8f6a'} />
        </lineSegments>
      )}
    </group>
  );
}

// 개구부 3D — 2D 평면의 문/창을 3D 미리보기 벽에 표시. 2D(x∈[0,W],y∈[0,D]) → 월드(x−W/2, z=y−D/2).
// top→뒤벽(z=−D/2) · bottom→앞(z=D/2) · left→좌벽(x=−W/2) · right→우(x=W/2). along='x'(상/하벽) or 'z'(좌/우벽).
function Window3D({ cx, cz, w, along }) {
  const h = 1.0, yc = 1.7, fr = 0.04;   // sill 1.2m — 침대 헤드보드 위로(가림 방지)
  return (
    <group position={[cx, 0, cz]} rotation={[0, along === 'z' ? Math.PI / 2 : 0, 0]}>
      <mesh position={[0, yc, 0]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#bcd8ef" transparent opacity={0.5} emissive="#e2f0fb" emissiveIntensity={0.55} side={THREE.DoubleSide} />
      </mesh>
      {[[0, yc + h / 2, w + 2 * fr, fr], [0, yc - h / 2, w + 2 * fr, fr], [-w / 2 - fr / 2, yc, fr, h + 2 * fr], [w / 2 + fr / 2, yc, fr, h + 2 * fr]].map(([px, py, bw, bh], i) => (
        <mesh key={i} position={[px, py, 0]}><boxGeometry args={[bw, bh, 0.06]} /><meshStandardMaterial color="#f1ece2" roughness={0.9} /></mesh>
      ))}
      <mesh position={[0, yc, 0.012]}><boxGeometry args={[w, 0.03, 0.04]} /><meshStandardMaterial color="#f1ece2" /></mesh>
      <mesh position={[0, yc, 0.012]}><boxGeometry args={[0.03, h, 0.04]} /><meshStandardMaterial color="#f1ece2" /></mesh>
    </group>
  );
}
function Door3D({ cx, cz, w, along }) {
  const h = 2.05, fr = 0.05;
  return (
    <group position={[cx, 0, cz]} rotation={[0, along === 'z' ? Math.PI / 2 : 0, 0]}>
      <mesh position={[0, h / 2, 0]}><boxGeometry args={[w, h, 0.05]} /><meshStandardMaterial color="#8a5a34" roughness={0.65} /></mesh>
      <mesh position={[0, h + fr / 2, 0]}><boxGeometry args={[w + 2 * fr, fr, 0.08]} /><meshStandardMaterial color="#5a463a" /></mesh>
      <mesh position={[-w / 2 - fr / 2, h / 2, 0]}><boxGeometry args={[fr, h + fr, 0.08]} /><meshStandardMaterial color="#5a463a" /></mesh>
      <mesh position={[w / 2 + fr / 2, h / 2, 0]}><boxGeometry args={[fr, h + fr, 0.08]} /><meshStandardMaterial color="#5a463a" /></mesh>
      <mesh position={[w / 2 - 0.09, 1.0, 0.04]}><boxGeometry args={[0.04, 0.1, 0.04]} /><meshStandardMaterial color="#c9b98f" metalness={0.6} roughness={0.4} /></mesh>
    </group>
  );
}
function Openings3D({ room, openings }) {
  const W = room.widthM, D = room.depthM;
  return (openings || []).map((o) => {
    const w = o.width || (o.kind === 'door' ? 0.9 : 1.2);
    let cx, cz, along;
    if (o.wall === 'top') { cz = -D / 2; cx = o.pos - W / 2; along = 'x'; }
    else if (o.wall === 'bottom') { cz = D / 2; cx = o.pos - W / 2; along = 'x'; }
    else if (o.wall === 'left') { cx = -W / 2; cz = o.pos - D / 2; along = 'z'; }
    else { cx = W / 2; cz = o.pos - D / 2; along = 'z'; }
    const P = { cx, cz, w, along };
    return o.kind === 'door' ? <Door3D key={o.id} {...P} /> : <Window3D key={o.id} {...P} />;
  });
}

// 컷아웃(비직사각형 방) — 배치금지 구역을 바닥~천장 벽 박스로 세운다(바닥은 박스가 가림).
function Cutouts3D({ room, H = 2.4 }) {
  const W = room.widthM, D = room.depthM;
  return (room.cutouts || []).map((c, i) => (
    <mesh key={i} position={[c.x + c.w / 2 - W / 2, H / 2, c.y + c.d / 2 - D / 2]} castShadow>
      <boxGeometry args={[c.w, H, c.d]} />
      <meshStandardMaterial color="#efe9df" roughness={0.95} />
    </mesh>
  ));
}

// 방 — 바닥 + 뒤쪽 2벽(카메라가 안을 보도록 개방).
function Shell({ W, D, H = 2.4 }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#e7ddcb" roughness={0.9} metalness={0} />
      </mesh>
      {/* 뒤벽 (z=-D/2) */}
      <mesh position={[0, H / 2, -D / 2]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color="#f3efe7" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* 좌벽 (x=-W/2) */}
      <mesh position={[-W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial color="#ece7dd" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* 걸레받이 느낌 얇은 라인 */}
      <Grid
        args={[W, D]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#cfc4ad"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#bcae95"
        position={[0, 0.004, 0]}
        fadeDistance={Math.max(W, D) * 2.2}
        fadeStrength={1}
        infiniteGrid={false}
      />
    </group>
  );
}

// 캔버스 레벨 드래그 — 포인터 ray를 바닥평면(y=0)과 교차시켜 정확한 위치 산출(아키스케치식).
function DragController({ dragId, onMove, onEnd, W, D }) {
  const { camera, gl } = useThree();
  const cb = useRef({ onMove, onEnd });
  cb.current = { onMove, onEnd };            // 최신 콜백을 ref로 — 드래그 중 리스너 재등록 방지
  useEffect(() => {
    if (!dragId) return;
    const el = gl.domElement;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const p = new THREE.Vector3();
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, p)) {
        cb.current.onMove(dragId, clamp(p.x + W / 2, 0, W), clamp(p.z + D / 2, 0, D));
      }
    };
    const up = () => { document.body.style.cursor = 'auto'; cb.current.onEnd(); };
    el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'grabbing';
    return () => { el.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragId, camera, gl, W, D]);
  return null;
}

// 현재 3D 카메라(위치+타깃)를 매 프레임 부모 ref에 기록 → 렌더가 같은 시점으로 찍게.
function CamCapture({ camRef, controls }) {
  const { camera } = useThree();
  useFrame(() => {
    if (!camRef) return;
    const t = controls.current?.target;
    camRef.current = {
      pos: [camera.position.x, camera.position.y, camera.position.z],
      target: t ? [t.x, t.y, t.z] : [0, 0.35, 0],
    };
  });
  return null;
}

export default function Room3D({ room, items, selectedId, setSelectedId, onMove, onRotate, flags = [], camRef, openings = [] }) {
  const W = room.widthM, D = room.depthM;
  const [dragId, setDragId] = useState(null);
  const controls = useRef();
  const flagSet = useMemo(() => new Set(flags.map((f) => (typeof f === 'string' ? f : f.id))), [flags]);
  const diag = Math.hypot(W, D);

  // R키로 선택 가구 회전
  useEffect(() => {
    const k = (e) => { if ((e.key === 'r' || e.key === 'R') && selectedId) onRotate(selectedId); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [selectedId, onRotate]);

  return (
    <div className="room3d">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [W * 0.55, diag * 0.85, D * 0.95], fov: 42, near: 0.05, far: 100 }}
        onPointerMissed={() => setSelectedId(null)}
      >
        <color attach="background" args={['#ece7dd']} />
        {/* 외부 HDR 없이 다중 라이트로 PBR 형태감 확보 (환경맵 의존 제거 → 확실히 렌더) */}
        <hemisphereLight args={['#fff6e8', '#b3aa98', 0.9]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[W * 0.7, 6.5, D * 0.5]}
          intensity={1.25}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-diag} shadow-camera-right={diag}
          shadow-camera-top={diag} shadow-camera-bottom={-diag}
          shadow-camera-near={0.5} shadow-camera-far={24}
          shadow-bias={-0.0004}
        />
        <directionalLight position={[-W * 0.5, 3, -D * 0.4]} intensity={0.35} color="#eaf0ff" />

        <Suspense fallback={<Html center><div className="r3d-load">3D 불러오는 중…</div></Html>}>
          <Shell W={W} D={D} />
          <Cutouts3D room={room} />
          <Openings3D room={room} openings={openings} />
          {items.map((it) => it.glb ? (
            <Piece
              key={it.id}
              item={it}
              W={W} D={D}
              selected={it.id === selectedId}
              flagged={flagSet.has(it.id)}
              onSelect={setSelectedId}
              onDragStart={setDragId}
            />
          ) : (
            // glb 없는 아이템(시드/네이버)은 실치수 박스로 폴백
            <group key={it.id} position={[toWorld(it.cx, it.cy, W, D)[0], it.elevM || 0, toWorld(it.cx, it.cy, W, D)[2]]} rotation={[0, (-(it.rotationDeg || 0) * Math.PI) / 180, 0]}
              onPointerDown={(e) => { e.stopPropagation(); setSelectedId(it.id); setDragId(it.id); }}>
              <mesh position={[0, it.hM / 2, 0]} castShadow>
                <boxGeometry args={[it.wM, it.hM, it.dM]} />
                <meshStandardMaterial color={flagSet.has(it.id) ? '#cc5b52' : it.color || '#c3b79c'} roughness={0.8} />
              </mesh>
            </group>
          ))}
          <ContactShadows position={[0, 0.012, 0]} scale={Math.max(W, D) * 1.6} far={3} blur={2.4} opacity={0.42} resolution={1024} />
        </Suspense>

        <OrbitControls
          ref={controls}
          enabled={!dragId}
          enablePan
          target={[0, 0.35, 0]}
          minDistance={diag * 0.4}
          maxDistance={diag * 2.2}
          maxPolarAngle={Math.PI / 2.05}
        />
        <CamCapture camRef={camRef} controls={controls} />
        <DragController dragId={dragId} onMove={onMove} onEnd={() => setDragId(null)} W={W} D={D} />
      </Canvas>
      <div className="r3d-hint">드래그로 가구 이동 · 빈 곳 드래그로 시점 회전 · 가구 선택 후 <b>R</b>키 90° 회전</div>
    </div>
  );
}
