// What a clean address points at, for link previews: /58 a page, /fabella a name, /58/glubig an entry to help read.
// Read from the book's own data files (book/data), the same ones the page uses.

export const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const cap = s => s.replace(/(^|[- ])(\p{L})/gu, (_, d, c) => d + c.toUpperCase());

const asset = (env, origin, path) => env.ASSETS.fetch(new URL(path, origin)).then(r => (r.ok ? r.json() : null)).catch(() => null);

// -> {kind: "page" | "missing" | "name" | "entry", n, word, page, data} or null for anything else.
export async function resolve(env, origin, path) {
  const parts = path.split("/").filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch { return ""; } });
  if (!parts.length || parts.length > 2) return null;
  const pages = await asset(env, origin, "/data/pages.json");
  if (!pages) return null;
  if (/^\d{1,3}$/.test(parts[0])) {
    const page = pages.find(p => p.n === +parts[0]);
    if (!page) return null;
    if (page.missing) return { kind: "missing", n: page.n, page };
    const data = await asset(env, origin, `/data/p/${page.n}.json`);
    if (parts.length === 1) return { kind: "page", n: page.n, page, data };
    const [, word, k] = /^(.+?)(?:-(\d+))?$/.exec(parts[1].toLowerCase()) || [];
    const e = data?.e.filter(x => x[4] === word)[(+k || 1) - 1];
    return e ? { kind: e[5] >= 3 ? "entry" : "name", n: page.n, word, page, data } : { kind: "page", n: page.n, page, data };
  }
  if (parts.length === 1 && /^[\p{L} -]{2,30}$/u.test(parts[0])) {
    const want = fold(parts[0]), index = await asset(env, origin, `/data/s/${want[0]}.json`);
    const hit = index && Object.entries(index).find(([name]) => fold(name) === want);
    if (!hit) return null;
    const n = hit[1][0], page = pages.find(p => p.n === n);
    return { kind: "name", n, word: hit[0], page, data: await asset(env, origin, `/data/p/${n}.json`), pages: hit[1] };
  }
  return null;
}
