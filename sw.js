const CACHE = 'champagne-stock-v11';
const ASSETS = ['index.html', 'style.css', 'app.js', 'qrcode.min.js', 'supabase-config.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function isCore(url) {
  return url.endsWith('index.html') || url.endsWith('style.css') ||
         url.endsWith('app.js') || url.endsWith('supabase-config.js');
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Jamais mettre en cache les API Supabase (les données doivent rester fraîches)
  if (url.hostname.includes('supabase.co')) return;

  // Fichiers "cœur" : réseau d'abord (toujours la dernière version en ligne),
  // puis le cache si hors connexion.
  if (isCore(url.pathname)) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html')))
    );
    return;
  }

  // Autres ressources (images, manifest...) : cache d'abord.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('index.html')))
  );
});