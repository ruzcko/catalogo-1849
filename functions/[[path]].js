// Every address that isn't a file: serve the book, with the title, description and preview image set for what the
// address points at (/58, /fabella, /58/glubig), so a shared link shows its own card in Messenger, Facebook or X.
// Files (anything with a dot, /data/, /fonts/) and the bare address go straight through.
import { cap, esc, resolve } from "../lib/book.js";

class SetContent {
  constructor(value) { this.value = value; }
  element(el) { el.setAttribute("content", this.value); }
}

export async function onRequestGet(context) {
  const { request, env } = context, url = new URL(request.url), path = url.pathname;
  if (path === "/" || path.includes(".") || path.startsWith("/data/") || path.startsWith("/fonts/")) return context.next();
  const page = await env.ASSETS.fetch(new URL("/", url.origin));
  const r = await resolve(env, url.origin, path).catch(() => null);
  if (!r) return page;
  let title, desc, card;
  const q = new URLSearchParams({ k: r.kind, n: String(r.n) });
  if (r.kind === "page") {
    const first = r.page.first, last = r.page.last;
    title = `Page ${r.n} · Catálogo 1849`;
    desc = `Leaf through page ${r.n} of the 1849 Catálogo alfabético de apellidos${first && last ? `, from ${cap(first)} to ${cap(last)}` : ""}: the book Filipino families chose their surnames from.`;
  } else if (r.kind === "missing") {
    title = `Page ${r.n} is missing · Catálogo 1849`;
    desc = `Page ${r.n} of the 1849 Catálogo alfabético de apellidos is missing from the only scan online. Have a copy, or know a library that does?`;
  } else if (r.kind === "name") {
    q.set("w", r.word);
    title = `${cap(r.word)} · Catálogo 1849`;
    desc = `${cap(r.word)} is on page ${r.n} of the Catálogo alfabético de apellidos, the book Filipino families chose their surnames from in 1849.`;
  } else {
    q.set("w", r.word);
    title = `Can you read this 1849 surname? · Catálogo 1849`;
    desc = `Help read page ${r.n} of the Catálogo alfabético de apellidos. Our best guess is “${r.word}”, but the scan is blurry.`;
  }
  card = `${url.origin}/og?${q}&v=1`;
  return new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(esc(title), { html: true }); } })
    .on('meta[property="og:title"]', new SetContent(title))
    .on('meta[property="og:description"]', new SetContent(desc))
    .on('meta[name="description"]', new SetContent(desc))
    .on('meta[property="og:image"]', new SetContent(card))
    .on('meta[name="twitter:image"]', new SetContent(card))
    .on('meta[property="og:url"]', new SetContent(url.origin + path))
    .transform(new Response(page.body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" } }));
}
