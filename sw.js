// 7th Clare Scouts service worker: offline shell + last-known content
const VERSION = "v0_35";
const SHELL = ["./", "./index.html", "./calendar.html", "./defaults.js", "./kit-defaults.js", "./logo.png", "./icon-192.png", "./icon-512.png", "./manifest.webmanifest", "./docs/Sionnach_Tips.pdf"];
const SHELL_CACHE = "shell-" + VERSION, DATA_CACHE = "data-" + VERSION, FONT_CACHE = "fonts";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL_CACHE, DATA_CACHE, FONT_CACHE].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Content API: network first, fall back to last saved copy
  if (url.pathname.includes("/.netlify/functions/content")) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(DATA_CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || new Response(JSON.stringify({empty:true}), {headers:{"Content-Type":"application/json"}}))));
    return;
  }
  // Fonts: cache as they arrive
  if (url.hostname.includes("fonts.g")) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy = res.clone(); caches.open(FONT_CACHE).then(c => c.put(e.request, copy)); return res; }).catch(() => r)));
    return;
  }
  // The rota function: leaders' data is never cached, so a lab page always
  // reads live and nothing private sits in a cache. The one public read, the
  // badge board, is network first with the last copy as fallback, so a section
  // page still shows a board when there is no signal.
  if (url.pathname.includes("/.netlify/functions/rota")) {
    if (url.searchParams.get("a") !== "board") return;
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(DATA_CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request)));
    return;
  }
  // lab/ is for experiments and is deliberately not part of the app: never
  // cached, so a push shows up on the very next load rather than one late.
  if (url.origin === location.origin && url.pathname.startsWith("/lab/")) return;
  // Same-origin shell: stale-while-revalidate
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then(c => c.put(e.request, copy)); } return res; }).catch(() => cached);
      return cached || net;
    }));
  }
});
