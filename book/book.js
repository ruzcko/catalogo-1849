// The virtual Catálogo: a 3D book whose pages are set in type from the open transcription (no scan images).
// Pages are drawn on canvases on demand and turned with a bending leaf; only the open spread and the leaf being
// turned are real meshes, so it stays light on phones.
import * as THREE from "three";

// ---------- Book layout ----------
const SCAN_W = 910, SCAN_H = 1498;              // the scanned page, in pixels: entry boxes use these
const H = 1.5, W = H * SCAN_W / SCAN_H;          // a page in world units
const TEX_W = 1280, TEX_H = Math.round(TEX_W * SCAN_H / SCAN_W), S = TEX_W / SCAN_W;
const LEAF = 0.0016;                             // paper thickness, for the stacks
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let PAGES = [];                                  // from data/pages.json: {n, scan, letter, first, last} or {n, missing}
// Faces in reading order: 0 cover, 1 endpaper, 2 title, 3 about this edition, then the printed pages, then the
// closing page, an endpaper and the back cover. Face f is the front of leaf f/2 (a right page) when f is even,
// the back of leaf (f-1)/2 (a left page) when odd.
const FRONT = 4;
let FACES = [], LEAVES = 0;
const faceOfPage = n => FRONT + PAGES.findIndex(p => p.n === n);

// ---------- Renderer, scene, camera ----------
const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d1712);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
// Unlit materials: the pages show their drawn colours exactly; the turning leaf is shaded by hand (see animate).

// A soft shadow under the book.
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2 * W * 1.18, H * 1.12),
  new THREE.MeshBasicMaterial({ map: radialShadow(), transparent: true, depthWrite: false }));
shadow.position.z = -0.02;
scene.add(shadow);

const paperEdge = new THREE.MeshBasicMaterial({ color: 0xd8c9a8 });
const stackL = new THREE.Mesh(new THREE.BoxGeometry(W, H, 1), paperEdge);
const stackR = new THREE.Mesh(new THREE.BoxGeometry(W, H, 1), paperEdge);
scene.add(stackL, stackR);

const pageMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff });
const leftPage = new THREE.Mesh(new THREE.PlaneGeometry(W, H), pageMat());
leftPage.geometry.translate(-W / 2, 0, 0);
const rightPage = new THREE.Mesh(new THREE.PlaneGeometry(W, H), pageMat());
rightPage.geometry.translate(W / 2, 0, 0);
scene.add(leftPage, rightPage);

// The leaf being turned: one bendable strip, its front and back drawn as two meshes.
const SEG = 48;
const leafGeo = new THREE.PlaneGeometry(W, H, SEG, 1);
leafGeo.translate(W / 2, 0, 0);
const leafFront = new THREE.Mesh(leafGeo, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
const leafBack = new THREE.Mesh(leafGeo, new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
const leaf = new THREE.Group();
leaf.add(leafFront, leafBack);
leaf.visible = false;
scene.add(leaf);

function bendLeaf(t, dir) {
  // t: 0 = lying on the right, 1 = lying on the left. The free edge lags behind the spine as it turns.
  const theta = Math.PI * t, lift = Math.sin(Math.PI * t), dx = W / SEG;
  const X = [0], Z = [0];
  for (let i = 1; i <= SEG; i++) {
    const u = (i - 0.5) / SEG;
    const a = Math.min(Math.PI, Math.max(0, theta - dir * 0.95 * lift * u * u));
    X.push(X[i - 1] + Math.cos(a) * dx);
    Z.push(Z[i - 1] + Math.sin(a) * dx);
  }
  const pos = leafGeo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const i = k % (SEG + 1);
    pos.setX(k, X[i]);
    pos.setZ(k, Z[i]);
  }
  pos.needsUpdate = true;
  leafGeo.computeVertexNormals();
}

// ---------- Drawing pages ----------
const FONT = '"IM Fell English", Georgia, serif', FONT_SC = '"IM Fell English SC", Georgia, serif';
const INK = "#2a2017";
const textures = new Map();                      // key "face:mirror" -> texture
const canvases = new Map();                      // face -> canvas (drawn once, shared by both orientations)
const order = [];                                // least recently used faces first
let highlight = null;                            // {n, name}: a searched entry, marked on its page
let noise = null;

function makeNoise() {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = c.height = 256;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 22;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function paper(g, side, tone = "#f0e5cb") {
  g.fillStyle = tone;
  g.fillRect(0, 0, TEX_W, TEX_H);
  g.fillStyle = g.createPattern(noise ||= makeNoise(), "repeat");
  g.fillRect(0, 0, TEX_W, TEX_H);
  // Aged edges.
  const v = g.createRadialGradient(TEX_W / 2, TEX_H / 2, TEX_H * 0.35, TEX_W / 2, TEX_H / 2, TEX_H * 0.75);
  v.addColorStop(0, "rgba(120, 90, 40, 0)");
  v.addColorStop(1, "rgba(120, 90, 40, .22)");
  g.fillStyle = v;
  g.fillRect(0, 0, TEX_W, TEX_H);
  // The gutter: a shadow along the spine edge (left on a right page, right on a left page).
  const gx = side === "R" ? 0 : TEX_W, gw = 110;
  const gut = g.createLinearGradient(gx, 0, side === "R" ? gw : TEX_W - gw, 0);
  gut.addColorStop(0, "rgba(60, 40, 20, .28)");
  gut.addColorStop(1, "rgba(60, 40, 20, 0)");
  g.fillStyle = gut;
  g.fillRect(0, 0, TEX_W, TEX_H);
}

function centred(g, text, y, size, font = FONT, color = INK) {
  g.font = `${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = "center";
  g.fillText(text, TEX_W / 2, y);
  g.textAlign = "left";
}

function drawCover(g, back) {
  g.fillStyle = "#5a1d16";
  g.fillRect(0, 0, TEX_W, TEX_H);
  g.fillStyle = g.createPattern(noise ||= makeNoise(), "repeat");
  for (let i = 0; i < 3; i++) g.fillRect(0, 0, TEX_W, TEX_H);
  const gold = "#d4b062";
  g.strokeStyle = gold;
  g.lineWidth = 6;
  g.strokeRect(70, 70, TEX_W - 140, TEX_H - 140);
  g.lineWidth = 2;
  g.strokeRect(92, 92, TEX_W - 184, TEX_H - 184);
  if (back) return;
  centred(g, "CATÁLOGO", 640, 116, FONT_SC, gold);
  centred(g, "ALFABÉTICO", 790, 96, FONT_SC, gold);
  centred(g, "DE", 900, 62, FONT_SC, gold);
  centred(g, "APELLIDOS", 1040, 116, FONT_SC, gold);
  g.fillStyle = gold;
  g.fillRect(TEX_W / 2 - 120, 1110, 240, 3);
  centred(g, "1849", 1230, 64, FONT_SC, gold);
}

function drawText(g, side, lines, top) {
  paper(g, side);
  let y = top;
  for (const [text, size, font, gap] of lines) {
    if (text) centred(g, text, y, size, font);
    y += gap;
  }
}

function drawMissing(g, side, n) {
  paper(g, side);
  centred(g, `[${n}]`, 1420 * S, 30);
  centred(g, `Page ${n} is missing`, TEX_H / 2 - 40, 54, FONT);
  g.font = `italic 34px ${FONT}`;
  centred(g, "from the only scan online.", TEX_H / 2 + 20, 34, `italic ${FONT}`);
  centred(g, "If you have a copy of the Catálogo, we'd love to hear from you.", TEX_H / 2 + 110, 28, `italic ${FONT}`, "#6b5a45");
}

function drawPrinted(g, side, page, data) {
  paper(g, side);
  const sizes = data.e.map(e => e[3] - e[1]).sort((a, b) => a - b);
  const size = Math.round((sizes[sizes.length >> 1] || 14) * S * 1.08);
  // The reprint's thumb letter, then the running head: page number and letter, as on the scanned page.
  g.font = `bold ${Math.round(34 * S)}px Georgia, serif`;
  g.fillStyle = INK;
  g.fillText(page.letter, (side === "R" ? SCAN_W - 50 : 22) * S, 52 * S);
  g.font = `${Math.round(17 * S)}px ${FONT}`;
  g.fillText(String(page.n), (side === "R" ? 790 : 62) * S, 118 * S);
  centred(g, page.letter, 118 * S, Math.round(17 * S));
  g.font = `${size}px ${FONT}`;
  for (const [x0, y0, x1, y1, name] of data.e) {
    if (highlight && highlight.n === page.n && highlight.name === name) {
      g.fillStyle = "rgba(240, 196, 60, .55)";
      g.fillRect(x0 * S - 6, y0 * S - 4, Math.max(x1 - x0, 60) * S + 12, (y1 - y0) * S + 10);
    }
    g.fillStyle = INK;
    g.globalAlpha = 0.82 + 0.18 * Math.abs(Math.sin(x0 * 12.9898 + y0 * 78.233));  // uneven 19th-century ink
    // Squeeze a name into its box (plus a little), so two overlapping OCR lines don't run into each other.
    g.fillText(name + ".", x0 * S, y1 * S - 2 * S, Math.max(x1 - x0, 40) * S * 1.12);
    g.globalAlpha = 1;
  }
  centred(g, `[${page.n}]`, 1428 * S, Math.round(17 * S));
}

const pageData = new Map();
async function loadPage(n) {
  if (!pageData.has(n)) pageData.set(n, fetch(`data/p/${n}.json`).then(r => r.json()));
  return pageData.get(n);
}

function faceCanvas(f) {
  if (canvases.has(f)) return canvases.get(f);
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  canvases.set(f, c);
  drawFace(f, c);
  return c;
}

function drawFace(f, c) {
  const g = c.getContext("2d"), side = f % 2 === 0 ? "R" : "L", kind = FACES[f];
  if (kind === "cover") drawCover(g, false);
  else if (kind === "backcover") drawCover(g, true);
  else if (kind === "endpaper") paper(g, side, "#d9c9a6");
  else if (kind === "title") drawText(g, side, [
    ["CATÁLOGO", 88, FONT_SC, 110], ["ALFABÉTICO", 72, FONT_SC, 96], ["DE APELLIDOS", 72, FONT_SC, 190],
    ["Manila, 1849", 40, `italic ${FONT}`, 520], ["Recreated from an open transcription", 30, FONT, 46],
    ["github.com/ruzcko/catalogo-1849", 26, FONT, 0]], 520);
  else if (kind === "about") drawText(g, side, [
    ["THIS EDITION", 44, FONT_SC, 90],
    ["Every page here is set in type from a machine-read", 30, FONT, 44],
    ["transcription of the National Archives of the", 30, FONT, 44],
    ["Philippines' 1973 reprint, as digitized by the", 30, FONT, 44],
    ["Filipinas Heritage Library. Names sit where they", 30, FONT, 44],
    ["sit on the scanned page; some readings are", 30, FONT, 44],
    ["uncertain, and a few pages are missing.", 30, FONT, 120],
    ["The 1849 text is in the public domain.", 28, `italic ${FONT}`, 44],
    ["Transcription CC BY 4.0 · apelyido.ruzcko.com", 26, FONT, 0]], 560);
  else if (kind === "fin") drawText(g, side, [["FIN.", 64, FONT_SC, 120],
    ["About 61,000 surnames, sent to every province in 1849.", 30, `italic ${FONT}`, 50],
    ["Find yours at apelyido.ruzcko.com", 30, FONT, 0]], 700);
  else if (kind && kind.missing) drawMissing(g, side, kind.n);
  else if (kind) {
    paper(g, side);
    loadPage(kind.n).then(data => { drawPrinted(g, side, kind, data); refreshFace(f); });
  } else paper(g, side);
}

function refreshFace(f) {
  for (const m of [false, true]) {
    const t = textures.get(`${f}:${m}`);
    if (t) t.needsUpdate = true;
  }
  render();
}

function texture(f, mirror = false) {
  const key = `${f}:${mirror}`;
  if (!textures.has(key)) {
    const t = new THREE.CanvasTexture(faceCanvas(f));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (mirror) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
    textures.set(key, t);
  }
  const i = order.indexOf(f);
  if (i >= 0) order.splice(i, 1);
  order.push(f);
  while (order.length > 12) {                     // keep a dozen pages in memory
    const old = order.shift();
    canvases.delete(old);
    for (const m of [false, true]) { textures.get(`${old}:${m}`)?.dispose(); textures.delete(`${old}:${m}`); }
  }
  return textures.get(key);
}

function setMap(mesh, f, mirror) {
  mesh.visible = f >= 0 && f < FACES.length;
  if (!mesh.visible) return;
  mesh.material.map = texture(f, mirror);
  mesh.material.needsUpdate = true;
}

// ---------- The open spread ----------
let cur = 0;                 // leaves turned so far: the left page is face 2cur-1, the right page face 2cur
let side = "R";              // on narrow screens, which page of the spread is in view
let turning = null;          // {from, to, start, dur, dir}

function place() {
  const leftZ = cur * LEAF, rightZ = (LEAVES - cur) * LEAF;
  stackL.visible = cur > 0;
  stackR.visible = cur < LEAVES;
  stackL.scale.z = Math.max(leftZ, 1e-4); stackL.position.set(-W / 2, 0, leftZ / 2 - LEAF);
  stackR.scale.z = Math.max(rightZ, 1e-4); stackR.position.set(W / 2, 0, rightZ / 2 - LEAF);
  leftPage.position.z = leftZ;
  rightPage.position.z = rightZ;
  const closed = cur === 0 || cur === LEAVES;
  shadow.scale.x = closed ? 0.55 : 1;
  shadow.position.x = cur === 0 ? W / 2 : cur === LEAVES ? -W / 2 : 0;
}

function showSpread() {
  setMap(leftPage, 2 * cur - 1, false);
  setMap(rightPage, 2 * cur, false);
  place();
  prefetch();
  updateBar();
  render();
}

function prefetch() {
  for (const f of [2 * cur + 1, 2 * cur + 2, 2 * cur - 2, 2 * cur - 3]) {
    const kind = FACES[f];
    if (kind && kind.n && !kind.missing) loadPage(kind.n);
  }
}

function turn(dir) {
  if (turning) return finishTurn();
  const to = cur + dir;
  if (to < 0 || to > LEAVES) return;
  const l = dir > 0 ? cur : cur - 1;              // the leaf that moves
  setMap(leafFront, 2 * l, false);
  setMap(leafBack, 2 * l + 1, true);
  if (dir > 0) setMap(rightPage, 2 * cur + 2, false); else setMap(leftPage, 2 * cur - 3, false);
  leaf.visible = true;
  turning = { from: cur, to, dir, start: performance.now(), dur: reduceMotion ? 0 : 750 };
  animate();
}

function finishTurn() {
  if (!turning) return;
  cur = turning.to;
  turning = null;
  leaf.visible = false;
  if (narrow()) side = cur === 0 ? "R" : cur === LEAVES ? "L" : side;
  showSpread();
  frame();
}

function animate() {
  if (!turning) return;
  const k = Math.min(1, (performance.now() - turning.start) / (turning.dur || 1));
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const t = turning.dir > 0 ? e : 1 - e;
  bendLeaf(t, turning.dir);
  // Shade the leaf as it lifts: the front darkens as it turns away, the back brightens as it lands.
  const lift = Math.sin(Math.PI * t);
  leafFront.material.color.setScalar(1 - 0.35 * t - 0.1 * lift);
  leafBack.material.color.setScalar(0.65 + 0.35 * t - 0.1 * lift);
  const zR = (LEAVES - turning.from) * LEAF, zL = turning.from * LEAF;
  leaf.position.z = zR + (zL - zR) * t + 0.002;
  render();
  if (k < 1) requestAnimationFrame(animate); else finishTurn();
}

// ---------- Camera: fit, zoom and pan ----------
const view = { zoom: 1, x: 0, y: 0, tx: 0, ty: 0 };   // x, y: centre of view; tx, ty: where the camera eases to
const narrow = () => innerWidth / innerHeight < 0.95;
const TOP = () => document.querySelector(".bar.top").offsetHeight, BOT = () => document.querySelector(".bar.bottom").offsetHeight;

function frame() {
  // The default view: the spread, or on a narrow screen the page in view (the cover and back cover alone).
  view.zoom = 1;
  const single = narrow() || cur === 0 || cur === LEAVES;
  const s = cur === 0 ? "R" : cur === LEAVES ? "L" : side;
  view.tx = single ? (s === "R" ? W / 2 : -W / 2) : 0;
  view.ty = 0;
  ease();
}

function fitDistance() {
  const single = narrow() || cur === 0 || cur === LEAVES;
  const vw = (single ? W : 2 * W) * 1.06, vh = H * 1.04;
  const usable = (innerHeight - TOP() - BOT()) / innerHeight;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.max(vh / 2 / (tan * usable), vw / 2 / (tan * camera.aspect));
}

function applyCamera() {
  const d = fitDistance() / view.zoom;
  // Keep the bars from covering the page: shift the view by half the difference between the two bars.
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const shift = ((BOT() - TOP()) / innerHeight) * d * tan;
  camera.position.set(view.x, view.y - shift, d);
  camera.lookAt(view.x, view.y - shift, 0);
  document.getElementById("unzoom").hidden = view.zoom < 1.05;
}

let easing = false;
function ease() {
  if (easing) return;
  easing = true;
  const step = () => {
    view.x += (view.tx - view.x) * (reduceMotion ? 1 : 0.18);
    view.y += (view.ty - view.y) * (reduceMotion ? 1 : 0.18);
    render();
    if (Math.abs(view.tx - view.x) + Math.abs(view.ty - view.y) > 1e-4) requestAnimationFrame(step);
    else { view.x = view.tx; view.y = view.ty; easing = false; render(); }
  };
  step();
}

function clampView() {
  // Keep the view on the pages: what's in view is the page in view (narrow screens, cover) or the spread.
  const single = narrow() || cur === 0 || cur === LEAVES;
  const s = cur === 0 ? "R" : cur === LEAVES ? "L" : side;
  const [x0, x1] = single ? (s === "R" ? [0, W] : [-W, 0]) : [-W, W];
  const d = fitDistance() / view.zoom, tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfW = d * tan * camera.aspect, halfH = d * tan * (innerHeight - TOP() - BOT()) / innerHeight;
  const fit = (v, a, b, half) => (b - a <= 2 * half ? (a + b) / 2 : Math.max(a + half, Math.min(b - half, v)));
  view.tx = fit(view.tx, x0, x1, halfW);
  view.ty = fit(view.ty, -H / 2, H / 2, halfH);
}

function zoomTo(z, wx, wy) {
  const old = view.zoom;
  view.zoom = Math.max(1, Math.min(6, z));
  if (wx != null) {   // keep the point under the finger where it is
    view.tx = wx - (wx - view.tx) * old / view.zoom;
    view.ty = wy - (wy - view.ty) * old / view.zoom;
  }
  if (view.zoom === 1) return frame();
  clampView();
  view.x = view.tx; view.y = view.ty;
  render();
}

function worldAt(px, py) {
  const ndc = new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p);
  return p;
}

// ---------- Navigation ----------
function next() {
  if (turning) return finishTurn();
  if (narrow() && side === "L" && cur > 0 && cur < LEAVES) { side = "R"; return frame(), updateBar(); }
  if (cur < LEAVES) { side = "L"; turn(1); }
}
function prev() {
  if (turning) return finishTurn();
  if (narrow() && side === "R" && cur > 0 && cur < LEAVES) { side = "L"; return frame(), updateBar(); }
  if (cur > 0) { side = "R"; turn(-1); }
}

function goToFace(f, animateTurn = true) {
  const target = f % 2 === 0 ? f / 2 : (f + 1) / 2;
  side = f % 2 === 0 ? "R" : "L";
  if (target === cur) return frame(), showSpread();
  if (animateTurn && !reduceMotion && Math.abs(target - cur) > 0) {
    cur = target - Math.sign(target - cur);
    showSpread();
    turn(Math.sign(target - (cur)) || 1);
  } else {
    cur = target;
    showSpread();
    frame();
  }
}
const goToPage = (n, anim) => { const f = faceOfPage(n); if (f >= FRONT) goToFace(f, anim); };

function visibleFace() {
  if (cur === 0) return 0;
  if (cur === LEAVES) return 2 * LEAVES - 1;
  return narrow() ? (side === "R" ? 2 * cur : 2 * cur - 1) : 2 * cur;
}

function updateBar() {
  const f = visibleFace(), kind = FACES[f];
  const label = k => k && k.n ? `p. ${k.n}${k.letter ? ` · ${k.letter}` : ""}` : null;
  let text;
  if (narrow() || cur === 0 || cur === LEAVES) text = label(kind) || ({ cover: "Cover", backcover: "Back cover", title: "Title page", about: "This edition", fin: "Fin", endpaper: "" })[kind] || "";
  else {
    const l = label(FACES[2 * cur - 1]), r = label(FACES[2 * cur]);
    text = l && r ? `pp. ${FACES[2 * cur - 1].n}–${FACES[2 * cur].n}${FACES[2 * cur].letter ? ` · ${FACES[2 * cur].letter}` : ""}` : l || r || "";
  }
  document.getElementById("where").textContent = text || "Catálogo";
  document.getElementById("prev").disabled = cur === 0 && side === "R";
  document.getElementById("next").disabled = cur === LEAVES;
  const n = kind && kind.n;
  const hash = n ? `#p=${n}` : "";
  if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname);
}

// ---------- Search ----------
const searchIdx = new Map();
const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-zñ]/g, "");
async function lookup(q) {
  const k = fold(q);
  if (!k) return [];
  const letter = k[0];
  if (!searchIdx.has(letter)) searchIdx.set(letter, fetch(`data/s/${letter}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})));
  const names = await searchIdx.get(letter);
  const out = [];
  for (const [name, pages] of Object.entries(names)) {
    const f = fold(name);
    if (f.startsWith(k)) out.push([name, pages, f === k ? 0 : 1, f.length]);
  }
  return out.sort((a, b) => a[2] - b[2] || a[3] - b[3] || a[0].localeCompare(b[0])).slice(0, 8);
}

const q = document.getElementById("q"), hits = document.getElementById("hits");
let hitList = [], active = -1;
q.addEventListener("input", async () => {
  const v = q.value;
  const res = await lookup(v);
  if (q.value !== v) return;
  hitList = res;
  active = res.length ? 0 : -1;
  hits.innerHTML = res.length
    ? res.map(([name, pages], i) => `<li role="option" data-i="${i}" aria-selected="${i === 0}">${name}<small>p. ${pages.join(", ")}</small></li>`).join("")
    : (v.trim() ? `<li class="none">Not in our reading of the book (yet)</li>` : "");
  hits.hidden = !v.trim();
});
q.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + hitList.length) % Math.max(hitList.length, 1);
    [...hits.children].forEach((li, i) => li.setAttribute("aria-selected", i === active));
  } else if (e.key === "Escape") { hits.hidden = true; q.blur(); }
});
q.form.addEventListener("submit", e => { e.preventDefault(); if (hitList[active]) choose(hitList[active]); });
hits.addEventListener("click", e => { const li = e.target.closest("li[data-i]"); if (li) choose(hitList[+li.dataset.i]); });
document.addEventListener("pointerdown", e => { if (!e.target.closest(".search")) hits.hidden = true; });

async function choose([name, pages]) {
  hits.hidden = true;
  q.blur();
  q.value = name;
  const n = pages[0];
  highlight = { n, name };
  const f = faceOfPage(n);
  // Redraw the page with the name marked, then go there and zoom in on it.
  canvases.delete(f);
  for (const m of [false, true]) { textures.get(`${f}:${m}`)?.dispose(); textures.delete(`${f}:${m}`); }
  goToPage(n, false);
  const data = await loadPage(n);
  const e = data.e.find(x => x[4] === name);
  if (e) {
    const pageX = f % 2 === 0 ? 0 : -W;
    const wx = pageX + ((e[0] + e[2]) / 2 / SCAN_W) * W, wy = H / 2 - ((e[1] + e[3]) / 2 / SCAN_H) * H;
    setTimeout(() => { view.zoom = narrow() ? 3.2 : 4; view.tx = wx; view.ty = wy; clampView(); ease(); }, reduceMotion ? 0 : 350);
  }
  if (pages.length > 1) toast(`${name} is on pages ${pages.join(", ")}`);
  history.replaceState(null, "", `#p=${n}&n=${encodeURIComponent(name)}`);
}

let toastTimer;
function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------- Input ----------
const pointers = new Map();
let drag = null, lastTap = 0, pinch = null;
canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom, mid: worldAt((a.x + b.x) / 2, (a.y + b.y) / 2) };
    drag = null;
  } else drag = { x: e.clientX, y: e.clientY, vx: view.tx, vy: view.ty, moved: false, t: performance.now() };
});
canvas.addEventListener("pointermove", e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    zoomTo(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, pinch.mid.x, pinch.mid.y);
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 6) { drag.moved = true; canvas.classList.add("dragging"); }
  if (view.zoom > 1.05 && drag.moved) {
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z) / innerHeight;
    view.tx = drag.vx - dx * perPx;
    view.ty = drag.vy + dy * perPx;
    clampView();
    view.x = view.tx; view.y = view.ty;
    render();
  }
});
const up = e => {
  pointers.delete(e.pointerId);
  canvas.classList.remove("dragging");
  if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (drag.moved && view.zoom <= 1.05 && Math.abs(dx) > 40) (dx < 0 ? next : prev)();
  else if (!drag.moved) {
    const now = performance.now();
    if (now - lastTap < 300) {
      const p = worldAt(e.clientX, e.clientY);
      if (view.zoom > 1.05) frame(); else zoomTo(narrow() ? 3 : 3.5, p.x, p.y);
      lastTap = 0;
    } else {
      lastTap = now;
      const x = e.clientX;
      if (view.zoom <= 1.05) setTimeout(() => {
        if (lastTap !== now) return;   // it became a double tap
        if (x < innerWidth * 0.22) prev(); else if (x > innerWidth * 0.78) next();
      }, 310);
    }
  }
  drag = null;
};
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", up);
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const p = worldAt(e.clientX, e.clientY);
  zoomTo(view.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
}, { passive: false });

document.getElementById("next").onclick = next;
document.getElementById("prev").onclick = prev;
document.getElementById("unzoom").onclick = frame;
document.getElementById("info").onclick = () => document.getElementById("about").showModal();
document.getElementById("where").onclick = () => {
  const v = prompt("Go to page (1–141), or type a surname:");
  if (!v) return;
  if (/^\d+$/.test(v.trim())) {
    const n = +v.trim(), p = PAGES.find(x => x.n === n);
    if (p) goToPage(n); else toast("No such page");
  } else { q.value = v; q.dispatchEvent(new Event("input")); q.focus(); }
};
addEventListener("keydown", e => {
  if (e.target === q) return;
  if (e.key === "ArrowRight") next();
  else if (e.key === "ArrowLeft") prev();
  else if (e.key === "+" || e.key === "=") zoomTo(view.zoom * 1.4, view.x, view.y);
  else if (e.key === "-") zoomTo(view.zoom / 1.4, view.x, view.y);
  else if (e.key === "Escape") frame();
  else if (e.key === "/") { e.preventDefault(); q.focus(); }
});

// ---------- Render ----------
let queued = false;
function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    applyCamera();
    renderer.render(scene, camera);
  });
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  frame();
  updateBar();
}
addEventListener("resize", resize);

function radialShadow() {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = 512; c.height = 256;
  const r = g.createRadialGradient(256, 128, 40, 256, 128, 256);
  r.addColorStop(0, "rgba(0,0,0,.55)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 512, 256);
  return new THREE.CanvasTexture(c);
}

// For checking in the browser console.
window.__book = { view, scene, shadow, leaf, bendLeaf, get cur() { return cur; }, get side() { return side; }, goToPage, next, prev, render,
  snap() { view.x = view.tx; view.y = view.ty; render(); } };

// ---------- Start ----------
(async () => {
  await Promise.all([document.fonts.load(`40px ${FONT}`), document.fonts.load(`40px ${FONT_SC}`), document.fonts.load(`italic 40px ${FONT}`)]).catch(() => {});
  PAGES = await fetch("data/pages.json").then(r => r.json());
  FACES = ["cover", "endpaper", "title", "about", ...PAGES];
  if (FACES.length % 2 === 1) FACES.push(null);          // the last printed page's blank back
  FACES.push("fin", null, "endpaper", "backcover");   // the back cover is the back of the last leaf
  LEAVES = FACES.length / 2;
  const m = /p=(\d+)/.exec(location.hash), nm = /n=([^&]+)/.exec(location.hash);  // before resize() rewrites it
  resize();
  if (nm) {
    const res = await lookup(decodeURIComponent(nm[1]));
    const hit = res.find(r => fold(r[0]) === fold(decodeURIComponent(nm[1])));
    if (hit) return choose(hit);
  }
  if (m) goToPage(+m[1], false); else showSpread();
})();
