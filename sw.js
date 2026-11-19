// Garde l'appli et le moteur vidéo en mémoire pour qu'elle marche hors ligne.
const CACHE = "ia-montage-v2";
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

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      // garde aussi le modèle de détourage une fois téléchargé
      if (r.ok && (e.request.url.startsWith(self.location.origin) || /jsdelivr|staticimgly/.test(e.request.url))) {
        const copie = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
      }
      return r;
    }))
  );
});
