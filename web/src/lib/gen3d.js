// AI 생성 3D 가구 — 네이버 쇼핑 상품 사진 1장 → TripoSR(camp-3 3090) image-to-3D.
// image: 네이버 원본 사진(비교용 썸네일) · glb: 생성된 3D(버텍스 컬러, 실척 미보장→카테고리 치수).
// 정직: 단일 사진 zero-shot 생성이라 뒷/옆면은 추정, 얇은 다리/직교 프레임 왜곡 가능. 품질 평가용 프루프.
export const GEN3D = [
  { id: 'gen-1', name: '오스본 라티나 가죽 소파 3인', cat: '소파', w: 200, d: 90, h: 85, color: '#c9c2b6', glb: '/glb/gen1.glb', image: '/glb/gen1.jpg', source: 'AI생성', dimAccuracy: '추정(AI)' },
  { id: 'gen-2', name: '두닷 콰트로 컴퓨터 책상 1200', cat: '책상', w: 120, d: 60, h: 74, color: '#c9c2b6', glb: '/glb/gen2.glb', image: '/glb/gen2.jpg', source: 'AI생성', dimAccuracy: '추정(AI)' },
  { id: 'gen-3', name: '에르먼 S20 메쉬 책상의자', cat: '의자', w: 55, d: 55, h: 95, color: '#c9c2b6', glb: '/glb/gen3.glb', image: '/glb/gen3.jpg', source: 'AI생성', dimAccuracy: '추정(AI)' },
  { id: 'gen-4', name: '아이린 엘린 원목 미니 협탁', cat: '협탁', w: 45, d: 40, h: 50, color: '#c9c2b6', glb: '/glb/gen4.glb', image: '/glb/gen4.jpg', source: 'AI생성', dimAccuracy: '추정(AI)' },
];
