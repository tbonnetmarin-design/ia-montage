// Mon IA Montage — tout tourne dans le navigateur du téléphone (ffmpeg.wasm + canvas).
import { FFmpeg } from "./lib/ffmpeg/index.js";

const $ = (s) => document.querySelector(s);
const BASE = new URL(".", location.href).href;

let fichier = null;      // File en cours (entrée)
let resultat = null;     // { blob, nom }
let actionChoisie = null;
let ffmpeg = null;
let logs = [];

// ---------- service worker (hors ligne) ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- actions ----------
const ACTIONS = {
  photo: [
    { id: "tiktok", titre: "Format TikTok", desc: "Vertical 9:16, fond flou" },
    { id: "fond", titre: "Enlever le fond", desc: "PNG détouré (internet la 1re fois)" },
    { id: "accroche", titre: "Texte d'accroche", desc: "Gros texte en haut" },
    { id: "filtre", titre: "Filtres", desc: "N&B, vintage, vif…" },
    { id: "rotation", titre: "Tourner / miroir", desc: "90°, 180°, miroir" },
    { id: "compresser", titre: "Alléger", desc: "Fichier plus léger" },
  ],
  photos: [
    { id: "diaporama", titre: "Diaporama", desc: "Vidéo TikTok avec tes photos" },
  ],
  videos: [
    { id: "assembler", titre: "Assembler", desc: "Mettre les vidéos bout à bout" },
  ],
  video: [
    { id: "tiktok", titre: "Format TikTok", desc: "Vertical 9:16, fond flou" },
    { id: "couper", titre: "Couper", desc: "Garder un passage" },
    { id: "blancs", titre: "Couper les blancs", desc: "Enlève les silences" },
    { id: "accroche", titre: "Texte d'accroche", desc: "Gros texte en haut" },
    { id: "musique", titre: "Ajouter une musique", desc: "Musique de fond" },
    { id: "vitesse", titre: "Vitesse", desc: "Ralenti ou accéléré" },
    { id: "filtre", titre: "Filtres", desc: "N&B, vintage, vif…" },
    { id: "rotation", titre: "Tourner / miroir", desc: "90°, 180°, miroir" },
    { id: "son", titre: "Son", desc: "Couper le son / garder l'audio" },
    { id: "inverser", titre: "Rembobiner", desc: "Lecture à l'envers (10 s)" },
    { id: "compresser", titre: "Alléger", desc: "Vidéo plus légère" },
    { id: "gif", titre: "En GIF", desc: "15 s max" },
  ],
};

const estVideo = (f) => f && f.type.startsWith("video");
let fichiers = [];       // tous les fichiers choisis (assembler / diaporama)

const FILTRES = {
  vif:      { nom: "Vif",            ff: "eq=saturation=1.45:contrast=1.08",           css: "saturate(1.45) contrast(1.08)" },
  nb:       { nom: "Noir & blanc",   ff: "hue=s=0,eq=contrast=1.1",                    css: "grayscale(1) contrast(1.1)" },
  vintage:  { nom: "Vintage",        ff: "curves=preset=vintage",                      css: "sepia(0.45) contrast(1.05) saturate(0.9)" },
  chaud:    { nom: "Chaud (été)",    ff: "colorbalance=rs=0.12:gs=0.03:bs=-0.12",     css: "sepia(0.2) saturate(1.25) hue-rotate(-8deg)" },
  froid:    { nom: "Froid (hiver)",  ff: "colorbalance=rs=-0.1:bs=0.14",              css: "saturate(1.1) hue-rotate(12deg) brightness(1.03)" },
  lumineux: { nom: "Plus lumineux",  ff: "eq=brightness=0.07:contrast=1.06",          css: "brightness(1.15) contrast(1.05)" },
  cine:     { nom: "Cinéma",         ff: "eq=contrast=1.15:saturation=0.85,vignette", css: "contrast(1.15) saturate(0.85)" },
};

function choix(id, titre, options, defaut) {
  return `<label>${titre}<select id="${id}" class="select">${options.map(([v, t]) =>
    `<option value="${v}"${v === defaut ? " selected" : ""}>${t}</option>`).join("")}</select></label>`;
}

// ---------- étape 1 : choix du fichier ----------
$("#fichier").addEventListener("change", (e) => {
  const fs = [...e.target.files];
  if (fs.length) chargerEntree(fs);
  e.target.value = "";
});

function chargerEntree(entree) {
  fichiers = Array.isArray(entree) ? entree : [entree];
  const f = fichiers[0];
  fichier = f;
  resultat = null;
  actionChoisie = null;
  let liste;
  if (fichiers.length > 1) {
    const tousVideos = fichiers.every(estVideo), toutesPhotos = fichiers.every((x) => !estVideo(x));
    liste = tousVideos ? ACTIONS.videos : toutesPhotos ? ACTIONS.photos : [];
    $("#apercu-entree").innerHTML = `<div class="info">${fichiers.length} fichiers choisis${liste.length ? "" :
      " — mélange photos + vidéos impossible, choisis que des photos ou que des vidéos"}</div>`;
  } else {
    afficherApercu($("#apercu-entree"), f);
    liste = ACTIONS[estVideo(f) ? "video" : "photo"];
  }
  $("#actions").innerHTML = "";
  for (const a of liste) {
    const b = document.createElement("button");
    b.className = "action";
    b.innerHTML = `<b>${a.titre}</b><small>${a.desc}</small>`;
    b.onclick = () => choisirAction(a.id, b);
    $("#actions").appendChild(b);
  }
  $("#options").innerHTML = "";
  $("#carte-actions").hidden = false;
  $("#carte-go").hidden = true;
  $("#carte-resultat").hidden = true;
  $("#carte-actions").scrollIntoView({ behavior: "smooth" });
}

function afficherApercu(zone, blob, transparent = false) {
  const url = URL.createObjectURL(blob);
  const taille = (blob.size / 1024 / 1024).toFixed(1) + " Mo";
  if (blob.type.startsWith("audio")) {
    zone.innerHTML = `<audio src="${url}" controls style="width:100%"></audio><div class="info">${taille}</div>`;
  } else if (blob.type.startsWith("video")) {
    zone.innerHTML = `<video src="${url}" controls playsinline></video><div class="info">${taille}</div>`;
  } else {
    zone.innerHTML = `<img src="${url}" class="${transparent ? "damier" : ""}" alt=""><div class="info">${taille}</div>`;
  }
}

// ---------- étape 2 : options ----------
function choisirAction(id, bouton) {
  actionChoisie = id;
  document.querySelectorAll(".action").forEach((b) => b.classList.remove("choisie"));
  bouton.classList.add("choisie");
  const o = $("#options");
  o.innerHTML = "";
  if (id === "couper") {
    o.innerHTML = `
      <label>Début (en secondes)<input id="o-debut" type="number" inputmode="decimal" value="0" min="0" step="0.5"></label>
      <label>Fin (en secondes, vide = jusqu'à la fin)<input id="o-fin" type="number" inputmode="decimal" min="0" step="0.5"></label>`;
  } else if (id === "accroche") {
    o.innerHTML = `
      <label>Ton texte<input id="o-texte" type="text" placeholder="3 astuces que personne ne connaît 🤯"></label>` +
      (estVideo(fichier) ? `<label>Affiché pendant (secondes, vide = toute la vidéo)<input id="o-duree" type="number" inputmode="decimal" min="0" step="0.5"></label>` : "");
  } else if (id === "musique") {
    o.innerHTML = `
      <label class="bouton" for="o-son">🎵 Choisir la musique (mp3, m4a…)</label>
      <input id="o-son" type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" hidden>
      <div id="o-son-nom" class="info"></div>
      <label>Volume de la musique : <span id="o-vol-val">25</span> %<input id="o-vol" type="range" min="5" max="100" value="25"></label>`;
    $("#o-son").onchange = (e) => ($("#o-son-nom").textContent = e.target.files[0] ? "✓ " + e.target.files[0].name : "");
    $("#o-vol").oninput = (e) => ($("#o-vol-val").textContent = e.target.value);
  } else if (id === "vitesse") {
    o.innerHTML = choix("o-vitesse", "Vitesse", [["0.5", "Ralenti ×0,5"], ["0.75", "×0,75"], ["1.5", "Accéléré ×1,5"], ["2", "×2"], ["3", "×3"]], "2");
  } else if (id === "filtre") {
    o.innerHTML = choix("o-filtre", "Filtre", Object.entries(FILTRES).map(([k, v]) => [k, v.nom]), "vif");
  } else if (id === "rotation") {
    o.innerHTML = choix("o-rot", "Sens", [["droite", "↻ 90° à droite"], ["gauche", "↺ 90° à gauche"], ["180", "180°"], ["miroir", "⇋ Miroir"]], "droite");
  } else if (id === "son") {
    o.innerHTML = choix("o-son-mode", "Quoi ?", [["muet", "Couper le son de la vidéo"], ["audio", "Garder seulement le son (fichier audio)"]], "muet");
  } else if (id === "diaporama") {
    o.innerHTML = `<label>Durée de chaque photo (secondes)<input id="o-par" type="number" inputmode="decimal" value="2.5" min="0.5" step="0.5"></label>
      <div class="info">Astuce : ensuite « Continuer à modifier » → « Ajouter une musique ».</div>`;
  }
  $("#carte-go").hidden = false;
}

// ---------- étape 3 : lancer ----------
$("#go").addEventListener("click", async () => {
  if (!fichier || !actionChoisie) return;
  $("#go").disabled = true;
  $("#progression").hidden = false;
  progres(0, "Préparation…");
  try {
    resultat = await executer(actionChoisie, fichier);
    afficherApercu($("#apercu-sortie"), resultat.blob, actionChoisie === "fond");
    $("#carte-resultat").hidden = false;
    $("#carte-resultat").scrollIntoView({ behavior: "smooth" });
    progres(1, "Terminé ✓");
  } catch (err) {
    console.error(err);
    if (ffmpeg && !/Écris|Choisis|Aucun silence/.test(err.message || "")) {
      try { ffmpeg.terminate(); } catch {}
      ffmpeg = null;
    }
    progres(0, "❌ " + (err.message || err));
  } finally {
    $("#go").disabled = false;
  }
});

function progres(p, texte) {
  $("#barre-int").style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + "%";
  if (texte) $("#statut").textContent = texte;
}

// ---------- étape 4 : résultat ----------
$("#enregistrer").addEventListener("click", async () => {
  if (!resultat) return;
  const f = new File([resultat.blob], resultat.nom, { type: resultat.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f] }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(f);
  a.download = resultat.nom;
  a.click();
});
$("#enchainer").addEventListener("click", () => {
  if (resultat) chargerEntree(new File([resultat.blob], resultat.nom, { type: resultat.blob.type }));
});
$("#recommencer").addEventListener("click", () => $("#fichier").click());

// ---------- moteur ----------
function nomSortie(suffixe, ext) {
  const base = (fichier.name || "fichier").replace(/\.[^.]+$/, "");
  return `${base}-${suffixe}.${ext}`;
}

async function executer(action, f) {
  if (action === "diaporama") return diaporama(fichiers);
  if (action === "assembler") return assembler(fichiers);
  if (!estVideo(f)) return executerPhoto(action, f);
  return executerVideo(action, f);
}

function canvasTikTok(img) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  c.width = 1080; c.height = 1920;
  const sCover = Math.max(1080 / img.width, 1920 / img.height);
  ctx.filter = "blur(40px)";
  ctx.drawImage(img, (1080 - img.width * sCover) / 2, (1920 - img.height * sCover) / 2, img.width * sCover, img.height * sCover);
  ctx.filter = "none";
  const s = Math.min(1080 / img.width, 1920 / img.height);
  ctx.drawImage(img, (1080 - img.width * s) / 2, (1920 - img.height * s) / 2, img.width * s, img.height * s);
  return c;
}

// ===== PHOTOS (canvas) =====
async function chargerImage(f) {
  const bmp = await createImageBitmap(f);
  return bmp;
}

function canvasEnBlob(c, type = "image/png", q) {
  return new Promise((ok) => c.toBlob(ok, type, q));
}

function dessinerAccroche(ctx, larg, haut, texte, position = "haut") {
  const taille = Math.max(18, Math.round(Math.min(haut / 16, larg / 11)));
  ctx.font = `800 ${taille}px -apple-system, "Segoe UI", Arial, sans-serif`;
  const max = larg * 0.88;
  const lignes = [];
  let ligne = "";
  for (const mot of texte.split(/\s+/).filter(Boolean)) {
    const essai = ligne ? ligne + " " + mot : mot;
    if (ctx.measureText(essai).width <= max || !ligne) ligne = essai;
    else { lignes.push(ligne); ligne = mot; }
  }
  if (ligne) lignes.push(ligne);
  const interligne = taille * 1.25, pad = taille * 0.5;
  const largBoite = Math.min(larg, Math.max(...lignes.map((l) => ctx.measureText(l).width)) + pad * 2);
  const hautBoite = lignes.length * interligne + pad * 1.4;
  const y0 = position === "bas" ? haut * 0.80 - hautBoite : position === "milieu" ? (haut - hautBoite) / 2 : haut * 0.08;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  const x0 = (larg - largBoite) / 2;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x0, y0, largBoite, hautBoite, taille * 0.35); ctx.fill(); }
  else ctx.fillRect(x0, y0, largBoite, hautBoite);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lignes.forEach((l, i) => ctx.fillText(l, larg / 2, y0 + pad * 0.7 + interligne * (i + 0.5)));
}

async function executerPhoto(action, f) {
  progres(0.2, "Je travaille sur ta photo…");
  if (action === "fond") {
    progres(0.2, "Détourage… (la 1re fois, téléchargement du modèle ~40 Mo)");
    const mod = await import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm");
    const blob = await mod.removeBackground(f, {
      progress: (k, cur, tot) => tot && progres(cur / tot, "Téléchargement du modèle… " + Math.round((cur / tot) * 100) + " %"),
    });
    return { blob, nom: nomSortie("sans-fond", "png") };
  }
  const img = await chargerImage(f);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (action === "tiktok") {
    return { blob: await canvasEnBlob(canvasTikTok(img), "image/jpeg", 0.92), nom: nomSortie("tiktok", "jpg") };
  }
  if (action === "filtre") {
    const k = $("#o-filtre").value;
    c.width = img.width; c.height = img.height;
    ctx.filter = FILTRES[k].css;
    ctx.drawImage(img, 0, 0);
    ctx.filter = "none";
    if (k === "cine") { // vignette douce
      const g = ctx.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.35,
        c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    }
    return { blob: await canvasEnBlob(c, "image/jpeg", 0.92), nom: nomSortie("filtre-" + k, "jpg") };
  }
  if (action === "rotation") {
    const r = $("#o-rot").value;
    const quart = r === "droite" || r === "gauche";
    c.width = quart ? img.height : img.width; c.height = quart ? img.width : img.height;
    ctx.translate(c.width / 2, c.height / 2);
    if (r === "droite") ctx.rotate(Math.PI / 2);
    else if (r === "gauche") ctx.rotate(-Math.PI / 2);
    else if (r === "180") ctx.rotate(Math.PI);
    else ctx.scale(-1, 1);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return { blob: await canvasEnBlob(c, "image/jpeg", 0.95), nom: nomSortie("tournee", "jpg") };
  }
  if (action === "accroche") {
    const texte = ($("#o-texte")?.value || "").trim();
    if (!texte) throw new Error("Écris d'abord ton texte.");
    c.width = img.width; c.height = img.height;
    ctx.drawImage(img, 0, 0);
    dessinerAccroche(ctx, c.width, c.height, texte);
    return { blob: await canvasEnBlob(c, "image/jpeg", 0.92), nom: nomSortie("accroche", "jpg") };
  }
  if (action === "compresser") {
    const s = Math.min(1, 1600 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { blob: await canvasEnBlob(c, "image/jpeg", 0.8), nom: nomSortie("leger", "jpg") };
  }
  throw new Error("Action inconnue");
}

// ===== VIDÉOS (ffmpeg.wasm) =====
async function chargerFFmpeg() {
  if (ffmpeg) return ffmpeg;
  progres(0.02, "Chargement du moteur vidéo (32 Mo la 1re fois, ensuite c'est gardé)…");
  ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => { logs.push(message); });
  ffmpeg.on("progress", ({ progress }) => {
    if (progress > 0 && progress <= 1) progres(progress, `Montage en cours… ${Math.round(progress * 100)} %`);
  });
  await ffmpeg.load({
    coreURL: BASE + "lib/core/ffmpeg-core.js",
    wasmURL: BASE + "lib/core/ffmpeg-core.wasm",
  });
  return ffmpeg;
}

async function lireFichier(f) {
  return new Uint8Array(await f.arrayBuffer());
}

async function infos(nom) {
  logs = [];
  await ffmpeg.exec(["-hide_banner", "-i", nom]); // échoue volontairement : on lit juste les infos
  const t = logs.join("\n");
  const d = t.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duree = d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : 0;
  const v = t.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const rot = t.match(/rotate\s*:\s*(-?\d+)|rotation of (-?[\d.]+)/);
  let larg = v ? +v[1] : 0, haut = v ? +v[2] : 0;
  const r = rot ? Math.abs(parseFloat(rot[1] ?? rot[2])) : 0;
  if (r === 90 || r === 270) [larg, haut] = [haut, larg];
  return { duree, larg, haut, son: /Audio:/.test(t) };
}

const X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p"];

async function executerVideo(action, f) {
  await chargerFFmpeg();
  const ext = (f.name.match(/\.([^.]+)$/) || [, "mp4"])[1].toLowerCase();
  progres(0.05, "Lecture de la vidéo…");
  // la vidéo est lue directement depuis le téléphone (pas copiée en mémoire) → marche avec les longues vidéos
  try { await ffmpeg.createDir("/in"); } catch {}
  try { await ffmpeg.unmount("/in"); } catch {}
  await ffmpeg.mount("WORKERFS", { files: [f] }, "/in");
  const entree = "/in/" + f.name;
  try {
    return await executerVideoSuite(action, f, entree, ext);
  } finally {
    if (ffmpeg) { try { await ffmpeg.unmount("/in"); } catch {} }
  }
}

async function executerVideoSuite(action, f, entree, ext) {
  const info = await infos(entree);
  progres(0.08, "Montage en cours…");

  let args, sortie = "sortie.mp4", type = "video/mp4", suffixe = action;
  const fichiersTemp = [entree];

  if (action === "tiktok") {
    const filtre = "[0:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=720:1280[bg];" +
      "[0:v]scale=720:1280:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2";
    args = ["-i", entree, "-filter_complex", filtre, ...X264, "-c:a", "aac", "-b:a", "128k", sortie];
  } else if (action === "couper") {
    const debut = parseFloat($("#o-debut").value) || 0;
    const fin = parseFloat($("#o-fin").value);
    args = ["-ss", String(debut), "-i", entree];
    if (fin > debut) args.push("-t", String(fin - debut));
    args.push(...X264, "-c:a", "aac", "-b:a", "128k", sortie);
  } else if (action === "compresser") {
    args = ["-i", entree, "-vf", "scale='min(720,iw)':-2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", sortie];
    suffixe = "leger";
  } else if (action === "gif") {
    sortie = "sortie.gif"; type = "image/gif";
    args = ["-t", "15", "-i", entree, "-vf",
      "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", sortie];
  } else if (action === "blancs") {
    progres(0.1, "Je cherche les silences…");
    logs = [];
    await ffmpeg.exec(["-i", entree, "-af", "silencedetect=noise=-35dB:d=0.5", "-vn", "-f", "null", "-"]);
    const t = logs.join("\n");
    const debuts = [...t.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
    const fins = [...t.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
    if (!debuts.length) throw new Error("Aucun silence trouvé dans cette vidéo.");
    const marge = 0.15, garder = [];
    let cur = 0;
    debuts.forEach((d, i) => {
      const e = fins[i] ?? info.duree;
      if (d + marge > cur) garder.push([cur, d + marge]);
      cur = Math.max(cur, e - marge);
    });
    if (cur < info.duree) garder.push([cur, info.duree]);
    const expr = garder.filter(([a, b]) => b - a > 0.05).map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
    args = ["-i", entree, "-vf", `select='${expr}',setpts=N/FRAME_RATE/TB`, "-af", `aselect='${expr}',asetpts=N/SR/TB`,
      ...X264, "-c:a", "aac", "-b:a", "128k", sortie];
    suffixe = "sans-blancs";
  } else if (action === "accroche") {
    const texte = ($("#o-texte")?.value || "").trim();
    if (!texte) throw new Error("Écris d'abord ton texte.");
    const duree = parseFloat($("#o-duree")?.value);
    const c = document.createElement("canvas");
    c.width = info.larg || 1080; c.height = info.haut || 1920;
    dessinerAccroche(c.getContext("2d"), c.width, c.height, texte);
    await ffmpeg.writeFile("texte.png", new Uint8Array(await (await canvasEnBlob(c)).arrayBuffer()));
    fichiersTemp.push("texte.png");
    const quand = duree > 0 ? `:enable='lt(t,${duree})'` : "";
    args = ["-i", entree, "-i", "texte.png", "-filter_complex", `[0:v][1:v]overlay=0:0${quand}`,
      ...X264, "-c:a", "copy", sortie];
  } else if (action === "musique") {
    const son = $("#o-son")?.files?.[0];
    if (!son) throw new Error("Choisis d'abord une musique.");
    const vol = (+$("#o-vol").value || 25) / 100;
    const extSon = (son.name.match(/\.([^.]+)$/) || [, "mp3"])[1].toLowerCase();
    await ffmpeg.writeFile("son." + extSon, await lireFichier(son));
    fichiersTemp.push("son." + extSon);
    const fondu = `afade=t=out:st=${Math.max(info.duree - 2, 0).toFixed(2)}:d=2`;
    const filtre = info.son
      ? `[1:a]volume=${vol},${fondu}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
      : `[1:a]volume=${Math.max(vol, 0.8)},${fondu}[a]`;
    args = ["-i", entree, "-stream_loop", "-1", "-i", "son." + extSon, "-filter_complex", filtre,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", info.duree.toFixed(2), sortie];
  } else if (action === "vitesse") {
    const v = parseFloat($("#o-vitesse").value) || 2;
    const atempo = [];
    let reste = v;
    while (reste > 2) { atempo.push("atempo=2"); reste /= 2; }
    while (reste < 0.5) { atempo.push("atempo=0.5"); reste /= 0.5; }
    atempo.push(`atempo=${reste.toFixed(4)}`);
    args = ["-i", entree, "-vf", `setpts=PTS/${v}`, ...X264];
    if (info.son) args.push("-af", atempo.join(","), "-c:a", "aac", "-b:a", "128k");
    else args.push("-an");
    args.push(sortie);
    suffixe = "x" + v;
  } else if (action === "filtre") {
    const k = $("#o-filtre").value;
    args = ["-i", entree, "-vf", FILTRES[k].ff, ...X264, "-c:a", "copy", sortie];
    suffixe = "filtre-" + k;
  } else if (action === "rotation") {
    const r = $("#o-rot").value;
    const vf = { droite: "transpose=1", gauche: "transpose=2", "180": "transpose=1,transpose=1", miroir: "hflip" }[r];
    args = ["-i", entree, "-vf", vf, ...X264, "-c:a", "copy", sortie];
    suffixe = "tournee";
  } else if (action === "son") {
    if ($("#o-son-mode").value === "audio") {
      if (!info.son) throw new Error("Cette vidéo n'a pas de son.");
      sortie = "sortie.m4a"; type = "audio/mp4"; suffixe = "audio";
      args = ["-i", entree, "-vn", "-c:a", "aac", "-b:a", "192k", sortie];
    } else {
      args = ["-i", entree, "-an", "-c:v", "copy", sortie];
      suffixe = "muet";
    }
  } else if (action === "inverser") {
    args = ["-t", "10", "-i", entree, "-vf", "reverse", ...X264];
    if (info.son) args.push("-af", "areverse", "-c:a", "aac"); else args.push("-an");
    args.push(sortie);
    suffixe = "rembobine";
  } else {
    throw new Error("Action inconnue");
  }

  logs = [];
  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    console.warn(logs.slice(-20).join("\n"));
    // après un plantage le moteur peut être inutilisable : on le recharge au prochain essai
    try { ffmpeg.terminate(); } catch {}
    ffmpeg = null;
    throw new Error("Le montage a échoué. Vidéo trop longue ou abîmée ? Essaie « Couper » ou « Alléger » d'abord.");
  }
  const data = await ffmpeg.readFile(sortie);
  for (const n of [...fichiersTemp, sortie]) { try { await ffmpeg.deleteFile(n); } catch {} }
  const ext2 = sortie.split(".").pop();
  return { blob: new Blob([data.buffer], { type }), nom: nomSortie(suffixe, ext2) };
}

// ===== PLUSIEURS FICHIERS =====
async function lancerFF(args, sortie, temp) {
  logs = [];
  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    console.warn(logs.slice(-20).join("\n"));
    try { ffmpeg.terminate(); } catch {}
    ffmpeg = null;
    throw new Error("Le montage a échoué. Essaie avec moins de fichiers ou des vidéos plus courtes.");
  }
  const data = await ffmpeg.readFile(sortie);
  for (const n of [...temp, sortie]) { try { await ffmpeg.deleteFile(n); } catch {} }
  return data;
}

async function diaporama(liste) {
  await chargerFFmpeg();
  const par = Math.max(0.5, parseFloat($("#o-par")?.value) || 2.5);
  const temp = [];
  for (let i = 0; i < liste.length; i++) {
    progres(0.05 + 0.3 * (i / liste.length), `Préparation des photos… ${i + 1}/${liste.length}`);
    const c = canvasTikTok(await chargerImage(liste[i]));
    const n = `img${String(i + 1).padStart(3, "0")}.jpg`;
    await ffmpeg.writeFile(n, new Uint8Array(await (await canvasEnBlob(c, "image/jpeg", 0.9)).arrayBuffer()));
    temp.push(n);
  }
  progres(0.4, "Création de la vidéo…");
  const data = await lancerFF(["-framerate", `1/${par}`, "-i", "img%03d.jpg", "-vf", "scale=1080:1920,fps=30",
    ...X264, "sortie.mp4"], "sortie.mp4", temp);
  return { blob: new Blob([data.buffer], { type: "video/mp4" }), nom: nomSortie("diaporama", "mp4") };
}

async function assembler(liste) {
  await chargerFFmpeg();
  const temp = [], infosV = [];
  for (let i = 0; i < liste.length; i++) {
    progres(0.03 + 0.1 * (i / liste.length), `Lecture des vidéos… ${i + 1}/${liste.length}`);
    const ext = (liste[i].name.match(/\.([^.]+)$/) || [, "mp4"])[1].toLowerCase();
    const n = `v${i}.${ext}`;
    await ffmpeg.writeFile(n, await lireFichier(liste[i]));
    temp.push(n);
    infosV.push(await infos(n));
  }
  // format de la 1re vidéo, en pair
  let L = infosV[0].larg || 720, H = infosV[0].haut || 1280;
  const s = Math.min(1, 1280 / Math.max(L, H));
  L = Math.round((L * s) / 2) * 2; H = Math.round((H * s) / 2) * 2;
  const args = [];
  temp.forEach((n) => args.push("-i", n));
  let parts = "", entrees = "", silence = liste.length;
  infosV.forEach((inf, i) => {
    parts += `[${i}:v]scale=${L}:${H}:force_original_aspect_ratio=decrease,pad=${L}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}];`;
    if (inf.son) parts += `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}];`;
    else {
      args.push("-f", "lavfi", "-t", inf.duree.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo");
      parts += `[${silence}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}];`;
      silence++;
    }
    entrees += `[v${i}][a${i}]`;
  });
  const filtre = parts + `${entrees}concat=n=${liste.length}:v=1:a=1[v][a]`;
  progres(0.15, "Assemblage…");
  const data = await lancerFF([...args, "-filter_complex", filtre, "-map", "[v]", "-map", "[a]", ...X264,
    "-c:a", "aac", "-b:a", "128k", "sortie.mp4"], "sortie.mp4", temp);
  return { blob: new Blob([data.buffer], { type: "video/mp4" }), nom: nomSortie("assemblage", "mp4") };
}

// =====================================================================
// ===== DEMANDE ÉCRITE : « écris ce que tu veux » =====================
// =====================================================================
const CLE_KEY = "ia-montage-cle-gemini";
const MODELE = "gemini-flash-latest";
const EXT_VIDEO = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp"];
const extDe = (n) => (String(n).match(/\.([^.\/]+)$/) || [, ""])[1].toLowerCase();

function lireCle() { try { return localStorage.getItem(CLE_KEY) || ""; } catch { return ""; } }
function majModeIA() {
  const ok = !!lireCle();
  $("#mode-ia").textContent = ok
    ? "🧠 Cerveau Gemini activé : écris ce que tu veux, comme tu veux."
    : "Mode simple : coupe, vitesse, filtres, texte entre guillemets, TikTok, son, à l'envers, GIF… Pour TOUT comprendre, ajoute ta clé Gemini gratuite dans ⚙️ Réglages (en bas).";
  $("#etat-cle").textContent = ok ? "✓ Clé enregistrée sur ce téléphone." : "Aucune clé enregistrée.";
}
$("#sauver-cle").addEventListener("click", () => {
  const v = $("#cle").value.trim();
  try { v ? localStorage.setItem(CLE_KEY, v) : localStorage.removeItem(CLE_KEY); } catch {}
  $("#cle").value = "";
  majModeIA();
});
majModeIA();

const CONSIGNES = `Tu es le moteur de montage d'une appli d'édition vidéo/photo qui tourne sur iPhone avec ffmpeg.wasm (FFmpeg 5.1, un seul thread, mémoire limitée ~1,5 Go).
L'utilisateur décrit en français ce qu'il veut. Tu réponds UNIQUEMENT avec un JSON :
{"resume": "phrase courte en français qui dit ce que tu vas faire (tutoiement)",
 "etapes": [ ... ]}
Chaque étape est soit :
 A) {"type":"ffmpeg","description":"…","args":[…],"ext":"mp4"}  — arguments ffmpeg SANS le mot "ffmpeg". Utilise "{in}" pour le fichier courant et "{out}" pour la sortie. Les fichiers d'origine sont aussi "{in1}", "{in2}"… (dans l'ordre donné). "ext" = extension de sortie (mp4, jpg, png, gif, m4a).
 B) {"type":"texte","description":"…","texte":"…","position":"haut|milieu|bas","debut":0,"fin":null} — incruste un texte (blanc sur bandeau noir) ; fin null = jusqu'au bout. Emojis acceptés.
Les étapes s'enchaînent : la sortie d'une étape devient le {in} de la suivante.
Règles :
- Vidéo : toujours "-c:v","libx264","-preset","ultrafast","-crf","23","-pix_fmt","yuv420p" et pour le son "-c:a","aac","-b:a","128k" (ou "-an" si pas de son). Sortie mp4.
- Si la vidéo dure plus de 60 s ou fait plus de 1280 px, ajoute dans la 1re étape un scale pour que le plus grand côté fasse au plus 1280 px (pair) — ça évite de manquer de mémoire. Pour couper, mets "-ss" et "-to"/"-t" AVANT "-i" quand c'est possible.
- PAS de drawtext, subtitles ni ass (aucune police installée) : utilise l'étape "texte".
- Vitesse : setpts=PTS/X pour l'image et atempo (entre 0.5 et 2, à chaîner) pour le son.
- Format TikTok : 1080x1920 (ou 720x1280 si vidéo longue) avec fond flou : [0:v]scale=…:force_original_aspect_ratio=increase,crop=…,boxblur=…[bg];[0:v]scale=…:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2
- Filtres utilisables : eq, hue, curves, colorbalance, vignette, unsharp, boxblur, gblur, crop, pad, rotate, transpose, hflip, vflip, fade, afade, reverse, areverse, volume, loudnorm, select, aselect, silencedetect n'est pas utile ici, tpad, fps, zoompan, xfade, concat, lavfi color/anullsrc.
- Pour une photo (jpg/png) : sortie jpg ou png avec "-frames:v","1" (et "-q:v","2" pour un jpg de bonne qualité).
- Vidéos longues : c'est lent sur téléphone (environ 2 à 4 fois la durée de la vidéo par passe) → fais TOUT en une seule étape ffmpeg dès que possible (un seul -filter_complex).
- Garde le minimum d'étapes ; une seule étape ffmpeg avec plusieurs filtres est préférable quand c'est simple.
- IMPORTANT : ffmpeg ne fait que du montage. Si la demande consiste à TRANSFORMER le contenu de l'image (coupe de cheveux, visage, maquillage, vêtements, ajouter/enlever un objet ou une personne, changer le décor, style dessin animé, animer une photo…), n'utilise pas ffmpeg : mets "etapes": [] et ajoute
  "generatif": {"consigne_image": "instruction PRÉCISE en anglais pour modifier l'image en gardant tout le reste identique (même personne, même cadrage, même lumière)",
                "moment_s": instant de la vidéo (en secondes) le plus représentatif à transformer (0 pour une photo),
                "mouvement": "pour une vidéo seulement : description en anglais de l'action/du mouvement de la scène d'origine, pour recréer une courte vidéo animée"}
  et dans "resume" explique ce que l'IA va transformer.
- Si une demande a besoin d'un fichier non fourni (ex. une musique précise), ne l'invente pas : fais le reste et dis-le dans "resume" (l'utilisateur peut utiliser le bouton « Ajouter une musique »).
- Réponds uniquement avec le JSON, sans texte autour.`;

async function planGemini(demande, contexte, erreur) {
  const corps = {
    systemInstruction: { parts: [{ text: CONSIGNES }] },
    contents: [{ role: "user", parts: [{ text:
      "Fichiers : " + JSON.stringify(contexte) + "\n\nDemande : " + demande +
      (erreur ? "\n\nTon plan précédent a échoué. Erreur FFmpeg :\n" + erreur + "\nDonne un plan corrigé, plus simple." : "") }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  };
  let r;
  for (const m of [MODELE, "gemini-2.5-flash", "gemini-2.0-flash"]) {   // si un nom de modèle n'existe plus, on essaie le suivant
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": lireCle() }, body: JSON.stringify(corps),
    });
    if (r.status !== 404) break;
  }
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 400 || r.status === 403) throw new Error("Clé Gemini refusée : vérifie-la dans ⚙️ Réglages.");
    if (r.status === 429) throw new Error("Limite gratuite Gemini atteinte pour l'instant : réessaie dans une minute.");
    throw new Error("Gemini indisponible (" + r.status + ") " + t.slice(0, 120));
  }
  const j = await r.json();
  const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const plan = JSON.parse(t.replace(/^\s*```(?:json)?/, "").replace(/```\s*$/, ""));
  if (!Array.isArray(plan.etapes)) plan.etapes = [];
  if (!plan.etapes.length && !plan.generatif) throw new Error(plan.resume || "Réponse de Gemini incompréhensible, reformule ta demande.");
  return plan;
}

// =====================================================================
// ===== IA GÉNÉRATIVE (transformer l'image : cheveux, visage, décor…) ==
// =====================================================================
const API = "https://generativelanguage.googleapis.com/v1beta";
const blobVersBase64 = (b) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = ko;
  r.readAsDataURL(b);
});
const base64VersBlob = (b64, type) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
};

function erreurGoogle(status, texte, quoi) {
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(texte))
    return new Error(`Quota atteint pour ${quoi}. La version gratuite de la clé ne l'inclut peut-être pas : sur aistudio.google.com, active la facturation (Billing) du projet de ta clé, puis réessaie.`);
  if (status === 400 && /billing|paid|FAILED_PRECONDITION/i.test(texte))
    return new Error(`${quoi} demande d'activer la facturation sur le projet de ta clé (aistudio.google.com → Billing).`);
  if (status === 400 || status === 403) return new Error(`Google refuse la demande (${quoi}) : ${texte.slice(0, 160)}`);
  return new Error(`${quoi} indisponible (${status}) : ${texte.slice(0, 160)}`);
}

// Photo → photo modifiée (modèle d'image Gemini)
async function geminiModifierImage(blob, consigne) {
  const corps = JSON.stringify({
    contents: [{ parts: [{ text: consigne }, { inlineData: { mimeType: blob.type || "image/jpeg", data: await blobVersBase64(blob) } }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  let r;
  for (const m of ["gemini-2.5-flash-image", "gemini-2.5-flash-image-preview", "gemini-3-pro-image-preview"]) {
    r = await fetch(`${API}/models/${m}:generateContent`, { method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": lireCle() }, body: corps });
    if (r.status !== 404) break;
  }
  if (!r.ok) throw erreurGoogle(r.status, await r.text(), "l'IA image");
  const j = await r.json();
  const parts = j.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) {
    const pourquoi = parts.map((p) => p.text || "").join(" ").trim() || j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || "";
    throw new Error("L'IA image n'a pas renvoyé d'image. " + (pourquoi ? "Raison : " + pourquoi.slice(0, 200) : "Reformule ta demande."));
  }
  return base64VersBlob(img.inlineData.data, img.inlineData.mimeType || "image/png");
}

// Image → courte vidéo animée (Veo) — payant chez Google
async function veoDepuisImage(imageBlob, prompt, ratio) {
  const corps = JSON.stringify({
    instances: [{ prompt, image: { bytesBase64Encoded: await blobVersBase64(imageBlob), mimeType: imageBlob.type || "image/png" } }],
    parameters: { aspectRatio: ratio },
  });
  let r;
  for (const m of ["veo-3.1-fast-generate-preview", "veo-3.0-fast-generate-001", "veo-3.1-generate-preview", "veo-3.0-generate-001"]) {
    r = await fetch(`${API}/models/${m}:predictLongRunning`, { method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": lireCle() }, body: corps });
    if (r.status !== 404) break;
  }
  if (!r.ok) throw erreurGoogle(r.status, await r.text(), "l'IA vidéo (Veo)");
  let op = await r.json();
  const t0 = Date.now();
  while (!op.done) {
    if (Date.now() - t0 > 8 * 60 * 1000) throw new Error("L'IA vidéo met trop de temps, réessaie plus tard.");
    const s = Math.round((Date.now() - t0) / 1000);
    progres(Math.min(0.95, 0.55 + s / 400), `🎬 L'IA crée ta vidéo… ${s} s (souvent 1 à 3 min)`);
    await new Promise((ok) => setTimeout(ok, 10000));
    const p = await fetch(`${API}/${op.name}`, { headers: { "x-goog-api-key": lireCle() } });
    if (!p.ok) throw erreurGoogle(p.status, await p.text(), "l'IA vidéo (Veo)");
    op = await p.json();
  }
  if (op.error) throw new Error("L'IA vidéo a refusé : " + (op.error.message || "").slice(0, 200));
  const rep = op.response?.generateVideoResponse || op.response || {};
  if (rep.raiMediaFilteredReasons?.length) throw new Error("L'IA vidéo a bloqué le résultat : " + rep.raiMediaFilteredReasons.join(" "));
  const uri = rep.generatedSamples?.[0]?.video?.uri || rep.videos?.[0]?.uri;
  const b64 = rep.generatedSamples?.[0]?.video?.bytesBase64Encoded || rep.videos?.[0]?.bytesBase64Encoded;
  if (b64) return base64VersBlob(b64, "video/mp4");
  if (!uri) throw new Error("L'IA vidéo n'a pas renvoyé de vidéo.");
  const v = await fetch(uri, { headers: { "x-goog-api-key": lireCle() } });
  if (!v.ok) throw new Error("Impossible de télécharger la vidéo créée (" + v.status + ").");
  return new Blob([await v.arrayBuffer()], { type: "video/mp4" });
}

// Plan B gratuit : on envoie la photo + la demande dans l'appli Gemini (incluse dans l'abonnement)
async function envoyerVersGemini(imageBlob, demande) {
  const texte = demande + "\n(Garde exactement la même personne, le même cadrage et la même lumière.)";
  try { await navigator.clipboard.writeText(texte); } catch {}
  const f = new File([imageBlob], "photo.png", { type: imageBlob.type || "image/png" });
  // bouton à toucher (iOS exige un vrai toucher pour ouvrir le menu de partage)
  document.querySelector("#vers-gemini")?.remove();
  const b = document.createElement("button");
  b.id = "vers-gemini";
  b.className = "bouton gros principal";
  b.textContent = "📤 Faire la transformation dans l'appli Gemini (gratuit)";
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(texte); } catch {}
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], text: texte }); } catch {}
    } else {
      const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = "photo.png"; a.click();
    }
  };
  $("#progression").appendChild(b);
  throw new Error("La clé gratuite ne permet pas la transformation IA. Touche le bouton ci-dessous → choisis « Gemini » → colle ta demande (déjà copiée) et envoie. Pour une vidéo, demande ensuite à Gemini « fais-en une vidéo ».");
}

async function geminiOuPlanB(img, consigne) {
  try { return await geminiModifierImage(img, consigne); }
  catch (e) {
    if (/Quota|facturation|Billing/i.test(e.message)) await envoyerVersGemini(img, $("#demande").value || consigne);
    throw e;
  }
}

async function executerGeneratif(plan, contexte) {
  const g = plan.generatif || {};
  const consigne = g.consigne_image || $("#demande").value;
  const f = fichiers[0];
  if (!estVideo(f)) {
    progres(0.3, "🪄 L'IA transforme ta photo… (10-30 s)");
    const blob = await geminiOuPlanB(f, consigne);
    return { blob, nom: nomSortie("ia", blob.type.includes("png") ? "png" : "jpg") };
  }
  // vidéo : 1) on prend une image de la vidéo, 2) on la transforme, 3) Veo recrée une courte vidéo
  const inf = contexte[0];
  const t = Math.max(0, Math.min(+g.moment_s || 0.5, Math.max(0, inf.duree_s - 0.1)));
  progres(0.2, "J'extrais une image de ta vidéo…");
  logs = [];
  await ffmpeg.exec(["-ss", String(t), "-i", "/in/" + f.name, "-frames:v", "1", "-update", "1", "/image-ia.png"]);
  const img = new Blob([(await ffmpeg.readFile("/image-ia.png")).buffer], { type: "image/png" });
  try { await ffmpeg.deleteFile("/image-ia.png"); } catch {}
  progres(0.35, "🪄 L'IA transforme l'image…");
  const modifiee = await geminiOuPlanB(img, consigne);
  afficherApercu($("#apercu-sortie"), modifiee);
  $("#carte-resultat").hidden = false;
  const ratio = inf.hauteur > inf.largeur ? "9:16" : "16:9";
  const ok = confirm("Voici l'image transformée (en bas).\n\nCréer maintenant une VIDÉO IA de ~8 s à partir d'elle ?\n" +
    "⚠️ C'est l'IA vidéo de Google (Veo) : c'est PAYANT sur le compte de ta clé (environ 1 à 4 € la vidéo selon les tarifs Google) et il faut que la facturation soit activée.\n\n" +
    "OK = créer la vidéo · Annuler = garder seulement l'image");
  if (!ok) return { blob: modifiee, nom: nomSortie("ia", "png") };
  const prompt = (g.mouvement ? g.mouvement + ". " : "") + "Keep the same person, framing, lighting and style as the image. " + consigne;
  const video = await veoDepuisImage(modifiee, prompt, ratio);
  return { blob: video, nom: nomSortie("ia", "mp4") };
}

// --- mode simple (sans clé / sans internet) ---
const enSec = (s) => { s = s.replace(",", "."); if (s.includes(":")) { const [m, x] = s.split(":"); return +m * 60 + +x; } return +s; };

function planLocal(demande, info) {
  const d = demande.toLowerCase();
  const vid = info.video, son = info.son;
  const V = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p"];
  const A = son ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"];
  const etapes = [], fait = [];
  const ff = (description, args, ext) => etapes.push({ type: "ffmpeg", description, args, ext: ext || (vid ? "mp4" : "jpg") });
  const sortieImg = vid ? [] : ["-frames:v", "1", "-update", "1", "-q:v", "2"];
  const grand = vid && (info.duree > 60 || Math.max(info.larg, info.haut) > 1280);
  const reduire = grand ? `scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',` : "";

  const coupe = d.match(/(?:coupe|garde|prends|de)\s*(?:de\s*|à partir de\s*)?(\d+(?:[:.,]\d+)?)\s*(?:s|sec|secondes)?\s*(?:à|a|-|jusqu'?à|jusqu'à)\s*(\d+(?:[:.,]\d+)?)/);
  const filtresV = [], filtresA = [];
  if (coupe && vid) fait.push(`je garde de ${coupe[1]} à ${coupe[2]}`);
  let vitesse = null;
  const mx = d.match(/(?:x|×|fois)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:x|×|fois)\b/);
  if (/acc[ée]l|plus vite|speed/.test(d)) vitesse = mx ? enSec(mx[1] || mx[2]) : 2;
  if (/ralenti|slow|moins vite/.test(d)) vitesse = mx ? Math.min(1, enSec(mx[1] || mx[2])) || 0.5 : 0.5;
  if (vitesse && vid) {
    filtresV.push(`setpts=PTS/${vitesse}`);
    let r = vitesse; const at = [];
    while (r > 2) { at.push("atempo=2"); r /= 2; }
    while (r < 0.5) { at.push("atempo=0.5"); r /= 0.5; }
    at.push(`atempo=${r.toFixed(4)}`);
    if (son) filtresA.push(...at);
    fait.push(`vitesse ×${vitesse}`);
  }
  const filtre = /noir et blanc|n&b|\bnb\b|black/.test(d) ? "nb" : /vintage|r[ée]tro/.test(d) ? "vintage" : /chaud|[ée]t[ée]/.test(d) ? "chaud"
    : /froid|hiver/.test(d) ? "froid" : /lumin|[ée]clair/.test(d) ? "lumineux" : /cin[ée]/.test(d) ? "cine" : /vif|satur|couleurs?/.test(d) ? "vif" : null;
  if (filtre) { filtresV.push(FILTRES[filtre].ff); fait.push("filtre " + FILTRES[filtre].nom); }
  if (/miroir/.test(d)) { filtresV.push("hflip"); fait.push("miroir"); }
  else if (/tourne|pivote|rotation/.test(d)) {
    filtresV.push(/gauche/.test(d) ? "transpose=2" : /180|retourne/.test(d) ? "transpose=1,transpose=1" : "transpose=1");
    fait.push("rotation");
  }
  if (/[àa] l'envers|rembobin|reverse/.test(d) && vid) { filtresV.push("reverse"); if (son) filtresA.push("areverse"); fait.push("à l'envers"); }
  const tiktok = /tiktok|tik tok|vertical|9[:/]16|reels?|shorts?/.test(d);

  const muet = /enl[eè]ve le son|sans (le )?son|muet|coupe le son|retire le son/.test(d) && vid;
  if (filtresV.length || filtresA.length || (coupe && vid) || grand || tiktok) {
    // tout en UNE seule passe (beaucoup plus rapide sur les longues vidéos)
    const args = [];
    if (coupe && vid) args.push("-ss", String(enSec(coupe[1])), "-to", String(enSec(coupe[2])));
    args.push("-i", "{in}");
    const pre = filtresV.join(",");
    if (tiktok) {
      const W = vid && (grand || info.duree > 30) ? 720 : 1080, H = W === 720 ? 1280 : 1920;
      args.push("-filter_complex", `[0:v]${pre ? pre + "," : ""}split[s1][s2];` +
        `[s1]scale=${W / 6}:${H / 6}:force_original_aspect_ratio=increase,crop=${W / 6}:${H / 6},boxblur=8:2,scale=${W}:${H}[bg];` +
        `[s2]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`, "-map", "[v]");
      if (vid && son && !muet) args.push("-map", "0:a?");
      fait.push("format TikTok");
    } else if (pre || grand) {
      args.push("-vf", (reduire + pre).replace(/,$/, ""));
    }
    if (filtresA.length && !muet) args.push("-af", filtresA.join(","));
    args.push(...(vid ? [...V, ...(muet ? ["-an"] : A)] : sortieImg), "{out}");
    if (muet) fait.push("sans le son");
    ff(fait.join(", ") || "préparation", args);
  } else if (muet) {
    ff("sans le son", ["-i", "{in}", "-an", "-c:v", "copy", "{out}"]); fait.push("sans le son");
  }
  const txt = demande.match(/["“«]\s*([^"”»]+?)\s*["”»]/);
  if (txt) {
    const pendant = d.match(/pendant\s*(\d+(?:[.,]\d+)?)\s*(?:s|sec|secondes)/);
    etapes.push({ type: "texte", description: `texte « ${txt[1]} »`, texte: txt[1],
      position: /en bas|bas de/.test(d) ? "bas" : /milieu|centre/.test(d) ? "milieu" : "haut",
      debut: 0, fin: pendant ? enSec(pendant[1]) : null });
    fait.push(`texte « ${txt[1]} »`);
  }
  if (/all[eè]ge|compresse|moins lourd|plus l[ée]ger/.test(d)) {
    ff("allégée", ["-i", "{in}", "-vf", "scale='min(720,iw)':-2", ...(vid ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", ...A] : ["-q:v", "5", ...sortieImg]), "{out}"], vid ? "mp4" : "jpg");
    fait.push("allégée");
  }
  if (/\bgif\b/.test(d) && vid) {
    ff("en GIF", ["-t", "15", "-i", "{in}", "-vf", "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "{out}"], "gif");
    fait.push("GIF");
  }
  return { resume: etapes.length ? "Je fais : " + fait.join(", ") + "." :
    "Je n'ai pas compris en mode simple. Ajoute ta clé Gemini (⚙️ Réglages) pour que je comprenne tout — y compris les transformations IA (cheveux, visage, décor…) — ou utilise les idées en dessous.", etapes };
}

// --- exécution d'un plan ---
async function etapeTexte(courant, e, i) {
  const inf = await infos(courant);
  const c = document.createElement("canvas");
  c.width = inf.larg || 1080; c.height = inf.haut || 1920;
  dessinerAccroche(c.getContext("2d"), c.width, c.height, String(e.texte || ""), e.position || "haut");
  const png = `/t${i}.png`;
  await ffmpeg.writeFile(png, new Uint8Array(await (await canvasEnBlob(c)).arrayBuffer()));
  const vid = EXT_VIDEO.includes(extDe(courant)) || extDe(courant) === "gif";
  const debut = +e.debut || 0, fin = e.fin == null || e.fin === "" ? null : +e.fin;
  const quand = vid && (debut > 0 || fin) ? `:enable='between(t,${debut},${fin ?? 99999})'` : "";
  const out = `/e${i}.${vid ? "mp4" : extDe(courant) === "png" ? "png" : "jpg"}`;
  const args = ["-i", courant, "-i", png, "-filter_complex", `[0:v][1:v]overlay=0:0${quand}`];
  args.push(...(vid ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "copy"] : ["-frames:v", "1", "-q:v", "2"]), out);
  logs = [];
  const code = await ffmpeg.exec(args);
  try { await ffmpeg.deleteFile(png); } catch {}
  if (code !== 0) throw Object.assign(new Error("texte"), { log: logs.slice(-15).join("\n") });
  return out;
}

async function executerPlan(plan) {
  let courant = "/in/" + fichiers[0].name;
  const crees = [];
  try {
    for (let i = 0; i < plan.etapes.length; i++) {
      const e = plan.etapes[i];
      $("#journal").textContent += `\n${i + 1}/${plan.etapes.length} · ${e.description || e.type}…`;
      progres(0.15 + 0.8 * (i / plan.etapes.length), `Étape ${i + 1}/${plan.etapes.length} : ${e.description || ""}`);
      if (e.type === "texte") {
        courant = await etapeTexte(courant, e, i);
      } else {
        const out = `/e${i}.${(e.ext || "mp4").replace(/^\./, "")}`;
        const args = (e.args || []).map((a) => String(a)
          .replaceAll("{in}", courant).replaceAll("{out}", out)
          .replace(/\{in(\d+)\}/g, (m, n) => "/in/" + (fichiers[+n - 1] || fichiers[0]).name));
        if (args[args.length - 1] !== out && !args.includes(out)) args.push(out);
        logs = [];
        const code = await ffmpeg.exec(args);
        if (code !== 0) throw Object.assign(new Error("étape " + (i + 1)), { log: logs.slice(-15).join("\n") });
        courant = out;
      }
      crees.push(courant);
    }
    const data = await ffmpeg.readFile(courant);
    const ext = extDe(courant);
    const type = ext === "gif" ? "image/gif" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "m4a" ? "audio/mp4" : ext === "mp3" ? "audio/mpeg" : "video/mp4";
    return { blob: new Blob([data.buffer], { type }), nom: nomSortie("montage", ext) };
  } finally {
    for (const n of crees) { try { await ffmpeg.deleteFile(n); } catch {} }
  }
}

$("#faire").addEventListener("click", async () => {
  const demande = $("#demande").value.trim();
  if (!fichiers.length) return;
  if (!demande) { $("#demande").focus(); return; }
  $("#faire").disabled = true; $("#go").disabled = true;
  $("#carte-go").hidden = false; $("#go").hidden = true;
  $("#progression").hidden = false; $("#journal").textContent = "";
  $("#carte-go").scrollIntoView({ behavior: "smooth" });
  let monte = false;
  try {
    await chargerFFmpeg();
    progres(0.08, "J'analyse ta vidéo…");
    try { await ffmpeg.createDir("/in"); } catch {}
    try { await ffmpeg.unmount("/in"); } catch {}
    await ffmpeg.mount("WORKERFS", { files: fichiers }, "/in");   // lit le fichier sans tout charger en mémoire
    monte = true;
    const contexte = [];
    for (const f of fichiers) {
      const inf = await infos("/in/" + f.name);
      contexte.push({ nom: f.name, type: estVideo(f) ? "video" : "photo", duree_s: +inf.duree.toFixed(2),
        largeur: inf.larg, hauteur: inf.haut, son: inf.son, taille_mo: +(f.size / 1048576).toFixed(1) });
    }
    const info = { video: estVideo(fichiers[0]), son: contexte[0].son, duree: contexte[0].duree_s, larg: contexte[0].largeur, haut: contexte[0].hauteur };
    progres(0.12, lireCle() ? "🧠 Je réfléchis à ta demande…" : "Je lis ta demande…");
    let plan = lireCle() ? await planGemini(demande, contexte) : planLocal(demande, info);
    $("#journal").textContent = "💬 " + (plan.resume || "");
    if (plan.generatif) {
      resultat = await executerGeneratif(plan, contexte);
      afficherApercu($("#apercu-sortie"), resultat.blob);
      $("#carte-resultat").hidden = false;
      $("#carte-resultat").scrollIntoView({ behavior: "smooth" });
      progres(1, "Terminé ✓ — tu peux continuer le montage avec « Continuer à modifier ».");
      return;
    }
    if (!plan.etapes.length) { progres(0, "Rien à faire pour cette demande — lis l'explication ci-dessous."); return; }
    try {
      resultat = await executerPlan(plan);
    } catch (err) {
      if (!lireCle() || !err.log) throw err;
      // 2e essai : on renvoie l'erreur à Gemini pour qu'il corrige son plan
      if (!ffmpeg) { await chargerFFmpeg(); try { await ffmpeg.createDir("/in"); } catch {} await ffmpeg.mount("WORKERFS", { files: fichiers }, "/in"); }
      $("#journal").textContent += "\n⚠️ Petit souci, je corrige…";
      plan = await planGemini(demande, contexte, err.log);
      $("#journal").textContent += "\n💬 " + (plan.resume || "");
      resultat = await executerPlan(plan);
    }
    afficherApercu($("#apercu-sortie"), resultat.blob);
    $("#carte-resultat").hidden = false;
    $("#carte-resultat").scrollIntoView({ behavior: "smooth" });
    progres(1, "Terminé ✓");
  } catch (err) {
    console.error(err, err.log || "");
    try { ffmpeg?.terminate(); } catch {}
    ffmpeg = null; monte = false;
    progres(0, "❌ " + (err.log ? "Le montage a échoué. Reformule, ou coupe la vidéo en plus court." : err.message || err));
  } finally {
    if (monte && ffmpeg) { try { await ffmpeg.unmount("/in"); } catch {} }
    $("#faire").disabled = false; $("#go").disabled = false; $("#go").hidden = false;
  }
});
