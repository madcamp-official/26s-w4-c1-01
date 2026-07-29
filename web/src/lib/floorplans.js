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
    id: 'fp-6w', name: '6평 가로형', pyeong: 6, widthM: 4.3, depthM: 3.4,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 1.95, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 2.15, width: 2.0 },
    ],
    annex: { d: 1.5, bath: { x: 2.7, w: 1.5 }, kitchen: { x: 0, w: 1.3 }, entry: { x: 1.5, w: 0.9 } },
    desc: '가로가 더 긴 와이드형 — 좌우 구역 나누기 좋음',
  },
  {
    id: 'fp-75w', name: '7.5평 가로형', pyeong: 7.5, widthM: 4.8, depthM: 4.0,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 2.1, width: 0.95, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 2.4, width: 2.2 },
      { kind: 'window', wall: 'left', pos: 1.5, width: 1.2 },
    ],
    annex: { d: 1.6, bath: { x: 3.1, w: 1.6 }, kitchen: { x: 0, w: 1.4 }, entry: { x: 1.65, w: 0.95 } },
    desc: '넓은 가로형 + 창 2개 — 거실감 있는 원룸',
  },
  {
    id: 'fp-9o', name: '9평 오피스텔', pyeong: 9, widthM: 4.0, depthM: 5.6,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 0.7, width: 0.95, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 2.0, width: 2.4 },
      { kind: 'window', wall: 'right', pos: 1.5, width: 1.2 },
    ],
    annex: { d: 1.8, bath: { x: 2.0, w: 1.8 }, kitchen: { x: 0, w: 1.5 }, entry: { x: 0.15, w: 0.95 } },
    balcony: { d: 1.0 },
    desc: '신축 오피스텔 — 통창 + 보조창 + 발코니',
  },
  // ── 실제 인허가 도면에서 실측한 세대 (design/화면 캡처 2026-07-29 112406.png) ──
  // 도면 전체 외곽 15,300×13,000mm에 픽셀↔mm 스케일을 잡아 내벽 위치를 읽고, 인쇄된
  // 전용면적으로 검산했다. 세대 외곽(벽 포함) → 전용면적 오차 6% = 벽 두께분이라 정합.
  //   1호 세대외곽 5,500×5,800 (하단체인 3,600+1,900 / 좌측체인 3,700+2,100) → 전용 29.86㎡
  // 방 사각형은 가구를 놓을 수 있는 주생활공간만 잡고, 욕실·현관·주방은 annex로 뺐다.
  {
    // 세대 내부(벽 안쪽) 전체를 방 사각형으로 잡고, 보일러실·주방·현관·욕실을 cutout으로 파낸다.
    // → 2D 편집기에서 실제 L자 형상 그대로 나오고, 가구가 그 구역을 침범하면 엔진이 잡는다.
    // 좌표는 세대 좌상단(벽 안쪽) 기준 m. 0.5m 격자를 도면에 얹어 판독했다.
    id: 'fp-real-1', name: '실측 도면 · 소형주택 1호', pyeong: 9.0, widthM: 5.2, depthM: 5.5,
    openings: [
      { kind: 'door', wall: 'right', pos: 2.6, width: 0.9, hinge: 'a' },   // 복도 → 현관
      { kind: 'window', wall: 'left', pos: 4.4, width: 1.5 },              // 좌측 외벽 창(발코니 쪽)
    ],
    cutouts: [
      { x: 0, y: 0, w: 1.6, d: 1.95, kind: 'closet' },     // 보일러실
      { x: 1.6, y: 0, w: 1.75, d: 0.75, kind: 'kitchen' }, // 주방 빌트인 카운터
      { x: 3.35, y: 0, w: 1.85, d: 3.35, kind: 'entry' },  // 현관 + 우상단 벽체
      { x: 3.35, y: 3.35, w: 1.85, d: 2.15, kind: 'bath' },// 욕실
    ],
    // 이 세대는 욕실·주방·현관이 전부 세대 '안'이라 바깥 복도(annex)가 없다.
    annex: { d: 0, bath: null, kitchen: { x: 0, w: 0 }, entry: { x: 0, w: 0 } },
    underlay: './plans/underlay-1.png',   // 방 bbox에 1:1 대응하는 실제 도면 크롭
    real: { source: '인허가 평면도 실측', areaM2: 29.86, unitMm: '5,500 × 5,800' },
    desc: '실제 도면 그대로 — 보일러실·주방·현관·욕실이 파인 L자, 가구 놓을 공간 약 14㎡',
  },
  {
    id: 'fp-real-2', name: '실측 도면 · 소형주택 2호', pyeong: 8.3, widthM: 5.1, depthM: 4.4,
    openings: [
      { kind: 'door', wall: 'right', pos: 3.6, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'left', pos: 2.2, width: 1.5 },
    ],
    cutouts: [
      { x: 3.4, y: 0, w: 1.7, d: 2.0, kind: 'bath' },       // 욕실(우상단)
      { x: 0, y: 2.8, w: 1.35, d: 1.6, kind: 'closet' },    // 보일러실(좌하단)
      { x: 1.5, y: 3.5, w: 2.9, d: 0.9, kind: 'kitchen' },  // 하단 주방 빌트인
    ],
    annex: { d: 0, bath: null, kitchen: { x: 0, w: 0 }, entry: { x: 0, w: 0 } },
    underlay: './plans/underlay-2.png',   // 방 bbox에 1:1 대응하는 실제 도면 크롭
    real: { source: '인허가 평면도 실측', areaM2: 27.34, unitMm: '5,100 × 4,400' },
    desc: '전용 27.34㎡ — 욕실이 우상단, 주방이 아래 벽면. 가로가 넓은 편',
  },
  {
    id: 'fp-real-3', name: '실측 도면 · 소형주택 3호', pyeong: 8.3, widthM: 4.5, depthM: 5.4,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 1.0, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'top', pos: 3.0, width: 1.5 },
    ],
    cutouts: [
      { x: 0, y: 0, w: 1.3, d: 0.7, kind: 'closet' },       // 보일러실
      { x: 0.2, y: 1.0, w: 1.5, d: 1.8, kind: 'bath' },     // 욕실
      { x: 0.2, y: 4.5, w: 1.3, d: 0.9, kind: 'entry' },    // 현관
      { x: 3.3, y: 3.2, w: 1.0, d: 2.0, kind: 'kitchen' },  // 우측 세로 주방
    ],
    annex: { d: 0, bath: null, kitchen: { x: 0, w: 0 }, entry: { x: 0, w: 0 } },
    underlay: './plans/underlay-3.png',   // 방 bbox에 1:1 대응하는 실제 도면 크롭
    real: { source: '인허가 평면도 실측', areaM2: 27.48, unitMm: '4,500 × 5,400' },
    desc: '전용 27.48㎡ — 부속실이 한쪽 벽에 몰려 반대쪽이 통으로 남는 세로형',
  },
  {
    id: 'fp-real-4', name: '실측 도면 · 소형주택 4호', pyeong: 10.9, widthM: 5.4, depthM: 5.95,
    openings: [
      { kind: 'door', wall: 'bottom', pos: 2.35, width: 0.9, hinge: 'a' },
      { kind: 'window', wall: 'right', pos: 2.0, width: 1.5 },
    ],
    cutouts: [
      { x: 0.05, y: 0, w: 1.6, d: 2.55, kind: 'closet', label: '침실' },  // 분리된 침실
      { x: 2.55, y: 0, w: 1.6, d: 0.85, kind: 'closet' },   // 보일러실
      { x: 0.85, y: 2.85, w: 0.8, d: 3.1, kind: 'kitchen' },// 세로 주방 빌트인
      { x: 1.85, y: 4.45, w: 1.0, d: 1.5, kind: 'entry' },  // 현관
      { x: 2.85, y: 4.15, w: 2.0, d: 1.8, kind: 'bath' },   // 욕실
    ],
    annex: { d: 0, bath: null, kitchen: { x: 0, w: 0 }, entry: { x: 0, w: 0 } },
    underlay: './plans/underlay-4.png',   // 방 bbox에 1:1 대응하는 실제 도면 크롭
    real: { source: '인허가 평면도 실측', areaM2: 35.91, unitMm: '5,700 × 6,300' },
    desc: '전용 35.91㎡ — 침실이 벽으로 분리된 1.5룸. 5세대 중 가장 큼',
  },
  {
    id: 'fp-real-5', name: '실측 도면 · 소형주택 5호', pyeong: 8.1, widthM: 4.65, depthM: 6.4,
    openings: [
      { kind: 'door', wall: 'left', pos: 1.6, width: 0.9, hinge: 'b' },
      { kind: 'window', wall: 'bottom', pos: 3.0, width: 1.5 },
    ],
    cutouts: [
      { x: 0, y: 0, w: 1.5, d: 1.5, kind: 'entry' },        // 현관
      { x: 2.0, y: 0, w: 1.9, d: 1.5, kind: 'bath' },       // 욕실
      { x: 2.5, y: 1.85, w: 1.5, d: 1.0, kind: 'closet' },  // 보일러실
      { x: 0, y: 2.55, w: 0.85, d: 3.2, kind: 'kitchen' },  // 좌측 세로 주방
    ],
    annex: { d: 0, bath: null, kitchen: { x: 0, w: 0 }, entry: { x: 0, w: 0 } },
    underlay: './plans/underlay-5.png',   // 방 bbox에 1:1 대응하는 실제 도면 크롭
    real: { source: '인허가 평면도 실측', areaM2: 26.86, unitMm: '4,650 × 6,400' },
    desc: '전용 26.86㎡ — 부속실이 위쪽에 모여 아래가 길게 트인 세로형',
  },
];
