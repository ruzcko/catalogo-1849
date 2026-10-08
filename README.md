# Catálogo alfabético de apellidos (1849): an open transcription

A machine-read, partly hand-checked list of the surnames in the **Catálogo alfabético de apellidos**: the book of about 61,000 surnames that Governor-General Narciso Clavería's decree of 21 November 1849 distributed across the Philippines, so families without fixed surnames could take one.

**At a glance:** 53,331 entries from all 140 name-list pages (updated 8 October 2026):

| Status | Entries |
| --- | ---: |
| `hand` / `hand_unclear` (two pages typed by a person) | 792 |
| `sure` | 13,128 |
| `likely` | 27,032 |
| `best_effort` | 9,525 |
| `low` | 2,854 |

A few scanned pages near the end carry no readable page number, so their `book_page` is empty. The Issuu scan skips a handful of pages, so a few short alphabetical stretches are missing.

This is the first open, searchable list of the book's names that we know of. It powers the "The book" chapter of [Apelyido](https://apelyido.ruzcko.com).

## Source and credit

- **The book:** *Catálogo alfabético de apellidos* (Manila, 1849). Public domain.
- **The edition read:** the 1973 reprint by the **National Archives of the Philippines**.
- **The scan:** digitized and made available online by the **Filipinas Heritage Library (Ayala Foundation)**: [Catálogo alfabético de apellidos on Issuu](https://issuu.com/filipinasheritagelibrary/docs/catalogo_alfabetico_de_apellidos). Thank you for preserving this book and making it accessible.
- **Transcription:** OCR with [Surya](https://github.com/datalab-to/surya), corrected using the book's alphabetical order, checked against hand-typed pages, by [Apelyido](https://apelyido.ruzcko.com).

### How the book's order is used

The book is alphabetical on the **first three letters** of each name: on the hand-typed pages, 99–100% of neighbouring entries are in order on three letters, but only 80% on the fourth (the printed order really is *aagno, aagaoan*). So the cleanup uses three letters and no more:

1. Every entry on a page starts with the page's letter, and an entry whose first two letters disagree with nearly all its neighbours is put back in line.
2. Across the whole book, we find the longest chain of entries whose first three letters never go backwards (confident readings count more). An entry off that chain, sitting between two neighbours that start the same way, gets a one-letter fix (*tnpoc* between *tap…* names becomes *tapoc*). These fixes are right about 70% of the time on the hand-typed pages, so they are marked `best_effort`.
3. Any other out-of-order entry is trusted one step less (`sure`/`likely` become `best_effort`, `best_effort` becomes `low`). On the hand-typed pages, 24 of the 26 entries demoted this way were indeed misread.

`ocr_raw` always keeps what the OCR actually read.

This repository contains only the transcribed text, not the page images.

## Read this before using it

**This is a first, machine-read version.** The only scan online is about 910 pixels wide, so many letters are blurred. Measured against two pages typed by hand, the OCR reads 82–91% of names exactly and 95–99% within one letter. Every row says how much to trust it (see `status`). A higher-resolution scan would make it near-perfect, and corrections are very welcome.

## Files

`catalogo_1849.csv`: one row per printed entry.

| Column | Meaning |
| --- | --- |
| `book_page` | Page number printed in the book's name list (empty if it couldn't be read) |
| `issuu_page` | Page number in the Issuu scan |
| `column`, `row` | Position on the page: column 1–6, then row from the top (row only, on hand-typed pages) |
| `entry` | The name as we read it, lowercase, as printed (accents kept) |
| `status` | How much to trust it (below) |
| `confidence` | The OCR's confidence in the line, 0–1 (empty on hand-typed pages) |
| `ocr_raw` | What the OCR actually read, before cleaning and repair |
| `x0`, `y0`, `x1`, `y1` | The entry's box on the scanned page, in pixels |

| `status` | Meaning |
| --- | --- |
| `hand` | Typed by a person from the scan |
| `hand_unclear` | Typed by a person; `?` marks letters they couldn't read |
| `checked` | An OCR reading confirmed or corrected by a person |
| `sure` | Confident OCR (≥ 0.8) **and** a surname people still carry in the Philippines today (in local-election candidate lists or the 2023 barangay officials) |
| `likely` | Confident OCR (≥ 0.8), but not a surname found today (often an old native name) |
| `best_effort` | Less confident OCR (0.6–0.8), a one-letter fix from the book's order, or a confident reading that breaks the order: probably right, check before relying on it |
| `low` | Low-confidence OCR (< 0.6), or a less confident one that breaks the order: often wrong |

For most uses, keep `hand`, `checked`, `sure` and `likely`.

## The virtual book

**Open it: [catalogo-1849.ruzcko.com](https://catalogo-1849.ruzcko.com)**

`book/` is a 3D book you can leaf through, with every page set in type from this transcription. It uses no scan images: each name is placed where it sits on the scanned page, and pages missing from the scan say so. It's a static site (three.js from a CDN, no build step).

    python tools/build_book.py           # catalogo_1849.csv -> book/data/ (pages, entries, search index)
    python -m http.server -d book 8000   # then open http://localhost:8000

Links: `#p=58` opens page 58; `#n=fabella` finds a name and marks it; `#e=100.1.6` opens one entry's reading help.

**Reading help.** *How sure?* shows each reading's status (faint: best guess; orange: blurry). Tapping a doubtful entry shows its scan crop (the Filipinas Heritage Library's scan, one line at a time, served by Apelyido rather than kept in this repo), the OCR's raw reading, where it falls in the book's order, and readers' readings. Readers vote for a reading or type their own; tallies show after voting. The server (`functions/api`, `lib/readings.js`, a Cloudflare D1 database) checks every reading against the book: the page's letter, the order of the first three letters, 2-20 letters, only the book's characters, close to what's printed. Votes keep only the reading and a hash of a random code made up by the browser. Readings that readers agree on are checked by hand before they change `catalogo_1849.csv`.

## Licence

The transcription is released under **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. You may use it for anything, including commercially, as long as you credit it, for example:

> *Catálogo alfabético de apellidos (1849), open transcription by Apelyido (apelyido.ruzcko.com), from the National Archives of the Philippines' 1973 reprint as digitized by the Filipinas Heritage Library.*

The underlying 1849 text is in the public domain.

The code in `book/` and `tools/` is MIT-licensed (`LICENSE-CODE`). The book's typeface is IM Fell English by Igino Marini (SIL Open Font License), loaded from Google Fonts.

## Corrections

Found a misread name? Open an issue or a pull request with the row's `issuu_page`, `column`, `row` and the correct reading, or write to hello@ruzcko.com.
