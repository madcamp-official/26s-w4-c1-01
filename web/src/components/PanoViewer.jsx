import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// 360° 둘러보기 — 서버가 구운 등장방형 파노라마 한 장을 구 '안쪽'에 입혀 방 한가운데 선 것처럼 본다.
// 렌더는 이미 끝났으므로 여기서는 서버를 다시 부르지 않는다: 돌리는 건 전부 즉각 반응한다.
// 시점은 그 자리에 고정(고개만 돌아감) — 걸어다니려면 자리마다 새 렌더가 필요하다.
export default function PanoViewer({ src, caption, onClose }) {
  const host = useRef(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(72, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.rotation.order = 'YXZ';
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const geo = new THREE.SphereGeometry(10, 60, 40);
    geo.scale(-1, 1, 1);                     // 뒤집어야 안쪽 면이 보인다
    const tex = new THREE.TextureLoader().load(src, () => draw());
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    scene.add(mesh);

    // three.js 구의 UV는 +X에서 시작해 감긴다 — 카메라 yaw=0은 파노라마의 u=0.25 지점을 본다.
    // 서버는 '방에서 볼 만한 방향'을 파노라마 한가운데(u=0.5)에 놓으므로 90° 돌려 시작한다.
    let yaw = Math.PI / 2, pitch = -0.05, raf = 0;
    function draw() {
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      renderer.render(scene, camera);
    }
    function schedule() {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
    }

    // 드래그(마우스·터치 공통) — 손가락 이동량만큼 시선을 돌린다. 위아래는 천장·바닥까지만.
    let dragging = false, lx = 0, ly = 0;
    const down = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture?.(e.pointerId); };
    const move = (e) => {
      if (!dragging) return;
      yaw -= (e.clientX - lx) * 0.005;
      pitch = Math.max(-1.35, Math.min(1.35, pitch - (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
      schedule();
    };
    const up = () => { dragging = false; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    // 두 손가락 핀치 = 화각 조절(줌). 좁힐수록 확대.
    const onWheel = (e) => {
      camera.fov = Math.max(35, Math.min(95, camera.fov + (e.deltaY > 0 ? 3 : -3)));
      camera.updateProjectionMatrix();
      schedule();
    };
    el.addEventListener('wheel', onWheel, { passive: true });

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      draw();
    };
    window.addEventListener('resize', onResize);
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', onWheel);
      geo.dispose(); tex.dispose(); mesh.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [src, onClose]);

  return (
    <div className="panoview">
      <div className="panoview-bar">
        <button className="rt-circle" onClick={onClose} aria-label="닫기">✕</button>
        <span className="imgview-cap">{caption || '방 안에서 둘러보기'}</span>
      </div>
      <div className="panoview-stage" ref={host} />
      <div className="imgview-hint">드래그해서 사방을 둘러봐 · 서 있는 자리는 고정이야</div>
    </div>
  );
}
