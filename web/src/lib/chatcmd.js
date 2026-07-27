// 배치 도우미 빠른 명령 파서 — "침대 넣어줘/소파 빼줘/책상 더 크게/조명 추가" 같은
// 자주 쓰는 문장을 로컬에서 즉시 해석(추가/삭제/크기). 매칭 안 되면 null → LLM(재배치)로 넘김.

const CAT_KW = [
  ['침대', ['침대', '베드', 'bed', '침대프레임']],
  ['소파', ['소파', '쇼파', 'sofa']],
  ['책상', ['책상', '데스크', 'desk']],
  ['의자', ['의자', '체어', 'chair', '스툴']],
  ['조명', ['조명', '스탠드', '램프', '플로어등', '플로어 스탠드']],
  ['수납', ['수납', '옷장', '서랍', '서랍장', '책장', '선반', '수납장', '행거']],
  ['러그', ['러그', '카펫', '카페트', 'rug']],
  ['테이블', ['테이블', '협탁', '탁자', '사이드테이블']],
];

export function matchCategory(text) {
  for (const [cat, kws] of CAT_KW) if (kws.some((k) => text.includes(k))) return cat;
  return null;
}

// 반환: { op: 'add'|'remove'|'resize', cat, factor? } | null(자연어 재배치로 위임)
export function parseCommand(text) {
  const t = (text || '').trim();
  const cat = matchCategory(t);
  if (!cat) return null;
  if (/(빼|제거|없애|지워|삭제|치워)/.test(t)) return { op: 'remove', cat };
  if (/(더\s*작게|작게|줄여|작게해|작아)/.test(t)) return { op: 'resize', cat, factor: 0.82 };
  if (/(더\s*크게|크게|키워|크게해|커)/.test(t)) return { op: 'resize', cat, factor: 1.22 };
  if (/(넣|추가|놓|놔|둬|배치|생성|만들|깔)/.test(t)) return { op: 'add', cat };
  return null;
}
