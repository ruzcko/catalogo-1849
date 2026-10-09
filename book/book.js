// The virtual Catálogo: a 3D book whose pages are set in type from the open transcription (no scan images).
// Pages are drawn on canvases on demand and turned with a bending leaf; only the open spread and the leaf being
// turned are real meshes, so it stays light on phones.
import * as THREE from "three";

// ---------- Reader help ----------
// Scan crops of the doubtful entries (Google's scan of the University of Michigan copy, a few lines per crop), served
// by Apelyido.
// Set to null to stop showing them.
const CROPS = "https://apelyido.ruzcko.com/scan/";
const CROPS_V = 9;                               // the strips' folder (/scan/9/): a new set goes in a new folder
// A crop's cell in the strip (px, drawn at 1.5x): three lines, the entry's in the middle (LINE_Y, LINE_H). Cells sit
// ACROSS to a row: crop k is at column k % ACROSS, row k / ACROSS (see Apelyido's pipeline/catalogo_crops.py).
const CELL_W = 300, CELL_H = 96, LINE_Y = 24, LINE_H = 39, ACROSS = 4, CELL_PAD = 6;
// The book's data (book/data) is fetched with this release's version, the ?v= index.html puts on book.js, so a new
// release never meets a page file the browser kept from the last one.
const DATA_V = new URL(import.meta.url).searchParams.get("v") || "0", dataUrl = path => `/data/${path}?v=${DATA_V}`;
// The scanned pages, for the Scan view: Google's scan of the University of Michigan copy, one image per page, served
// by Apelyido from /scan/pages/<version>/<page>.webp (with CORS, as the book draws them into WebGL textures). Its
// meta.json says how the dataset's boxes (Google px, a page 2,400 wide) map to image px: image = box x scale +
// offset ({"scale": 0.667, "offset": [0, 0], ...}); without it an image is taken to be the whole page, scaled.
// ?scans=<base> tries another host while developing (an Apelyido preview, or a folder on this site).
const SCANS = (() => {
  try {
    const s = new URLSearchParams(location.search).get("scans");
    if (s && (/^\/[\w/-]*\/$/.test(s) || /^https:\/\/[\w-]+\.apelyido\.pages\.dev\/[\w/-]*\/$/.test(s))) return s;
  } catch {}
  return "https://apelyido.ruzcko.com/scan/pages/";
})();
const SCANS_V = 1;
const SCAN_CREDIT = "Digitized by Google from the University of Michigan's copy (1973 National Archives reprint)";
const GW = 2400, GH = 3882;                       // Google's page, in the dataset's pixels
const SITEKEY = "0x4AAAAAAFPGu217YHhvnzcG";       // Turnstile, so votes come from people
const STATUS = ["Read by a person", "Sure", "Likely", "Best guess", "Blurry"];
// A line neither scan could read is "?" in the data, "unread" in its address (/2/unread, /2/unread-3).
const unread = name => !/\p{L}/u.test(name), slug = name => (unread(name) ? "unread" : name);
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });   // the room is the page's background
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
renderer.setClearColor(0x000000, 0);
const camera = new THREE.PerspectiveCamera(16, 1, 0.01, 80);   // a long lens: a lifted page doesn't loom
// Unlit materials: the pages show their drawn colours exactly; the turning leaf is shaded in its shader.

// A soft shadow under the book.
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2 * W * 1.18, H * 1.12),
  new THREE.MeshBasicMaterial({ map: radialShadow(), transparent: true, depthWrite: false }));
shadow.position.z = -0.02;
scene.add(shadow);

// Solid shapes, unlit like the pages: each side its own shade (box faces: +x, -x, +y, -y, +z, -z), so the closed book
// reads as a block when it's seen at an angle. The front edge (-y) faces the reader then.
const shaded = (hex, sides) => sides.map(k => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) }));
const paperEdge = shaded(0xd8c9a8, [0.84, 0.84, 0.7, 0.93, 1, 0.6]);
const stackL = new THREE.Mesh(new THREE.BoxGeometry(W, H, 1), paperEdge);
const stackR = new THREE.Mesh(new THREE.BoxGeometry(W, H, 1), paperEdge);
scene.add(stackL, stackR);
// The hard covers' boards, under the pages and a little larger, in the cover's leather.
const BOARD = 0.014, OVER = 0.02;
const boardMat = shaded(0x5a1d16, [0.7, 0.7, 0.6, 0.85, 1, 0.5]);
const boardL = new THREE.Mesh(new THREE.BoxGeometry(W + OVER, H + 2 * OVER, BOARD), boardMat);
const boardR = new THREE.Mesh(new THREE.BoxGeometry(W + OVER, H + 2 * OVER, BOARD), boardMat);
scene.add(boardL, boardR);

const pageMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff });
const leftPage = new THREE.Mesh(new THREE.PlaneGeometry(W, H), pageMat());
leftPage.geometry.translate(-W / 2, 0, 0);
const rightPage = new THREE.Mesh(new THREE.PlaneGeometry(W, H), pageMat());
rightPage.geometry.translate(W / 2, 0, 0);
scene.add(leftPage, rightPage);

// The leaf being turned: a finely divided sheet, bent on the graphics card. It turns about the spine (x = 0), from
// angle 0 (lying on the right) to π (lying on the left). Along the sheet the angle changes by k per unit, so it bows
// like paper (a circular arc, in closed form), and "twist" makes one corner lead, as when it's grabbed high or low.
// Its shade comes from how the surface faces the reader: darker as it turns away, a faint sheen along the crest.
const LEAF_VS = `
uniform float uTheta, uK, uTwist, uHalfH, uW;
varying vec2 vUv;
varying float vNz;
void main() {
  vUv = uv;
  float u = position.x, v = position.y;
  float k = uK + uTwist * (v / uHalfH) / uW;
  float a = uTheta + k * u;
  vec3 p = abs(k) < 1e-4 ? vec3(u * cos(uTheta), v, u * sin(uTheta))
                         : vec3((sin(a) - sin(uTheta)) / k, v, (cos(uTheta) - cos(a)) / k);
  vNz = cos(a);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const LEAF_FS = `
uniform sampler2D map;
uniform float uBack;
varying vec2 vUv;
varying float vNz;
void main() {
  vec2 uv = uBack > 0.5 ? vec2(1.0 - vUv.x, vUv.y) : vUv;
  float facing = uBack > 0.5 ? -vNz : vNz;
  float shade = 0.66 + 0.34 * clamp(facing, 0.0, 1.0) + 0.06 * pow(1.0 - abs(vNz), 8.0);
  gl_FragColor = vec4(texture2D(map, uv).rgb * shade, 1.0);
  #include <colorspace_fragment>
}`;
const SEG_X = 72, SEG_Y = 24;
const leafGeo = new THREE.PlaneGeometry(W, H, SEG_X, SEG_Y);
leafGeo.translate(W / 2, 0, 0);
const bend = { uTheta: { value: 0 }, uK: { value: 0 }, uTwist: { value: 0 }, uHalfH: { value: H / 2 }, uW: { value: W } };
const leafMat = back => new THREE.ShaderMaterial({ vertexShader: LEAF_VS, fragmentShader: LEAF_FS,
  side: back ? THREE.BackSide : THREE.FrontSide, uniforms: { ...bend, map: { value: null }, uBack: { value: back ? 1 : 0 } } });
const leafFront = new THREE.Mesh(leafGeo, leafMat(false));
const leafBack = new THREE.Mesh(leafGeo, leafMat(true));
leafFront.frustumCulled = leafBack.frustumCulled = false;   // the shader moves it; its box doesn't know
const leaf = new THREE.Group();
leaf.add(leafFront, leafBack);
leaf.visible = false;
scene.add(leaf);

// The shadow the lifted leaf casts on the page beneath it: a soft band just beyond its edge.
const castShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, H),
  new THREE.MeshBasicMaterial({ map: edgeShadow(), transparent: true, depthWrite: false, opacity: 0 }));
castShadow.visible = false;
scene.add(castShadow);

// Put the leaf at t (0 = lying on the right, 1 = lying on the left). dir: +1 turning forward, -1 back; the free edge
// lags behind the spine. twist: -1..1, which corner leads (where it was grabbed).
function poseLeaf(t, dir, twist = 0) {
  const rigid = T && T.rigid;                     // a cover: a stiff board, it doesn't bow
  const lift = Math.sin(Math.PI * t), theta = Math.PI * t, k = rigid ? 0 : -dir * 0.9 * lift / W;
  bend.uTheta.value = theta;
  bend.uK.value = k;
  bend.uTwist.value = rigid ? 0 : 0.35 * twist * lift;
  // Where the free edge is (at mid height), and how high: the shadow falls just beyond it, on the page below.
  const edge = Math.abs(k) < 1e-6 ? W * Math.cos(theta) : (Math.sin(theta + k * W) - Math.sin(theta)) / k;
  const width = 0.5 * W * lift + 0.02;
  const onRight = edge >= 0;
  castShadow.visible = lift > 0.01;
  castShadow.scale.x = onRight ? width : -width;
  castShadow.position.x = onRight ? Math.min(edge, W) + width / 2 : Math.max(edge, -W) - width / 2;
  castShadow.material.opacity = 0.5 * lift;
}

// ---------- Drawing pages ----------
const FONT = '"IM Fell English", Georgia, serif', FONT_SC = '"IM Fell English SC", Georgia, serif';
const INK = "#2a2017";
const textures = new Map();                      // key "face:side" -> texture (side R: gutter on the left)
const canvases = new Map();                      // key "face:side" -> canvas
const order = [];                                // least recently used keys first
const BLANK = -1;                                // the plain paper back of a page in single-page mode
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
  centred(g, `Page ${n}`, TEX_H / 2 - 40, 54, FONT);
  g.font = `italic 34px ${FONT}`;
  centred(g, "has no transcription yet.", TEX_H / 2 + 20, 34, `italic ${FONT}`);
  centred(g, "Have a copy of the Catálogo, or a clear photo of this page?", TEX_H / 2 + 110, 28, `italic ${FONT}`, "#6b5a45");
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
  for (const e of entries) {
    const [x0, y0, x1, y1, name, status] = e;
    if (sure && status === 4) {   // blurry: highlighted so it stands out
      g.fillStyle = "rgba(232, 150, 60, .32)";
      g.fillRect(x0 * S - 4, y0 * S - 2, Math.max(x1 - x0, 50) * S + 8, (y1 - y0) * S + 6);
    }
    if (marked(page, e)) {
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

// Views: "tidy" sets the names in even columns and lines (the default); "inplace" sets each name where it sits on the
// scanned page, crooked as the scan is; "scan" shows the scanned page itself. Either typeset view leaves a gap where
// the OCR missed a line. The view is remembered per browser (?view= picks one).
const VIEWS = { tidy: ["Tidy", "Tidy: the names set in straight columns"],
  inplace: ["In place", "In place: the names set where they sit on the page"],
  scan: ["Scan", "Scan: the scanned page itself, digitized by Google from the University of Michigan's copy"] };
let pageView = "tidy";
try {
  const old = localStorage.getItem("layout");   // before there were three views: "scan" meant in place
  pageView = new URLSearchParams(location.search).get("view") || localStorage.getItem("view") || (old === "scan" ? "inplace" : "tidy");
} catch {}
if (!VIEWS[pageView]) pageView = "tidy";
let tidy = pageView === "tidy";
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
    return [Math.round(x0), Math.round(y0), Math.round(x0 + colW * 0.92), Math.round(y0 + h), ...x.slice(4)];   // name, status, column, row, other reading, crop
  });
  return data.tidy;
}

function viewButton() {
  const b = document.getElementById("layout"), keys = Object.keys(VIEWS), nextView = keys[(keys.indexOf(pageView) + 1) % keys.length];
  b.textContent = VIEWS[pageView][0];
  b.title = `${VIEWS[pageView][1]}. Tap for ${VIEWS[nextView][0]}.`;
  b.setAttribute("aria-label", `View: ${VIEWS[pageView][0]}. Switch to ${VIEWS[nextView][0]}`);
  canvas.setAttribute("aria-label", `The book${pageView === "scan" ? ", showing the scanned pages" : ""}. Drag or use the arrow keys to turn pages; ` +
    "double-tap to zoom. The names on the open pages are listed by the first button.");
}
function setView(v) {
  pageView = v;
  tidy = v === "tidy";
  try { localStorage.setItem("view", v); } catch {}
  viewButton();
  forget();
  show();
  toast(VIEWS[v][1]);
}

const pageData = new Map();
let noStore = false;   // set once the server says a page changed: fetch past any cached copy from then on
async function loadPage(n) {
  if (!pageData.has(n)) pageData.set(n, fetch(dataUrl(`p/${n}.json`), noStore ? { cache: "no-store" } : {}).then(r => r.json()));
  return pageData.get(n);
}

function faceCanvas(f, side) {
  const key = `${f}:${side}`;
  if (canvases.has(key)) return canvases.get(key);
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  canvases.set(key, c);
  drawFace(f, c, side);
  return c;
}

// Forget drawn pages (all, or one face), so they're drawn afresh: after a layout change, a search mark, "How sure?".
function forget(f) {
  for (const key of [...canvases.keys()]) {
    if (f != null && !key.startsWith(`${f}:`)) continue;
    canvases.delete(key);
    textures.get(key)?.dispose();
    textures.delete(key);
    const i = order.indexOf(key);
    if (i >= 0) order.splice(i, 1);
  }
}

function drawFace(f, c, side) {
  const g = c.getContext("2d"), kind = f === BLANK ? null : FACES[f];
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
    ["Philippines' 1973 reprint, read from two scans:", 30, FONT, 44],
    ["Google's (University of Michigan copy) and the", 30, FONT, 44],
    ["Filipinas Heritage Library's. Each name keeps its", 30, FONT, 44],
    ["column and line; some readings are uncertain.", 30, FONT, 120],
    ["The 1849 text is in the public domain.", 28, `italic ${FONT}`, 44],
    ["Transcription CC BY 4.0 · apelyido.ruzcko.com", 26, FONT, 0]], 560);
  else if (kind === "fin") drawText(g, side, [["FIN.", 64, FONT_SC, 120],
    ["About 60,000 surnames, sent to every province in 1849.", 30, `italic ${FONT}`, 50],
    ["Find yours at apelyido.ruzcko.com", 30, FONT, 0]], 700);
  else if (kind && kind.missing) drawMissing(g, side, kind.n);
  else if (kind) {
    paper(g, side);
    loadPage(kind.n).then(data => {
      drawPrinted(g, side, kind, data);
      if (pageView === "scan") loadingNote(g);
      refreshFace(f, side);
      if (pageView !== "scan") return;
      Promise.all([scanImage(kind.scan), scanMeta()]).then(([img, meta]) => {
        if (canvases.get(`${f}:${side}`) !== c) return;   // forgotten meanwhile (another view, or out of memory)
        if (img) drawScan(g, kind, data, img, meta);
        else { drawPrinted(g, side, kind, data); loadingNote(g, "The scan of this page didn't load."); }
        refreshFace(f, side);
      });
    });
  } else paper(g, side);
}

// ---------- The scanned pages (Scan view) ----------
const scanImages = new Map();                     // scan number -> Promise of its image (or null), the last ten
let scanMetaP = null;
const scanMeta = () => (scanMetaP ||= fetch(`${SCANS}${SCANS_V}/meta.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
function scanImage(n) {
  if (!scanImages.has(n)) {
    scanImages.set(n, new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = "anonymous";              // drawn into a WebGL texture: it must come with CORS
      img.decoding = "async";
      img.alt = `Scan of page ${n}`;
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `${SCANS}${SCANS_V}/${n}.webp`;
    }));
    while (scanImages.size > 10) scanImages.delete(scanImages.keys().next().value);
  }
  return scanImages.get(n);
}
function loadingNote(g, text = "Loading the scan…") {
  g.save();
  g.font = `italic ${Math.round(15 * S)}px ${FONT}`;
  const w = g.measureText(text).width + 28 * S;
  g.fillStyle = "rgba(42, 32, 23, .78)";
  g.fillRect((TEX_W - w) / 2, 70 * S, w, 26 * S);
  g.fillStyle = "#f3ead6";
  g.textAlign = "center";
  g.fillText(text, TEX_W / 2, 88 * S);
  g.restore();
}
// The scan, drawn so the dataset's boxes land on their lines: Google px -> image px by meta.json (or the image's own
// width), and Google px -> texture px by the page's size.
function drawScan(g, page, data, img, meta) {
  const scale = (meta && meta.scale) || img.naturalWidth / GW, [dx, dy] = (meta && meta.offset) || [0, 0];
  const kx = TEX_W / GW, ky = TEX_H / GH;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, TEX_W, TEX_H);
  g.drawImage(img, (-dx / scale) * kx, (-dy / scale) * ky, (img.naturalWidth / scale) * kx, (img.naturalHeight / scale) * ky);
  if (!page.hand) {                               // a hand-typed page's entries have no positions on the scan
    for (const e of data.e) {
      const [x0, y0, x1, y1, , status] = e, x = x0 * S - 5, y = y0 * S - 3, w = Math.max(x1 - x0, 40) * S + 10, h = (y1 - y0) * S + 6;
      if (marked(page, e)) {
        g.fillStyle = "rgba(240, 196, 60, .28)";
        g.fillRect(x - 3, y - 3, w + 6, h + 6);
        g.strokeStyle = "#c9561a";
        g.lineWidth = 4;
        g.strokeRect(x - 3, y - 3, w + 6, h + 6);
      } else if (sure && status >= 3) {          // How sure?: blurry ones washed orange, best guesses dotted
        if (status === 4) { g.fillStyle = "rgba(232, 150, 60, .22)"; g.fillRect(x, y, w, h); }
        g.setLineDash(status === 4 ? [] : [4, 4]);
        g.strokeStyle = status === 4 ? "rgba(214, 120, 30, .9)" : "rgba(120, 80, 30, .7)";
        g.lineWidth = 2;
        g.strokeRect(x, y, w, h);
        g.setLineDash([]);
      }
    }
  }
  g.save();
  g.font = `italic ${Math.round(11 * S)}px ${FONT}`;
  g.fillStyle = "rgba(42, 32, 23, .7)";
  g.textAlign = "center";
  g.fillText(SCAN_CREDIT, TEX_W / 2, TEX_H - 10 * S);
  g.restore();
}
const marked = (page, e) => highlight && highlight.n === page.n && highlight.name === e[4] &&
  (highlight.col == null || (highlight.col === e[6] && highlight.row === e[7]));

function refreshFace(f, side) {
  const t = textures.get(`${f}:${side}`);
  if (t) t.needsUpdate = true;
  render();
}

function texture(f, side) {
  const key = `${f}:${side}`;
  if (!textures.has(key)) {
    const t = new THREE.CanvasTexture(faceCanvas(f, side));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures.set(key, t);
  }
  const i = order.indexOf(key);
  if (i >= 0) order.splice(i, 1);
  order.push(key);
  while (order.length > 12) {                     // keep a dozen pages in memory
    const old = order.shift();
    canvases.delete(old);
    textures.get(old)?.dispose();
    textures.delete(old);
  }
  return textures.get(key);
}

// Show face f (drawn for side "R" or "L") on a mesh, or hide the mesh if there's no such face.
function setMap(mesh, f, side) {
  mesh.visible = f === BLANK || (f >= 0 && f < FACES.length);
  if (!mesh.visible) return;
  const tex = texture(f, side);
  if (mesh.material.uniforms) mesh.material.uniforms.map.value = tex;
  else { mesh.material.map = tex; mesh.material.needsUpdate = true; }
}

// ---------- What's open: a spread (wide screens) or one page (narrow) ----------
// Wide screens show the open book: the left page is face 2cur-1, the right page face 2cur. Narrow screens show one
// page at a time, never panning: the page turns away over the spine to reveal the next (SINGLE[si]).
let mode = "spread";
let cur = 0;                 // spread: leaves turned so far
let SINGLE = [], si = 0;     // single: the faces shown one by one (no blank backs or endpapers), and which is open
let T = null;                // the turn in progress: {dir, t, twist, from, done, anim}
const wantMode = () => (innerWidth / innerHeight < 0.95 ? "single" : "spread");
const sideOf = f => (mode === "single" ? "R" : f % 2 === 0 ? "R" : "L");

// The faces in view, each with the x where its page starts.
function inView() {
  if (mode === "single") return [{ f: SINGLE[si], x0: 0 }];
  return [{ f: 2 * cur - 1, x0: -W }, { f: 2 * cur, x0: 0 }].filter(v => v.f >= 0 && v.f < FACES.length && FACES[v.f] != null);
}
function visibleFace() {
  const v = inView();
  return (v.find(x => x.x0 === 0) || v[0] || { f: 0 }).f;
}
// Switch mode (on a resize), keeping the same page open.
function setMode(m) {
  if (m === mode) return false;
  const f = visibleFace();
  mode = m;
  if (m === "single") si = Math.max(0, SINGLE.indexOf(f) >= 0 ? SINGLE.indexOf(f) : SINGLE.findIndex(x => x >= f));
  else cur = f % 2 === 0 ? f / 2 : (f + 1) / 2;
  forget();
  return true;
}

function place() {
  const left = mode === "single" ? 0 : cur, right = mode === "single" ? SINGLE.length - si : LEAVES - cur;
  const leftZ = left * LEAF, rightZ = right * LEAF;
  stackL.visible = mode === "spread" && cur > 0;
  stackR.visible = right > 0;
  stackL.scale.z = Math.max(leftZ, 1e-4); stackL.position.set(-W / 2, 0, leftZ / 2 - LEAF);
  stackR.scale.z = Math.max(rightZ, 1e-4); stackR.position.set(W / 2, 0, rightZ / 2 - LEAF);
  leftPage.position.z = leftZ;
  rightPage.position.z = rightZ;
  castShadow.position.z = Math.max(leftZ, rightZ) + 0.001;
  const alone = mode === "single" || cur === 0 || cur === LEAVES;
  shadow.scale.x = alone ? 0.55 : 1;
  shadow.position.x = mode === "single" || cur === 0 ? W / 2 : cur === LEAVES ? -W / 2 : 0;
  boardR.visible = mode === "single" || cur < LEAVES;
  boardL.visible = mode === "spread" && cur > 0;
  boardR.position.set((W + OVER) / 2, 0, -LEAF - BOARD / 2);
  boardL.position.set(-(W + OVER) / 2, 0, -LEAF - BOARD / 2);
  // Closed, the book is seen at an angle, lying on the desk; open, from straight above, to read.
  const tt = closedBook() ? 1 : 0;
  if (tt !== view.tt) { view.tt = tt; ease(); }
}
const closedBook = () => (mode === "single" ? si === 0 || si === SINGLE.length - 1 : cur === 0 || cur === LEAVES);

function show() {
  if (mode === "single") {
    leftPage.visible = false;
    setMap(rightPage, SINGLE[si], "R");
  } else {
    setMap(leftPage, 2 * cur - 1, "L");
    setMap(rightPage, 2 * cur, "R");
  }
  place();
  prefetch();
  updateBar();
  render();
}
const showSpread = show;

function prefetch() {
  const faces = mode === "single" ? [SINGLE[si + 1], SINGLE[si - 1]] : [2 * cur + 1, 2 * cur + 2, 2 * cur - 2, 2 * cur - 3];
  for (const f of faces) {
    const kind = FACES[f];
    if (kind && kind.n && !kind.missing) {
      loadPage(kind.n);
      if (pageView === "scan") scanImage(kind.scan);
    }
  }
}

// Start turning one leaf (dir +1 forward, -1 back): set up what's on the leaf and what's revealed beneath it.
function startTurn(dir) {
  if (mode === "single") {
    if (dir > 0 ? si >= SINGLE.length - 1 : si <= 0) return null;
    setMap(leafFront, dir > 0 ? SINGLE[si] : SINGLE[si - 1], "R");
    setMap(leafBack, BLANK, "R");
    if (dir > 0) setMap(rightPage, SINGLE[si + 1], "R");
  } else {
    if (dir > 0 ? cur >= LEAVES : cur <= 0) return null;
    const l = dir > 0 ? cur : cur - 1;              // the leaf that moves
    setMap(leafFront, 2 * l, "R");
    setMap(leafBack, 2 * l + 1, "L");
    if (dir > 0) setMap(rightPage, 2 * cur + 2, "R"); else setMap(leftPage, 2 * cur - 3, "L");
  }
  leaf.visible = true;
  const moving = mode === "single" ? (dir > 0 ? SINGLE[si] : SINGLE[si - 1]) : 2 * (dir > 0 ? cur : cur - 1);
  T = { dir, t: dir > 0 ? 0 : 1, twist: 0, anim: null, rigid: moving === 0 || FACES[moving + 1] === "backcover" || FACES[moving] === "backcover" };
  if (closedBook() && view.tt) { view.tt = 0; ease(); }   // opening the book: the camera comes round to read it
  drawTurn();
  return T;
}

function drawTurn() {
  poseLeaf(T.t, T.dir, T.twist);
  const right = mode === "single" ? SINGLE.length - si : LEAVES - cur, left = mode === "single" ? 0 : cur;
  const zR = right * LEAF, zL = left * LEAF;
  leaf.position.z = zR + (zL - zR) * T.t + 0.003;
  leaf.scale.z = T.rigid ? 1 : mode === "single" ? 0.55 : 0.8;   // a flatter lift: the page turns low over the book, as a real one does
  render();
}

// Animate the turn to its end (goal 1 = lying on the left) or back where it started. Full turns ease in and out;
// a release mid-drag eases out from where the finger left it.
function settle(goal, fromDrag = false) {
  if (!T) return;
  const from = T.t, dist = Math.abs(goal - from);
  T.anim = { from, goal, start: performance.now(), dur: reduceMotion ? 0 : Math.max(140, (fromDrag ? 520 : 820) * dist), fromDrag };
  requestAnimationFrame(stepTurn);
}
function stepTurn() {
  if (!T || !T.anim) return;
  const a = T.anim, k = Math.min(1, (performance.now() - a.start) / (a.dur || 1));
  const e = a.fromDrag ? 1 - Math.pow(1 - k, 3) : (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  T.t = a.from + (a.goal - a.from) * e;
  T.twist *= a.fromDrag ? 0.94 : 1;
  drawTurn();
  if (k < 1) requestAnimationFrame(stepTurn); else endTurn();
}
function endTurn() {
  if (!T) return;
  const completed = T.dir > 0 ? T.t >= 0.999 : T.t <= 0.001;
  const dir = T.dir;
  T = null;
  leaf.visible = false;
  castShadow.visible = false;
  if (completed) { if (mode === "single") si += dir; else cur += dir; }
  show();
  frame();
}
const finishTurn = () => { if (T) { T.t = T.dir > 0 ? 1 : 0; endTurn(); } };
// A whole turn, as from the arrows or a tap.
function turn(dir) {
  if (T) finishTurn();
  if (startTurn(dir)) settle(dir > 0 ? 1 : 0);
}

// ---------- Camera: fit, zoom and pan ----------
const view = { zoom: 1, tz: 1, x: 0, y: 0, tx: 0, ty: 0, tilt: 0, tt: 0 };   // x, y, zoom, tilt: now; tx, ty, tz, tt: where the camera eases to
const narrow = () => mode === "single";
const TOP = () => document.querySelector(".bar.top").offsetHeight, BOT = () => document.querySelector(".bar.bottom").offsetHeight;

// The part of the book in view: one page (single mode, or the closed book), or the spread.
function span() {
  if (mode === "single" || cur === 0) return [0, W];
  if (cur === LEAVES) return [-W, 0];
  return [-W, W];
}

function frame() {
  // The default view: what's open, whole (zooming out smoothly if zoomed in).
  view.tz = 1;
  const [x0, x1] = span();
  view.tx = (x0 + x1) / 2;
  view.ty = 0;
  ease();
}

function fitDistance() {
  const [x0, x1] = span();
  const vw = (x1 - x0) * (mode === "single" ? 1.04 : 1.06), vh = H * 1.04;
  const usable = (innerHeight - TOP() - BOT()) / innerHeight;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.max(vh / 2 / (tan * usable), vw / 2 / (tan * camera.aspect));
}

function applyCamera() {
  // tilt 0: straight above the page. tilt 1: the book lying on a desk, seen from the front and a little to the
  // right, a step further back. In between, the camera swings between the two.
  const tilt = view.tilt, d = (fitDistance() / view.zoom) * (1 + 0.55 * tilt);
  // Keep the bars from covering the page: shift the view by half the difference between the two bars.
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const shift = ((BOT() - TOP()) / innerHeight) * d * tan * (1 - tilt);
  const pitch = 0.82 * tilt, yaw = 0.32 * tilt, x = view.x, y = view.y - shift;
  camera.position.set(x + d * Math.sin(pitch) * Math.sin(yaw), y - d * Math.sin(pitch) * Math.cos(yaw), d * Math.cos(pitch));
  camera.up.set(-Math.sin(yaw), Math.cos(yaw), 0);
  camera.lookAt(x, y, 0);
  document.getElementById("unzoom").hidden = view.zoom < 1.05;
}

let easing = false;
function ease() {
  if (easing) return;
  easing = true;
  const step = () => {
    const k = reduceMotion ? 1 : 0.18;
    view.x += (view.tx - view.x) * k;
    view.y += (view.ty - view.y) * k;
    view.zoom += (view.tz - view.zoom) * k;
    view.tilt += (view.tt - view.tilt) * (reduceMotion ? 1 : 0.07);   // the swing from desk to page is slower
    render();
    if (Math.abs(view.tx - view.x) + Math.abs(view.ty - view.y) + Math.abs(view.tz - view.zoom) + Math.abs(view.tt - view.tilt) > 1e-4) requestAnimationFrame(step);
    else { view.x = view.tx; view.y = view.ty; view.zoom = view.tz; view.tilt = view.tt; easing = false; render(); }
  };
  step();
}

function clampView() {
  // Keep the view on the pages in view.
  const [x0, x1] = span();
  const d = fitDistance() / view.zoom, tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfW = d * tan * camera.aspect, halfH = d * tan * (innerHeight - TOP() - BOT()) / innerHeight;
  const fit = (v, a, b, half) => (b - a <= 2 * half ? (a + b) / 2 : Math.max(a + half, Math.min(b - half, v)));
  view.tx = fit(view.tx, x0, x1, halfW);
  view.ty = fit(view.ty, -H / 2, H / 2, halfH);
}

// Zoom in on a point, smoothly (a double tap, a search) or at once (pinch, wheel, keys).
function glideTo(z, wx, wy) {
  view.tz = Math.max(1, Math.min(6, z));
  view.tx = wx; view.ty = wy;
  const keep = view.zoom;
  view.zoom = view.tz; clampView(); view.zoom = keep;   // clamp for where it's going
  ease();
}
function zoomTo(z, wx, wy) {
  const old = view.zoom;
  view.zoom = view.tz = Math.max(1, Math.min(6, z));
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
  applyCamera();
  camera.updateMatrixWorld();   // the camera as it is now, even if no frame has been drawn since it moved
  const ndc = new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p);
  return p;
}

// ---------- Navigation ----------
function next() { turn(1); }
function prev() { turn(-1); }

function goToFace(f, animateTurn = true) {
  if (T) finishTurn();
  if (mode === "single") {
    let i = SINGLE.indexOf(f);
    if (i < 0) i = Math.max(0, SINGLE.findIndex(x => x >= f));
    if (i === si) return frame(), show();
    if (animateTurn && !reduceMotion) { si = i - Math.sign(i - si); show(); return turn(Math.sign(i - si)); }
    si = i;
  } else {
    const target = f % 2 === 0 ? f / 2 : (f + 1) / 2;
    if (target === cur) return frame(), show();
    if (animateTurn && !reduceMotion) { cur = target - Math.sign(target - cur); show(); return turn(Math.sign(target - cur)); }
    cur = target;
  }
  show();
  frame();
}
const goToPage = (n, anim) => { const f = faceOfPage(n); if (f >= FRONT) goToFace(f, anim); };

function updateBar() {
  const f = visibleFace(), kind = FACES[f], faces = inView().map(v => FACES[v.f]);
  const label = k => k && k.n ? `p. ${k.n}${k.letter ? ` · ${k.letter}` : ""}` : null;
  const named = { cover: "Cover", backcover: "Back cover", title: "Title page", about: "This edition", fin: "Fin", endpaper: "" };
  const printed = faces.filter(k => k && k.n);
  const text = printed.length === 2
    ? `pp. ${printed[0].n}–${printed[1].n}${printed[1].letter ? ` · ${printed[1].letter}` : ""}`
    : label(printed[0]) || named[kind] || "";
  document.getElementById("where").textContent = text || "Catálogo";
  document.getElementById("prev").disabled = mode === "single" ? si === 0 : cur === 0;
  document.getElementById("next").disabled = mode === "single" ? si === SINGLE.length - 1 : cur === LEAVES;
  // Help for a page in view with no transcription (none today: both scans cover every page).
  const gap = faces.find(k => k && k.missing);
  const help = document.getElementById("help");
  help.hidden = !gap;
  if (gap) {
    help.querySelector("b").textContent = `Page ${gap.n}`;
    help.querySelector("a").href = `mailto:hello@ruzcko.com?subject=${encodeURIComponent(`Catálogo 1849, page ${gap.n}`)}&body=${encodeURIComponent(
      `Hi! About page ${gap.n} of the Catálogo alfabético de apellidos, which has no transcription yet:\n\n` +
      `[ ] I have a copy (which edition? 1849 original / 1973 National Archives reprint / other)\n` +
      `[ ] I know a library or person who has one: \n[ ] I can send a photo of the page\n\n`)}`;
  }
  const n = kind && kind.n;
  if (!dlg.open) setPath(n ? `/${n}` : "/");
}

// ---------- The story before the book, then the book opening ----------
// First visit: a few screens of history (index.html), then the closed book on the desk opens. Later visits: the
// book opens straight away. A link to a page, a name or an entry skips both.
const story = document.getElementById("story");
let storyOpen = false;
function showStory() {
  storyOpen = true;
  story.hidden = false;
  story.classList.remove("closing");
  story.scrollTop = 0;
}
function closeStory() {
  if (!storyOpen) return;
  storyOpen = false;
  try { localStorage.setItem("story", "seen"); } catch {}
  story.classList.add("closing");
  setTimeout(() => { story.hidden = true; story.classList.remove("closing"); }, reduceMotion ? 0 : 600);
  openBook(reduceMotion ? 0 : 650);
}
function openBook(delay) {   // the front cover lifts, if the book is still closed on it (once the tab is in view)
  if (document.hidden) {
    addEventListener("visibilitychange", () => openBook(delay), { once: true });
    return;
  }
  setTimeout(() => { if (!T && !storyOpen && (mode === "single" ? si === 0 : cur === 0)) next(); }, delay);
}
story.querySelector(".skipbook").onclick = closeStory;
story.querySelector(".open").onclick = closeStory;
document.getElementById("restory").onclick = () => {
  document.getElementById("about").close();
  goToFace(0, false);   // back to the closed book, so it opens again after the story
  showStory();
};

// Clean addresses: /58 is a page, /fabella a name, /58/glubig an entry to help read (/58/glubig-2 for a second
// "glubig" on the same page). The address changes as you read, without adding to the back button's history.
const setPath = path => { if (location.pathname !== path || location.hash) history.replaceState(null, "", path); };
async function entryPath(page, e) {
  const data = await loadPage(page.n);
  const same = data.e.filter(x => x[4] === e[4]);
  const k = same.findIndex(x => x[6] === e[6] && x[7] === e[7]);
  return `/${page.n}/${encodeURIComponent(slug(e[4]))}${k > 0 ? `-${k + 1}` : ""}`;
}

// ---------- Search ----------
const searchIdx = new Map();
const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-zñ]/g, "");
async function lookup(q) {
  const k = fold(q);
  if (!k) return [];
  const letter = k[0];
  if (!searchIdx.has(letter)) searchIdx.set(letter, fetch(dataUrl(`s/${letter}.json`)).then(r => r.ok ? r.json() : {}).catch(() => ({})));
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
    : (v.trim() ? `<li class="none">Not in the OCR reading of the book (yet)</li>` : "");
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
  forget(f);
  goToPage(n, false);
  const data = await loadPage(n);
  const e = layoutOf(data).find(x => x[4] === name);
  if (e) {
    const pageX = (inView().find(v => v.f === f) || { x0: 0 }).x0;
    const wx = pageX + ((e[0] + e[2]) / 2 / SCAN_W) * W, wy = H / 2 - ((e[1] + e[3]) / 2 / SCAN_H) * H;
    setTimeout(() => glideTo(narrow() ? 3.2 : 4, wx, wy), reduceMotion ? 0 : 350);
  }
  if (pages.length > 1) toast(`${name} is on pages ${pages.join(", ")}`);
  setPath(`/${encodeURIComponent(name)}`);
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
  forget();
  show();
}
// The server's data differs from the page we drew (a copy cached from an older release): drop ours and redraw.
function pageChanged() {
  noStore = true;
  pageData.clear();
  if (dlg.open) dlg.close();
  redrawAll();
  toast("This page changed since you opened it: it's up to date now. Please try again.");
}
function setSure(on) {
  sure = on;
  try { localStorage.setItem("sure", on ? "1" : "0"); } catch {}
  document.getElementById("sure").setAttribute("aria-pressed", String(on));
  redrawAll();
  if (on) toast("Faint: the OCR's best guess · Orange: blurry. Tap one to help read it.");
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
  if (T) return null;
  const p = worldAt(px, py);
  const hitPage = inView().find(v => p.x >= v.x0 && p.x <= v.x0 + W);
  const kind = hitPage && FACES[hitPage.f];
  if (!kind || !kind.n || kind.missing || (pageView === "scan" && kind.hand)) return null;
  const sx = ((p.x - hitPage.x0) / W) * SCAN_W, sy = ((H / 2 - p.y) / H) * SCAN_H;
  const data = await loadPage(kind.n);
  let best = null, bestD = Infinity;
  for (const e of layoutOf(data)) {
    const pad = pageView === "scan" ? 12 : 6;     // on the scan, a tap near a line counts
    if (sx < e[0] - pad || sx > Math.max(e[2], e[0] + 40) + pad || sy < e[1] - pad * 0.7 || sy > e[3] + pad * 0.7) continue;
    const d = Math.abs(sy - (e[1] + e[3]) / 2);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best && { page: kind, scan: data.scan, e: best, orig: data.e.find(x => x[6] === best[6] && x[7] === best[7]) };
}

async function openEntryAt(px, py) {
  const hit = await entryAt(px, py);
  if (!hit) return false;
  if (hit.e[5] <= 2) { toast(`${hit.e[4]}: ${STATUS[hit.e[5]].toLowerCase()}. ${WHY[hit.e[5]]}`); return true; }
  openEntry(hit);
  return true;
}

// The names on the open pages as a list, for keyboards and screen readers. Doubtful ones open their reading help.
const list = document.getElementById("list");
document.getElementById("names").onclick = async () => {
  const shown = inView().map(v => FACES[v.f]).filter(k => k && k.n && !k.missing);
  const box = list.querySelector(".pages");
  if (!shown.length) box.innerHTML = `<p class="small">No names on these pages: turn to a page of the book.</p>`;
  else {
    const datas = await Promise.all(shown.map(k => loadPage(k.n)));
    box.innerHTML = datas.map((data, i) => `<h3>Page ${shown[i].n}</h3><ol>` + data.e.map((e, j) => e[5] >= 3
      ? `<li><button type="button" data-p="${i}" data-e="${j}">${unread(e[4]) ? "<i>unread line</i>" : esc(e[4])}<span class="sr"> (${unread(e[4]) ? "neither scan could read it" : STATUS[e[5]].toLowerCase()}: help read it)</span></button></li>`
      : `<li>${esc(e[4])}</li>`).join("") + "</ol>").join("");
    box.onclick = ev => {
      const b = ev.target.closest("button[data-e]");
      if (!b) return;
      const data = datas[+b.dataset.p];
      list.close();
      openEntry({ page: shown[+b.dataset.p], scan: data.scan, e: data.e[+b.dataset.e] });
    };
  }
  list.showModal();
};
list.querySelector(".x").onclick = () => list.close();

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
  const wordW = Math.min(CELL_W, (orig[2] - orig[0] + CELL_PAD + 10) * 1.5);
  const room = Math.min(innerWidth - 72, 400);
  // Just the entry's line, as large as fits; or the three lines around it, with the entry outlined.
  const cropStyle = around => {
    const k = around ? Math.min(1.33, room / CELL_W) : Math.min(1.67, room / wordW);
    const cx = (crop % ACROSS) * CELL_W, cy = Math.floor(crop / ACROSS) * CELL_H + (around ? 0 : LINE_Y);
    return { k, css: `background-image:url('${CROPS}${CROPS_V}/${scan}.webp');background-size:${CELL_W * ACROSS * k}px auto;` +
      `background-position:-${cx * k}px -${cy * k}px;width:${(around ? CELL_W : wordW) * k}px;height:${(around ? CELL_H : LINE_H) * k}px` };
  };
  const id = `${scan}.${col}.${row}`, blank = unread(name);
  highlight = { n: page.n, name, col, row };   // outlined on its page, until the next one
  forget(faceOfPage(page.n));
  show();
  const link = await entryPath(page, e);
  setPath(link);
  dlg.innerHTML = `
    <div class="eh"><h2>${blank ? "Unread line" : `${esc(name)}.`}</h2><span class="chip s${status}">${blank ? "Unread" : STATUS[status]}</span><button type="button" class="x" aria-label="Close">✕</button></div>
    <p class="why">${blank ? "Neither scan could read this line, so it has no reading yet. Can you read it?" : WHY[status]}</p>
    ${CROPS && crop != null ? `<figure class="crop"><div class="img" style="${cropStyle(false).css}"><span class="mark" hidden></span></div>
      <figcaption>The scan, page ${page.n} · digitized by Google from the University of Michigan's copy · <button type="button" class="around">Show the lines around it</button></figcaption></figure>` : ""}
    <p class="small order" hidden></p>
    ${raw && !blank ? `<p class="small">OCR reading: <b>${esc(name)}</b> · the other scan's OCR: <b>${esc(raw)}</b></p>` : ""}
    <form class="readings" autocomplete="off">
      <p class="q">How do you read it?</p>
      <div class="opts"><p class="small">Loading…</p></div>
      <label class="own">${blank ? "Your reading:" : "Something else:"} <input name="own" maxlength="20" spellcheck="false" autocapitalize="off" placeholder="type your reading"></label>
      <p class="err" role="alert"></p>
      <div class="ts"></div>
      <div class="acts"><button type="submit" class="primary">Vote</button><button type="button" class="notsure">Not sure, just show the votes</button></div>
      <p class="small"><button type="button" class="askfriend">Ask a friend to read it</button></p>
    </form>
    <div class="tally" hidden></div>`;
  dlg.showModal();
  dlg.querySelector(".x").onclick = () => { dlg.close(); updateBar(); };
  const aroundBtn = dlg.querySelector(".around");
  if (aroundBtn) aroundBtn.onclick = () => {
    const img = dlg.querySelector(".crop .img"), mark = img.querySelector(".mark"), around = mark.hidden;
    const { k, css } = cropStyle(around);
    img.style.cssText = css;
    mark.hidden = !around;
    if (around) mark.style.cssText = `top:${LINE_Y * k}px;height:${LINE_H * k}px;width:${wordW * k}px`;
    aroundBtn.textContent = around ? "Just this line" : "Show the lines around it";
  };
  dlg.querySelector(".askfriend").onclick = async () => {
    const url = location.origin + link, text = `Can you read this 1849 surname? Help read the Catálogo alfabético de apellidos.`;
    try {
      if (navigator.share) await navigator.share({ title: "Catálogo 1849", text, url });
      else { await navigator.clipboard.writeText(url); toast("Link copied"); }
    } catch {}
  };
  const form = dlg.querySelector("form"), err = dlg.querySelector(".err");
  let res;
  try { res = await fetch(`/api/entry?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`).then(r => r.json()); } catch { res = null; }
  if (res?.error === "stale") return pageChanged();
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
  dlg.querySelector(".opts").innerHTML = res.options.length ? res.options.map(o =>
    `<label><input type="radio" name="pick" value="${esc(o.r)}"> ${esc(o.r)}${o.ours ? ` <small>OCR reading</small>` : ""}</label>`).join("")
    : `<p class="small">No readings yet: type yours below.</p>`;
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
      body: JSON.stringify({ id, name, reading, device, token }) }).then(x => x.json()).catch(() => null);
    if (r?.error === "stale") return pageChanged();
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
      <span>${esc(o.r)}${o.ours ? " <small>OCR reading</small>" : ""}</span><b>${o.v}</b></div>`).join("") : `<p class="small">No votes yet. Be the first!</p>`) +
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
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom, mid: worldAt((a.x + b.x) / 2, (a.y + b.y) / 2) };
    if (drag?.turning && T) settle(T.dir > 0 ? 0 : 1, true);   // a second finger: let the page fall back
    drag = null;
  } else drag = { x: e.clientX, y: e.clientY, vx: view.tx, vy: view.ty, moved: false, t: performance.now(),
                  w: worldAt(e.clientX, e.clientY), turning: false, trail: [] };
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
    return;
  }
  // Not zoomed: a sideways drag turns the page, following the finger.
  if (!drag.turning && drag.moved && Math.abs(dx) > Math.abs(dy) * 1.2) {
    if (T) finishTurn();
    if (!startTurn(dx < 0 ? 1 : -1)) { drag = null; return; }
    drag.turning = true;
    drag.t0 = T.t;
    T.twist = Math.max(-1, Math.min(1, drag.w.y / (H / 2))) * (T.dir > 0 ? 1 : -1);   // grabbed high or low
  }
  if (drag.turning && T) {
    const w = worldAt(e.clientX, e.clientY);
    const reach = mode === "single" ? 1.7 * W : 2 * W;   // how far the finger travels for a whole turn
    T.t = Math.max(0, Math.min(1, drag.t0 + (drag.w.x - w.x) / reach));
    drag.trail.push([performance.now(), e.clientX]);
    if (drag.trail.length > 6) drag.trail.shift();
    drawTurn();
  }
});
const up = e => {
  pointers.delete(e.pointerId);
  canvas.classList.remove("dragging");
  if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
  if (!drag) return;
  if (drag.turning && T) {
    // Let go: finish the turn if it's past halfway or was flicked, otherwise let the page fall back.
    const [t0, x0] = drag.trail[0] || [0, e.clientX], [t1, x1] = drag.trail[drag.trail.length - 1] || [1, e.clientX];
    const v = (x1 - x0) / Math.max(1, t1 - t0);     // px per ms; negative: towards the left
    const flick = T.dir > 0 ? v < -0.45 : v > 0.45, back = T.dir > 0 ? v > 0.45 : v < -0.45;
    const past = T.dir > 0 ? T.t > 0.42 : T.t < 0.58;
    const done = !back && (flick || past);
    settle(done === (T.dir > 0) ? 1 : 0, true);
    drag = null;
    return;
  }
  if (!drag.moved) {
    const now = performance.now();
    if (now - lastTap < 300) {
      const p = worldAt(e.clientX, e.clientY);
      if (view.zoom > 1.05) frame(); else glideTo(narrow() ? 3 : 3.5, p.x, p.y);
      lastTap = 0;
    } else {
      lastTap = now;
      const x = e.clientX, y = e.clientY;
      setTimeout(async () => {
        if (lastTap !== now) return;   // it became a double tap
        if (sure && await openEntryAt(x, y)) return;
        if (view.zoom <= 1.05) {
          if (x < innerWidth * 0.22) prev(); else if (x > innerWidth * 0.78 || closedBook()) next();
        }
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
document.getElementById("layout").onclick = () => { const k = Object.keys(VIEWS); setView(k[(k.indexOf(pageView) + 1) % k.length]); };
document.getElementById("sure").onclick = () => setSure(!sure);
document.getElementById("info").onclick = () => document.getElementById("about").showModal();
// Go to a page: the page label turns into a box for a page number (or a surname, handed to the search).
const where = document.getElementById("where"), jump = document.getElementById("jump");
where.onclick = () => {
  where.hidden = true;
  jump.hidden = false;
  jump.value = "";
  jump.focus();
};
function endJump(refocus) {
  if (jump.hidden) return;
  jump.hidden = true;
  where.hidden = false;
  if (refocus) where.focus();
}
jump.addEventListener("blur", () => { if (document.hasFocus()) endJump(false); });   // not when the window loses focus
jump.addEventListener("keydown", e => {
  if (e.key === "Escape") { e.preventDefault(); endJump(true); }
  if (e.key !== "Enter") return;
  e.preventDefault();
  const v = jump.value.trim();
  endJump(true);
  if (!v) return;
  if (/^\d+$/.test(v)) {
    const n = +v, p = PAGES.find(x => x.n === n);
    if (p) goToPage(n); else toast("No such page");
  } else { q.value = v; q.dispatchEvent(new Event("input")); q.focus(); }
});
addEventListener("keydown", e => {
  if (storyOpen || e.target.closest?.("input, textarea, select, dialog")) return;
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
  if (FACES.length && setMode(wantMode())) { if (T) finishTurn(); show(); }
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

function edgeShadow() {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = 256; c.height = 4;
  const r = g.createLinearGradient(0, 0, 256, 0);
  r.addColorStop(0, "rgba(40,25,10,.9)");
  r.addColorStop(0.35, "rgba(40,25,10,.35)");
  r.addColorStop(1, "rgba(40,25,10,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// For checking in the browser console.
window.__book = { view, scene, shadow, leaf, poseLeaf, startTurn, settle, get T() { return T; }, get mode() { return mode; },
  get cur() { return cur; }, get si() { return si; }, goToPage, next, prev, render,
  snap() { view.x = view.tx; view.y = view.ty; render(); } };

// ---------- Start ----------
// Links: /58 opens a page, /fabella finds a name and marks it, /58/glubig opens one entry's reading help.
// The older #p=58, #n=fabella and #e=100.1.6 links still work, on arrival and when they change.
async function followPath(path) {
  const parts = path.split("/").filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch { return ""; } });
  if (!parts.length) return false;
  const page = /^\d{1,3}$/.test(parts[0]) ? PAGES.find(p => p.n === +parts[0]) : null;
  if (page && parts.length === 1) { goToPage(page.n, false); return true; }
  if (page && parts.length === 2) {   // an entry: its reading, and which one if the page has it twice
    const [, s, k] = /^(.+?)(?:-(\d+))?$/.exec(parts[1].toLowerCase()) || [];
    const name = s === "unread" ? "?" : s;
    goToPage(page.n, false);
    if (page.missing) return true;
    const data = await loadPage(page.n);
    const e = data.e.filter(x => x[4] === name)[(+k || 1) - 1];
    if (e && e[5] >= 3) { if (!sure) setSure(true); openEntry({ page, scan: data.scan, e }); }
    else if (e) { highlight = { n: page.n, name }; redrawAll(); }
    else toast(`“${name}” isn't on page ${page.n} any more: readers may have fixed it.`);
    return true;
  }
  if (parts.length === 1 && /^[\p{L} -]{2,30}$/u.test(parts[0])) {
    const res = await lookup(parts[0]);
    const hit = res.find(r => fold(r[0]) === fold(parts[0]));
    if (hit) { choose(hit); return true; }
    toast(`“${parts[0]}” isn't in the OCR reading of the book (yet).`);
  }
  return false;
}
async function follow(hash) {
  const m = /p=(\d+)/.exec(hash), nm = /n=([^&]+)/.exec(hash), ent = /e=(\d{1,3})\.(\d{1,2})\.(\d{1,3})/.exec(hash);
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
dlg.addEventListener("close", () => updateBar());   // back to the page's address

(async () => {
  const pages = fetch(dataUrl("pages.json")).then(r => r.json());
  await Promise.all([document.fonts.load(`40px ${FONT}`), document.fonts.load(`40px ${FONT_SC}`), document.fonts.load(`italic 40px ${FONT}`)]).catch(() => {});
  PAGES = await pages;
  FACES = ["cover", "endpaper", "title", "about", ...PAGES];
  if (FACES.length % 2 === 1) FACES.push(null);          // the last printed page's blank back
  FACES.push("fin", null, "endpaper", "backcover");   // the back cover is the back of the last leaf
  LEAVES = FACES.length / 2;
  SINGLE = FACES.map((k, f) => f).filter(f => FACES[f] != null && FACES[f] !== "endpaper");
  mode = wantMode();
  const hash = location.hash, path = location.pathname;   // before resize() rewrites them
  resize();
  // Start where the camera is going, not gliding there from the spine (a glide that stalls in a hidden tab).
  Object.assign(view, { x: view.tx, y: view.ty, zoom: view.tz, tilt: view.tt });
  render();
  viewButton();
  document.getElementById("sure").setAttribute("aria-pressed", String(sure));
  const linked = (await follow(hash)) || (await followPath(path));
  if (linked) {   // a link to a page, a name or an entry: straight there, from above
    Object.assign(view, { tilt: view.tt });
    render();
  } else {
    showSpread();
    Object.assign(view, { tilt: view.tt });
    render();
    let seen = false;
    try { seen = localStorage.getItem("story") === "seen"; } catch {}
    if (seen) openBook(900); else showStory();
  }
})();
