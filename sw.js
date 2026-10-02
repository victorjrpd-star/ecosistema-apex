const CACHE_NAME = 'apex-core-v1';
const DB_NAME = 'ApexOfflineDB';
const STORE_NAME = 'pending_mutations';

// Helper para encolar mutaciones directamente desde el Service Worker (IndexedDB compartida)
function enqueueInSW(mutation) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      mutation.client_timestamp = new Date().toISOString();
      mutation.uuid = mutation.uuid || crypto.randomUUID();
      store.add(mutation);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

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
    const coreFiles = ['./', './index.html'];
    const allFiles = Array.from(new Set([...coreFiles, ...urlsToCache]));

    caches.open(CACHE_NAME).then((cache) => {
      cache.addAll(allFiles).catch(err => console.log('Error cacheando módulos del rol:', err));
    });
  }
});

// Interceptar peticiones para servir contenido offline y respaldar transacciones de Supabase
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Interceptar llamadas a Supabase
  if (url.includes('supabase.co')) {
    // Si es una consulta GET, intentar red y respaldar con datos vacíos si falla
    if (event.request.method === 'GET') {
      event.respondWith(
        fetch(event.request).catch(() => new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }))
      );
      return;
    }

    // Si es una mutación (POST, PATCH, PUT, DELETE)
    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request);
        } catch (err) {
          // Si falla por falta de red, capturamos el cuerpo y lo guardamos localmente en IndexedDB
          try {
            const clonedReq = event.request.clone();
            let bodyData = {};
            try {
              bodyData = await clonedReq.json();
            } catch (e) {}

            // Extraer el nombre de la tabla desde la URL de Supabase (ej: .../rest/v1/apex_checkins...)
            const parts = url.split('/rest/v1/');
            let tableName = 'unknown_table';
            if (parts.length > 1) {
              tableName = parts[1].split('?')[0];
            }

            const method = event.request.method;
            await enqueueInSW({
              type: (method === 'PUT' || method === 'PATCH') ? 'update' : 'insert',
              table: tableName,
              payload: bodyData,
              method: method,
              url: url
            });
            console.log('[SW] Operación interceptada y guardada en cola offline:', tableName);
          } catch (dbErr) {
            console.error('[SW] Error guardando mutación offline en IndexedDB:', dbErr);
          }

          // Retornar éxito simulado para evitar el error "Failed to fetch" en la interfaz
          return new Response(JSON.stringify({ success: true, offline_queued: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    return;
  }

  // Peticiones estándar de archivos estáticos
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        return networkResponse;
      }).catch(() => {
        return caches.match('./index.html');
      });
    })
  );
});
