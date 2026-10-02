const CACHE_NAME = 'apex-core-v1';
const DB_NAME = 'ApexOfflineDB';
const STORE_NAME = 'pending_mutations';

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

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_USER_MODULES') {
    const urlsToCache = event.data.urls || [];
    const coreFiles = ['./', './index.html'];
    const allFiles = Array.from(new Set([...coreFiles, ...urlsToCache]));

    caches.open(CACHE_NAME).then((cache) => {
      cache.addAll(allFiles).catch(err => console.log('Error cacheando módulos:', err));
    });
  }
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  if (url.includes('supabase.co')) {
    if (event.request.method === 'GET') {
      event.respondWith(
        fetch(event.request).catch(() => new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }))
      );
      return;
    }

    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request);
        } catch (err) {
          try {
            const clonedReq = event.request.clone();
            let bodyData = {};
            try {
              bodyData = await clonedReq.json();
            } catch (e) {}

            const parts = url.split('/rest/v1/');
            let tableName = 'unknown_table';
            if (parts.length > 1) {
              tableName = parts[1].split('?')[0];
            }

            const method = event.request.method;
            
            // Garantizar que si es un array lo aplanemos para inserción limpia
            let cleanPayload = Array.isArray(bodyData) ? bodyData[0] : bodyData;

            await enqueueInSW({
              type: 'insert',
              table: tableName,
              payload: cleanPayload,
              method: method,
              url: url
            });
            console.log('[SW] Check-in / Mutación capturada y guardada en cola offline:', tableName, cleanPayload);
          } catch (dbErr) {
            console.error('[SW] Error encolando en IndexedDB:', dbErr);
          }

          return new Response(JSON.stringify({ success: true, offline_queued: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
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
        return caches.match('./index.html');
      });
    })
  );
});
