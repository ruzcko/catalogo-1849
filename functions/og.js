// GET /og?k=page|missing|name|entry&n=58&w=glubig: a link-preview card (1200 x 630 PNG) for a clean address, set in
// the book's type (IM Fell, OFL) on paper, with a few of the page's names beside it. No scan images. Drawn as SVG and
// rendered with resvg (lib/og, MPL-2.0), then cached at the edge. With no k, the book's general card.
import { initWasm, Resvg } from "../lib/og/resvg.mjs";
import wasm from "../lib/og/resvg.wasm";
import { cap, esc } from "../lib/book.js";

const W = 1200, H = 630, INK = "#2a2017", PAPER = "#efe4c8", RED = "#9a3b1f";
let ready = null, fonts = null;
async function setup(env, origin) {
  ready ??= initWasm(wasm);
  fonts ??= Promise.all(["IMFeENrm28P", "IMFeENit28P", "IMFeENsc28P"].map(f =>
    env.ASSETS.fetch(new URL(`/fonts/${f}.ttf`, origin)).then(r => r.arrayBuffer()).then(b => new Uint8Array(b))));
  await ready;
  return fonts;
}

// A column of the page's names beside the card, the chosen one marked: like a strip torn from the book.
function column(data, word, mark) {
  if (!data) return "";
  const list = data.e.filter(e => e[5] <= 2 || e[4] === word);
  let i = word ? list.findIndex(e => e[4] === word) : 0;
  if (i < 0) i = 0;
  const from = Math.max(0, Math.min(i - 6, list.length - 14)), lines = list.slice(from, from + 14);
  return lines.map((e, j) => {
    const y = 120 + j * 34, me = word && e[4] === word;
    const box = me ? (mark === "entry"
      ? `<rect x="846" y="${y - 25}" width="${Math.min(300, 30 + e[4].length * 15)}" height="33" fill="none" stroke="${RED}" stroke-width="2.5" stroke-dasharray="6 5" rx="4"/>`
      : `<rect x="846" y="${y - 25}" width="${Math.min(300, 30 + e[4].length * 15)}" height="33" fill="#e8c35a" fill-opacity=".6" rx="4"/>`) : "";
    return `${box}<text x="860" y="${y}" font-size="28" fill="${INK}" fill-opacity="${me ? 1 : 0.42}">${esc(e[4])}.</text>`;
  }).join("");
}

function card({ k, n, w, page, data }) {
  const big = (text, max, width) => Math.max(48, Math.min(max, Math.floor(width / (text.length * 0.5))));
  let main = "";
  if (k === "page") {
    main = `<text x="80" y="300" font-size="150">Page ${n}</text>
      <text x="84" y="380" font-size="44" font-style="italic" fill-opacity=".8">${page?.first && page?.last ? `from ${esc(cap(page.first))} to ${esc(cap(page.last))}` : ""}</text>`;
  } else if (k === "missing") {
    main = `<text x="80" y="290" font-size="140">Page ${n}</text>
      <text x="84" y="370" font-size="46" font-style="italic">is missing from the only scan online.</text>
      <text x="84" y="430" font-size="40" fill="${RED}">Have a copy? Help fill it.</text>`;
  } else if (k === "name") {
    const s = big(w + ".", 150, 700);
    main = `<text x="76" y="${170 + s}" font-size="${s}">${esc(cap(w))}.</text>
      <text x="84" y="${250 + s}" font-size="46" font-style="italic">is in the 1849 Catálogo, page ${n}.</text>`;
  } else if (k === "entry") {
    const s = big(w + "?", 130, 640);
    main = `<text x="80" y="210" font-size="58">Can you read this</text>
      <text x="80" y="276" font-size="58">1849 surname?</text>
      <text x="76" y="${300 + s}" font-size="${s}" font-style="italic">${esc(w)}?</text>
      <line x1="80" y1="${320 + s}" x2="${Math.min(780, 80 + w.length * s * 0.47)}" y2="${320 + s}" stroke="${RED}" stroke-width="4" stroke-dasharray="10 8"/>
      <text x="84" y="${380 + s}" font-size="38" font-style="italic" fill-opacity=".8">Our best guess, from a blurry page ${n}.</text>`;
  } else {
    main = `<text x="80" y="260" font-size="96">Catálogo alfabético</text>
      <text x="80" y="370" font-size="96">de apellidos</text>
      <text x="84" y="450" font-size="44" font-style="italic" fill-opacity=".85">The book Filipino families chose their surnames from.</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><radialGradient id="age" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#8a6a30" stop-opacity="0"/><stop offset="1" stop-color="#8a6a30" stop-opacity=".28"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <rect width="${W}" height="${H}" fill="url(#age)"/>
  <rect x="26" y="26" width="${W - 52}" height="${H - 52}" fill="none" stroke="#a88c5c" stroke-width="2"/>
  <rect x="34" y="34" width="${W - 68}" height="${H - 68}" fill="none" stroke="#a88c5c" stroke-width="1"/>
  <line x1="820" y1="70" x2="820" y2="${H - 70}" stroke="#a88c5c" stroke-width="1" stroke-opacity=".6"/>
  <g font-family="IM FELL English" fill="${INK}">
    <text x="80" y="110" font-family="IM FELL English SC" font-size="32" letter-spacing="1" fill-opacity=".8">Catálogo alfabético de apellidos · 1849</text>
    ${main}
    <text x="80" y="566" font-size="30" fill-opacity=".75">catalogo-1849.ruzcko.com</text>
    ${k === "missing" || !data ? "" : column(data, w, k)}
  </g>
</svg>`;
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default, hit = await cache.match(request);
  if (hit) return hit;
  const url = new URL(request.url), p = url.searchParams;
  const k = ["page", "missing", "name", "entry"].includes(p.get("k")) ? p.get("k") : "home";
  const n = /^\d{1,3}$/.test(p.get("n") || "") ? +p.get("n") : null;
  const w = /^[\p{L} -]{1,30}$/u.test(p.get("w") || "") ? p.get("w").toLowerCase() : null;
  if ((k !== "home" && !n) || ((k === "name" || k === "entry") && !w)) return new Response("bad request", { status: 400 });
  try {
    const fontData = await setup(env, url.origin);
    const pages = await env.ASSETS.fetch(new URL("/data/pages.json", url.origin)).then(r => r.json());
    const page = n ? pages.find(x => x.n === n) : null;
    const data = page && !page.missing ? await env.ASSETS.fetch(new URL(`/data/p/${n}.json`, url.origin)).then(r => r.json()) : null;
    const show = k === "home" ? await env.ASSETS.fetch(new URL("/data/p/58.json", url.origin)).then(r => r.json()) : data;
    const png = new Resvg(card({ k, n, w, page, data: show }), {
      font: { fontBuffers: fontData, defaultFontFamily: "IM FELL English", loadSystemFonts: false },
      fitTo: { mode: "width", value: W },
    }).render().asPng();
    const res = new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
    waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (e) {
    return new Response("could not draw the card", { status: 500 });
  }
}
