"""Build the virtual book's data from catalogo_1849.csv (standard library only).

    python tools/build_book.py        ->  book/data/pages.json   the page list (for navigation and search)
                                          book/data/p/<n>.json   one file per printed page: its entries

Each printed page keeps the entries where the scan has them (x0, y0, x1, y1 in scan pixels, 910 x 1498), so the
recreated page looks like the scanned one. Hand-typed pages have no positions: they're laid out in six even
columns. Pages missing from the scan get a placeholder, so the page numbers run on as in the book.

Each entry: [x0, y0, x1, y1, name, status, column]. Status codes: 0 hand-typed or checked, 1 sure, 2 likely,
3 best effort, 4 low. The site can draw entries where they are (as scanned) or straightened into even columns.
"""
import csv
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "book" / "data"
STATUS = {"hand": 0, "hand_unclear": 0, "checked": 0, "sure": 1, "likely": 2, "best_effort": 3, "low": 4}
MIN_ENTRIES = 30  # the last scans (back matter) hold only a few stray words


def page_numbers(read):
    """Printed page numbers in scan order, trusting the number read on the page only when it continues the run:
    the next page should follow it (a jump is a page missing from the scan), otherwise it's a misread."""
    out, prev = [], 0
    for i, bp in enumerate(read):
        nxt = read[i + 1] if i + 1 < len(read) else None
        if bp == prev + 1 or (bp and bp > prev + 1 and nxt == bp + 1):
            n = bp
        else:
            n = prev + 1
        out.append(n)
        prev = n
    return out


def main():
    rows = list(csv.DictReader((ROOT / "catalogo_1849.csv").open(encoding="utf-8")))
    by_scan = {}
    for r in rows:
        by_scan.setdefault(int(r["issuu_page"]), []).append(r)
    scans = [s for s in sorted(by_scan) if len(by_scan[s]) >= MIN_ENTRIES]
    read = [int(by_scan[s][0]["book_page"]) if by_scan[s][0]["book_page"] else None for s in scans]
    numbers = page_numbers(read)

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "p").mkdir(parents=True)
    pages, prev = [], 0
    for scan, n in zip(scans, numbers):
        for missing in range(prev + 1, n):  # pages the online scan skips
            pages.append({"n": missing, "missing": True})
        entries = by_scan[scan]
        hand = not entries[0]["x0"]
        if hand:
            per_col = -(-len(entries) // 6)
            out = []
            for i, r in enumerate(sorted(entries, key=lambda r: int(r["row"]))):
                col, row = divmod(i, per_col)
                x0, y0 = 62 + col * 140, 150 + row * (1250 / per_col)
                out.append([round(x0), round(y0), round(x0 + 110), round(y0 + 14), r["entry"], STATUS[r["status"]], col + 1])
        else:
            out = [[round(float(r["x0"])), round(float(r["y0"])), round(float(r["x1"])), round(float(r["y1"])),
                    r["entry"], STATUS[r["status"]], int(r["column"])]
                   for r in sorted(entries, key=lambda r: (int(r["column"]), int(r["row"])))]
        names = [e[4] for e in out if e[5] < 4]
        letters = sorted({e[4][0] for e in out if e[5] < 3}, key=lambda c: -sum(e[4][0] == c for e in out))
        (OUT / "p" / f"{n}.json").write_text(json.dumps({"n": n, "scan": scan, "e": out}, ensure_ascii=False,
                                                        separators=(",", ":")), encoding="utf-8")
        pages.append({"n": n, "scan": scan, "letter": letters[0].upper() if letters else "",
                      "first": names[0] if names else "", "last": names[-1] if names else "", "hand": hand})
        prev = n
    (OUT / "pages.json").write_text(json.dumps(pages, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Search index: entry -> page numbers (skipping low readings), split by first letter to keep each file small.
    index = {}
    for scan, n in zip(scans, numbers):
        for r in by_scan[scan]:
            if r["status"] != "low" and "?" not in r["entry"]:
                index.setdefault(r["entry"][0], {}).setdefault(r["entry"], [])
                if n not in index[r["entry"][0]][r["entry"]]:
                    index[r["entry"][0]][r["entry"]].append(n)
    (OUT / "s").mkdir()
    for letter, names in index.items():
        (OUT / "s" / f"{letter}.json").write_text(json.dumps(names, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    missing = [p["n"] for p in pages if p.get("missing")]
    print(f"{len(pages)} pages ({len(scans)} scanned, missing from the scan: {missing}); "
          f"search index for {len(index)} letters, {sum(len(v) for v in index.values()):,} names")


if __name__ == "__main__":
    main()
