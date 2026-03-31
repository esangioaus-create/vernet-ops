const CACHE = 'vernet-ops-v2';
const ASSETS = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.url.includes('/socket.io/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
