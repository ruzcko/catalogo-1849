"""Build the virtual book's data from catalogo_1849.csv (standard library only).

    python tools/build_book.py        ->  book/data/pages.json   the page list (for navigation and search)
                                          book/data/p/<n>.json   one file per printed page: its entries
                                          book/data/s/<letter>.json  search index

Each printed page keeps its entries where the scan has them. The CSV's boxes are in pixels of Google's scan as
rendered (2,400 x 3,882); here they're scaled to the 910 x 1,498 frame the book draws in. Hand-typed pages have no
positions: they're laid out in six even columns. A page with no entries gets a placeholder, so the page numbers run on.

Each entry: [x0, y0, x1, y1, name, status, column, row, other reading, crop]. The entry's id is
"<page>.<column>.<row>", as in the CSV. "Other reading": for a doubtful entry, what the other scan's OCR read, if
different. Doubtful entries (best effort and low) are numbered in page order (the last field): their scan crops sit in
that order in the page's crop strip, made by the private Apelyido pipeline (not in this repo). Status codes:
0 hand-typed or checked, 1 sure, 2 likely, 3 best effort, 4 low. The site can draw entries where they are (as
scanned) or straightened into even columns.
"""
import csv
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "book" / "data"
STATUS = {"hand": 0, "hand_unclear": 0, "checked": 0, "sure": 1, "likely": 2, "best_effort": 3, "low": 4}
SX, SY = 910 / 2400, 1498 / 3882   # Google page pixels -> the book's drawing frame
LAST = 141


def other(r):
    """For a doubtful entry, the other scan's reading when it differs from ours."""
    if STATUS[r["status"]] < 3:
        return None
    for v in (r["google_reading"], r["issuu_reading"]):
        if v and v != r["entry"]:
            return v
    return None


def main():
    rows = list(csv.DictReader((ROOT / "catalogo_1849.csv").open(encoding="utf-8")))
    by_page = {}
    for r in rows:
        by_page.setdefault(int(r["book_page"]), []).append(r)

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "p").mkdir(parents=True)
    pages = []
    for n in range(1, LAST + 1):
        entries = by_page.get(n)
        if not entries:
            pages.append({"n": n, "missing": True})
            continue
        hand = not entries[0]["x0"]
        if hand:
            per_col = -(-len(entries) // 6)
            out = []
            for i, r in enumerate(sorted(entries, key=lambda r: int(r["row"]))):
                col, row = divmod(i, per_col)
                x0, y0 = 62 + col * 140, 150 + row * (1250 / per_col)
                out.append([round(x0), round(y0), round(x0 + 110), round(y0 + 14), r["entry"], STATUS[r["status"]], col + 1,
                            int(r["row"]), None])
        else:
            out = [[round(float(r["x0"]) * SX), round(float(r["y0"]) * SY), round(float(r["x1"]) * SX), round(float(r["y1"]) * SY),
                    r["entry"], STATUS[r["status"]], int(r["column"]), int(r["row"]), other(r)]
                   for r in sorted(entries, key=lambda r: (int(r["block"] or 1), int(r["column"]), int(r["row"])))]   # reading order
        k = 0
        for e in out:  # number the doubtful entries: their crops' order in the page's crop strip
            if e[5] >= 3 and not hand:
                e.append(k)
                k += 1
            else:
                e.append(None)
        names = [e[4] for e in out if e[5] < 4]
        letters = sorted({e[4][0] for e in out if e[5] < 3}, key=lambda c: -sum(e[4][0] == c for e in out))
        (OUT / "p" / f"{n}.json").write_text(json.dumps({"n": n, "scan": n, "e": out}, ensure_ascii=False,
                                                        separators=(",", ":")), encoding="utf-8")
        pages.append({"n": n, "scan": n, "letter": letters[0].upper() if letters else "",
                      "first": names[0] if names else "", "last": names[-1] if names else "", "hand": hand})
    (OUT / "pages.json").write_text(json.dumps(pages, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Search index: entry -> page numbers (skipping low readings), split by first letter to keep each file small.
    index = {}
    for n, entries in by_page.items():
        for r in entries:
            if r["status"] != "low" and "?" not in r["entry"]:
                index.setdefault(r["entry"][0], {}).setdefault(r["entry"], [])
                if n not in index[r["entry"][0]][r["entry"]]:
                    index[r["entry"][0]][r["entry"]].append(n)
    (OUT / "s").mkdir()
    for letter, names in index.items():
        (OUT / "s" / f"{letter}.json").write_text(json.dumps(names, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    missing = [p["n"] for p in pages if p.get("missing")]
    print(f"{len(pages)} pages (without entries: {missing}); search index for {len(index)} letters, "
          f"{sum(len(v) for v in index.values()):,} names")


if __name__ == "__main__":
    main()
