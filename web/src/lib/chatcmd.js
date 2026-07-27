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

// 문장에서 '마지막에 등장한' 가구 카테고리 — "침대 옆에 협탁 놔줘"처럼 참조 가구(앞)와
// 대상 가구(동사 직전, 뒤)가 함께 나오면 뒤의 것이 명령 대상이다.
export function matchCategory(text) {
  let best = null, bestPos = -1;
  for (const [cat, kws] of CAT_KW) {
    for (const k of kws) {
      const p = text.lastIndexOf(k);
      if (p > bestPos) { bestPos = p; best = cat; }
    }
  }
  return best;
}

// 문장에 위치 표현이 있는가 — 있으면 '추가' 후 LLM 재배치로 위치까지 반영해야 함.
export function hasPlaceHint(text) {
  return /창가|창문|문\s?앞|문\s?옆|옆에|앞에|뒤에|맞은편|반대쪽|반대편|구석|코너|모서리|벽에|벽쪽|중앙|가운데|중간|근처|사이|머리맡|헤드|발치|침대\s?옆|책상\s?옆/.test(text || '');
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
