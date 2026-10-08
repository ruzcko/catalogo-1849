// The virtual Catálogo: a 3D book whose pages are set in type from the open transcription (no scan images).
// Pages are drawn on canvases on demand and turned with a bending leaf; only the open spread and the leaf being
// turned are real meshes, so it stays light on phones.
import * as THREE from "three";

// ---------- Reader help ----------
// Scan crops of the doubtful entries (the Filipinas Heritage Library's scan, one word per crop), served by Apelyido.
// Set to null to stop showing them.
const CROPS = "https://apelyido.ruzcko.com/scan/";
// A crop's cell in the strip (px, drawn at 2x): three lines, the entry's in the middle (LINE_Y, LINE_H). Cells sit
// ACROSS to a row: crop k is at column k % ACROSS, row k / ACROSS (see Apelyido's pipeline/catalogo_crops.py).
const CELL_W = 400, CELL_H = 128, LINE_Y = 32, LINE_H = 52, ACROSS = 4, CELL_PAD = 6;
const SITEKEY = "0x4AAAAAAFPGu217YHhvnzcG";       // Turnstile, so votes come from people
const STATUS = ["Read by a person", "Sure", "Likely", "Best guess", "Blurry"];
const WHY = [
  "A person typed this page from the scan.",
  "The OCR was confident, and people still carry this surname today.",
  "The OCR was confident, but nobody carries this name today: often an old native name.",
  "The OCR wasn't sure, or the reading breaks the book's alphabetical order. Probably right; help us check.",
  "The scan is blurry here and the OCR's reading is often wrong. Can you read it?"];

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
  centred(g, "Have a copy of the Catálogo, or know who does?", TEX_H / 2 + 110, 28, `italic ${FONT}`, "#6b5a45");
  centred(g, "Tap “Help fill this page” below.", TEX_H / 2 + 152, 28, `italic ${FONT}`, "#6b5a45");
}

function drawPrinted(g, side, page, data) {
  paper(g, side);
  const entries = layoutOf(data);
  const sizes = data.e.map(e => e[3] - e[1]).sort((a, b) => a - b);
  let size = Math.round((sizes[sizes.length >> 1] || 14) * S * 1.08);
  if (tidy && data.pitch) size = Math.min(size, Math.round(data.pitch * S * 0.86));   // even lines: fit the type to them
  // The reprint's thumb letter, then the running head: page number and letter, as on the scanned page.
  g.font = `bold ${Math.round(34 * S)}px Georgia, serif`;
  g.fillStyle = INK;
  g.fillText(page.letter, (side === "R" ? SCAN_W - 50 : 22) * S, 52 * S);
  g.font = `${Math.round(17 * S)}px ${FONT}`;
  g.fillText(String(page.n), (side === "R" ? 790 : 62) * S, 118 * S);
  centred(g, page.letter, 118 * S, Math.round(17 * S));
  g.font = `${size}px ${FONT}`;
  for (const [x0, y0, x1, y1, name, status] of entries) {
    if (sure && status === 4) {   // blurry: highlighted so it stands out
      g.fillStyle = "rgba(232, 150, 60, .32)";
      g.fillRect(x0 * S - 4, y0 * S - 2, Math.max(x1 - x0, 50) * S + 8, (y1 - y0) * S + 6);
    }
    if (highlight && highlight.n === page.n && highlight.name === name) {
      g.fillStyle = "rgba(240, 196, 60, .55)";
      g.fillRect(x0 * S - 6, y0 * S - 4, Math.max(x1 - x0, 60) * S + 12, (y1 - y0) * S + 10);
    }
    g.fillStyle = INK;
    g.globalAlpha = 0.82 + 0.18 * Math.abs(Math.sin(x0 * 12.9898 + y0 * 78.233));  // uneven 19th-century ink
    if (sure && status === 3) {   // best guess: faint, with a dotted underline
      g.globalAlpha = 0.5;
      g.setLineDash([3, 4]);
      g.strokeStyle = "rgba(120, 80, 30, .8)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0 * S, y1 * S + 2);
      g.lineTo(x0 * S + Math.min(g.measureText(name + ".").width, Math.max(x1 - x0, 40) * S * 1.12), y1 * S + 2);
      g.stroke();
      g.setLineDash([]);
    }
    // Squeeze a name into its box (plus a little), so two overlapping OCR lines don't run into each other.
    g.fillText(name + ".", x0 * S, y1 * S - 2 * S, Math.max(x1 - x0, 40) * S * 1.12);
    g.globalAlpha = 1;
  }
  centred(g, `[${page.n}]`, 1428 * S, Math.round(17 * S));
}

// Layout: "tidy" straightens a page into even columns and lines (the default); "scan" keeps every name where it
// sits on the scanned page, crooked as the scan is. Either way a line the OCR missed stays a gap.
let tidy = true;
try { tidy = localStorage.getItem("layout") !== "scan"; } catch {}
function layoutOf(data) {
  if (!tidy) return data.e;
  if (data.tidy) return data.tidy;
  const e = data.e, median = a => a.sort((x, y) => x - y)[a.length >> 1];
  const cols = Math.max(...e.map(x => x[6] || 1));
  const left = Math.min(...e.map(x => x[0])), right = Math.max(...e.map(x => x[2]));
  const top = Math.min(...e.map(x => x[1]));
  const h = median(e.map(x => x[3] - x[1])) || 14;
  // Line pitch: the usual step between one line and the next in a column.
  const steps = [];
  for (let i = 1; i < e.length; i++) if (e[i][6] === e[i - 1][6]) { const d = e[i][1] - e[i - 1][1]; if (d > 8 && d < 30) steps.push(d); }
  let pitch = steps.length ? median(steps) : 16.5;
  // The scan is slightly tilted, so each column counts lines from its own first line (when that line is near the
  // top; a column whose first lines the OCR missed counts from the page's top instead).
  const colTop = {};
  for (const x of e) colTop[x[6]] = Math.min(colTop[x[6]] ?? Infinity, x[1]);
  for (const c in colTop) if (colTop[c] - top > 1.5 * pitch) colTop[c] = top;
  const slotted = [];
  let prevCol = null, prevSlot = -1;
  for (const x of e) {
    if (x[6] !== prevCol) { prevCol = x[6]; prevSlot = -1; }
    const slot = Math.max(Math.round((x[1] - colTop[x[6]]) / pitch), prevSlot + 1);
    prevSlot = slot;
    slotted.push([x, slot]);
  }
  const last = Math.max(...slotted.map(([, sl]) => sl));
  if (top + (last + 1) * pitch > 1415) pitch = (1415 - top) / (last + 1);   // keep clear of the page number
  const colW = (right - left) / cols;
  data.pitch = pitch;
  data.tidy = slotted.map(([x, slot]) => {
    const x0 = left + ((x[6] || 1) - 1) * colW, y0 = top + slot * pitch;
    return [Math.round(x0), Math.round(y0), Math.round(x0 + colW * 0.92), Math.round(y0 + h), x[4], x[5], x[6]];
  });
  return data.tidy;
}

function setLayout(t) {
  tidy = t;
  try { localStorage.setItem("layout", t ? "tidy" : "scan"); } catch {}
  document.getElementById("layout").textContent = t ? "Tidy" : "As scanned";
  document.getElementById("layout").setAttribute("aria-pressed", String(!t));
  for (const f of [...canvases.keys()]) {
    canvases.delete(f);
    for (const m of [false, true]) { textures.get(`${f}:${m}`)?.dispose(); textures.delete(`${f}:${m}`); }
  }
  order.length = 0;
  showSpread();
  toast(t ? "Tidy: columns straightened" : "As scanned: names where they sit on the scan");
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
    ["Filipinas Heritage Library. Each name keeps its", 30, FONT, 44],
    ["column and line from the scan; some readings are", 30, FONT, 44],
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
  // Help for a missing page in view.
  const inView = narrow() || cur === 0 || cur === LEAVES ? [kind] : [FACES[2 * cur - 1], FACES[2 * cur]];
  const gap = inView.find(k => k && k.missing);
  const help = document.getElementById("help");
  help.hidden = !gap;
  if (gap) {
    help.querySelector("b").textContent = `Page ${gap.n}`;
    help.querySelector("a").href = `mailto:hello@ruzcko.com?subject=${encodeURIComponent(`Catálogo 1849, page ${gap.n}`)}&body=${encodeURIComponent(
      `Hi! About page ${gap.n} of the Catálogo alfabético de apellidos, which is missing from the scan:\n\n` +
      `[ ] I have a copy (which edition? 1849 original / 1973 National Archives reprint / other)\n` +
      `[ ] I know a library or person who has one: \n[ ] I can send a photo of the page\n\n`)}`;
  }
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
  const e = layoutOf(data).find(x => x[4] === name);
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

// ---------- How sure? and reading help ----------
let sure = false;
try { sure = localStorage.getItem("sure") === "1"; } catch {}
function redrawAll() {
  for (const f of [...canvases.keys()]) {
    canvases.delete(f);
    for (const m of [false, true]) { textures.get(`${f}:${m}`)?.dispose(); textures.delete(`${f}:${m}`); }
  }
  order.length = 0;
  showSpread();
}
function setSure(on) {
  sure = on;
  try { localStorage.setItem("sure", on ? "1" : "0"); } catch {}
  document.getElementById("sure").setAttribute("aria-pressed", String(on));
  redrawAll();
  if (on) toast("Faint: our best guess · Orange: blurry. Tap one to help read it.");
}

const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
const device = (() => {   // a random code for this browser, so one device gets one vote per entry
  try {
    let d = localStorage.getItem("device");
    if (!d) { d = randomId(); localStorage.setItem("device", d); }
    return d;
  } catch { return randomId(); }
})();
const voted = id => { try { return localStorage.getItem(`voted:${id}`); } catch { return null; } };

// The entry under a tap, if any: which page was hit, and which name's box (in the current layout).
async function entryAt(px, py) {
  if (turning || cur === 0 || cur === LEAVES) return null;
  const p = worldAt(px, py);
  const right = p.x >= 0, f = right ? 2 * cur : 2 * cur - 1, kind = FACES[f];
  if (!kind || !kind.n || kind.missing) return null;
  if (narrow() && (right ? "R" : "L") !== side) return null;
  const sx = ((p.x - (right ? 0 : -W)) / W) * SCAN_W, sy = ((H / 2 - p.y) / H) * SCAN_H;
  const data = await loadPage(kind.n);
  let best = null, bestD = Infinity;
  for (const e of layoutOf(data)) {
    if (sx < e[0] - 6 || sx > Math.max(e[2], e[0] + 40) + 6 || sy < e[1] - 4 || sy > e[3] + 4) continue;
    const d = Math.abs(sy - (e[1] + e[3]) / 2);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best && { page: kind, scan: data.scan, e: best, orig: data.e.find(x => x[6] === best[6] && x[7] === best[7]) };
}

async function openEntryAt(px, py) {
  const hit = await entryAt(px, py);
  if (!hit) return false;
  if (hit.e[5] <= 2) { toast(`${hit.e[4]}: ${STATUS[hit.e[5]].toLowerCase()}. We're confident about this one.`); return true; }
  openEntry(hit);
  return true;
}

let turnstileReady = null;
function loadTurnstile() {
  turnstileReady ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  return turnstileReady;
}

const dlg = document.getElementById("entry");
async function openEntry({ page, scan, e, orig = e }) {
  const [, , , , name, status, col, row, raw, crop] = e;
  // The crop, cut to the word's width and shown as large as fits.
  const wordW = Math.min(CELL_W, (orig[2] - orig[0] + CELL_PAD + 10) * 2);
  const room = Math.min(innerWidth - 72, 400);
  // Just the entry's line, as large as fits; or the three lines around it, with the entry outlined.
  const cropStyle = around => {
    const k = around ? Math.min(1, room / CELL_W) : Math.min(1.25, room / wordW);
    const cx = (crop % ACROSS) * CELL_W, cy = Math.floor(crop / ACROSS) * CELL_H + (around ? 0 : LINE_Y);
    return { k, css: `background-image:url('${CROPS}${scan}.webp');background-size:${CELL_W * ACROSS * k}px auto;` +
      `background-position:-${cx * k}px -${cy * k}px;width:${(around ? CELL_W : wordW) * k}px;height:${(around ? CELL_H : LINE_H) * k}px` };
  };
  const id = `${scan}.${col}.${row}`;
  history.replaceState(null, "", `#e=${id}`);
  dlg.innerHTML = `
    <div class="eh"><h2>${esc(name)}.</h2><span class="chip s${status}">${STATUS[status]}</span><button type="button" class="x" aria-label="Close">✕</button></div>
    <p class="why">${WHY[status]}</p>
    ${CROPS && crop != null ? `<figure class="crop"><div class="img" style="${cropStyle(false).css}"><span class="mark" hidden></span></div>
      <figcaption>The scan, page ${page.n} · Filipinas Heritage Library · <button type="button" class="around">Show the lines around it</button></figcaption></figure>` : ""}
    <p class="small order" hidden></p>
    ${raw ? `<p class="small">The OCR read <b>${esc(raw)}</b>; we read <b>${esc(name)}</b>.</p>` : ""}
    <form class="readings" autocomplete="off">
      <p class="q">How do you read it?</p>
      <div class="opts"><p class="small">Loading…</p></div>
      <label class="own">Something else: <input name="own" maxlength="20" spellcheck="false" autocapitalize="off" placeholder="type your reading"></label>
      <p class="err" role="alert"></p>
      <div class="ts"></div>
      <div class="acts"><button type="submit" class="primary">Vote</button><button type="button" class="notsure">Not sure, just show the votes</button></div>
    </form>
    <div class="tally" hidden></div>`;
  dlg.showModal();
  dlg.querySelector(".x").onclick = () => dlg.close();
  const form = dlg.querySelector("form"), err = dlg.querySelector(".err");
  let res;
  try { res = await fetch(`/api/entry?id=${encodeURIComponent(id)}`).then(r => r.json()); } catch { res = null; }
  if (!res?.ok) { dlg.querySelector(".opts").innerHTML = `<p class="small">Couldn't load the readings. Try again later.</p>`; return; }
  const mine = voted(id);
  if (mine) return showTally(res.options, mine);
  // The book is in order on the first three letters, so its neighbours narrow down how it can start.
  if (res.prev || res.next) {
    const o = dlg.querySelector(".order");
    o.innerHTML = res.prev && res.next ? `In the book it comes between <b>${esc(res.prev)}</b> and <b>${esc(res.next)}</b>.`
      : res.prev ? `In the book it comes after <b>${esc(res.prev)}</b>.` : `In the book it comes before <b>${esc(res.next)}</b>.`;
    o.hidden = false;
  }
  const aroundBtn = dlg.querySelector(".around");
  if (aroundBtn) aroundBtn.onclick = () => {
    const img = dlg.querySelector(".crop .img"), mark = img.querySelector(".mark"), around = mark.hidden;
    const { k, css } = cropStyle(around);
    img.style.cssText = css;
    mark.hidden = !around;
    if (around) mark.style.cssText = `top:${LINE_Y * k}px;height:${LINE_H * k}px;width:${wordW * k}px`;
    aroundBtn.textContent = around ? "Just this line" : "Show the lines around it";
  };
  dlg.querySelector(".opts").innerHTML = res.options.map(o =>
    `<label><input type="radio" name="pick" value="${esc(o.r)}"> ${esc(o.r)}${o.ours ? ` <small>our reading</small>` : ""}</label>`).join("");
  form.own.addEventListener("input", () => { form.querySelectorAll("input[name=pick]").forEach(r => { r.checked = false; }); });
  form.querySelectorAll("input[name=pick]").forEach(r => r.addEventListener("change", () => { form.own.value = ""; }));
  dlg.querySelector(".notsure").onclick = () => showTally(res.options, null);
  let token = "";
  loadTurnstile().then(() => {
    if (!dlg.open) return;
    window.turnstile.render(dlg.querySelector(".ts"), { sitekey: SITEKEY, size: "flexible", callback: t => { token = t; } });
  }).catch(() => { err.textContent = "Couldn't load the spam check. Try again later."; });
  form.onsubmit = async ev => {
    ev.preventDefault();
    const pick = form.querySelector("input[name=pick]:checked")?.value, own = form.own.value.trim();
    const reading = own || pick;
    if (!reading) { err.textContent = "Pick a reading or type your own."; return; }
    if (!token) { err.textContent = "One moment: we're checking you're a person."; return; }
    err.textContent = "";
    const r = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, reading, device, token }) }).then(x => x.json()).catch(() => null);
    if (r?.ok || r?.error === "already") {
      try { localStorage.setItem(`voted:${id}`, reading); } catch {}
      showTally(r.options, reading, r.pending);
    } else {
      err.textContent = r?.message || (r?.error === "verify" ? "The spam check failed. Please try again." : "Couldn't save your vote. Try again later.");
      token = "";
      try { window.turnstile?.reset(dlg.querySelector(".ts")); } catch {}
    }
  };
}

// The tally: shown after you vote, or when you choose "Not sure" (so votes aren't swayed by the count).
function showTally(options, mine, pending) {
  const total = options.reduce((a, o) => a + o.v, 0), top = Math.max(...options.map(x => x.v), 1);
  const list = [...options].sort((a, b) => b.v - a.v);
  const box = dlg.querySelector(".tally");
  box.innerHTML = `<p class="q">${mine ? "Thanks! Here's how readers read it:" : "How readers read it so far:"}</p>` +
    (total ? list.map(o => `<div class="bar${o.r === mine ? " me" : ""}"><i style="width:${Math.round(100 * o.v / top)}%"></i>
      <span>${esc(o.r)}${o.ours ? " <small>our reading</small>" : ""}</span><b>${o.v}</b></div>`).join("") : `<p class="small">No votes yet. Be the first!</p>`) +
    (pending ? `<p class="small">Your own reading shows here once someone else reads it the same way.</p>` : "") +
    `<p class="small">When readers agree, we check it and fix the dataset for everyone.</p>`;
  box.hidden = false;
  if (mine) dlg.querySelector("form").hidden = true;
  else dlg.querySelector(".notsure").hidden = true;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
      const x = e.clientX, y = e.clientY;
      setTimeout(async () => {
        if (lastTap !== now) return;   // it became a double tap
        if (sure && await openEntryAt(x, y)) return;
        if (view.zoom <= 1.05) { if (x < innerWidth * 0.22) prev(); else if (x > innerWidth * 0.78) next(); }
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
document.getElementById("layout").onclick = () => setLayout(!tidy);
document.getElementById("sure").onclick = () => setSure(!sure);
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
// Links: #p=58 opens a page, #n=fabella finds a name and marks it, #e=100.1.6 opens one entry's reading help.
// Followed on arrival and whenever the address's # part changes (a link clicked while the book is open).
async function follow(hash) {
  const m = /p=(\d+)/.exec(hash), nm = /n=([^&]+)/.exec(hash), ent = /e=(\d{2,3})\.(\d{1,2})\.(\d{1,3})/.exec(hash);
  if (dlg.open) dlg.close();
  if (ent) {
    const page = PAGES.find(p => p.scan === +ent[1]);
    if (page) {
      goToPage(page.n, false);
      const data = await loadPage(page.n);
      const e = data.e.find(x => x[6] === +ent[2] && x[7] === +ent[3]);
      if (e && e[5] >= 3) { if (!sure) setSure(true); openEntry({ page, scan: data.scan, e }); }
      return true;
    }
  }
  if (nm) {
    const res = await lookup(decodeURIComponent(nm[1]));
    const hit = res.find(r => fold(r[0]) === fold(decodeURIComponent(nm[1])));
    if (hit) { choose(hit); return true; }
  }
  if (m) { goToPage(+m[1], false); return true; }
  return false;
}
addEventListener("hashchange", () => follow(location.hash));

(async () => {
  await Promise.all([document.fonts.load(`40px ${FONT}`), document.fonts.load(`40px ${FONT_SC}`), document.fonts.load(`italic 40px ${FONT}`)]).catch(() => {});
  PAGES = await fetch("data/pages.json").then(r => r.json());
  FACES = ["cover", "endpaper", "title", "about", ...PAGES];
  if (FACES.length % 2 === 1) FACES.push(null);          // the last printed page's blank back
  FACES.push("fin", null, "endpaper", "backcover");   // the back cover is the back of the last leaf
  LEAVES = FACES.length / 2;
  const hash = location.hash;   // before resize() rewrites it
  resize();
  document.getElementById("layout").textContent = tidy ? "Tidy" : "As scanned";
  document.getElementById("sure").setAttribute("aria-pressed", String(sure));
  if (!(await follow(hash))) showSpread();
})();
