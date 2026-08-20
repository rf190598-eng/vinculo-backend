// Service worker do Painel Admin do Vínculo — mesmo padrão do sw.js do app
// principal (network-first, com fallback pro cache do "app shell" só se a
// rede cair na navegação; não cacheia respostas de API). Fica servido a
// partir de /admin/sw.js de propósito: por padrão o navegador só deixa um
// service worker controlar URLs dentro do diretório de onde ele foi
// servido, então registrar a partir de /admin/ dá escopo automático
// "/admin/*", sem disputar o escopo "/" que o sw.js do app já controla.
const CACHE_NAME = 'vinculo-admin-shell-v1';
const APP_SHELL = ['/admin/painel', '/admin/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

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
  // Só cuida de GET — chamadas de API (POST/PATCH/etc.) sempre vão direto
  // pra rede, nunca passam por cache.
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
