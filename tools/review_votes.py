"""Review reader votes before they change the dataset (standard library only).

    python tools/review_votes.py votes.json               # review in the browser: http://127.0.0.1:<port>/
    python tools/review_votes.py votes.json --write       # just write the accepted corrections
    python tools/review_votes.py votes.json --min-votes 3 --strips <folder of <page>.webp>

votes.json is an export of the reader-vote database (schema.sql), made through the Cloudflare API:

    {"exported": "2026-10-09",
     "readings": [{"entry": "58.1.6", "reading": "glubiq", "votes": 3, "typed": 1, "first_day": "2026-10-09"}, ...],
     "days": [{"entry": "58.1.6", "day": "2026-10-09", "voters": 3}, ...]}

It never holds voter ids (the tool refuses a file that does). An entry comes up for review when its leading reading
isn't ours and has at least --min-votes votes. The page shows the scan crop, our reading and both scans', every
reading with its votes, the entry's trusted neighbours, and what the book's own rules (lib/readings.js, the code the
vote server runs) say about each reading. Keys: a accept the chosen reading (1-9 choose), e edit, r reject, s skip.

Decisions are kept in review/votes/decisions.json (review/ is not in git), keyed by entry id and our reading, so a
reviewed entry doesn't come back unless the data under it changes. Accepted and edited readings are written to
review/votes/corrections.csv in the format of Apelyido's data/catalogo/corrections.csv (page, from, to, source, x0,
y0: the entry's top-left corner on Google's page, as in catalogo_1849.csv), for the Apelyido pipeline to apply. This
tool never changes the dataset or Apelyido itself.
"""
import argparse
import csv
import datetime
import json
import re
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK = ROOT / "book"
OUT = ROOT / "review" / "votes"
ID = re.compile(r"^(\d{1,3})\.(\d{1,2})\.(\d{1,3})$")
STATUS = ["read by a person", "sure", "likely", "best guess", "blurry"]


def load_votes(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    for rows in (data.get("readings", []), data.get("days", [])):
        for r in rows:
            if any("voter" == k or k.startswith("voter_") or k == "device" for k in r):
                sys.exit("votes.json holds voter ids: export only readings and per-day counts.")
    return data


def entries():
    """Every entry in the book's data, by id, with its CSV row (for the box on Google's page and both readings)."""
    pages = json.loads((BOOK / "data" / "pages.json").read_text(encoding="utf-8"))
    rows = {}
    with (ROOT / "catalogo_1849.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["column"] and r["row"]:
                rows[(int(r["book_page"]), int(r["column"]), int(r["row"]))] = r
    out = {}
    for p in pages:
        if p.get("missing"):
            continue
        data = json.loads((BOOK / "data" / "p" / f"{p['n']}.json").read_text(encoding="utf-8"))
        for i, e in enumerate(data["e"]):
            out[f"{data['scan']}.{e[6]}.{e[7]}"] = {"n": p["n"], "scan": data["scan"], "i": i, "e": e,
                                                     "row": rows.get((p["n"], e[6], e[7]))}
    return out


def crops_version():
    m = re.search(r"const CROPS_V = (\d+)", (BOOK / "book.js").read_text(encoding="utf-8"))
    return int(m.group(1)) if m else None


def queue(votes, book, min_votes, decisions):
    by_entry = {}
    for r in votes.get("readings", []):
        by_entry.setdefault(r["entry"], []).append({"r": r["reading"], "v": int(r.get("votes") or 0), "t": int(r.get("typed") or 0)})
    days = {}
    for d in votes.get("days", []):
        days.setdefault(d["entry"], []).append({"day": d["day"], "voters": int(d.get("voters") or 0)})
    items, unknown = [], []
    for eid, cands in sorted(by_entry.items(), key=lambda kv: tuple(int(x) for x in kv[0].split(".")) if ID.match(kv[0]) else (999,)):
        b = book.get(eid)
        if not b:
            unknown.append(eid)
            continue
        e, row = b["e"], b["row"] or {}
        cands.sort(key=lambda c: -c["v"])
        lead = cands[0]
        if lead["r"] == e[4] or lead["v"] < min_votes:
            continue
        if decisions.get(key(eid, e[4])):
            continue
        items.append({"id": eid, "n": b["n"], "scan": b["scan"], "ours": e[4], "status": STATUS[e[5]], "crop": e[9],
                      "box": e[:4], "google": row.get("google_reading", ""), "issuu": row.get("issuu_reading", ""),
                      "x0": row.get("x0", ""), "y0": row.get("y0", ""), "gbox": [row.get(k, "") for k in ("x0", "y0", "x1", "y1")],
                      "candidates": cands, "days": days.get(eid, [])})
    return items, unknown


def key(eid, ours):
    return f"{eid}|{ours}"


def read_decisions():
    f = OUT / "decisions.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def save_decisions(d):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "decisions.json").write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def write_corrections(decisions):
    """Accepted and edited readings, in the format of Apelyido's corrections.csv."""
    OUT.mkdir(parents=True, exist_ok=True)
    rows = [d for d in decisions.values() if d["action"] in ("accept", "edit")]
    rows.sort(key=lambda d: (d["page"], float(d["y0"] or 0), float(d["x0"] or 0)))
    path = OUT / "corrections.csv"
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["page", "from", "to", "source", "x0", "y0"])
        for d in rows:
            how = "reader votes" if d["action"] == "accept" else "reader votes, edited by the reviewer"
            w.writerow([d["page"], d["from"], d["to"], f"{how} {d['votes']}, reviewed {d['day']}", d["x0"], d["y0"]])
    return path, len(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("votes", help="the votes export (JSON)")
    ap.add_argument("--min-votes", type=int, default=2, help="votes the leading reading needs to come up (default 2)")
    ap.add_argument("--crops", default="https://apelyido.ruzcko.com/scan/", help="where the crop strips are served")
    ap.add_argument("--strips", help="a local folder of <page>.webp strips, instead of --crops")
    ap.add_argument("--port", type=int, default=0, help="port for the review page (default: any free one)")
    ap.add_argument("--write", action="store_true", help="write corrections.csv from the decisions so far and stop")
    ap.add_argument("--no-browser", action="store_true", help="don't open the review page")
    a = ap.parse_args()

    votes, book, decisions = load_votes(a.votes), entries(), read_decisions()
    if a.write:
        path, n = write_corrections(decisions)
        print(f"{n} corrections -> {path}")
        return
    v = crops_version()
    crops = "/strips/" if a.strips else f"{a.crops.rstrip('/')}/{v}/"
    items, unknown = queue(votes, book, a.min_votes, decisions)
    if unknown:
        print(f"{len(unknown)} voted entries aren't in this book's data (re-laid out since the export?): {', '.join(unknown[:8])}"
              f"{' ...' if len(unknown) > 8 else ''}. Remap the votes before reviewing them.", flush=True)
    print(f"{len(items)} entries to review (leading reading isn't ours, {a.min_votes}+ votes); {len(decisions)} decided before.", flush=True)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, body, ctype="application/json", status=200):
            b = body if isinstance(body, bytes) else body.encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", ctype)
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(b)

        def file(self, path, ctype):
            if path.is_file():
                self.send(path.read_bytes(), ctype)
            else:
                self.send("not found", "text/plain", 404)

        def do_GET(self):
            p = self.path.split("?")[0]
            if p == "/":
                self.send(PAGE.replace("__CROPS__", json.dumps(crops)), "text/html; charset=utf-8")
            elif p == "/queue":
                self.send(json.dumps({"items": items, "decided": len(decisions)}, ensure_ascii=False))
            elif p == "/lib/readings.js":
                self.file(ROOT / "lib" / "readings.js", "text/javascript")
            elif re.fullmatch(r"/data/(pages\.json|p/\d{1,3}\.json)", p):
                self.file(BOOK / p.lstrip("/"), "application/json")
            elif a.strips and re.fullmatch(r"/strips/\d{1,3}\.webp", p):
                self.file(Path(a.strips) / p.split("/")[-1], "image/webp")
            elif m := re.fullmatch(r"/cut/(\d{1,3}\.\d{1,2}\.\d{1,3})", p):
                # A name without a crop strip (the OCR was sure of it): its lines cut from Google's page render, if the
                # renders are on this machine (as review_reference.py does).
                import review_reference
                it = next((x for x in items if x["id"] == m.group(1)), None)
                if not (it and all(it["gbox"]) and review_reference.PAGES.is_dir()):
                    return self.send("not found", "text/plain", 404)
                png, top, h = review_reference.cut(it["n"], it["gbox"])
                self.send_response(200)
                self.send_header("content-type", "image/png")
                self.send_header("x-line", f"{top},{h}")
                self.end_headers()
                self.wfile.write(png)
            else:
                self.send("not found", "text/plain", 404)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            if self.path == "/decide":
                it = next((x for x in items if x["id"] == body.get("id")), None)
                if not it or body.get("action") not in ("accept", "edit", "reject"):
                    return self.send(json.dumps({"ok": False}), status=400)
                to = str(body.get("to") or "").strip().lower()
                if body["action"] != "reject" and not to:
                    return self.send(json.dumps({"ok": False, "error": "no reading"}), status=400)
                votes_for = next((c["v"] for c in it["candidates"] if c["r"] == to), 0)
                decisions[key(it["id"], it["ours"])] = {
                    "id": it["id"], "action": body["action"], "page": it["n"], "from": it["ours"], "to": to,
                    "votes": votes_for, "x0": it["x0"], "y0": it["y0"], "day": datetime.date.today().isoformat()}
                save_decisions(decisions)
                self.send(json.dumps({"ok": True}))
            elif self.path == "/write":
                path, n = write_corrections(decisions)
                self.send(json.dumps({"ok": True, "n": n, "path": str(path)}))
            else:
                self.send("not found", "text/plain", 404)

    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print(f"Review page: {url}  (Ctrl+C to stop; decisions are saved as you go)", flush=True)
    if not a.no_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        path, n = write_corrections(decisions)
        print(f"\n{n} corrections -> {path}")


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reader votes · review</title>
<style>
  :root { --bg: #1d1712; --ink: #f3ead6; --muted: #b9a98c; --accent: #d9b45a; --line: rgba(243,234,214,.18); color-scheme: dark; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.45 Georgia, serif; }
  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; font-weight: 400; color: var(--muted); margin: 0 0 16px; }
  h2 { font-size: 34px; font-weight: 400; margin: 0; }
  .muted, small { color: var(--muted); }
  .crop { position: relative; background-color: #fff; background-repeat: no-repeat; border-radius: 6px; margin: 12px 0; }
  .crop i { position: absolute; left: 0; right: 0; border: 2px solid #e0932f; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr.sel td { background: rgba(217,180,90,.16); }
  .ok { color: #9fd38a; } .no { color: #f0a35a; }
  .keys { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; }
  button { font: inherit; color: var(--ink); background: rgba(255,255,255,.08); border: 1px solid var(--line); border-radius: 999px;
    padding: 6px 14px; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  kbd { font-family: ui-monospace, monospace; color: var(--accent); }
  input { font: inherit; color: var(--ink); background: rgba(255,255,255,.08); border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; }
</style></head>
<body><main>
<h1>Reader votes · <span id="count"></span></h1>
<div id="item"></div>
</main>
<script type="module">
import { entryContext, check, normalise } from "/lib/readings.js";
const CROPS = __CROPS__;
// The crop strips' layout, as in book/book.js (and Apelyido's pipeline/catalogo_crops.py).
const CELL_W = 300, CELL_H = 96, LINE_Y = 24, LINE_H = 39, ACROSS = 4;
const env = { ASSETS: { fetch: u => fetch(new URL(u).pathname) } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let items = [], at = 0, pick = 0, ctx = null, decided = 0;

async function load() {
  const q = await fetch("/queue").then(r => r.json());
  items = q.items; decided = q.decided; at = 0;
  show();
}
async function show() {
  const box = document.getElementById("item");
  document.getElementById("count").textContent = `${items.length - at} to review, ${decided} decided`;
  if (at >= items.length) {
    box.innerHTML = `<p>Nothing left to review.</p><p><button id="write">Write corrections.csv</button> <span id="out" class="muted"></span></p>`;
    box.querySelector("#write").onclick = write;
    return;
  }
  const it = items[at];
  ctx = await entryContext(env, new Request(location.origin + "/"), it.id);
  pick = 0;
  const cx = (it.crop % ACROSS) * CELL_W, cy = Math.floor(it.crop / ACROSS) * CELL_H;
  let crop = it.crop == null ? `<p class="muted">No crop for this entry.</p>` :
    `<div class="crop" style="background-image:url('${CROPS}${it.scan}.webp');background-position:-${cx}px -${cy}px;width:${CELL_W}px;height:${CELL_H}px"><i style="top:${LINE_Y}px;height:${LINE_H}px"></i></div>`;
  if (it.crop == null) {   // no strip for a sure name: its lines cut from the page render, when they're here
    const r = await fetch(`/cut/${it.id}`);
    if (r.ok) {
      const [top, h] = (r.headers.get("x-line") || "0,0").split(",").map(Number);
      crop = `<div class="crop"><img src="${URL.createObjectURL(await r.blob())}" alt="The scan around this line" style="display:block"><i style="top:${top - 3}px;height:${h + 6}px"></i></div>`;
    }
  }
  const rule = r => { const why = ctx ? check(normalise(r), ctx) : "entry not found"; return why ? `<span class="no">${esc(why)}</span>` : `<span class="ok">fits the book's rules</span>`; };
  box.innerHTML = `
    <h2>${it.ours === "?" ? "Unread line" : esc(it.ours) + "."}</h2>
    <p class="muted">Page ${it.n} · entry ${esc(it.id)} · ${esc(it.status)} · Google read <b>${esc(it.google || "—")}</b>, Issuu <b>${esc(it.issuu || "—")}</b></p>
    ${crop}
    <p class="muted">In the book it comes ${ctx?.prev ? `after <b>${esc(ctx.prev)}</b>` : ""}${ctx?.prev && ctx?.next ? " and " : ""}${ctx?.next ? `before <b>${esc(ctx.next)}</b>` : ""}.
      Page letters: ${esc((ctx?.letters || []).join(", ").toUpperCase())}.</p>
    <table><tr><th></th><th>Reading</th><th>Votes</th><th>Typed</th><th>The book's rules</th></tr>
      ${it.candidates.map((c, i) => `<tr data-i="${i}"><td><kbd>${i + 1}</kbd></td><td><b>${esc(c.r)}</b>${c.r === it.ours ? " <small>ours</small>" : ""}</td>
        <td>${c.v}</td><td>${c.t}</td><td>${rule(c.r)}</td></tr>`).join("")}</table>
    <p class="muted">${it.days.map(d => `${esc(d.day)}: ${d.voters}`).join(" · ") || ""}</p>
    <div class="keys"><button data-k="a"><kbd>a</kbd> accept</button><button data-k="e"><kbd>e</kbd> edit</button>
      <button data-k="r"><kbd>r</kbd> reject</button><button data-k="s"><kbd>s</kbd> skip</button></div>
    <p class="err no" role="alert"></p>`;
  box.querySelectorAll("[data-k]").forEach(b => b.onclick = () => act(b.dataset.k));
  box.querySelectorAll("tr[data-i]").forEach(tr => tr.onclick = () => select(+tr.dataset.i));
  select(0);
}
function select(i) {
  const it = items[at];
  if (!it || i >= it.candidates.length) return;
  pick = i;
  document.querySelectorAll("tr[data-i]").forEach(tr => tr.classList.toggle("sel", +tr.dataset.i === i));
}
async function decide(action, to) {
  const it = items[at];
  const r = await fetch("/decide", { method: "POST", body: JSON.stringify({ id: it.id, action, to }) }).then(x => x.json());
  if (!r.ok) { document.querySelector(".err").textContent = r.error || "Couldn't save that."; return; }
  decided++; at++; show();
}
function act(k) {
  const it = items[at];
  if (!it) return;
  if (k === "a") decide("accept", it.candidates[pick].r);
  else if (k === "r") decide("reject");
  else if (k === "s") { at++; show(); }
  else if (k === "e") {
    const v = prompt("The reading to write to the dataset:", it.candidates[pick].r);
    if (!v) return;
    const why = ctx && check(normalise(v), ctx);
    if (why && !confirm(`${why}\n\nWrite it anyway?`)) return;
    decide("edit", normalise(v));
  }
}
async function write() {
  const r = await fetch("/write", { method: "POST", body: "{}" }).then(x => x.json());
  document.getElementById("out").textContent = `${r.n} corrections written to ${r.path}`;
}
addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  if (/^[1-9]$/.test(e.key)) select(+e.key - 1);
  else if ("aers".includes(e.key) && e.key.length === 1) act(e.key);
});
load();
</script>
</body></html>
"""

if __name__ == "__main__":
    main()
