const C = 'tk-spacemap-v4', PANO = 'tk-spacemap-pano',
      SHELL = ['./', 'index.html', 'style.css', 'script.js', 'app.js', 'manifest.webmanifest', 'icon.svg'],
      VENDOR = ['embed', 'vendor/three.min.js', 'vendor/fonts.css'];


self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(C);
  await Promise.allSettled(SHELL.concat(VENDOR).map(u => c.add(u)));
  
  try { 
    const css = await (await c.match('vendor/fonts.css')).text(), 
          base = new URL('vendor/fonts.css', self.registration.scope);
    await Promise.allSettled([...css.matchAll(/url\(([^)]+)\)/g)].map(m => c.add(new URL(m[1].replace(/['"]/g, ''), base).href)));
  } catch {} 
  
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(k => Promise.all(k.filter(x => x != C && x != PANO).map(x => caches.delete(x))))
    .then(() => clients.claim())
));

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method != 'GET') return;

  if (u.hostname.endsWith('.supabase.co') && u.pathname.includes('/storage/v1/object/public/')) {
    e.respondWith(caches.open(PANO).then(async c => {
      const hit = await c.match(r);
      if (hit) return hit;

      const res = await fetch(r);
      if (res.ok) c.put(r, res.clone());
      return res;
    }));
    return;
  }

  if (u.origin != location.origin || u.pathname.startsWith('/api')) return;

  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const k = res.clone(); caches.open(C).then(c => c.put(r, k)); }
      return res;
    }).catch(async () => 
      (await caches.match(r, { ignoreSearch: true })) 
      || (r.mode == 'navigate' ? caches.match('index.html') : Response.error())
    )
  );
});