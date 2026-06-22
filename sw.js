// TradeOS Service Worker v12
// Maneja: caché offline, notificaciones push, sincronización en segundo plano

const CACHE_NAME = 'tradeos-v12';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ══════════════════════════════════════════
// INSTALL — pre-cachea los archivos base
// ══════════════════════════════════════════
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_URLS);
    }).then(function() {
      return self.skipWaiting(); // activa inmediatamente sin esperar
    })
  );
});

// ══════════════════════════════════════════
// ACTIVATE — limpia cachés viejos
// ══════════════════════════════════════════
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim(); // toma control de todas las pestañas abiertas
    })
  );
});

// ══════════════════════════════════════════
// FETCH — sirve desde caché, actualiza en segundo plano
// Estrategia: Network first → Cache fallback
// ══════════════════════════════════════════
self.addEventListener('fetch', function(e) {
  // Solo intercepta requests del mismo origen
  if (!e.request.url.startsWith(self.location.origin)) return;
  // No intercepta Supabase API calls
  if (e.request.url.includes('supabase.co')) return;

  e.respondWith(
    fetch(e.request)
      .then(function(res) {
        // Si la red responde, actualiza la caché
        if (res && res.status === 200) {
          var resClone = res.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, resClone);
          });
        }
        return res;
      })
      .catch(function() {
        // Sin red: sirve desde caché
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
  );
});

// ══════════════════════════════════════════
// PUSH — recibe notificación del servidor
// ══════════════════════════════════════════
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}

  var title   = data.title   || 'TradeOS';
  var body    = data.body    || 'Tienes una alerta nueva';
  var tag     = data.tag     || 'tradeos-default';
  var url     = data.url     || '/';
  var icon    = data.icon    || '/icon-192.png';
  var badge   = data.badge   || '/icon-96.png';

  e.waitUntil(
    self.registration.showNotification(title, {
      body:    body,
      tag:     tag,
      icon:    icon,
      badge:   badge,
      vibrate: [200, 100, 200],
      data:    { url: url },
      actions: [
        { action: 'open',    title: 'Ver en TradeOS' },
        { action: 'dismiss', title: 'Cerrar' }
      ]
    })
  );
});

// ══════════════════════════════════════════
// NOTIFICATIONCLICK — abre la app al tocar
// ══════════════════════════════════════════
self.addEventListener('notificationclick', function(e) {
  e.notification.close();

  if (e.action === 'dismiss') return;

  var targetUrl = (e.notification.data && e.notification.data.url) || '/';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clients) {
        // Si la app ya está abierta, la enfoca
        for (var i = 0; i < clients.length; i++) {
          if (clients[i].url.includes(self.location.origin)) {
            clients[i].focus();
            clients[i].postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
            return;
          }
        }
        // Si no está abierta, la abre
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ══════════════════════════════════════════
// SYNC — ejecuta tareas pendientes cuando hay red
// ══════════════════════════════════════════
self.addEventListener('sync', function(e) {
  if (e.tag === 'tradeos-sync') {
    e.waitUntil(
      // Le avisa a la app que hay conexión disponible para reintentar
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'ONLINE_SYNC' });
        });
      })
    );
  }
});

// ══════════════════════════════════════════
// NOTIFICACIONES PROGRAMADAS (via postMessage)
// La app puede pedirle al SW que programe alertas
// ══════════════════════════════════════════
self.addEventListener('message', function(e) {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_NOTIFICATION') {
    var delay   = e.data.delay   || 0;   // ms desde ahora
    var title   = e.data.title   || 'TradeOS';
    var body    = e.data.body    || '';
    var tag     = e.data.tag     || 'scheduled-' + Date.now();

    if (delay <= 0) {
      // Notificación inmediata
      self.registration.showNotification(title, {
        body:    body,
        tag:     tag,
        icon:    '/icon-192.png',
        badge:   '/icon-96.png',
        vibrate: [200, 100, 200],
        data:    { url: '/' }
      });
    } else {
      // Notificación con retraso usando setTimeout
      setTimeout(function() {
        self.registration.showNotification(title, {
          body:    body,
          tag:     tag,
          icon:    '/icon-192.png',
          badge:   '/icon-96.png',
          vibrate: [200, 100, 200],
          data:    { url: '/' }
        });
      }, delay);
    }
  }

  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
