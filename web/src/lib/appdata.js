// ywlee 디자인 공용 상수 — 무드/예산/평수/마켓 카테고리.
// 무드 그라디언트는 프로토타입(design/방꾸-프로토타입.html)의 관찰값 그대로.

export const MOODS = ['포근한 북유럽', '시크한 인더스트리얼', '화사한 내추럴', '모던', '빈티지 레트로', '러블리 파스텔'];

// 무드 썸네일(실사 대체) 빗금 스와치
export const MOOD_BG = {
  '포근한 북유럽': 'repeating-linear-gradient(45deg,#E8DCCB,#E8DCCB 7px,#F2E9DD 7px,#F2E9DD 14px)',
  '시크한 인더스트리얼': 'repeating-linear-gradient(45deg,#B8B2A8,#B8B2A8 7px,#CFCAC1 7px,#CFCAC1 14px)',
  '화사한 내추럴': 'repeating-linear-gradient(45deg,#C7D4B8,#C7D4B8 7px,#DDE6D2 7px,#DDE6D2 14px)',
  '모던': 'repeating-linear-gradient(45deg,#C9CDD1,#C9CDD1 7px,#E2E5E7 7px,#E2E5E7 14px)',
  '빈티지 레트로': 'repeating-linear-gradient(45deg,#D9B679,#D9B679 7px,#E7CE9C 7px,#E7CE9C 14px)',
  '러블리 파스텔': 'repeating-linear-gradient(45deg,#F0CFDA,#F0CFDA 7px,#F8E4EA 7px,#F8E4EA 14px)',
};

// 무드 → 카탈로그 스타일 매핑(catalog.deriveStyle 값과 대응). 필터 실현용.
export const MOOD_TO_STYLE = {
  '포근한 북유럽': ['북유럽', '내추럴'],
  '시크한 인더스트리얼': ['인더스트리얼'],
  '화사한 내추럴': ['내추럴', '북유럽'],
  '모던': ['모던', '미드센추리'],
  '빈티지 레트로': ['클래식', '미드센추리'],
  '러블리 파스텔': ['내추럴', '클래식'],
};

export const BUDGETS = ['10만원 이하', '10~30만원', '30~50만원', '50~100만원', '100만원+'];

// 온보딩 평수 옵션(라벨→평수). estimateRoom으로 실제 치수 계산.
export const PYEONGS = [
  { label: '4평', pyeong: 4 },
  { label: '5평', pyeong: 5 },
  { label: '6.5평', pyeong: 6.5 },
  { label: '8평', pyeong: 8 },
  { label: '10평+', pyeong: 10 },
];

// 마켓 카테고리 세그먼트 → 카탈로그 cat 판정.
// kw: 검색 실행 시 이 카테고리를 검색어에 섞어 보내는 힌트(네이버쇼핑 결과를 카테고리로 좁힘).
export const MARKET_CATS = [
  { label: '전체', match: () => true, kw: '' },
  { label: '침대', match: (c) => c === '침대', kw: '침대' },
  { label: '책상·의자', match: (c) => c === '책상' || c === '의자' || c === '테이블', kw: '책상 의자' },
  { label: '소파', match: (c) => c === '소파', kw: '소파' },
  { label: '수납', match: (c) => c === '수납', kw: '수납장' },
  { label: '조명', match: (c) => c === '조명', kw: '조명' },
  { label: '러그', match: (c) => c === '러그', kw: '러그' },
];

export const MARKET_PRICES = ['~10만', '10~30', '30~50', '50~100', '100+'];

// 홈 탭 "방꾸 이야기" — 커뮤니티는 별도 탭 없이 홈 내부 세그먼트 전환으로만 존재(design/커뮤니티.html 1c안).
// 백엔드 저장소가 없어 정적 목업 데이터로 화면만 구현(§docs/프론트.md: 실 저장은 이번 범위 밖).
export const COMMUNITY_CATS = [
  { key: 'all', label: '전체' },
  { key: 'flex', label: '자랑 🎀' },
  { key: 'tip', label: '꿀팁 💡' },
  { key: 'question', label: '질문 ❓' },
];

export const COMMUNITY_POSTS = [
  { id: 'p1', cat: 'flex', badge: '🎀 자랑', author: '지은', photo: '#EAD7CE', title: '지은님의 원룸 완성! 러블리 파스텔로 꾸며봤어', likes: 128, comments: 12 },
  { id: 'p2', cat: 'tip', badge: '💡 꿀팁', author: '유민', title: '원룸 4평인데 러그 대신 이거 쓰니까 훨씬 넓어보여 (사진 첨부)', likes: 84, comments: 21, saves: 15 },
  { id: 'p3', cat: 'question', badge: '❓ 질문', author: '하늘', title: '북유럽 톤에 어울리는 커피잔 소품 추천 좀 해줘 ㅠㅠ', comments: 9, answering: true },
];
