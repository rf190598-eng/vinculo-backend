// Service worker básico do Vínculo — não implementa funcionamento 100%
// offline. Existe principalmente pra satisfazer o critério de
// instalabilidade de PWA em alguns navegadores (junto com o manifest.json).
// Estratégia: network-first, com fallback pro cache do "app shell" só se a
// rede cair na navegação (não cacheia respostas de API nem dados pessoais).
const CACHE_NAME = 'vinculo-shell-v1';
const APP_SHELL = ['/prototipo', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Só cuida de GET — POST/PATCH/DELETE (login, mensagens, etc.) sempre vão
  // direto pra rede, nunca passam por cache.
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
