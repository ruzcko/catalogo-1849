"""Check our readings against a reference list, on the 1849 scan (a sibling of review_votes.py).

    python tools/review_reference.py <reference.csv> [--queue abcd]

A reference list is another reading of the book's names, in its own (alphabetical) order: a CSV with a
printed_name column, and optionally reading_uncertain (yes), printed_page and printed_col. The tool pairs it with
our entries itself (any verdict or our_id columns are only compared with that, for the summary): exact readings
first, then readings one or two letters apart anywhere in the pages it covers, preferring those whose printed
neighbours pair near the same place in our reading order. That catches names a misread letter re-sorted, alone or
in a run (a few lines with the same damaged letter, sorted together a section away).

A reference is a prompt, never a source: keep it outside this repository, pass it by path, and never copy its
readings into the dataset. What goes into a correction is what the reviewer reads on the 1849 scan. A reference has its own errors (letters dropped where the scan is blotted, letters swapped), so "the
reference differs" only says where to look.

Queues, in this order:
  a  NEAR, and the reference equals one of our two scans' readings: a strong hint
  b  the other NEARs
  c  MATCH on an entry we only half trust (best effort, low): confirm it
  d  our entries in the covered pages with no counterpart in the reference: possible junk or a line read twice

Keys: 1-9 choose one of our scans' readings, a "the scan shows it", e type what the scan shows, k leave it (can't
tell, or ours is right), d "not a line in the book", s skip. The crop is cut from Google's page renders (--pages,
Apelyido's data/raw/google1973/pages) when they're on this machine, else taken from the book's crop strips.

Decisions are kept in review/reference/decisions.json (review/ is not in git). Readings confirmed or corrected go to
review/reference/corrections.csv, in the format of Apelyido's data/catalogo/corrections.csv (a correction whose `to`
equals `from` marks the reading checked); lines that aren't in the book go to review/reference/drops.csv (page,
entry, source, x0, y0), for Apelyido to drop. Neither file holds the reference's readings.
"""
import argparse
import bisect
import collections
import csv
import datetime
import io
import json
import re
import unicodedata
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from review_votes import BOOK, ID, ROOT, STATUS, crops_version, entries

OUT = ROOT / "review" / "reference"
PAGES = ROOT.parent / "apelyido" / "data" / "raw" / "google1973" / "pages"   # Google's scan, 2,400 x 3,882 per page
KINDS = {"a": "The reference equals one of our scans' readings", "b": "The reference reads it differently",
         "c": "Same reading in the reference: confirm it on the scan", "d": "No counterpart in the reference"}
HAS_LETTER = re.compile(r"[^\W\d_]")


def fold(s):
    """Lowercase letters only, without accents (ñ kept), for comparing readings."""
    s = s.lower().replace("ñ", "\0")
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().replace("\0", "ñ")
    return re.sub(r"[^a-zñ]", "", s)


def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def deletions(s):
    """s with up to two letters left out (one, for short names): names within two edits share one of these."""
    out = {s} | {s[:k] + s[k + 1:] for k in range(len(s))}
    if len(s) >= 5:
        out |= {x[:k] + x[k + 1:] for x in out for k in range(len(x))}
    return out


def pair(printed, ours):
    """Pair the reference's names (in its order) with our entries (in reading order). The reference is re-sorted
    alphabetically, so a misread letter near the start moves a name, and a run of damaged lines can move together
    (a few consecutive lines with the same damaged letter, re-sorted together). So: exact readings first,
    each to the nearest unused one; then readings one or two letters apart anywhere in the covered pages, preferring
    those whose printed neighbours pair near the same place on our side (a run that moved together).
    Returns ({printed index: (our index, distance)}, covered pages)."""
    pos = {}
    for j, o in enumerate(ours):
        pos.setdefault(o["f"], []).append(j)
    paired, used, last = {}, set(), 0
    for i, p in enumerate(printed):
        free = [j for j in pos.get(p["f"], []) if j not in used]
        if free:
            j = min(free, key=lambda j: abs(j - last - 1))
            paired[i], last = (j, 0), j
            used.add(j)
    per_page = collections.Counter(ours[j]["n"] for j, _ in paired.values())
    dense = [n for n, c in per_page.items() if c >= 20]
    covered = set(range(min(dense), max(dense) + 1)) if dense else set()
    # Readings within two letters, through a deletion index.
    index = collections.defaultdict(set)
    for j, o in enumerate(ours):
        if j not in used and o["n"] in covered:
            for d in deletions(o["f"]):
                index[d].add(j)
    cands = {}
    for i, p in enumerate(printed):
        if i in paired or len(p["f"]) < 2:
            continue
        near = set()
        for d in deletions(p["f"]):
            near |= index.get(d, set())
        limit = 1 if len(p["f"]) <= 4 else 2
        cands[i] = [(j, d) for j, d in ((j, lev(p["f"], ours[j]["f"])) for j in near) if d <= limit]
    for _ in range(3):   # a run's support grows as its lines pair
        options = []
        for i, cs in cands.items():
            if i in paired:
                continue
            for j, d in cs:
                if j in used:
                    continue
                around = [paired[k][0] for k in range(i - 2, i + 3) if k != i and k in paired] + \
                         [jj for k in range(i - 2, i + 3) if k != i and k not in paired for jj, _ in cands.get(k, [])]
                support = sum(abs(jj - j) <= 4 for jj in around)
                options.append((d - 0.5 * min(support, 2), -len(printed[i]["f"]), i, j, d, support, len(cs)))
        options.sort()
        took = False
        for _, _, i, j, d, support, n in options:
            if i in paired or j in used:
                continue
            # Alone (no neighbour pairs near it): only a close, unambiguous match of a longer name.
            if support or (n == 1 and ((d == 1 and len(printed[i]["f"]) >= 5) or len(printed[i]["f"]) >= 8)):
                paired[i] = (j, d)
                used.add(j)
                took = True
        if not took:
            break
    # The rest: the closest reading that sits where the printed neighbours put it (between the places their pairs
    # take in our reading order, give or take ten lines).
    order = sorted(paired)
    for i, cs in cands.items():
        if i in paired:
            continue
        k = bisect.bisect_left(order, i)
        lo = paired[order[k - 1]][0] if k > 0 else 0
        hi = paired[order[k]][0] if k < len(order) else len(ours)
        lo, hi = min(lo, hi) - 10, max(lo, hi) + 10
        fit = sorted((d, abs(j - (lo + hi) / 2), j) for j, d in cs if j not in used and lo <= j <= hi)
        if fit:
            paired[i] = (fit[0][2], fit[0][0])
            used.add(fit[0][2])
    return paired, covered


def build(ref_path, book, decisions, queues):
    """The review queues, from our own pairing of the reference with our entries. The reference file's own verdicts
    are only compared with ours, for the summary."""
    with open(ref_path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    printed = [{"r": r["printed_name"].strip().lower(), "f": fold(r["printed_name"].strip()),
                "uncertain": r.get("reading_uncertain") == "yes", "verdict": r.get("verdict", ""), "their_id": r.get("our_id", ""),
                "where": ", ".join(x for x in (f"p. {r['printed_page']}" if r.get("printed_page") else "", r.get("printed_col", "")) if x)}
               for r in rows if r.get("printed_name", "").strip()]
    ours = sorted(({"id": eid, "n": b["n"], "i": b["i"], "f": fold(b["e"][4]), "b": b} for eid, b in book.items()),
                  key=lambda o: (o["n"], o["i"]))
    paired, covered = pair(printed, ours)
    by_our = {j: (i, d) for i, (j, d) in paired.items()}
    alpha = sorted(range(len(printed)), key=lambda i: printed[i]["f"])
    keys = [printed[i]["f"] for i in alpha]

    def printed_around(i=None, name=None):
        if i is None:   # where a name would sit in the reference's alphabet
            k = bisect.bisect_left(keys, name)
            return [printed[alpha[x]]["r"] for x in range(max(0, k - 2), min(len(keys), k + 2))]
        return [printed[x]["r"] if x != i else f"[{printed[x]['r']}]" for x in range(max(0, i - 2), min(len(printed), i + 3))]

    def ours_around(j):
        return [ours[x]["b"]["e"][4] if x != j else f"[{ours[x]['b']['e'][4]}]"
                for x in range(max(0, j - 2), min(len(ours), j + 3)) if ours[x]["n"] == ours[j]["n"]]

    def in_stretch(j):
        """Whether the reference covers this stretch of our lines: paired lines just before and after it on the same
        page, whose printed names sit close together (the reference skips whole stretches)."""
        def side(step):
            for x in range(j + step, j + 5 * step, step):
                if not 0 <= x < len(ours) or ours[x]["n"] != ours[j]["n"]:
                    return None
                if x in by_our:
                    return by_our[x][0]
            return None
        before, after = side(-1), side(1)
        return before is not None and after is not None and abs(after - before) <= 8

    items = []
    for j, o in enumerate(ours):
        if o["n"] not in covered:
            continue
        b, e = o["b"], o["b"]["e"]
        row = b["row"] or {}
        if j in by_our:
            i, d = by_our[j]
            p = printed[i]
            alts = {fold(row.get("google_reading", "")), fold(row.get("issuu_reading", ""))} - {""}
            kind = ("a" if p["f"] in alts else "b") if d else ("c" if e[5] >= 3 else None)
            refs, near_p = [{"r": p["r"], "uncertain": p["uncertain"], "where": p["where"], "d": d}], printed_around(i=i)
        elif in_stretch(j):
            kind, refs, near_p = "d", [], printed_around(name=o["f"])
        else:
            continue
        if not kind or kind not in queues or decisions.get(f"{o['id']}|{e[4]}"):
            continue
        scans = [x for x in dict.fromkeys([e[4], row.get("google_reading", ""), row.get("issuu_reading", "")]) if x and HAS_LETTER.search(x)]
        items.append({"id": o["id"], "n": b["n"], "scan": b["scan"], "kind": kind, "ours": e[4], "status": STATUS[e[5]], "crop": e[9],
                      "google": row.get("google_reading", ""), "issuu": row.get("issuu_reading", ""),
                      "box": [row.get(k, "") for k in ("x0", "y0", "x1", "y1")], "candidates": scans, "printed": refs,
                      "printed_near": near_p, "ours_near": ours_around(j)})
    items.sort(key=lambda it: (it["kind"], tuple(int(x) for x in it["id"].split("."))))
    mine = collections.Counter("MATCH" if d == 0 else "NEAR" for _, d in paired.values())
    mine["MISSING"] = len(printed) - len(paired)
    summary = {"covered": f"pages {min(covered)}-{max(covered)}" if covered else "none", "ours": dict(mine),
               "file": dict(collections.Counter(p["verdict"] for p in printed)),
               "paired_differently": sum(1 for i, (j, _) in paired.items() if printed[i]["their_id"] != ours[j]["id"]),
               "ours_only": sum(1 for j, o in enumerate(ours) if o["n"] in covered and j not in by_our and in_stretch(j))}
    return items, summary


def read_decisions():
    f = OUT / "decisions.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def save_decisions(d):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "decisions.json").write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def write_outputs(decisions):
    OUT.mkdir(parents=True, exist_ok=True)
    order = lambda d: (d["page"], float(d["y0"] or 0), float(d["x0"] or 0))
    fixes = sorted((d for d in decisions.values() if d["action"] in ("accept", "edit")), key=order)
    drops = sorted((d for d in decisions.values() if d["action"] == "drop"), key=order)
    with (OUT / "corrections.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["page", "from", "to", "source", "x0", "y0"])
        for d in fixes:
            w.writerow([d["page"], d["from"], d["to"], f"checked against scan {d['day']} (printed-edition prompt)", d["x0"], d["y0"]])
    with (OUT / "drops.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["page", "entry", "source", "x0", "y0"])
        for d in drops:
            w.writerow([d["page"], d["from"], f"not a line on the scan, checked {d['day']} (printed-edition prompt)", d["x0"], d["y0"]])
    return len(fixes), len(drops)


def cut(n, box):
    """The entry's line and the ones around it, cut from Google's page render: (png bytes, line top, line height)."""
    from PIL import Image, ImageOps   # only when the page renders are here
    x0, y0, x1, y1 = (float(v) for v in box)
    h = y1 - y0
    left, top, right, bottom = x0 - 20, y0 - 1.6 * h, x0 + 400, y1 + 1.6 * h   # one column: a page is 2,400 wide
    img = ImageOps.autocontrast(Image.open(PAGES / f"page_{n:03d}.png").convert("L").crop((round(left), round(top), round(right), round(bottom))))
    img = img.resize((480, round(480 * img.height / img.width)))
    k = 480 / (right - left)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue(), round((y0 - top) * k), round(h * k)


def main():
    global PAGES
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("reference", help="the reference comparison (CSV), kept outside the repository")
    ap.add_argument("--queue", default="abcd", help="which queues, in order (default abcd)")
    ap.add_argument("--pages", default=str(PAGES), help="Google's page renders, page_NNN.png (default: Apelyido's)")
    ap.add_argument("--crops", default="https://apelyido.ruzcko.com/scan/", help="the crop strips, when the renders aren't here")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--write", action="store_true", help="write corrections.csv and drops.csv from the decisions so far and stop")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    PAGES = Path(a.pages)
    decisions = read_decisions()
    if a.write:
        n, m = write_outputs(decisions)
        print(f"{n} corrections, {m} drops -> {OUT}")
        return
    book = entries()
    items, summary = build(a.reference, book, decisions, set(a.queue.replace(",", "")))
    renders = PAGES.is_dir()
    strips = f"{a.crops.rstrip('/')}/{crops_version()}/"
    counts = {k: sum(it["kind"] == k for it in items) for k in "abcd"}
    print(f"{len(items)} entries to check: " + ", ".join(f"{k} {v}" for k, v in counts.items() if v) +
          f"; {len(decisions)} decided before.", flush=True)
    print(f"Pairing ({summary['covered']}): ours {summary['ours']}, the file's {summary['file']}; "
          f"{summary['paired_differently']} paired differently from the file; {summary['ours_only']} of our entries unpaired.", flush=True)
    print("Crops: " + ("cut from " + str(PAGES) if renders else "the crop strips (doubtful entries only)"), flush=True)

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

        def do_GET(self):
            p = self.path.split("?")[0]
            if p == "/":
                page = PAGE.replace("__STRIPS__", json.dumps(strips)).replace("__RENDERS__", json.dumps(renders)).replace("__KINDS__", json.dumps(KINDS))
                self.send(page, "text/html; charset=utf-8")
            elif p == "/queue":
                self.send(json.dumps({"items": items, "decided": len(decisions)}, ensure_ascii=False))
            elif p == "/lib/readings.js":
                self.send((ROOT / "lib" / "readings.js").read_bytes(), "text/javascript")
            elif re.fullmatch(r"/data/(pages\.json|p/\d{1,3}\.json)", p):
                f = BOOK / p.lstrip("/")
                self.send(f.read_bytes()) if f.is_file() else self.send("not found", "text/plain", 404)
            elif m := re.fullmatch(r"/cut/(\d{1,3}\.\d{1,2}\.\d{1,3})", p):
                it = next((x for x in items if x["id"] == m.group(1)), None)
                if not (renders and it and all(it["box"])):
                    return self.send("not found", "text/plain", 404)
                png, top, h = cut(it["n"], it["box"])
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
                action = body.get("action")
                if not it or action not in ("accept", "edit", "keep", "drop"):
                    return self.send(json.dumps({"ok": False}), status=400)
                to = str(body.get("to") or "").strip().lower()
                if action in ("accept", "edit") and not to:
                    return self.send(json.dumps({"ok": False, "error": "no reading"}), status=400)
                if action == "accept" and to not in it["candidates"]:   # accept takes one of our scans' readings only
                    return self.send(json.dumps({"ok": False, "error": "accept takes one of our scans' readings; type anything else"}), status=400)
                decisions[f"{it['id']}|{it['ours']}"] = {
                    "id": it["id"], "action": action, "kind": it["kind"], "page": it["n"], "from": it["ours"], "to": to,
                    "x0": it["box"][0], "y0": it["box"][1], "day": datetime.date.today().isoformat()}
                save_decisions(decisions)
                self.send(json.dumps({"ok": True}))
            elif self.path == "/write":
                n, m = write_outputs(decisions)
                self.send(json.dumps({"ok": True, "n": n, "m": m, "path": str(OUT)}))
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
        n, m = write_outputs(decisions)
        print(f"\n{n} corrections, {m} drops -> {OUT}")


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reference check</title>
<style>
  :root { --bg: #1d1712; --ink: #f3ead6; --muted: #b9a98c; --accent: #d9b45a; --warn: #f0a35a; --line: rgba(243,234,214,.18); color-scheme: dark; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.45 Georgia, serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; font-weight: 400; color: var(--muted); margin: 0 0 12px; }
  h2 { font-size: 34px; font-weight: 400; margin: 0; }
  .kind { color: var(--accent); margin: 4px 0 8px; }
  .muted, small { color: var(--muted); }
  .warn { border: 1px solid #8a5a22; color: #f3d2a8; background: rgba(240,163,90,.08); border-radius: 10px; padding: 8px 12px; font-size: 14px; }
  .crop { position: relative; display: inline-block; margin: 12px 0; border-radius: 6px; overflow: hidden; background: #fff; }
  .crop img { display: block; }
  .crop i { position: absolute; left: 0; right: 0; border: 2px solid #e0932f; border-radius: 4px; }
  .strip { background-repeat: no-repeat; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr.sel td { background: rgba(217,180,90,.16); }
  tr.ref td { color: var(--muted); font-style: italic; }
  .ok { color: #9fd38a; } .no { color: var(--warn); }
  .keys { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px; }
  button { font: inherit; color: var(--ink); background: rgba(255,255,255,.08); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  kbd { font-family: ui-monospace, monospace; color: var(--accent); }
</style></head>
<body><main>
<h1>Reference check · <span id="count"></span></h1>
<p class="warn">The reference is a prompt, not an answer. It has its own errors: it drops letters where the 1849 scan is
blotted, and swaps letters. Write only what you read on the scan.</p>
<div id="item"></div>
</main>
<script type="module">
import { entryContext, check, normalise } from "/lib/readings.js";
const STRIPS = __STRIPS__, RENDERS = __RENDERS__, KINDS = __KINDS__;
// The crop strips' layout, as in book/book.js.
const CELL_W = 300, CELL_H = 96, LINE_Y = 24, LINE_H = 39, ACROSS = 4;
const env = { ASSETS: { fetch: u => fetch(new URL(u).pathname) } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let items = [], at = 0, pick = 0, ctx = null, decided = 0;

async function load() {
  const q = await fetch("/queue").then(r => r.json());
  items = q.items; decided = q.decided; at = 0;
  show();
}
async function crop(it) {
  if (RENDERS) {
    const r = await fetch(`/cut/${it.id}`);
    if (r.ok) {
      const [top, h] = (r.headers.get("x-line") || "0,0").split(",").map(Number), url = URL.createObjectURL(await r.blob());
      return `<div class="crop"><img src="${url}" alt="The scan around this line"><i style="top:${top - 3}px;height:${h + 6}px"></i></div>`;
    }
  }
  if (it.crop == null) return `<p class="muted">No crop for this entry: open page ${it.n} in the book.</p>`;
  const cx = (it.crop % ACROSS) * CELL_W, cy = Math.floor(it.crop / ACROSS) * CELL_H;
  return `<div class="crop strip" style="background-image:url('${STRIPS}${it.scan}.webp');background-position:-${cx}px -${cy}px;width:${CELL_W}px;height:${CELL_H}px"><i style="top:${LINE_Y}px;height:${LINE_H}px"></i></div>`;
}
const near = s => s.startsWith("[") ? `<b>${esc(s.slice(1, -1))}</b>` : esc(s);
const rule = r => { const why = ctx ? check(normalise(r), ctx) : "entry not found"; return why ? `<span class="no">${esc(why)}</span>` : `<span class="ok">fits the book's rules</span>`; };
async function show() {
  const box = document.getElementById("item");
  const left = items.length - at, by = "abcd".split("").map(k => [k, items.slice(at).filter(x => x.kind === k).length]).filter(([, n]) => n);
  document.getElementById("count").textContent = `${left} to check (${by.map(([k, n]) => `${k} ${n}`).join(", ")}), ${decided} decided`;
  if (at >= items.length) {
    box.innerHTML = `<p>Nothing left in these queues.</p><p><button id="write">Write corrections.csv and drops.csv</button> <span id="out" class="muted"></span></p>`;
    box.querySelector("#write").onclick = write;
    return;
  }
  const it = items[at];
  ctx = await entryContext(env, new Request(location.origin + "/"), it.id);
  pick = 0;
  const scans = it.candidates.map(c => [c, [c === it.ours && "ours", c === it.google && "Google", c === it.issuu && "Issuu"].filter(Boolean).join(", ")]);
  box.innerHTML = `
    <p class="kind">${esc(it.kind)} · ${esc(KINDS[it.kind])}</p>
    <h2>${it.ours === "?" ? "Unread line" : esc(it.ours) + "."}</h2>
    <p class="muted">Page ${it.n} · entry ${esc(it.id)} · ${esc(it.status)}</p>
    ${await crop(it)}
    <p class="muted">On the scan: ${it.ours_near.map(near).join(" · ")}<br>
      In the printed list${it.printed.length ? "" : " (where it would sort)"}: ${it.printed_near.map(near).join(" · ")}</p>
    <p class="muted">The book's order puts it ${ctx?.prev ? `after <b>${esc(ctx.prev)}</b>` : ""}${ctx?.prev && ctx?.next ? " and " : ""}${ctx?.next ? `before <b>${esc(ctx.next)}</b>` : ""}.</p>
    <table><tr><th></th><th>Reading</th><th>From</th><th>The book's rules</th></tr>
      ${scans.map(([c, from], i) => `<tr data-i="${i}"><td><kbd>${i + 1}</kbd></td><td><b>${esc(c)}</b></td><td class="muted">${esc(from)}</td><td>${rule(c)}</td></tr>`).join("")}
      ${it.printed.map(p => `<tr class="ref"><td></td><td>${esc(p.r)}</td><td>printed edition (reference)${p.uncertain ? ", its reading uncertain" : ""}${p.d ? `, ${p.d} letter${p.d > 1 ? "s" : ""} from ours` : ""}</td><td>${rule(p.r)}</td></tr>`).join("")}
    </table>
    <div class="keys"><button data-k="a"><kbd>a</kbd> the scan shows the chosen reading</button><button data-k="e"><kbd>e</kbd> type what the scan shows</button>
      <button data-k="k"><kbd>k</kbd> leave it</button><button data-k="d"><kbd>d</kbd> not a line in the book</button><button data-k="s"><kbd>s</kbd> skip</button></div>
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
  if (k === "a") decide("accept", it.candidates[pick]);
  else if (k === "k") decide("keep");
  else if (k === "s") { at++; show(); }
  else if (k === "d") { if (confirm(`Drop "${it.ours}" from page ${it.n}: it isn't a line on the scan (junk, or a line read twice)?`)) decide("drop"); }
  else if (k === "e") {
    const v = prompt("What the 1849 scan shows (not what the reference says):", it.ours === "?" ? "" : it.ours);
    if (!v) return;
    const why = ctx && check(normalise(v), ctx);
    if (why && !confirm(`${why}\n\nWrite it anyway?`)) return;
    decide("edit", normalise(v));
  }
}
async function write() {
  const r = await fetch("/write", { method: "POST", body: "{}" }).then(x => x.json());
  document.getElementById("out").textContent = `${r.n} corrections and ${r.m} drops written to ${r.path}`;
}
addEventListener("keydown", e => {
  if (/^[1-9]$/.test(e.key)) select(+e.key - 1);
  else if ("aekds".includes(e.key) && e.key.length === 1) act(e.key);
});
load();
</script>
</body></html>
"""

if __name__ == "__main__":
    main()
