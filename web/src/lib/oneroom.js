// 원룸 표준 규격 가구 — 한국 원룸(4~9평)에 실제로 들어가는 크기.
//
// 왜 필요한가: 3D 카탈로그(ABO)는 미국 가구라 침대 30종 중 27종이 폭 150cm 이상(퀸·킹)이다.
// 5평 원룸에 킹 침대를 놓는 배치가 기본이 되어버린다. 한국은 슈퍼싱글(110)이 원룸 표준인데
// 미국 규격엔 아예 없는 사이즈다.
//
// 어떻게: 가장 비슷한 ABO 모델을 베이스로 쓰고 w/d/h를 한국 규격으로 선언한다.
// 렌더·3D 뷰 모두 선언 치수에 맞춰 GLB를 늘리므로(Room3D의 fit, blender place의 dims)
// 평면도·3D·사진의 크기가 전부 일치한다.
//
// 베이스 고르는 기준(중요): ① 배율이 크게 튀지 않을 것 ② 침대는 '매트리스가 있는' 모델일 것.
// AmazonBasics 접이식(B073WQ8JLT)·Movian 싱글프레임(B0718WYQ8D)은 매트리스 없는 맨프레임이라
// 렌더에 앙상한 철제 틀만 나온다 — 베이스로 쓰지 않는다.
//
// 이름은 영어로 통일한다 — ABO 카탈로그가 전부 영어라 한글 이름을 섞으면 목록이 뒤죽박죽이 된다.
// (카테고리 칩·안내 문구 등 앱 UI는 한국어 그대로)
//
// 치수 근거(KS/업계 통용):
//   침대 싱글 100×200 · 슈퍼싱글 110×200 · 더블 140×200 · 퀸 150×200
//   책상 깊이 45~60 · 3단 서랍장 높이 70 전후 · 원룸 러그 150×100
const O = (id, name, cat, w, d, h, base, color, note) => ({
  id: `oneroom-${id}`, name, cat, w, d, h,
  glb: `/glb/${base}.glb`, image: `/glb/${base}.jpg`,
  color, source: 'One-Room', dimAccuracy: '정형', oneroom: true, note,
});

export const ONEROOM = [
  // ── 침대: 원룸의 크기를 좌우하는 가구. 슈퍼싱글이 가장 흔하다.
  // 베이스 B075QDV39J = 103×223 데이베드(매트리스 포함) → 싱글·슈퍼싱글에 배율 ±7%로 딱 맞는다.
  O('bed-s', 'Single Bed (S)', '침대', 100, 200, 87, 'B075QDV39J', '#c9c2b6', 'Minimum for one person'),
  O('bed-ss', 'Super Single Bed (SS)', '침대', 110, 200, 87, 'B075QDV39J', '#c9c2b6', 'Most common in one-room'),
  O('bed-d', 'Double Bed (D)', '침대', 140, 200, 93, 'B075QG3JWL', '#c9c2b6', 'Needs 6 pyeong or more'),
  O('bed-q', 'Queen Bed (Q)', '침대', 150, 200, 93, 'B075QG3JWL', '#c9c2b6', 'Needs 8 pyeong or more'),

  // ── 책상: 원룸은 깊이 45~50이 현실적(60은 통로를 먹는다)
  O('desk-slim', 'Slim Desk 80', '책상', 80, 45, 73, 'B07GFFQZRQ', '#b98a6a', 'For narrow rooms'),
  O('desk-100', 'One-Room Desk 100', '책상', 100, 50, 73, 'B07GFFQZRQ', '#b98a6a', 'Laptop + one monitor'),
  O('desk-120', 'Computer Desk 120', '책상', 120, 60, 73, 'B079HXWXXD', '#b98a6a', 'Fits two monitors'),

  // ── 의자·1인 소파
  O('chair-desk', 'Desk Chair', '의자', 45, 50, 85, 'B01D7P5BFS', '#8f8778', null),
  O('chair-arm', 'Armchair (1-seat)', '의자', 80, 80, 75, 'B075X4T5R9', '#b0a68c', 'Instead of a 2-seat sofa'),
  O('stool', 'Stool', '의자', 40, 40, 45, 'B075X4J118', '#b0a68c', 'Extra seat, tucks away'),

  // ── 수납: 원룸은 세로로 쌓는 게 유리
  O('drawer-3', '3-Drawer Chest', '수납', 60, 40, 70, 'B072ZK8897', '#d0c3a8', null),
  O('drawer-slim', 'Slim Cabinet', '수납', 45, 40, 90, 'B072ZK8897', '#d0c3a8', 'Fits tight gaps'),
  O('shelf-tall', 'Tall Bookshelf', '수납', 60, 30, 180, 'B07HSMYNYJ', '#d0c3a8', 'Takes little floor'),

  // ── 테이블
  O('table-side', 'Side Table', '테이블', 45, 45, 50, 'B072ZLMBH7', '#c3b79c', 'Beside the bed'),
  // 원형 커피테이블 원본 치수 그대로 — 각진 좌식테이블을 만들려고 원형을 늘리면 찌그러진 타원이 된다.
  O('table-low', 'Round Coffee Table', '테이블', 80, 80, 36, 'B07GDSF3MR', '#c3b79c', 'Low, for meals and work'),

  // ── 러그: 미국 규격(183×122)은 원룸에 과하다
  O('rug-s', 'One-Room Rug 150×100', '러그', 150, 100, 1, 'B07QB8JRC3', '#d8cdbb', null),

  // ── 조명(원본이 이미 원룸 크기라 규격만 명시)
  O('lamp-desk', 'Desk Lamp', '조명', 21, 21, 41, 'B07374M818', '#e8e2d6', 'On the desk'),
];

// 침대 규격 라벨 — 한국은 '폭'으로 부른다(길이는 대부분 200 고정).
// 목록에서 킹·퀸만 잔뜩 보이는 걸 막고, 내 방에 뭐가 들어가는지 바로 읽히게.
// 표기는 품목명과 같은 영어로 통일.
export function bedSizeLabel(item) {
  if (item?.cat !== '침대') return null;
  const w = item.w;
  if (!w) return null;
  if (w <= 105) return 'Single';
  if (w <= 125) return 'Super Single';
  if (w <= 147) return 'Double';
  if (w <= 157) return 'Queen';
  return 'King';
}
