const CACHE_NAME = 'apex-core-v1';

// Instalación del Service Worker
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activación y limpieza de cachés antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Escuchar los módulos específicos enviados dinámicamente desde el index.html según el rol
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_USER_MODULES') {
    const urlsToCache = event.data.urls || [];
    // Incluir siempre el núcleo principal y los recursos base
    const coreFiles = ['./', './index.html'];
    const allFiles = Array.from(new Set([...coreFiles, ...urlsToCache]));

    caches.open(CACHE_NAME).then((cache) => {
      cache.addAll(allFiles).catch(err => console.log('Error cacheando módulos del rol:', err));
    });
  }
});

// Interceptar peticiones para servir contenido offline
self.addEventListener('fetch', (event) => {
  // Omitir peticiones a Supabase u APIs externas para que manejen su propia red/cola
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        return networkResponse;
      }).catch(() => {
        // Fallback genérico si no hay red ni caché para recursos estáticos
        return caches.match('./index.html');
      });
    })
  );
});