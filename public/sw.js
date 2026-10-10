// Service worker : app shell en cache, réseau pour l'API, notifications push.
const CACHE = 'assistant-v22';
const CACHE_PARTAGE = 'partage';
const CLE_PARTAGE = '/partage/attente';
const SHELL = ['/app', '/login', '/styles.css', '/app.js', '/conversation.js', '/taches.html', '/outils.html', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Menu « Partager » (Android, ordinateur) : le formulaire est mis de côté dans le Cache API, puis l'app l'envoie comme un message.
async function recevoirPartage(request) {
  const form = await request.formData();
  const cache = await caches.open(CACHE_PARTAGE);
  await cache.put(CLE_PARTAGE, new Response(form));
  return Response.redirect('/app?partage=1', 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/partage') { event.respondWith(recevoirPartage(event.request)); return; }
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

// Relais d'une notification aux pages ouvertes : en mode voiture, l'app la lit à voix haute (ignorée sinon).
async function relayerNotification(m) {
  const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const w of fenetres) w.postMessage({ type: 'notification', titre: m.titre || 'Assistant', corps: m.corps || '', url: m.url || '/app' });
}

self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = {}; }
  event.waitUntil(Promise.all([
    self.registration.showNotification(m.titre || 'Assistant', {
      body: m.corps || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: m.tag || 'assistant',
      data: { url: m.url || '/app' },
    }),
    relayerNotification(m).catch(() => {}),
  ]));
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
