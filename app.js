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

function dessinerAccroche(ctx, larg, haut, texte) {
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
  const y0 = haut * 0.08;
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
  const entree = "entree." + ext;
  progres(0.05, "Lecture de la vidéo…");
  await ffmpeg.writeFile(entree, await lireFichier(f));
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
