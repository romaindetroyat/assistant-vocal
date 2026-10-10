// Service worker : app shell en cache, réseau pour l'API, notifications push.
const CACHE = 'assistant-v10';
const SHELL = ['/app', '/login', '/styles.css', '/app.js', '/conversation.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // Réseau d'abord, cache en secours (l'app reste ouvrable hors ligne).
  event.respondWith(
    fetch(event.request)
      .then((reponse) => {
        if (reponse.ok && url.origin === location.origin) {
          const copie = reponse.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match('/app'))),
  );
});

self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = {}; }
  event.waitUntil(
    self.registration.showNotification(m.titre || 'Assistant', {
      body: m.corps || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: m.tag || 'assistant',
      data: { url: m.url || '/app' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      const existante = fenetres.find((w) => 'focus' in w);
      return existante ? existante.focus() : self.clients.openWindow(url);
    }),
  );
});
