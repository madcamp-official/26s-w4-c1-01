// 실측 원룸 도면 10종 — 실제 한국 원룸/오피스텔 구조(현관 복도 + 욕실 + 주방 카운터 + 방).
// 각 도면은 엔진이 그대로 쓰는 방 사각형(widthM×depthM)과 문/창(openings 좌표계)을 갖는다.
// annex(현관·욕실·주방)는 방 사각형 '바깥'에 붙는 시각 요소 — 배치 공간을 침범하지 않는다.
// 좌표 규칙: 방 x∈[0,W], y∈[0,D]. top=y0(안쪽 벽), bottom=yD(현관 쪽 벽).

// annex: 방 아래(bottom)에 붙는 입구 구역. bath={x(방 좌표계 기준 시작x), w, d}, kitchen={x, w}(카운터, 깊이 0.6 고정), entry=현관 매트 위치.
export const FLOORPLANS = [
  {
    id: 'fp-4a', name: '4평 미니 원룸', pyeong: 4, widthM: 2.5, depthM: 4.0,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.55, width: 0.8, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 1.25, width: 1.2 },
    ],
    annex: { d: 1.5, bath: { x: 1.1, w: 1.4 }, kitchen: { x: 0, w: 0 }, entry: { x: 0.15, w: 0.8 } },
    desc: '현관 옆 욕실, 안쪽 창 — 미니 원룸 기본형',
  },
  {
    id: 'fp-5a', name: '5평 일자형', pyeong: 5, widthM: 2.8, depthM: 4.8,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.6, width: 0.85, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 1.4, width: 1.5 },
    ],
    annex: { d: 1.6, bath: { x: 1.3, w: 1.5 }, kitchen: { x: 0, w: 1.2 }, entry: { x: 0.15, w: 0.85 } },
    desc: '복도 주방 + 남향 창 — 가장 흔한 5평 구조',
  },
  {
    id: 'fp-55', name: '5.5평 분리주방', pyeong: 5.5, widthM: 3.0, depthM: 4.6,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 2.45, width: 0.85, hinge: 'b' },
      { kind: 'window', wall: 'left', pos: 1.3, width: 1.5 },
    ],
    annex: { d: 1.7, bath: { x: 0.15, w: 1.5 }, kitchen: { x: 0, w: 0 }, entry: { x: 2.1, w: 0.8 } },
    desc: '거울형(문 오른쪽) — 방이 온전히 남는 타입',
  },
  {
    id: 'fp-6a', name: '6평 표준형', pyeong: 6, widthM: 3.2, depthM: 5.2,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.65, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 1.6, width: 1.8 },
    ],
    annex: { d: 1.7, bath: { x: 1.5, w: 1.6 }, kitchen: { x: 0, w: 1.3 }, entry: { x: 0.15, w: 0.9 } },
    desc: '넓은 안쪽 창 + 복도 주방 — 신축 원룸 표준',
  },
  {
    id: 'fp-6s', name: '6평 정방형', pyeong: 6, widthM: 3.9, depthM: 4.1,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.65, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'right', pos: 1.5, width: 1.7 },
    ],
    annex: { d: 1.6, bath: { x: 1.6, w: 1.6 }, kitchen: { x: 3.3, w: 0 }, entry: { x: 0.2, w: 0.9 } },
    desc: '정사각에 가까운 방 — 배치 자유도가 높음',
  },
  {
    id: 'fp-65', name: '6.5평 복도형', pyeong: 6.5, widthM: 2.7, depthM: 6.4,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.6, width: 0.85, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 1.35, width: 1.4 },
      { kind: 'window', wall: 'right', pos: 1.2, width: 1.1 },
    ],
    annex: { d: 1.6, bath: { x: 1.2, w: 1.4 }, kitchen: { x: 0, w: 1.1 }, entry: { x: 0.12, w: 0.85 } },
    desc: '길쭉한 복도형 — 구역 나누기 좋은 타입',
  },
  {
    id: 'fp-7b', name: '7평 발코니형', pyeong: 7, widthM: 3.3, depthM: 5.3,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.65, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 1.65, width: 2.2 },
    ],
    annex: { d: 1.7, bath: { x: 1.6, w: 1.6 }, kitchen: { x: 0, w: 1.4 }, entry: { x: 0.15, w: 0.9 } },
    balcony: { d: 0.9 },   // top 창 바깥 발코니 스트립
    desc: '큰 창 너머 발코니 — 채광 최상',
  },
  {
    id: 'fp-75', name: '7.5평 투윈도우', pyeong: 7.5, widthM: 3.5, depthM: 5.5,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.65, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 1.75, width: 1.8 },
      { kind: 'window', wall: 'right', pos: 1.5, width: 1.3 },
    ],
    annex: { d: 1.7, bath: { x: 1.7, w: 1.6 }, kitchen: { x: 0, w: 1.4 }, entry: { x: 0.15, w: 0.9 } },
    desc: '창 2개 코너룸 — 통풍·채광 우수',
  },
  {
    id: 'fp-8w', name: '8평 와이드', pyeong: 8, widthM: 4.2, depthM: 5.0,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.7, width: 0.95, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 2.1, width: 2.0 },
    ],
    annex: { d: 1.8, bath: { x: 1.7, w: 1.7 }, kitchen: { x: 3.5, w: 0 }, entry: { x: 0.15, w: 0.95 } },
    desc: '가로로 넓은 방 — 침실+거실 구역 분리형',
  },
  {
    id: 'fp-l55', name: 'L자 5.5평', pyeong: 5.5, widthM: 3.2, depthM: 4.6,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.8, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 1.6, width: 1.6 },
    ],
    // 욕실이 방 우하단으로 파고든 진짜 L자 — cutouts는 배치금지(엔진)이자 욕실(도면)
    cutouts: [{ x: 1.7, y: 3.2, w: 1.5, d: 1.4 }],
    annex: { d: 1.4, kitchen: { x: 0, w: 1.2 }, entry: { x: 1.4, w: 0.9 } },
    desc: '욕실이 방 안으로 파인 L자 — 실평면 그대로',
  },
  {
    id: 'fp-l7', name: 'L자 7평', pyeong: 7, widthM: 3.5, depthM: 5.6,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 2.6, width: 0.9, hinge: 'b' },
      { kind: 'window', wall: 'top', pos: 1.75, width: 1.9 },
      { kind: 'window', wall: 'right', pos: 1.4, width: 1.2 },
    ],
    cutouts: [{ x: 0, y: 4.2, w: 1.5, d: 1.4 }],   // 좌하단 욕실(좌벽에 접함)
    annex: { d: 1.4, kitchen: { x: 1.7, w: 1.3 }, entry: { x: 0.2, w: 0.9 } },
    desc: '좌하단 L자 + 창 2개 — 코너 활용형',
  },
  {
    id: 'fp-9o', name: '9평 오피스텔', pyeong: 9, widthM: 3.8, depthM: 6.3,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.7, width: 0.95, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 1.9, width: 2.4 },
      { kind: 'window', wall: 'right', pos: 1.6, width: 1.2 },
    ],
    annex: { d: 1.9, bath: { x: 1.8, w: 1.8 }, kitchen: { x: 0, w: 1.5 }, entry: { x: 0.15, w: 0.95 } },
    balcony: { d: 1.0 },
    desc: '신축 오피스텔 — 통창 + 보조창 + 발코니',
  },
];
