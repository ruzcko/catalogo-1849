// Shared by the reader-vote endpoints: find an entry in the book's data and check a suggested reading against
// what the book allows. An entry's id is "<page>.<column>.<row>", as in catalogo_1849.csv.

const ID = /^(\d{1,3})\.(\d{1,2})\.(\d{1,3})$/;
export const fold = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// A sort key in the book's alphabet, the Spanish of 1849: "ll" is a letter after "l", "ñ" comes after "n", accents
// don't count ("~" sorts after "z"). Same as collate() in Apelyido's pipeline/catalogo_ocr.py.
const collate = s => s.toLowerCase().replace(/ñ/g, "\u0000").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\u0000/g, "n~").replace(/ll/g, "l~");
// The book has no I or K sections, but a few I and K names sit among the Y and Q ones (I/Y and K/Q were used
// interchangeably then).
const ALSO = { y: "i", q: "k" };
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

let pagesByScan = null;
async function asset(env, request, path) {
  const r = await env.ASSETS.fetch(new URL(path, request.url));
  return r.ok ? r.json() : null;
}

// The entry, its page, the letters its page allows, and its trusted neighbours (for the alphabetical check).
export async function entryContext(env, request, id) {
  const m = ID.exec(String(id || ""));
  if (!m) return null;
  const [scan, col, row] = [+m[1], +m[2], +m[3]];
  if (!pagesByScan) {
    const pages = await asset(env, request, "/data/pages.json");
    pagesByScan = new Map((pages || []).filter(p => p.scan).map(p => [p.scan, p.n]));
  }
  const n = pagesByScan.get(scan);
  if (!n) return null;
  const page = await asset(env, request, `/data/p/${n}.json`);
  const i = page?.e.findIndex(e => e[6] === col && e[7] === row);
  if (i == null || i < 0) return null;
  const e = page.e[i];
  // A page's letters: its main letter, plus a second where the section changes mid-page (15+ trusted entries).
  const counts = {};
  for (const x of page.e) if (x[5] <= 2) counts[fold(x[4])[0]] = (counts[fold(x[4])[0]] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const letters = sorted.filter(([, c], k) => k === 0 || c >= 15).map(([l]) => l);
  const trusted = (from, step) => { for (let j = from; j >= 0 && j < page.e.length; j += step) if (page.e[j][5] <= 2) return page.e[j][4]; return null; };
  // What's printed, as read: ours and the other scan's. An unread line ("?") has nothing to compare a reading with.
  const base = [...new Set([e[4], e[8]].filter(b => b && /\p{L}/u.test(b)))];
  return { id: `${scan}.${col}.${row}`, n, entry: e, letters, prev: trusted(i - 1, -1), next: trusted(i + 1, 1), base };
}

export function normalise(s) {
  return String(s || "").normalize("NFC").toLowerCase().trim().replace(/\.+$/, "").replace(/\s+/g, "");
}

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// The book's rules for a reading. Returns null if it's allowed, or a message saying why not.
export function check(reading, ctx) {
  const r = reading, f = fold(r);
  if (!/^[a-zñáéíóúü][a-zñáéíóúü-]*$/.test(r)) return "Only letters (and a hyphen) appear in the book.";
  if (r.length > 20) return "That's longer than any name in the book.";
  if (r.length < 2) return "The book has no one-letter names.";
  if (r.length === 2 && !ctx.base.includes(r)) return "Two-letter names are very rare in the book; this one doesn't match the scan.";
  const allowed = [...ctx.letters, ...ctx.letters.map(l => ALSO[l]).filter(Boolean)];
  if (!allowed.includes(f[0])) return `Every name on this page starts with ${ctx.letters.map(l => l.toUpperCase()).join(" or ")}.`;
  // The book is in order on the first three letters, in its own alphabet (Ll after L). Stray I and K names aren't.
  const p3 = ctx.prev && collate(ctx.prev).slice(0, 3), n3 = ctx.next && collate(ctx.next).slice(0, 3), r3 = collate(r).slice(0, 3);
  const stray = ALSO[ctx.letters[0]] === f[0];
  if (!stray && ((p3 && r3 < p3) || (n3 && r3 > n3))) return `That wouldn't fit in the book's order, between ${ctx.prev || "…"} and ${ctx.next || "…"}.`;
  const close = ctx.base.some(b => distance(fold(b), f) <= Math.max(2, Math.ceil(f.length / 2)));
  if (ctx.base.length && !close) return "That's too different from what's printed here.";
  return null;
}

// Readings shown for an entry: ours and the OCR's, plus readers' own once two people have typed the same one. An
// unread line starts with none.
export async function tally(env, ctx) {
  const rows = (await env.DB.prepare("SELECT reading, votes, typed FROM readings WHERE entry = ?1").bind(ctx.id).all()).results || [];
  const byReading = new Map(rows.map(r => [r.reading, r]));
  const shown = [...ctx.base, ...rows.filter(r => r.typed >= 2 && !ctx.base.includes(r.reading)).map(r => r.reading)];
  return shown.map(r => ({ r, v: byReading.get(r)?.votes || 0, ours: r === ctx.entry[4] }));
}
