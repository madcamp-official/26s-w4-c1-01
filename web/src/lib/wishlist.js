// 찜한 상품 — 계정 DB가 아직 없어 이 브라우저(localStorage)에만 저장하는 MVP(정직 원칙: 완성된 만큼만 제공).
// 로컬 카탈로그·네이버 검색 결과 둘 다 이 세션이 끝나면 서버에서 다시 조회할 방법이 없어서,
// id만 저장하지 않고 다시 보여줄 때 필요한 정보(이름·가격·이미지·구매링크)를 통째로 스냅샷 떠서 저장한다.
const KEY = 'bk-wishlist';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function writeAll(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 용량 초과 등 — 찜은 부가기능이라 앱 흐름을 막지 않고 조용히 무시 */ }
}

export function getWishlist() { return readAll(); }
export function isWished(id) { return readAll().some((x) => x.id === id); }

// 찜 토글 — 반환값은 토글 후 상태(true=찜됨).
export function toggleWish(item) {
  const list = readAll();
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    writeAll(list);
    return false;
  }
  list.unshift({
    id: item.id, name: item.name, cat: item.cat, price: item.price, priceEst: item.priceEst,
    image: item.image, color: item.color, buyUrl: item.buyUrl, dimAccuracy: item.dimAccuracy,
    savedAt: Date.now(),
  });
  writeAll(list);
  return true;
}

export function removeWish(id) {
  writeAll(readAll().filter((x) => x.id !== id));
}
