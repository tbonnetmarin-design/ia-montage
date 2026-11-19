// Garde l'appli et le moteur vidéo en mémoire pour qu'elle marche hors ligne.
// L'interface (html/css/js de l'appli) est prise en ligne en priorité → les mises à jour arrivent toutes seules.
// Le moteur vidéo (lib/, 32 Mo) reste en cache → pas re-téléchargé.
const CACHE = "ia-montage-v4";
const FICHIERS = [
  "./", "index.html", "style.css", "app.js", "manifest.json", "icon-512.png",
  "lib/ffmpeg/index.js", "lib/ffmpeg/classes.js", "lib/ffmpeg/const.js", "lib/ffmpeg/errors.js",
  "lib/ffmpeg/types.js", "lib/ffmpeg/utils.js", "lib/ffmpeg/worker.js", "lib/ffmpeg/empty.mjs",
  "lib/core/ffmpeg-core.js", "lib/core/ffmpeg-core.wasm",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const garder = (req, r) => {
  if (r && r.ok) { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
  return r;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const memeSite = url.origin === self.location.origin;
  const lourd = memeSite && url.pathname.includes("/lib/");
  if (memeSite && !lourd) {
    // réseau d'abord, cache si hors ligne
    e.respondWith(fetch(req).then((r) => garder(req, r)).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // moteur + modèle de détourage : cache d'abord
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) =>
    (lourd || /jsdelivr|staticimgly/.test(req.url)) ? garder(req, r) : r)));
});
