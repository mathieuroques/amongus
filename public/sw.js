// Service worker volontairement simple :
// - l'interface (HTML/JS/CSS/icônes) est mise en cache pour un chargement rapide et l'installation ;
// - les requêtes /api (serveur de jeu) ne passent JAMAIS par le cache : une action de jeu
//   n'est considérée comme faite que si le serveur l'a confirmée.
const CACHE = 'imposteurs-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    // réseau d'abord (pour obtenir les mises à jour), cache en secours
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return r;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    // fichiers versionnés : cache d'abord
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((r) => {
            if (r.ok) {
              const copy = r.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return r;
          }),
      ),
    );
  }
});

// --- Notifications push (téléphone en veille) ---------------------------------------
// Le contenu est chiffré de bout en bout ; il ne contient que des informations publiques.
self.addEventListener('push', (e) => {
  let msg = { title: 'Imposteurs', body: 'Nouvel événement dans la partie.', tag: 'jeu', urgent: false };
  try {
    msg = { ...msg, ...e.data.json() };
  } catch {
    /* message vide */
  }
  e.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      renotify: true,
      requireInteraction: !!msg.urgent,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: msg.urgent ? [500, 150, 500, 150, 500] : [200, 100, 200],
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    }),
  );
});
