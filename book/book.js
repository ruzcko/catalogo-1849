// The virtual Catálogo: a 3D book whose pages are set in type from the open transcription (no scan images).
// Pages are drawn on canvases on demand and turned with a bending leaf; only the open spread and the leaf being
// turned are real meshes, so it stays light on phones.
import * as THREE from "three";

// ---------- Reader help ----------
// Scan crops of the doubtful entries (Google's scan of the University of Michigan copy, a few lines per crop), served
// by Apelyido.
// Set to null to stop showing them.
const CROPS = "https://apelyido.ruzcko.com/scan/";
const CROPS_V = 13;                              // the strips' folder (/scan/13/): a new set goes in a new folder
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
// How sure the OCR is, as a light wash under every name (Tags and Scan views), so any line can be checked on the scan:
// green read by a person or sure, blue likely, amber its best guess (also dotted), orange blurry.
const SHADE = ["rgba(70, 140, 95, .16)", "rgba(70, 140, 95, .16)", "rgba(70, 115, 175, .15)", "rgba(214, 165, 45, .28)", "rgba(232, 120, 40, .32)"];
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
const LEAF = 0.0007;                             // paper thickness, for the stacks (141 leaves: a paperback's spine)
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
renderer.shadowMap.enabled = true;               // real shadows, unless the GPU probe at start turns them off (lite)
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let lite = false;
const scene = new THREE.Scene();
renderer.setClearColor(0x000000, 0);
const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 80);   // a long lens: a lifted page doesn't loom (near 0.1: depth precision for the page on its block)

// The light: one warm key over the reader's left shoulder, which casts the shadows, and the room's soft fill. The
// pages and the boards are lit materials, so the gutter, the page block and a turning board shade as they move.
const LIGHT = new THREE.Vector3(-1.5, 1.3, 3.4);
const key = new THREE.DirectionalLight(0xfff2de, 2.3);
key.position.copy(LIGHT);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2.4, right: 2.4, top: 2, bottom: -2, near: 0.5, far: 10 });
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.012;
scene.add(key, key.target);
const fill = new THREE.HemisphereLight(0xfff5e6, 0x5a4a3a, 1.2);
fill.position.set(0, 0, 1);                      // the pages face +z: that side gets the room's light
scene.add(fill);
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });

// The desk takes the book's shadow and nothing else (the room's colour is the page's CSS). Under the book, a soft
// contact shadow, the one thing a shadow map doesn't give.
const desk = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.38, transparent: true, depthWrite: false }));
desk.position.z = -0.03;
desk.receiveShadow = true;
scene.add(desk);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2 * W * 1.18, H * 1.12),
  new THREE.MeshBasicMaterial({ map: radialShadow(), transparent: true, depthWrite: false, opacity: 0.7 }));
shadow.position.z = -0.02;
scene.add(shadow);

// The book is one group, so the closed book can be turned over in the hand: `book` sits at the closed block's
// centre and `inner` holds every part at the coordinates the rest of the code uses (the spine at x = 0).
const book = new THREE.Group(), inner = new THREE.Group();
book.rotation.order = "YXZ";
book.add(inner);
scene.add(book);

// The page block: the leaves on each side of the spine, as a block whose top follows the pages down into the
// gutter when the book is open (the leaves are glued at the spine). Its edges are the fanned paper, as fine lines.
const paperTone = 0xe9dcbd;
const LINE_SP = 2.2 * LEAF;                      // one line on the paper's edge for every two leaves or so
function makeStack() {
  const tex = new THREE.CanvasTexture(edgeLines());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.Mesh(new THREE.BufferGeometry(), [std(paperTone), std(0xffffff, { map: tex })]);
  m.castShadow = m.receiveShadow = true;
  inner.add(m);
  return m;
}
const stackL = makeStack(), stackR = makeStack();
// The covers: the 1973 reprint is a paperback, so they are thin boards, flush with the pages, hinged at the spine
// (x = 0). The front cover lies on the pages while the book is closed and turns over to the left to open it; the
// back lies under the pages and turns over them to close the book at the end. Closed, a flat spine joins them.
const BOARD = 0.006, OVER = 0.004, BW = W + OVER, BH = H + 2 * OVER;
const boardTone = 0xcbb183;
function makeCover(rises) {   // rises: the board sits on its hinge (the front), else hangs from it (the back)
  const geo = new THREE.BoxGeometry(BW, BH, BOARD);
  geo.translate(BW / 2, 0, rises ? BOARD / 2 : -BOARD / 2);
  const edge = std(boardTone, { roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, std(0xffffff, { roughness: 0.78 }), std(0xffffff)]);
  mesh.castShadow = mesh.receiveShadow = true;
  inner.add(mesh);
  return mesh;
}
const coverF = makeCover(true), coverB = makeCover(false);
const spineGeo = new THREE.CylinderGeometry(1, 1, BH, 24, 1, true, Math.PI, Math.PI);   // half a tube along y, bulging to -x
const spine = new THREE.Mesh(spineGeo, std(boardTone, { roughness: 0.8, side: THREE.DoubleSide }));
spine.castShadow = true;
inner.add(spine);
const NONE = -3;                                 // no page here (a cover lies there instead)
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

const pageMat = () => std(0xffffff, { roughness: 0.95 });
const PAGE_SEG = 56;
const pageGeo = sign => { const g = new THREE.PlaneGeometry(W, H, PAGE_SEG, 1); g.translate(sign * W / 2, 0, 0); return g; };
const leftPage = new THREE.Mesh(pageGeo(-1), pageMat()), rightPage = new THREE.Mesh(pageGeo(1), pageMat());
leftPage.receiveShadow = rightPage.receiveShadow = true;
inner.add(leftPage, rightPage);
// Open, the pages run down into the gutter: x from the spine, on a stack zTop high, a page lies at
// zTop (1 - GD d e^(-|x| / GK)), d = 1 open, 0 closed (a closed paperback is a flat block). GK: how wide the valley is.
const GK = 0.18 * W, GD = 0.6;   // the valley's width, and how far down the leaves go (they hinge above the glue)
const gutter = (x, zTop, d) => zTop * (1 - GD * d * Math.exp(-Math.abs(x) / GK));
function shapePage(mesh, zTop, d) {
  const p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, gutter(p.getX(i), zTop, d));
  p.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}
// The block on one side (sign -1 left, +1 right), zTop high, its top following the gutter. Faces: the top (material
// 0), then the fore-edge, the head and the tail and the glued edge at the spine, as lined paper (material 1).
const STACK_N = 28;
function shapeStack(mesh, zTop, d, sign) {
  mesh.visible = zTop > 1e-5;
  if (!mesh.visible) return;
  const pos = [], uv = [], idx = [];
  let n = 0;
  const v = (x, y, z, u, w) => { pos.push(x, y, z); uv.push(u, w); return n++; };
  const quad = (a, b, c, e, flip) => { if (flip) idx.push(a, e, c, a, c, b); else idx.push(a, b, c, a, c, e); };
  const neg = sign < 0, h = H / 2, vz = z => z / (8 * LINE_SP);
  const xs = [], zs = [];
  // The block's top sits a leaf under the page drawn on it, so the two never fight for the same depth.
  for (let i = 0; i <= STACK_N; i++) { const u = i / STACK_N, x = sign * W * (0.3 * u * u + 0.7 * u); xs.push(x); zs.push(Math.max(0, gutter(x, zTop, d) - LEAF)); }
  for (let i = 0; i < STACK_N; i++) {   // the top
    const a = v(xs[i], -h, zs[i], i / STACK_N, 0), b = v(xs[i + 1], -h, zs[i + 1], (i + 1) / STACK_N, 0);
    const c = v(xs[i + 1], h, zs[i + 1], (i + 1) / STACK_N, 1), e = v(xs[i], h, zs[i], i / STACK_N, 1);
    quad(a, b, c, e, neg);
  }
  const topCount = idx.length;
  for (let i = 0; i < STACK_N; i++) {   // the tail (y = -H/2, toward the reader) and the head
    const u0 = Math.abs(xs[i]) / W, u1 = Math.abs(xs[i + 1]) / W;
    let a = v(xs[i], -h, 0, u0, 0), b = v(xs[i + 1], -h, 0, u1, 0), c = v(xs[i + 1], -h, zs[i + 1], u1, vz(zs[i + 1])), e = v(xs[i], -h, zs[i], u0, vz(zs[i]));
    quad(a, b, c, e, neg);
    a = v(xs[i], h, 0, u0, 0); b = v(xs[i + 1], h, 0, u1, 0); c = v(xs[i + 1], h, zs[i + 1], u1, vz(zs[i + 1])); e = v(xs[i], h, zs[i], u0, vz(zs[i]));
    quad(a, b, c, e, !neg);
  }
  {   // the fore-edge, and the glued edge at the spine (hidden by the spine when the book is shut)
    const X = sign * W, zt = zs[STACK_N];
    quad(v(X, -h, 0, 0, 0), v(X, h, 0, 1, 0), v(X, h, zt, 1, vz(zt)), v(X, -h, zt, 0, vz(zt)), neg);
    const z0 = zs[0];
    if (z0 > 1e-5) quad(v(0, -h, 0, 0, 0), v(0, h, 0, 1, 0), v(0, h, z0, 1, vz(z0)), v(0, -h, z0, 0, vz(z0)), !neg);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.addGroup(0, topCount, 0);
  geo.addGroup(topCount, idx.length - topCount, 1);
  geo.computeVertexNormals();
  mesh.geometry.dispose();
  mesh.geometry = geo;
}
// Shape the pages and the blocks for what's open, with the gutter as deep as the view's dip (0 closed, 1 open).
function shapeAll() {
  const [l, r] = paper2(), d = view.dip;
  shapePage(leftPage, l * LEAF, d);
  shapePage(rightPage, r * LEAF, d);
  shapeStack(stackL, l * LEAF, d, -1);
  shapeStack(stackR, r * LEAF, d, 1);
}

// The leaf being turned: a finely divided sheet, bent on the graphics card. It turns about the spine (x = 0), from
// angle 0 (lying on the right) to π (lying on the left), and it curls as paper does: the sheet rolls round a line
// across it (the curl), flat on either side of the roll. The line leans with where the page was grabbed, so a corner
// peels up first; early in a turn the roll is out by the free edge and the edge leads, and as the page comes over the
// whole sheet bows and the edge trails as it lands. In the sheet's own frame: the part before the curl lies flat,
// the roll (from uC, uL long) turns it by uDelta, the rest goes on straight; then the whole sheet turns by uThetaS
// about the spine. Its shade comes from how the surface faces the reader, with a sheen along the roll.
// The sheet's shape and its normal, shared by its own shaders and by the depth pass that casts its shadow. At rest
// (uLift 0) it lies in the gutter's valley like the page beneath it, uDip deep at the spine; lifted, it straightens.
const LEAF_FN = `
uniform float uThetaS, uDelta, uC, uL, uAlpha, uDip, uLift;
vec3 leafPos(vec3 position, out vec3 nrm) {
  vec2 n = vec2(cos(uAlpha), -sin(uAlpha)), along = vec2(sin(uAlpha), cos(uAlpha));
  float s = dot(position.xy, n), w = dot(position.xy, along);
  float X = s, Z = 0.0, phi = 0.0;
  if (abs(uDelta) > 1e-4 && s > uC) {
    float R = uL / uDelta;
    if (s < uC + uL) {
      phi = uDelta * (s - uC) / uL;
      X = uC + R * sin(phi);
      Z = R * (1.0 - cos(phi));
    } else {
      float r = s - uC - uL;
      phi = uDelta;
      X = uC + R * sin(uDelta) + r * cos(uDelta);
      Z = R * (1.0 - cos(uDelta)) + r * sin(uDelta);
    }
  }
  vec2 q = X * n + w * along;
  float c = cos(uThetaS), sn = sin(uThetaS);
  vec3 p = vec3(q.x * c - Z * sn, q.y, q.x * sn + Z * c);
  p.z -= uDip * ${GD.toFixed(3)} * exp(-abs(p.x) / ${GK.toFixed(5)}) * (1.0 - uLift);
  vec3 n0 = vec3(-sin(phi) * n.x, -sin(phi) * n.y, cos(phi));
  nrm = vec3(n0.x * c - n0.z * sn, n0.y, n0.x * sn + n0.z * c);
  return p;
}`;
const LEAF_VS = LEAF_FN + `
varying vec2 vUv;
varying vec3 vN;
varying float vRoll;
void main() {
  vUv = uv;
  vec3 nrm;
  vec3 p = leafPos(position, nrm);
  vN = nrm;
  float s = dot(position.xy, vec2(cos(uAlpha), -sin(uAlpha)));
  vRoll = (abs(uDelta) > 1e-4 && s > uC && s < uC + uL) ? sin(3.14159265 * (s - uC) / uL) : 0.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
// Lit like the pages: the key light from uLight, the room's fill as a floor, and a sheen along the roll.
const LEAF_FS = `
uniform sampler2D map;
uniform float uBack;
uniform vec3 uLight;
varying vec2 vUv;
varying vec3 vN;
varying float vRoll;
void main() {
  vec2 uv = uBack > 0.5 ? vec2(1.0 - vUv.x, vUv.y) : vUv;
  vec3 N = uBack > 0.5 ? -vN : vN;
  float facing = clamp(dot(N, uLight), 0.0, 1.0);
  float shade = 0.56 + 0.47 * facing + 0.05 * vRoll * facing + 0.04 * pow(1.0 - abs(N.z), 6.0);
  gl_FragColor = vec4(texture2D(map, uv).rgb * shade, 1.0);
  #include <colorspace_fragment>
}`;
const SEG_X = 72, SEG_Y = 48;   // fine both ways: the curl's line can lean
const leafGeo = new THREE.PlaneGeometry(W, H, SEG_X, SEG_Y);
leafGeo.translate(W / 2, 0, 0);
const bend = { uThetaS: { value: 0 }, uDelta: { value: 0 }, uC: { value: 0 }, uL: { value: W }, uAlpha: { value: 0 }, uDip: { value: 0 }, uLift: { value: 0 } };
const leafMat = back => new THREE.ShaderMaterial({ vertexShader: LEAF_VS, fragmentShader: LEAF_FS,
  side: back ? THREE.BackSide : THREE.FrontSide, uniforms: { ...bend, map: { value: null }, uBack: { value: back ? 1 : 0 }, uLight: { value: LIGHT.clone().normalize() } } });
const leafFront = new THREE.Mesh(leafGeo, leafMat(false));
const leafBack = new THREE.Mesh(leafGeo, leafMat(true));
leafFront.frustumCulled = leafBack.frustumCulled = false;   // the shader moves it; its box doesn't know
// The sheet's shadow on the pages: a depth pass bent the same way (both faces, so the sheet never has a hole).
const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
leafDepth.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, bend);
  sh.vertexShader = LEAF_FN + String.fromCharCode(10) + sh.vertexShader.replace("#include <begin_vertex>", "vec3 leafN; vec3 transformed = leafPos(position, leafN);");
};
leafFront.customDepthMaterial = leafDepth;
leafFront.castShadow = true;
const leaf = new THREE.Group();
leaf.add(leafFront, leafBack);
leaf.visible = false;
inner.add(leaf);

// Without shadow maps (lite), the shadow the lifted leaf casts on the page beneath it: a soft band beyond its edge.
const castShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, H),
  new THREE.MeshBasicMaterial({ map: edgeShadow(), transparent: true, depthWrite: false, opacity: 0 }));
castShadow.visible = false;
inner.add(castShadow);

// Put the leaf at t (0 = lying on the right, 1 = lying on the left). dir: +1 turning forward, -1 back. twist: -1..1,
// where it was grabbed, high or low, for the way it turns (dir); the corner nearer the grab peels first.
function poseLeaf(t, dir, twist = 0) {
  const rigid = T && T.rigid;                     // a cover: a stiff board, it doesn't curl
  const p = dir > 0 ? t : 1 - t, lift = Math.sin(Math.PI * p);   // how far through the turn, in its own direction
  // The spine's angle and the free edge's, for a forward turn: the edge leads at first, then trails as it lands.
  const mean = Math.PI * p, lead = rigid ? 0 : 2.8 * lift * (1 - 1.5 * p);
  const s0 = Math.min(Math.PI, Math.max(0, mean - lead / 2)), e0 = Math.min(Math.PI, Math.max(0, mean + lead / 2));
  const k = smooth(0, 0.45, p);                   // the roll starts out by the edge, and spreads to the whole sheet
  bend.uThetaS.value = dir > 0 ? s0 : Math.PI - s0;
  bend.uDelta.value = (dir > 0 ? 1 : -1) * (e0 - s0);
  bend.uC.value = 0.5 * W * (1 - k);
  bend.uL.value = W * (0.4 + 0.6 * k);
  // The lean is for the peel; it straightens as the page comes down, so it lands square on the stack.
  bend.uAlpha.value = rigid ? 0 : -0.5 * twist * (dir > 0 ? 1 : -1) * (1 - smooth(0.55, 0.9, p));
  bend.uLift.value = lift;
  // Where the free edge is (at mid height), and how high: the shadow falls just beyond it, on the page below.
  const edge = curlX(W);
  const width = 0.5 * W * lift + 0.02;
  const onRight = edge >= 0;
  castShadow.visible = lite && lift > 0.01;
  castShadow.scale.x = onRight ? width : -width;
  castShadow.position.x = onRight ? Math.min(edge, W) + width / 2 : Math.max(edge, -W) - width / 2;
  castShadow.material.opacity = 0.5 * lift;
}
// Where a point of the sheet's middle line (u from the spine) is, across the book, as the shader puts it.
function curlX(u) {
  const { uThetaS: { value: ts }, uDelta: { value: d }, uC: { value: c }, uL: { value: l }, uAlpha: { value: al } } = bend;
  const s = u * Math.cos(al);
  let X = s, Z = 0;
  if (Math.abs(d) > 1e-4 && s > c) {
    const R = l / d;
    if (s < c + l) { const phi = d * (s - c) / l; X = c + R * Math.sin(phi); Z = R * (1 - Math.cos(phi)); }
    else { const r = s - c - l; X = c + R * Math.sin(d) + r * Math.cos(d); Z = R * (1 - Math.cos(d)) + r * Math.sin(d); }
  }
  return (X * Math.cos(al) + u * Math.sin(al) ** 2) * Math.cos(ts) - Z * Math.sin(ts);
}

// ---------- Drawing pages ----------
const FONT = '"IM Fell English", Georgia, serif', FONT_SC = '"IM Fell English SC", Georgia, serif';
const INK = "#2a2017";
const textures = new Map();                      // key "face:side" -> texture (side R: gutter on the left)
const canvases = new Map();                      // key "face:side" -> canvas
const order = [];                                // least recently used keys first
const BLANK = -2;                                // the plain paper back of a page in single-page mode (not -1: that is
                                                 // "no page" left of a closed book, 2 x 0 - 1)
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
  gut.addColorStop(0, "rgba(60, 40, 20, .14)");   // light: the page's own curve into the gutter shades it now
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

// A cover's inside: plain paper, as a paperback's is.
function endpaper(g, side) { paper(g, side, "#e6d8b6"); }

// The cover of the National Archives' 1973 reprint, from a photograph of it (img/catalogo-1849.jpg, public domain
// via Wikimedia Commons): tan paper, the title in blackletter, a quill, the decree's order and Clavería's
// signature. The back is plain. Without the photograph, the title is set in type.
const coverImg = new Image();
coverImg.src = "/img/catalogo-1849.jpg";
const coverReady = new Promise(r => { coverImg.onload = () => r(true); coverImg.onerror = () => r(false); });
function drawCover(g, back) {
  g.fillStyle = "#cdb383";
  g.fillRect(0, 0, TEX_W, TEX_H);
  g.fillStyle = g.createPattern(noise ||= makeNoise(), "repeat");
  for (let i = 0; i < 2; i++) g.fillRect(0, 0, TEX_W, TEX_H);
  if (back) return;
  if (coverImg.naturalWidth) { g.drawImage(coverImg, 40, 12, 440, 724, 0, 0, TEX_W, TEX_H); return; }
  const ink = "#3a2a1a";
  centred(g, "CATÁLOGO", 640, 116, FONT_SC, ink);
  centred(g, "ALFABÉTICO", 790, 96, FONT_SC, ink);
  centred(g, "DE", 900, 62, FONT_SC, ink);
  centred(g, "APELLIDOS", 1040, 116, FONT_SC, ink);
  centred(g, "Manila, 21 de Noviembre de 1849", 1230, 40, `italic ${FONT}`, ink);
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
  // Even lines: the type as large as they allow. In place: the size of the printed type.
  const size = tidy && data.pitch ? Math.round(data.pitch * S * 0.9) : Math.round((sizes[sizes.length >> 1] || 14) * S * 1.08);
  g.fillStyle = INK;
  if (tidy) {   // one head line: the page number at the outer edge, the letter in the middle
    g.font = `${Math.round(24 * S)}px ${FONT}`;
    g.textAlign = side === "R" ? "right" : "left";
    g.fillText(String(page.n), (side === "R" ? TIDY.right : TIDY.left) * S, TIDY.head * S);
    g.textAlign = "left";
    centred(g, page.letter, TIDY.head * S, Math.round(26 * S), FONT_SC);
  } else {      // as on the scanned page: the reprint's thumb letter, the running head, and its page number below
    g.font = `bold ${Math.round(34 * S)}px Georgia, serif`;
    g.fillText(page.letter, (side === "R" ? SCAN_W - 50 : 22) * S, 52 * S);
    g.font = `${Math.round(17 * S)}px ${FONT}`;
    g.fillText(String(page.n), (side === "R" ? 790 : 62) * S, 118 * S);
    centred(g, page.letter, 118 * S, Math.round(17 * S));
    centred(g, `[${page.n}]`, 1428 * S, Math.round(17 * S));
  }
  g.font = `${size}px ${FONT}`;
  for (const e of entries) {
    const [x0, y0, x1, y1, name, status] = e;
    const litHere = lit && lit.n === page.n && lit.col === e[6];   // a column lit for the foreword
    if (sure && !litHere) {   // Tags: every name washed by how sure the OCR is
      g.fillStyle = SHADE[status];
      g.fillRect(x0 * S - 4, y0 * S - 2, Math.max(x1 - x0, 50) * S + 8, (y1 - y0) * S + 6);
    }
    if (marked(page, e)) {
      g.fillStyle = "rgba(240, 196, 60, .55)";
      g.fillRect(x0 * S - 6, y0 * S - 4, Math.max(x1 - x0, 60) * S + 12, (y1 - y0) * S + 10);
    }
    if (litHere) {
      g.fillStyle = "rgba(255, 184, 60, .6)";
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
}

// Views, picked in the View panel: "tags" (the default) sets the names in even columns, each shaded by how sure the
// OCR is; "plain" the same without shading; "inplace" sets each name where it sits on the scanned page, crooked as
// the scan is; "scan" shows the scanned page itself, every line the OCR read lightly shaded. A typeset view leaves a
// gap where the OCR missed a line. Remembered per browser (?view= picks one for a visit).
const VIEWS = {
  tags: ["Tags", "The OCR's reading in straight columns, every name shaded by how sure the OCR is of it. Even a sure name can be misread: tap any name to see its line on the scan, and tell us if it's wrong."],
  plain: ["Plain", "The OCR's reading in straight columns, without shading, for reading the book. Tap any name to see its line on the scan."],
  inplace: ["As seen", "The OCR's reading, each name set where it sits on the scanned page, crooked as the scan is."],
  scan: ["Scan", "The scanned page itself, digitized by Google from the University of Michigan's copy of the 1973 reprint. Every line the OCR read is lightly shaded: tap one to compare it with the OCR's reading."] };
let pageView = "tags";
try {
  // Earlier versions: view "tidy" (with or without How sure?), "inplace", "scan"; before that, layout "scan" meant in place.
  const stored = localStorage.getItem("view"), sureBefore = localStorage.getItem("sure") === "1";
  const before = stored === "tidy" ? (sureBefore ? "tags" : "plain") : stored || (localStorage.getItem("layout") === "scan" ? "inplace" : null);
  pageView = new URLSearchParams(location.search).get("view") || before || "tags";
} catch {}
if (pageView === "tidy") pageView = "plain";
if (!VIEWS[pageView]) pageView = "tags";
let tidy = pageView === "tags" || pageView === "plain";
let sure = pageView === "tags" || pageView === "scan";   // shading by certainty
// The typeset views use the whole page, margin to margin, under one head line (the page number at the outer edge, the
// letter in the middle); the reprint packs about 72 lines a column, so a page with fewer keeps the same line spacing.
const TIDY = { left: 46, right: SCAN_W - 46, top: 86, bottom: 1472, rows: 72, head: 62 };
function layoutOf(data) {
  if (!tidy) return data.e;
  if (data.tidy) return data.tidy;
  const e = data.e, median = a => a.sort((x, y) => x - y)[a.length >> 1];
  const cols = Math.max(...e.map(x => x[6] || 1));
  const top = Math.min(...e.map(x => x[1]));
  // Line pitch: the usual step between one line and the next in a column.
  const steps = [];
  for (let i = 1; i < e.length; i++) if (e[i][6] === e[i - 1][6]) { const d = e[i][1] - e[i - 1][1]; if (d > 8 && d < 30) steps.push(d); }
  const pitch = steps.length ? median(steps) : 16.5;
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
  const lines = (TIDY.bottom - TIDY.top) / Math.max(last + 1, TIDY.rows), colW = (TIDY.right - TIDY.left) / cols;
  data.pitch = lines;
  data.tidy = slotted.map(([x, slot]) => {
    const x0 = TIDY.left + ((x[6] || 1) - 1) * colW, y0 = TIDY.top + slot * lines;
    return [Math.round(x0), Math.round(y0), Math.round(x0 + colW * 0.94), Math.round(y0 + lines * 0.8), ...x.slice(4)];   // name, status, column, row, other reading, crop
  });
  return data.tidy;
}

function viewButton() {
  const b = document.getElementById("layout");
  b.textContent = `${VIEWS[pageView][0]} ▾`;
  b.setAttribute("aria-label", `View: ${VIEWS[pageView][0]}. Change the view`);
  canvas.setAttribute("aria-label", `The book${pageView === "scan" ? ", showing the scanned pages" : ""}. Drag or use the arrow keys to turn pages; ` +
    "double-tap to zoom. The names on the open pages are listed by the first button.");
}
function setView(v) {
  pageView = v;
  tidy = v === "tags" || v === "plain";
  sure = v === "tags" || v === "scan";
  try { localStorage.setItem("view", v); } catch {}
  viewButton();
  forget();
  show();
}
// The View panel: the four views, each with an (i) that says what it is.
const viewsDlg = document.getElementById("views");
function openViews() {
  const box = viewsDlg.querySelector(".vopts");
  box.innerHTML = Object.entries(VIEWS).map(([k, [label, info]]) => `<div class="vopt"><div class="vrow">
    <label><input type="radio" name="view" value="${k}"${k === pageView ? " checked" : ""}> ${label}</label>
    <button type="button" class="i" aria-expanded="false" aria-controls="vi-${k}" aria-label="What is ${label}?">i</button></div>
    <p class="vinfo" id="vi-${k}" hidden>${info}</p></div>`).join("");
  box.onchange = e => { if (e.target.name === "view") { setView(e.target.value); viewsDlg.close(); } };
  box.onclick = e => {
    const b = e.target.closest(".i");
    if (!b) return;
    const p = document.getElementById(b.getAttribute("aria-controls"));
    p.hidden = !p.hidden;
    b.setAttribute("aria-expanded", String(!p.hidden));
  };
  viewsDlg.showModal();
}
viewsDlg.querySelector(".x").onclick = () => viewsDlg.close();

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
  else if (kind === "endpaper") endpaper(g, side);
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
      } else if (sure) {                         // every line the OCR read, washed by how sure it is
        g.fillStyle = SHADE[status];
        g.fillRect(x, y, w, h);
        if (status >= 3) {                       // and the doubtful ones outlined: best guesses dotted, blurry solid
          g.setLineDash(status === 4 ? [] : [4, 4]);
          g.strokeStyle = status === 4 ? "rgba(214, 120, 30, .9)" : "rgba(120, 80, 30, .7)";
          g.lineWidth = 2;
          g.strokeRect(x, y, w, h);
          g.setLineDash([]);
        }
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
  while (order.length > 16) {                     // keep a dozen pages in memory, and the covers' four faces
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

// The paper on each side: the leaves between the two covers (the covers are boards, posed apart).
function paper2() {
  if (mode === "single") return [0, Math.max(0, SINGLE.length - si - 1)];
  return [Math.max(0, Math.min(cur, LEAVES - 1) - 1), Math.max(0, LEAVES - 1 - Math.max(cur, 1))];
}
// The covers and the spine as they lie when no cover is turning (turn: a cover's turn in progress, posed by its t).
function poseCovers(turn) {
  const single = mode === "single", [left, right] = paper2(), zL = left * LEAF, zR = right * LEAF, desk = -LEAF;
  let tf = (single ? si : cur) === 0 ? 0 : 1, tb = !single && cur === LEAVES ? 1 : 0;
  if (turn && turn.cover === "F") tf = turn.t;
  if (turn && turn.cover === "B") tb = turn.t;
  if (turn && single && turn.rigid && (turn.dir > 0 ? si === 0 : si === 1)) tf = turn.t;   // the cover, as a page
  // The front board's hinge stays on the pages while the board is over them, and comes down to the desk once it's
  // past upright; the back board's hinge rises onto the pages before the board is over them. So neither cuts in.
  const pf = zR + (desk - zR) * smooth(0.5, 1, tf), pb = desk + (zL - desk) * smooth(0, 0.5, tb);
  coverF.visible = !single;
  coverF.position.set(0, 0, pf);
  coverF.rotation.y = -Math.PI * tf;
  coverB.position.set(0, 0, pb);
  coverB.rotation.y = -Math.PI * tb;
  setFace(coverF.material[4], 0, "R"); setFace(coverF.material[5], 1, "L");
  setFace(coverB.material[4], FACES.length - 2, "R"); setFace(coverB.material[5], FACES.length - 1, "L");
  // The spine, from under the back board to the top of the one on top. It bulges out on the side away from the
  // pages, which is where the turning board goes: so it folds flat as the front board comes up to upright, and
  // rounds out only once the back board is past upright.
  const back = !single && tb > 0, round = back ? smooth(0.5, 0.65, tb) : 1 - smooth(0.35, 0.5, tf);
  spine.visible = round > 0.01;
  if (spine.visible) {
    const bottom = desk - BOARD, top = back ? pb + BOARD : single ? zR : pf + BOARD, half = Math.max(1e-4, (top - bottom) / 2);
    spine.position.set(0, 0, (top + bottom) / 2);
    spine.scale.set((back ? -1 : 1) * Math.max(0.003, 0.35 * half * round), 1, half);   // a paperback's spine: barely rounded
  }
}
function setFace(mat, f, side) {
  const tex = texture(f, side);
  if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
}
const pageOr = f => (f === 1 || f === FACES.length - 2 ? NONE : f);   // the endpapers are the covers' insides

function place() {
  const [left, right] = paper2(), leftZ = left * LEAF, rightZ = right * LEAF;
  view.td = closedBook() ? 0 : 1;                // the gutter opens up with the book (eased, in ease())
  if (reduceMotion) view.dip = view.td;
  shapeAll();
  castShadow.position.z = Math.max(leftZ, rightZ) + 0.001;
  const alone = mode === "single" || cur === 0 || cur === LEAVES;
  shadow.scale.x = alone ? 0.55 : 1;
  shadow.position.x = mode === "single" || cur === 0 ? W / 2 : cur === LEAVES ? -W / 2 : 0;
  // The group turns about the closed block's centre, for turning the book over in the hand.
  const cx = mode === "spread" && cur === LEAVES ? -W / 2 : W / 2, cz = closedBook() ? Math.max(leftZ, rightZ) / 2 : 0;
  book.position.set(cx, 0, cz);
  inner.position.set(-cx, 0, -cz);
  poseCovers(null);
  // Closed, the book is seen at an angle, lying on the desk; open, from a little in front of straight above.
  const tt = tiltFor();
  if (tt !== view.tt) { view.tt = tt; ease(); }
  document.body.classList.toggle("shut", closedBook());
}
const closedBook = () => (mode === "single" ? si === 0 || si === SINGLE.length - 1 : cur === 0 || cur === LEAVES);

function show() {
  if (mode === "single") {
    leftPage.visible = false;
    setMap(rightPage, SINGLE[si], "R");
  } else {
    // Closed on the front, the page under the cover; closed on the back, the last page under it; the endpapers are
    // the covers' own insides.
    setMap(leftPage, cur === LEAVES ? FACES.length - 3 : cur >= 2 ? pageOr(2 * cur - 1) : NONE, "L");
    setMap(rightPage, cur === 0 ? 2 : pageOr(2 * cur), "R");
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
function startTurn(dir, peek = false) {
  if (mode === "single") {
    if (dir > 0 ? si >= SINGLE.length - 1 : si <= 0) return null;
    setMap(leafFront, dir > 0 ? SINGLE[si] : SINGLE[si - 1], "R");
    setMap(leafBack, BLANK, "R");
    if (dir > 0) setMap(rightPage, SINGLE[si + 1], "R");
  } else {
    if (dir > 0 ? cur >= LEAVES : cur <= 0) return null;
    const l = dir > 0 ? cur : cur - 1;              // the leaf that moves
    if (l !== 0 && l !== LEAVES - 1) {             // a paper leaf (a cover turns as its board, posed in drawTurn)
      setMap(leafFront, 2 * l, "R");
      setMap(leafBack, 2 * l + 1, "L");
      if (dir > 0) setMap(rightPage, pageOr(2 * cur + 2), "R"); else setMap(leftPage, cur - 1 >= 2 ? pageOr(2 * cur - 3) : NONE, "L");
    }
  }
  leaf.visible = true;
  const moving = mode === "single" ? (dir > 0 ? SINGLE[si] : SINGLE[si - 1]) : 2 * (dir > 0 ? cur : cur - 1);
  T = { dir, t: dir > 0 ? 0 : 1, twist: -0.4 * dir, anim: null, rigid: moving === 0 || FACES[moving + 1] === "backcover" || FACES[moving] === "backcover" };
  if (mode === "spread" && T.rigid) { T.cover = moving === 0 ? "F" : "B"; leaf.visible = false; }
  if (!peek && closedBook() && view.tt === 1) { view.tt = READ_TILT; ease(); }   // opening the book: the camera comes round to read it
  if (!peek && (tumble.x || tumble.y)) springBack();                              // and the book settles flat if it was in the hand
  if (!peek && storyOpen && !choreo) closeStory(false, true);                     // turned by hand: the reader has the book
  // Closing a cover: the shadow under the book comes in to the closed book's size with it.
  if (T.cover === "F" && dir < 0) { shadow.scale.x = 0.55; shadow.position.x = W / 2; }
  if (T.cover === "B" && dir > 0) { shadow.scale.x = 0.55; shadow.position.x = -W / 2; }
  drawTurn();
  return T;
}

function drawTurn() {
  poseLeaf(T.t, T.dir, T.twist);                   // the leaf's bend, and the shadow it casts on the page below
  poseCovers(T);
  if (T.cover) {
    leaf.visible = false;
    if (T.cover === "F" ? castShadow.position.x < 0 : castShadow.position.x > 0) castShadow.visible = false;   // no pages there
    render();
    return;
  }
  const [left, right] = paper2(), zR = right * LEAF, zL = left * LEAF;
  // The hinge rides on the taller stack while the leaf is over it, so the sheet never cuts into the pages.
  leaf.position.z = zR + (zL - zR) * (zR >= zL ? smooth(0.5, 0.85, T.t) : smooth(0.15, 0.5, T.t)) + 0.003;
  leaf.scale.z = T.rigid ? 1 : mode === "single" ? 0.75 : 1;      // the lift: how high the page rises as it turns
  bend.uDip.value = (leaf.position.z / leaf.scale.z) * view.dip;   // at rest, down into the gutter like the page beneath
  render();
}

// Animate the turn to its end (goal 1 = lying on the left) or back where it started. Full turns ease in and out;
// a release mid-drag eases out from where the finger left it.
function settle(goal, fromDrag = false, dur) {
  if (!T) return;
  const from = T.t, dist = Math.abs(goal - from);
  T.anim = { from, goal, start: performance.now(), dur: reduceMotion ? 0 : dur ?? Math.max(160, (fromDrag ? 560 : 1050) * dist), fromDrag };
  requestAnimationFrame(stepTurn);
}
function stepTurn() {
  if (!T || !T.anim) return;
  const a = T.anim, k = Math.min(1, (performance.now() - a.start) / (a.dur || 1));
  const e = a.fromDrag ? 1 - Math.pow(1 - k, 3) : (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  T.t = a.from + (a.goal - a.from) * e;
  T.twist *= a.fromDrag ? 0.94 : 1;
  drawTurn();
  if (k < 1) requestAnimationFrame(stepTurn); else if (!T.hold) endTurn();
}
function endTurn() {
  if (!T) return;
  const completed = T.dir > 0 ? T.t >= 0.999 : T.t <= 0.001;
  const dir = T.dir, onEnd = T.onEnd;
  T = null;
  leaf.visible = false;
  castShadow.visible = false;
  if (completed) { if (mode === "single") si += dir; else cur += dir; }
  show();
  frame();
  if (onEnd) onEnd(completed);
}
const finishTurn = () => { if (T) { T.t = T.dir > 0 ? 1 : 0; endTurn(); } };
// A whole turn, as from the arrows or a tap.
function turn(dir, dur) {
  if (T) finishTurn();
  if (startTurn(dir)) settle(dir > 0 ? 1 : 0, false, dur);
}

// ---------- Camera: fit, zoom and pan ----------
const view = { zoom: 1, tz: 1, x: 0, y: 0, tx: 0, ty: 0, tilt: 0, tt: 0, side: 0, ts: 0, below: 0, tb: 0, dip: 0, td: 0 };   // x, y, zoom, tilt, side: now; tx, ty, tz, tt, ts: where the camera eases to; dip: the gutter, 0 shut, 1 open
// Reading, the camera sits a little in front of straight above, so the open book keeps its depth; zoomed in to
// check a line, it goes straight above. Shut, the book is seen lying on the desk (tilt 1).
const READ_TILT = 0;   // 0: straight above, as the book always was (a small value tilts the open book)
const tiltFor = () => (closedBook() ? 1 : view.tz > 1.05 ? 0 : READ_TILT);
// side: the width (px) of the foreword beside the book, which the book's view leaves free on the left; below: its
// height (px) under the book, on a phone.
const freeW = () => (innerWidth - view.side) / innerWidth;
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
  view.tt = tiltFor();
  const [x0, x1] = span();
  view.tx = (x0 + x1) / 2;
  view.ty = 0;
  ease();
}

function fitDistance() {
  const [x0, x1] = span();
  const vw = (x1 - x0) * 1.03, vh = H * 1.035;
  const usable = (innerHeight - TOP() - BOT() - view.below) / innerHeight;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.max(vh / 2 / (tan * usable), vw / 2 / (tan * camera.aspect * freeW()));
}

function applyCamera() {
  // tilt 0: straight above the page. tilt 1: the book lying on a desk, seen from the front and a little to the
  // right, a step further back. In between, the camera swings between the two.
  const tilt = view.tilt, d = (fitDistance() / view.zoom) * (1 + 0.22 * tilt * tilt);   // a small step back for the desk view
  // Keep the bars from covering the page: shift the view by half the difference between the two bars.
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const shift = ((BOT() - TOP()) / innerHeight) * d * tan * (1 - tilt) + ((view.below / innerHeight) * d * tan) / Math.cos(0.82 * tilt);
  // And move it over by half the panel's width, so the book sits in the middle of the space the panel leaves.
  // The shift runs along the camera's own up, so a yawed camera moves the book up the screen, not sideways.
  const pitch = 0.82 * tilt, yaw = 0.32 * tilt;
  const x = view.x - (view.side / innerWidth) * d * tan * camera.aspect + shift * Math.sin(yaw), y = view.y - shift * Math.cos(yaw);
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
    view.side += (view.ts - view.side) * (reduceMotion ? 1 : 0.14);
    view.below += (view.tb - view.below) * (reduceMotion ? 1 : 0.14);
    if (view.dip !== view.td) {   // the gutter deepens as the book opens, and flattens as it shuts
      view.dip += (view.td - view.dip) * (reduceMotion ? 1 : 0.1);
      if (Math.abs(view.td - view.dip) < 0.004) view.dip = view.td;
      shapeAll();
    }
    render();
    if (Math.abs(view.tx - view.x) + Math.abs(view.ty - view.y) + Math.abs(view.tz - view.zoom) + Math.abs(view.tt - view.tilt) + Math.abs(view.ts - view.side) / 1000 + Math.abs(view.tb - view.below) / 1000 + Math.abs(view.td - view.dip) > 1e-4) requestAnimationFrame(step);
    else { view.x = view.tx; view.y = view.ty; view.zoom = view.tz; view.tilt = view.tt; view.side = view.ts; view.below = view.tb; easing = false; render(); }
  };
  step();
}

function clampView() {
  // Keep the view on the pages in view.
  const [x0, x1] = span();
  const d = fitDistance() / view.zoom, tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfW = d * tan * camera.aspect * freeW(), halfH = d * tan * (innerHeight - TOP() - BOT()) / innerHeight;
  const fit = (v, a, b, half) => (b - a <= 2 * half ? (a + b) / 2 : Math.max(a + half, Math.min(b - half, v)));
  view.tx = fit(view.tx, x0, x1, halfW);
  view.ty = fit(view.ty, -H / 2, H / 2, halfH);
}

// Zoom in on a point, smoothly (a double tap, a search) or at once (pinch, wheel, keys).
function glideTo(z, wx, wy) {
  view.tz = Math.max(1, Math.min(6, z));
  view.tt = tiltFor();
  view.tx = wx; view.ty = wy;
  const keep = view.zoom;
  view.zoom = view.tz; clampView(); view.zoom = keep;   // clamp for where it's going
  ease();
}
function zoomTo(z, wx, wy) {
  const old = view.zoom;
  view.zoom = view.tz = Math.max(1, Math.min(6, z));
  view.tt = tiltFor();
  if (view.tt !== view.tilt) ease();
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

// ---------- The foreword, beside the book, and the book opening ----------
// The foreword is optional: museum placards beside the closed book on a wide screen, below it on a phone
// (index.html). It opens on every visit to the front door and folds away to the tab at the left edge; a link to a
// page, a name or an entry goes straight there. As the placards scroll, the book acts each one (BEATS). A hand on
// the book stops the beat, and a page turned by hand folds the foreword away, so the reader can read.
const story = document.getElementById("story"), storyTab = document.getElementById("storytab"), storyX = document.getElementById("storyx");
let storyOpen = false, choreo = false;                        // choreo: a beat is turning the pages, not the reader
const beside = () => innerWidth >= 760;                       // the placards sit beside the book, not below it
const PANEL = 0.42;                                           // on a phone, the book's share of the screen, from the top
function placeStory() {   // beside the book, between the bars; or below it, and the book's view makes room above
  const side = beside(), top = side ? TOP() : Math.round(innerHeight * PANEL);
  story.classList.toggle("below", !side);
  story.style.top = `${top}px`;
  story.style.bottom = side ? `${BOT()}px` : "0";
  storyX.style.top = `${top + 10}px`;
  storyX.hidden = !storyOpen;
  dots.hidden = !storyOpen;
  dots.classList.toggle("below", !side);
  dots.style.top = side ? "" : `${top + 14}px`;
  document.body.classList.toggle("foreword", storyOpen);
  view.ts = storyOpen && side ? story.offsetWidth : 0;
  view.tb = storyOpen && !side ? innerHeight - top : 0;
}
function showStory(fromTop = false) {
  storyOpen = true;
  story.classList.remove("out");
  storyTab.setAttribute("aria-expanded", "true");
  if (fromTop) {   // at the top: again once laid out and once the type has arrived, as the reflow can snap it on
    const opened = performance.now(), pin = () => { if (storyOpen && performance.now() - opened < 1500) { story.scrollTop = 0; onStoryScroll(); } };
    pin();
    requestAnimationFrame(pin);
    setTimeout(pin, 300);
    document.fonts?.ready.then(pin);
  }
  placeStory();
  if (fromTop) { view.side = view.ts; view.below = view.tb; }   // opened with the page: the book starts in its place, no glide
  ease();
  beatNow = -1;
  onStoryScroll();
}
function closeStory(open, quiet = false) {
  if (!storyOpen) return;
  storyOpen = false;
  stopBeat();
  story.classList.add("out");
  storyTab.setAttribute("aria-expanded", "false");
  placeStory();
  ease();
  if (open) openBook(reduceMotion ? 0 : 450); else if (!quiet) inviteOpen(600);
}
// The placard being read is the one across the middle of the panel (or the nearest to it): it's lit, the rest
// wait faintly, and the book plays its beat.
const slides = [...story.querySelectorAll(".slide")];
function activeSlide() {
  const r = story.getBoundingClientRect(), mid = r.top + r.height * 0.47;
  let best = 0, bestD = Infinity;
  slides.forEach((x, i) => {
    const b = x.getBoundingClientRect();
    const d = mid >= b.top && mid <= b.bottom ? 0 : Math.min(Math.abs(mid - b.top), Math.abs(mid - b.bottom));
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
const dots = document.getElementById("dots");
dots.innerHTML = slides.map((x, i) => `<button type="button" data-i="${i}" aria-label="${x.querySelector("h2").textContent}"></button>`).join("");
dots.onclick = e => { const b = e.target.closest("button[data-i]"); if (b) story.scrollTo({ top: slides[+b.dataset.i].offsetTop, behavior: reduceMotion ? "instant" : "smooth" }); };
let scrollTick = false;
function onStoryScroll() {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => {
    scrollTick = false;
    const k = activeSlide();
    slides.forEach((x, i) => x.classList.toggle("on", i === k));
    [...dots.children].forEach((b, i) => b.setAttribute("aria-current", i === k ? "true" : "false"));
    if (storyOpen) playBeat(k);
  });
}
story.addEventListener("scroll", onStoryScroll, { passive: true });
storyTab.onclick = () => showStory();
storyX.onclick = () => closeStory(false);
document.getElementById("skipto").onclick = () => closeStory(false);
story.querySelector(".open").onclick = () => closeStory(true);

// The beats: what the book does for each placard. Each is a sequence of turns; a new beat, a hand on the book or
// the foreword closing cancels the one running (its id goes stale, and it stops at its next step).
let beatNow = -1, beatId = 0, lit = null;                    // lit: {n, col}, a column washed gold on its page
const wait = ms => new Promise(r => setTimeout(r, ms));
// One turn, as a promise: resolves when the leaf lands (false if there was nothing to turn).
const turnP = (dir, dur) => new Promise(res => {
  if (T) finishTurn();
  if (!startTurn(dir)) return res(false);
  T.onEnd = () => res(true);
  settle(dir > 0 ? 1 : 0, false, dur);
});
const stale = id => id !== beatId || !storyOpen;
const at = () => (mode === "single" ? si : cur), jumpTo = k => { if (mode === "single") si = k; else cur = k; show(); };
async function shut(id, slow = false) {   // close the book: the cover at once, or (slow) leaf by leaf first
  if (peeking) peekCover(false);
  if (closedBook()) return;
  if (!slow && at() > 1) jumpTo(1);
  if (slow && at() > 3) jumpTo(3);
  while (slow && !stale(id) && at() > 1) await turnP(-1, 1100);
  if (!stale(id)) await turnP(-1, slow ? 900 : 650);
}
async function openTo(id, n) {           // open the book (the cover first, if it's shut) and turn to a page
  if (peeking) peekCover(false);
  if (closedBook()) { await turnP(1, 700); if (stale(id)) return; }
  goToPage(n, true);
}
const BEATS = [
  async id => shut(id),                                       // the title wall: shut, under the light
  async id => shut(id),                                       // 1: shut
  async id => {                                               // 2: the cover opens, the pages riffle, it shuts again
    await shut(id); if (stale(id)) return;
    await turnP(1, 650);
    for (let i = 0; i < 9 && !stale(id); i++) await turnP(1, 150);
    if (stale(id)) return;
    await wait(350); if (stale(id)) return;
    await shut(id);
  },
  async id => openTo(id, 58),                                 // 3: open on the table, at a spread
  async id => {                                               // 4: the A pages, one column lit (drawn lit before the turn)
    lit = { n: 2, col: 1 }; forget(faceOfPage(2));
    await openTo(id, 2);
  },
  async id => shut(id, true),                                 // 5: closed, slowly
  async id => { await shut(id); if (!stale(id)) { await wait(400); if (!stale(id)) peekCover(true); } }];   // 6: the cover lifts and waits
function unlight() { if (lit) { const f = faceOfPage(lit.n); lit = null; forget(f); } }
const BEATS_ON = false;                                     // the book keeps still while the foreword is read
function playBeat(k) {
  if (!BEATS_ON || k === beatNow || k < 0 || reduceMotion) return;         // (with reduced motion the book keeps still)
  beatNow = k;
  const id = ++beatId;
  unlight();
  choreo = true;
  BEATS[k](id).catch(() => {}).finally(() => { if (id === beatId) choreo = false; });
}
function stopBeat() {
  beatId++;
  choreo = false;
  beatNow = -1;
  if (lit) { unlight(); show(); }
}
// A hand on the book stops the beat; let go, the beat starts over once the hand is away (the reader can turn the
// book over and look at it, and the docent steps back).
let resumeTimer;
function pauseBeat() { if (storyOpen) { beatId++; choreo = false; } }
function resumeBeat() {
  if (!storyOpen) return;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { if (storyOpen && !pointers.size && !drag) { beatNow = -1; playBeat(activeSlide()); } }, 1400);
}
function openBook(delay) {   // the front cover lifts, if the book is still closed on it (once the tab is in view)
  if (document.hidden) {
    addEventListener("visibilitychange", () => openBook(delay), { once: true });
    return;
  }
  setTimeout(() => { if (!T && (mode === "single" ? si === 0 : cur === 0)) next(); }, delay);
}

// The closed book waits for the reader: on a computer the cover lifts a little under the pointer, and a click opens
// it from there; a touch screen gets one small lift, as an invitation, and a tap opens it.
const PEEK = 0.09;                                // how far the cover lifts, as a part of a whole turn
let peeking = false, invited = false;
const frontClosed = () => (mode === "single" ? si === 0 : cur === 0);
function peekCover(on) {
  if (reduceMotion || view.zoom > 1.05) return;
  if (on && !peeking && !T && frontClosed() && startTurn(1, true)) {
    peeking = true;
    T.hold = true;
    settle(PEEK);
  } else if (!on && peeking && T) {
    peeking = false;
    T.hold = false;
    settle(0);
  }
}
function openCover() {   // a click or a tap on the closed book: open it, from the lifted cover if it's lifted
  if (peeking && T) {
    peeking = false;
    T.hold = false;
    view.tt = READ_TILT;
    ease();
    if (storyOpen) closeStory(false, true);
    settle(1);
  } else next();
}
const overBook = (x, y) => { const p = worldAt(x, y), [x0, x1] = span(); return p.x >= x0 && p.x <= x1 && Math.abs(p.y) <= H / 2; };
canvas.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || pointers.size) return;
  const over = !T || peeking ? frontClosed() && view.zoom <= 1.05 && !tumble.x && !tumble.y && overBook(e.clientX, e.clientY) : false;
  canvas.style.cursor = over ? "pointer" : "";
  if (!choreo || peeking) peekCover(over);
});
canvas.addEventListener("pointerleave", () => { canvas.style.cursor = ""; if (!choreo) peekCover(false); });
function inviteOpen(delay) {
  if (document.hidden) { addEventListener("visibilitychange", () => inviteOpen(delay), { once: true }); return; }
  setTimeout(() => {
    if (invited || storyOpen || !frontClosed()) return;
    invited = true;
    const touch = matchMedia("(hover: none)").matches;
    toast(touch ? "Tap the book to open it" : "Click the book to open it");
    if (touch) { peekCover(true); setTimeout(() => peekCover(false), 900); }
  }, delay);
}
document.getElementById("restory").onclick = () => {
  document.getElementById("about").close();
  showStory(true);
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
  topBar.classList.remove("searching");
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

// ---------- Reading help ----------
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
    box.innerHTML = datas.map((data, i) => `<h3>Page ${shown[i].n}</h3><ol>` + data.e.map((e, j) => `<li><button type="button" data-p="${i}" data-e="${j}">${unread(e[4]) ? "<i>unread line</i>" : esc(e[4])}<span class="sr"> (${unread(e[4]) ? "neither scan could read it" : STATUS[e[5]].toLowerCase()}: see it on the scan)</span></button></li>`).join("") + "</ol>").join("");
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
  // A name without a crop strip (the OCR was sure of it) is cut from its page's scan, framed as the strips are.
  const meta = crop == null && !page.hand ? await scanMeta() : null;
  const cropStyle = around => {
    const k = around ? Math.min(1.33, room / CELL_W) : Math.min(1.67, room / wordW), size = `width:${(around ? CELL_W : wordW) * k}px;height:${(around ? CELL_H : LINE_H) * k}px`;
    if (crop == null) {
      const sc = meta.scale, [ox, oy] = meta.offset || [0, 0], kx = (GW / SCAN_W) * sc, ky = (GH / SCAN_H) * sc, c = (1.5 * k) / kx;
      const x = (orig[0] - CELL_PAD) * kx + ox, y = (orig[1] - 21 + (around ? 0 : 16)) * ky + oy;   // as catalogo_crops.py frames a cell
      return { k, css: `background-image:url('${SCANS}${SCANS_V}/${scan}.webp');background-size:${meta.width * c}px auto;` +
        `background-position:-${x * c}px -${y * c}px;${size}` };
    }
    const cx = (crop % ACROSS) * CELL_W, cy = Math.floor(crop / ACROSS) * CELL_H + (around ? 0 : LINE_Y);
    return { k, css: `background-image:url('${CROPS}${CROPS_V}/${scan}.webp');background-size:${CELL_W * ACROSS * k}px auto;` +
      `background-position:-${cx * k}px -${cy * k}px;${size}` };
  };
  const id = `${scan}.${col}.${row}`, blank = unread(name), confident = status <= 2 && !blank;   // a green name: agree or not
  highlight = { n: page.n, name, col, row };   // outlined on its page, until the next one
  forget(faceOfPage(page.n));
  show();
  const link = await entryPath(page, e);
  setPath(link);
  dlg.innerHTML = `
    <div class="eh"><h2>${blank ? "Unread line" : `${esc(name)}.`}</h2><span class="chip s${status}">${blank ? "Unread" : STATUS[status]}</span><button type="button" class="x" aria-label="Close">✕</button></div>
    <p class="why">${blank ? "Neither scan could read this line, so it has no reading yet. Can you read it?" : WHY[status] +
      (status <= 2 ? " Still, an OCR can be wrong: if the scan shows something else, tell us." : "")}</p>
    ${CROPS && (crop != null || (meta && meta.scale && meta.width)) ? `<figure class="crop"><div class="img" style="${cropStyle(false).css}"><span class="mark" hidden></span></div>
      <figcaption>The scan, page ${page.n} · digitized by Google from the University of Michigan's copy · <button type="button" class="around">Show the lines around it</button></figcaption></figure>` : ""}
    <p class="small order" hidden></p>
    ${raw && !blank ? `<p class="small">OCR reading: <b>${esc(name)}</b> · the other scan's OCR: <b>${esc(raw)}</b></p>` : ""}
    <form class="readings" autocomplete="off">
      <p class="q">${confident ? `Does the scan say <b>${esc(name)}</b>?` : "How do you read it?"}</p>
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
  if (mine) return showTally(res.options, mine, false, confident && name);
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
  // A name the OCR was sure of: one question, does the scan agree? "No" opens the box for what it does say.
  let agreed = false;
  if (confident) {
    const opts = dlg.querySelector(".opts"), own = form.own.closest(".own"), vote = form.querySelector('button[type="submit"]');
    opts.innerHTML = `<div class="agree"><button type="button" class="primary yes">Yes, it matches</button>
      <button type="button" class="no">No, it says something else</button></div>`;
    own.hidden = vote.hidden = true;
    opts.querySelector(".yes").onclick = () => { agreed = true; form.requestSubmit(); };
    opts.querySelector(".no").onclick = () => {
      opts.hidden = true;
      own.hidden = vote.hidden = false;
      dlg.querySelector(".q").textContent = "What does the scan say?";
      form.own.focus();
    };
  }
  form.own.addEventListener("input", () => { form.querySelectorAll("input[name=pick]").forEach(r => { r.checked = false; }); });
  form.querySelectorAll("input[name=pick]").forEach(r => r.addEventListener("change", () => { form.own.value = ""; }));
  dlg.querySelector(".notsure").onclick = () => showTally(res.options, null, false, confident && name);
  let token = "";
  loadTurnstile().then(() => {
    if (!dlg.open) return;
    window.turnstile.render(dlg.querySelector(".ts"), { sitekey: SITEKEY, size: "flexible", callback: t => { token = t; } });
  }).catch(() => { err.textContent = "Couldn't load the spam check. Try again later."; });
  form.onsubmit = async ev => {
    ev.preventDefault();
    const pick = form.querySelector("input[name=pick]:checked")?.value, own = form.own.value.trim();
    const reading = agreed ? name : own || pick;
    agreed = false;
    if (!reading) { err.textContent = confident ? "Type what the scan says." : "Pick a reading or type your own."; return; }
    if (!token) { err.textContent = "One moment: we're checking you're a person."; return; }
    err.textContent = "";
    const r = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name, reading, device, token }) }).then(x => x.json()).catch(() => null);
    if (r?.error === "stale") return pageChanged();
    if (r?.ok || r?.error === "already") {
      try { localStorage.setItem(`voted:${id}`, reading); } catch {}
      showTally(r.options, reading, r.pending, confident && name);
    } else {
      err.textContent = r?.message || (r?.error === "verify" ? "The spam check failed. Please try again." : "Couldn't save your vote. Try again later.");
      token = "";
      try { window.turnstile?.reset(dlg.querySelector(".ts")); } catch {}
    }
  };
}

// The tally: shown after you vote, or when you choose "Not sure" (so votes aren't swayed by the count).
function showTally(options, mine, pending, ocr) {   // ocr: a green name's OCR reading, to say how many agree with it
  const total = options.reduce((a, o) => a + o.v, 0), top = Math.max(...options.map(x => x.v), 1);
  const list = [...options].sort((a, b) => b.v - a.v);
  const box = dlg.querySelector(".tally"), yes = ocr ? (options.find(o => o.r === ocr)?.v || 0) : 0;
  box.innerHTML = `<p class="q">${mine ? "Thanks! Here's how readers read it:" : "How readers read it so far:"}</p>` +
    (ocr && total ? `<p class="small">${yes} of ${total} reader${total === 1 ? "" : "s"} say the scan matches the OCR reading.</p>` : "") +
    (total ? list.map(o => `<div class="bar${o.r === mine ? " me" : ""}"><i style="width:${Math.round(100 * o.v / top)}%"></i>
      <span>${esc(o.r)}${o.ours ? " <small>OCR reading</small>" : ""}</span><b>${o.v}</b></div>`).join("") : `<p class="small">No votes yet. Be the first!</p>`) +
    (pending ? `<p class="small">Your own reading shows here once someone else reads it the same way.</p>` : "") +
    `<p class="small">When readers agree, we check it and fix the dataset for everyone.</p>`;
  box.hidden = false;
  if (mine) dlg.querySelector("form").hidden = true;
  else dlg.querySelector(".notsure").hidden = true;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- The closed book, in the hand ----------
// Shut, the book can be turned over: a drag tumbles it about its centre (pitch and yaw), and let go it settles back
// onto the desk with a little spring. Its parts have labels, as an exhibit does: tap the spine, the page block or
// the back (the front opens it).
const tumble = { x: 0, y: 0, x0: 0, y0: 0, vx: 0, vy: 0, anim: 0 };
function setTumble(x, y) {
  tumble.x = Math.max(-1.25, Math.min(1.25, x));
  tumble.y = y;
  book.rotation.set(tumble.x, tumble.y, 0);
  hideLabel();
  render();
}
function stopSpring() { tumble.anim = 0; }
function springBack() {
  stopSpring();
  const goalY = Math.round(tumble.y / (2 * Math.PI)) * 2 * Math.PI;   // the nearest way round to lying flat
  if (reduceMotion) { tumble.x = tumble.y = 0; book.rotation.set(0, 0, 0); render(); return; }
  const id = ++tumble.anim;
  tumble.vx = tumble.vy = 0;
  const step = () => {
    if (tumble.anim !== id) return;
    tumble.vx = tumble.vx * 0.8 - tumble.x * 0.085;
    tumble.vy = tumble.vy * 0.8 - (tumble.y - goalY) * 0.085;
    tumble.x += tumble.vx; tumble.y += tumble.vy;
    book.rotation.set(tumble.x, tumble.y, 0);
    render();
    if (Math.abs(tumble.x) + Math.abs(tumble.y - goalY) + Math.abs(tumble.vx) + Math.abs(tumble.vy) > 2e-3) requestAnimationFrame(step);
    else { tumble.x = tumble.y = 0; tumble.anim = 0; book.rotation.set(0, 0, 0); render(); }
  };
  step();
}
const LABELS = {
  spine: "The spine. A to Z, with Ll as a letter of its own after L: the Spanish alphabet of 1849.",
  edge: "141 pages of names, six columns to a page, about 72 names to a column.",
  back: "The back of the book. Drag to turn it over; tap the front to open it." };
const caster = new THREE.Raycaster();
// Which part of the shut book is under a point: "cover" (the front, which opens it), "back", "spine" or "edge".
function partAt(px, py) {
  applyCamera();
  camera.updateMatrixWorld();
  book.updateMatrixWorld(true);
  caster.setFromCamera(new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1), camera);
  const hit = caster.intersectObjects([coverF, coverB, spine, stackR, stackL].filter(o => o.visible), false)[0];   // (a hidden cover still catches rays)
  if (!hit) return null;
  const o = hit.object, nz = hit.face ? hit.face.normal.z : 0;
  if (o === spine) return "spine";
  if (o === stackR || o === stackL) return "edge";
  if (o === coverF) return nz > 0.5 ? "cover" : nz < -0.5 ? "back" : "edge";   // its inside shows only when it's the one on top, turned
  return nz < -0.5 ? "back" : nz > 0.5 ? "cover" : "edge";
}
const labelBox = document.getElementById("label");
let labelTimer;
function showLabel(part, x, y) {
  labelBox.textContent = LABELS[part];
  labelBox.hidden = false;
  const w = labelBox.offsetWidth, h = labelBox.offsetHeight;
  labelBox.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px`;
  labelBox.style.top = `${y - h - 14 < 60 ? y + 18 : y - h - 14}px`;
  clearTimeout(labelTimer);
  labelTimer = setTimeout(hideLabel, 6000);
}
function hideLabel() { if (!labelBox.hidden) labelBox.hidden = true; }

// ---------- Input ----------
const pointers = new Map();
let drag = null, lastTap = 0, pinch = null;
canvas.addEventListener("pointerdown", e => {
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  hideLabel();
  pauseBeat();
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
  // The closed book: a drag turns it over in the hand; only a drag on the lifted cover takes the cover with it.
  if (drag.tumbling) { setTumble(tumble.x0 + dy * 0.011, tumble.y0 + dx * 0.011); return; }
  if (!drag.turning && drag.moved && closedBook() && !(peeking && T && dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2)) {
    if (peeking) peekCover(false);
    if (T) finishTurn();
    drag.tumbling = true;
    tumble.x0 = tumble.x; tumble.y0 = tumble.y;
    stopSpring();
    setTumble(tumble.x0 + dy * 0.011, tumble.y0 + dx * 0.011);
    return;
  }
  // Not zoomed: a sideways drag turns the page, following the finger.
  if (!drag.turning && drag.moved && Math.abs(dx) > Math.abs(dy) * 1.2) {
    if (peeking && T && dx < 0) {                 // the lifted cover: the drag takes it from where it is
      peeking = false;
      T.hold = false;
      T.anim = null;
      view.tt = 0;
      ease();
    } else if (peeking && T) {                    // dragged the other way: let the cover down
      peekCover(false);
      drag = null;
      return;
    } else {
      if (T) finishTurn();
      if (!startTurn(dx < 0 ? 1 : -1)) { drag = null; return; }
    }
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
  resumeBeat();
  if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
  if (!drag) return;
  if (drag.tumbling) { drag = null; springBack(); return; }   // let go: the book settles back onto the desk
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
  if (!drag.moved && view.zoom <= 1.05 && closedBook()) {   // a tap on the shut book: open it, or read a part's label
    const part = partAt(e.clientX, e.clientY);
    if (part && part !== "cover") { drag = null; showLabel(part, e.clientX, e.clientY); return; }
    if (frontClosed() && (part === "cover" || overBook(e.clientX, e.clientY))) { drag = null; openCover(); return; }
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
        if (await openEntryAt(x, y)) return;
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
document.getElementById("layout").onclick = openViews;
document.getElementById("info").onclick = () => document.getElementById("about").showModal();
// Go to: the page label opens the book's letters, A to Z (each section's first page), and a box for a page number
// (or a surname, handed to the search).
const where = document.getElementById("where"), indexDlg = document.getElementById("index"), jump = document.getElementById("jump");
let sections = null;
// The book's sections, A to Z with Ll after L: each starts on the first page that has it (pages.json lists the
// sections on each page, from build_book.py, so one that starts partway down a page is found there).
function bookSections() {
  if (sections) return sections;
  sections = [];
  for (const p of PAGES) for (const k of p.keys || []) if (!sections.some(s => s.k === k)) sections.push({ k, n: p.n });
  return sections;
}
where.onclick = () => {
  const kind = FACES[visibleFace()], here = kind && kind.n;
  const cur = here ? bookSections().filter(s => s.n <= here).pop() : null;
  indexDlg.querySelector(".letters").innerHTML = bookSections().map(s =>
    `<button type="button" data-n="${s.n}"${cur && s.k === cur.k ? ' aria-current="true"' : ""} aria-label="${s.k}, from page ${s.n}">${s.k}</button>`).join("");
  jump.value = "";
  indexDlg.showModal();
};
indexDlg.querySelector(".letters").onclick = e => {
  const b = e.target.closest("button[data-n]");
  if (!b) return;
  indexDlg.close();
  goToPage(+b.dataset.n);
};
indexDlg.querySelector(".x").onclick = () => indexDlg.close();
indexDlg.querySelector(".goto").onsubmit = e => {
  e.preventDefault();
  const v = jump.value.trim();
  if (!v) return;
  indexDlg.close();
  if (/^\d+$/.test(v)) {
    const n = +v, p = PAGES.find(x => x.n === n);
    if (p) goToPage(n); else toast("No such page");
  } else { q.value = v; q.dispatchEvent(new Event("input")); openSearch(); q.focus(); }
};

// On a phone, search is an icon, so the title shows in full: it opens the box across the bar, and closes left empty.
const topBar = document.querySelector(".bar.top");
const openSearch = () => topBar.classList.add("searching");
document.getElementById("searchbtn").onclick = () => { openSearch(); q.focus(); };
const closeSearch = () => { if (!q.value && document.activeElement !== q) topBar.classList.remove("searching"); };
q.addEventListener("blur", () => setTimeout(closeSearch, 200));
document.addEventListener("pointerdown", e => { if (!topBar.contains(e.target)) setTimeout(closeSearch, 0); });   // a tap elsewhere

// Light or dark: the device's setting until the reader picks one (kept, and applied before the page paints).
const themeBtn = document.getElementById("theme"), darkQuery = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light")) === "dark";
function themeButton() {
  const label = isDark() ? "Light mode" : "Dark mode";
  themeBtn.setAttribute("aria-label", label);
  themeBtn.title = label;
  document.querySelector('meta[name="theme-color"]').content = isDark() ? "#1d1712" : "#f1eee8";
  // The room's light: the house lights up, or down to one lamp over the book.
  key.intensity = isDark() ? 2.7 : 2.3;
  fill.intensity = isDark() ? 0.65 : 1.2;
  fill.groundColor.set(isDark() ? 0x1a140e : 0x5a4a3a);
  if (FACES.length) render();
}
themeBtn.onclick = () => {
  const theme = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("theme", theme); } catch {}
  themeButton();
};
darkQuery.addEventListener?.("change", themeButton);
themeButton();
addEventListener("keydown", e => {
  if (e.key === "Escape" && storyOpen && !document.querySelector("dialog[open]")) { closeStory(false); return; }
  if (e.target.closest?.("input, textarea, select, dialog, #story")) return;
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
  placeStory();
  view.side = view.ts;
  view.below = view.tb;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (FACES.length && setMode(wantMode())) { if (T) finishTurn(); show(); }
  frame();
  updateBar();
}
addEventListener("resize", resize);

// The paper's edge: fine lines, one every two leaves or so, on cream (repeated along the block's height).
function edgeLines() {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = 64; c.height = 128;
  g.fillStyle = "#eadfc3";
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(120, 95, 55, ${0.3 + 0.3 * Math.random()})`;
    g.fillRect(0, i * 16 + 7, 64, 1.5);
    g.fillStyle = "rgba(255, 255, 255, .3)";
    g.fillRect(0, i * 16 + 9, 64, 1);
  }
  return c;
}

// A few frames of the opening glide, timed: a slow GPU drops the shadow maps and the extra pixels (lite), and the
// turning leaf gets its drawn shadow band back.
function probe() {
  if (reduceMotion) return;
  const dts = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    dts.push(now - last);
    last = now;
    render();
    if (dts.length < 26) requestAnimationFrame(tick);
    else if (dts.slice(6).sort((a, b) => a - b)[10] > 26) goLite();   // the median frame over 26 ms: under 40 fps
  };
  requestAnimationFrame(tick);
}
function goLite() {
  lite = true;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(1);
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  render();
}

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
window.__book = { view, scene, shadow, leaf, poseLeaf, startTurn, settle, partAt, tumble, book, renderer, key, ease, get easing() { return easing; }, get lite() { return lite; }, get T() { return T; }, get mode() { return mode; },
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
    if (e && e[5] >= 3) { openEntry({ page, scan: data.scan, e }); }
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
      if (e) openEntry({ page, scan: data.scan, e });   // an entry's link opens it, sure or not
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
  await Promise.all([document.fonts.load(`40px ${FONT}`), document.fonts.load(`40px ${FONT_SC}`), document.fonts.load(`italic 40px ${FONT}`), coverReady]).catch(() => {});
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
  Object.assign(view, { x: view.tx, y: view.ty, zoom: view.tz, tilt: view.tt, dip: view.td });
  shapeAll();
  render();
  viewButton();
  probe();
  const linked = (await follow(hash)) || (await followPath(path));
  if (linked) {   // a link to a page, a name or an entry: straight there, from above
    Object.assign(view, { tilt: view.tt });
    render();
  } else {
    showSpread();
    Object.assign(view, { tilt: view.tt });
    render();
    showStory(true);   // the foreword beside the closed book (below it on a phone), every time at the front door
  }
})();
