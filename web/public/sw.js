// 방꾸요정 서비스워커 — PWA 설치 요건 + 정적 셸 캐시.
// 원칙: /api·외부 요청은 절대 캐시하지 않는다(렌더/로그인/검색은 항상 실시간).
const CACHE = 'bangkku-v2';   // 세대 올리면 activate 때 구캐시 전부 삭제

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // 정적 자원: 네트워크 우선, 실패 시 캐시(오프라인 셸)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./')))
  );
});
