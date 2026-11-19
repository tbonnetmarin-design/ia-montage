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
    { id: "compresser", titre: "Alléger", desc: "Fichier plus léger" },
  ],
  video: [
    { id: "tiktok", titre: "Format TikTok", desc: "Vertical 9:16, fond flou" },
    { id: "couper", titre: "Couper", desc: "Garder un passage" },
    { id: "blancs", titre: "Couper les blancs", desc: "Enlève les silences" },
    { id: "accroche", titre: "Texte d'accroche", desc: "Gros texte en haut" },
    { id: "musique", titre: "Ajouter une musique", desc: "Musique de fond" },
    { id: "compresser", titre: "Alléger", desc: "Vidéo plus légère" },
    { id: "gif", titre: "En GIF", desc: "15 s max" },
  ],
};

const estVideo = (f) => f && f.type.startsWith("video");

// ---------- étape 1 : choix du fichier ----------
$("#fichier").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) chargerEntree(f);
  e.target.value = "";
});

function chargerEntree(f) {
  fichier = f;
  resultat = null;
  actionChoisie = null;
  afficherApercu($("#apercu-entree"), f);
  const liste = ACTIONS[estVideo(f) ? "video" : "photo"];
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
  if (blob.type.startsWith("video")) {
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
  if (!estVideo(f)) return executerPhoto(action, f);
  return executerVideo(action, f);
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
    c.width = 1080; c.height = 1920;
    const sCover = Math.max(1080 / img.width, 1920 / img.height);
    ctx.filter = "blur(40px)";
    ctx.drawImage(img, (1080 - img.width * sCover) / 2, (1920 - img.height * sCover) / 2, img.width * sCover, img.height * sCover);
    ctx.filter = "none";
    const s = Math.min(1080 / img.width, 1920 / img.height);
    ctx.drawImage(img, (1080 - img.width * s) / 2, (1920 - img.height * s) / 2, img.width * s, img.height * s);
    return { blob: await canvasEnBlob(c, "image/jpeg", 0.92), nom: nomSortie("tiktok", "jpg") };
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
  } else {
    throw new Error("Action inconnue");
  }

  logs = [];
  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    console.warn(logs.slice(-20).join("\n"));
    throw new Error("Le montage a échoué (vidéo trop lourde ? essaie « Alléger » d'abord).");
  }
  const data = await ffmpeg.readFile(sortie);
  for (const n of [...fichiersTemp, sortie]) { try { await ffmpeg.deleteFile(n); } catch {} }
  const ext2 = sortie.split(".").pop();
  return { blob: new Blob([data.buffer], { type }), nom: nomSortie(suffixe, ext2) };
}
