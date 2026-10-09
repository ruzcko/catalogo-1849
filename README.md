# Catálogo alfabético de apellidos (1849): an open transcription

In 1849, many Filipinos had a baptismal name but no family name passed down, and so many shared the same saints' names that the tax lists and parish books couldn't tell people apart (the decree's preamble, 1973 reprint, p. x). So Governor-General Narciso Clavería's decree of 21 November 1849 sent a book of about 60,000 surnames, the **Catálogo alfabético de apellidos**, to every province, for families without a fixed surname to take one.

This is a machine-read, partly hand-checked list of the names in that book.

**At a glance:** 59,171 entries from all 141 name-list pages, read from two independent scans (updated 9 October 2026):

| Status | Entries |
| --- | ---: |
| `hand` / `hand_unclear` (two pages typed by a person) | 792 |
| `checked` (corrected from a source) | 1 |
| `sure` | 11,344 |
| `likely` | 21,471 |
| `best_effort` | 21,040 |
| `low` (376 of them `?`: lines neither scan could read) | 4,523 |

Every page is covered, including the eight (62–63, 66–67, 70–71, 74–75; 3,273 names) that the Issuu scan skips. Two OCR readings agree on 25,864 names; where they differ (26,863), the more likely one is kept and the other is recorded. The book prints about 60,662 names: 376 lines are here as `?` because neither scan could read them, and about 1,500 are still missing.

This is the first open, searchable list of the book's names that we know of. It powers the "The book" chapter of [Apelyido](https://apelyido.ruzcko.com).

## Source and credit

- **The book:** *Catálogo alfabético de apellidos* (Manila, 1849). Public domain.
- **The edition read:** the 1973 reprint by the **National Archives of the Philippines**.
- **The scans,** two independent copies of that reprint:
  - **Google Books**, from the **University of Michigan** library's copy: [Catálogo alfabético de apellidos](https://books.google.com/books?id=dEMvAAAAMAAJ), digitized by Google (about 4,400 pixels wide, all 141 pages).
  - The **Filipinas Heritage Library (Ayala Foundation)**: [Catálogo alfabético de apellidos on Issuu](https://issuu.com/filipinasheritagelibrary/docs/catalogo_alfabetico_de_apellidos) (910 pixels wide, 133 pages). Thank you for preserving this book and making it accessible.
- **Transcription:** both scans read with [Surya](https://github.com/datalab-to/surya) OCR, combined line by line, corrected using the book's alphabetical order, checked against hand-typed pages, by [Apelyido](https://apelyido.ruzcko.com).

### How the two scans are combined

The two copies have different blemishes (one is faded where the other is clear), so their OCR errors fall in different places. On each page the two readings are lined up, using the names both read the same to map one scan onto the other, and each printed line is paired with its counterpart:

- **Both read it the same:** trusted (`sure` or `likely`).
- **They differ:** a surname people still carry today wins; otherwise the more confident reading. The other reading is kept in the dataset (`google_reading`, `issuu_reading`). If both were confident, it's marked `best_effort`.
- **Only one scan has the line** (a page or a line the other skips): that scan's reading.

On the two hand-typed pages this reads 91% and 86% of names exactly (the Issuu scan alone: 91% and 82%), and 85% of the names marked `sure` or `likely` are right (81% before).

### How the book's order is used

The book is alphabetical on the **first three letters** of each name: on the hand-typed pages, 99–100% of neighbouring entries are in order on three letters, but only 80% on the fourth (the printed order really is *aagno, aagaoan*). So the cleanup uses three letters and no more:

1. Every entry on a page starts with the page's letter, and an entry whose first two letters disagree with nearly all its neighbours is put back in line.
2. Across the whole book, we find the longest chain of entries whose first three letters never go backwards (confident readings count more). An entry off that chain, sitting between two neighbours that start the same way, gets a one-letter fix (*tnpoc* between *tap…* names becomes *tapoc*). These fixes are right about 70% of the time on the hand-typed pages, so they are marked `best_effort`.
3. Any other out-of-order entry is trusted one step less (`sure`/`likely` become `best_effort`, `best_effort` becomes `low`). On the hand-typed pages, 24 of the 26 entries demoted this way were indeed misread.

`google_reading` and `issuu_reading` always keep what each scan's OCR actually read (after cleaning).

The order follows the book's own alphabet, the Spanish of 1849: **Ll is a letter of its own after L** (its section follows L), ñ comes after n, and accents don't count. In the Ll section the old type's "ll" often comes out of the OCR as "h", "li", "il" or "in" (*llamas* read as *hamas*); those are put back. There are no I, K, W or X sections, though a few I and K names sit among the Y and Q ones.

**A check against a published count.** Todd Sales Lucero's "Ten things to know about the Catálogo" (*The Freeman*, 15 November 2023) counts 141 pages of names, six columns of 72 names (432 on a full page), about 53,517 names legible with certainty, 113 Ll names and 14 I names, and gives the first name as AACAIN and the last as ZURRAR. This transcription has 59,171 entries, 432 on its fullest pages, 97 Ll names, starts with *aacain*, and ends with *zurrar* (the OCRs read *zurrac* and *zustar*; corrected from the article).

This repository contains only the transcribed text, not the page images.

## Read this before using it

**This is a machine-read version.** Both copies have faded, smudged and cracked stretches (some printed into the 1973 reprint itself). Measured against two pages typed by hand, it reads 86–91% of names exactly and 97–99% within one letter. Every row says how much to trust it (see `status`), and corrections are very welcome: readers can vote on doubtful names in the [virtual book](https://catalogo-1849.ruzcko.com).

## Files

`catalogo_1849.csv`: one row per printed entry.

| Column | Meaning |
| --- | --- |
| `book_page` | Page number printed in the book's name list |
| `block` | Where a new letter starts mid-page, the book runs the heading across the page and starts the new section in all six columns below it: blocks number those bands from the top (1 on most pages). The numbers keep their order but can skip one (1, 2, 4), and are empty on the two hand-typed pages. The page reads block by block, each block column by column |
| `column`, `row` | Position on the page: column 1–6, then row from the top of the column (row only, on hand-typed pages) |
| `entry` | The name as read (by OCR, or by a person on the hand-typed pages), lowercase, as printed (accents kept) |
| `status` | How much to trust it (below) |
| `confidence` | The OCR's confidence in the line, 0–1 (empty on hand-typed pages) |
| `google_reading`, `issuu_reading` | What each scan's OCR read for this line (empty where that scan has no line here) |
| `x0`, `y0`, `x1`, `y1` | The entry's box on Google's scan of the page, in pixels of the page drawn 2,400 × 3,882 |

| `status` | Meaning |
| --- | --- |
| `hand` | Typed by a person from the scan |
| `hand_unclear` | Typed by a person; `?` marks letters they couldn't read |
| `checked` | An OCR reading confirmed or corrected by a person |
| `sure` | Both scans agree, or confident OCR (≥ 0.8), **and** a surname people still carry in the Philippines today (in local-election candidate lists or the 2023 barangay officials) |
| `likely` | Both scans agree, or confident OCR (≥ 0.8), but not a surname found today (often an old native name) |
| `best_effort` | Less confident OCR (0.6–0.8), the two scans confidently disagree, a one-letter fix from the book's order, or a confident reading that breaks the order: probably right, check before relying on it |
| `low` | Low-confidence OCR (< 0.6), or a less confident one that breaks the order: often wrong. `?` is a line neither scan could read |

For most uses, keep `hand`, `checked`, `sure` and `likely`.

## The virtual book

**Open it: [catalogo-1849.ruzcko.com](https://catalogo-1849.ruzcko.com)**

`book/` is a 3D book you can leaf through, with every page set in type from this transcription. Its pages use no scan images: each name is placed where it sits on the scanned page. (Doubtful entries show a small crop of Google's scan, served by Apelyido, so readers can judge.) It's a static site (three.js from a CDN, no build step).

    python tools/build_book.py           # catalogo_1849.csv -> book/data/ (pages, entries, search index)
    python -m http.server -d book 8000   # then open http://localhost:8000

**Opening.** On a first visit the book opens with a short history (why the book was made, the decree, letter by letter in Albay, whether it worked; sources from the decree and Domingo Abella's introduction in the 1973 reprint), then the closed book appears at an angle on a light desk and its cover swings open as the camera comes round to read it. Later visits open the book straight away; a link to a page, a name or an entry skips both. *About* has the story again.

**Views.** *Tidy* sets the names in straight columns; *In place* sets each where it sits on the page; *Scan* shows the scanned page itself (Google's scan of the University of Michigan copy, served by Apelyido from `/scan/pages/<version>/<page>.webp`, with its `meta.json` mapping the dataset's boxes onto the images), with the same page turns and zoom, and an opened name outlined on its line. Only the pages in view and the next ones are fetched. The view is remembered in the browser; `?view=scan` picks one, and `?scans=<base>` tries another image host while developing (an Apelyido preview).

Links: `/58` opens page 58; `/fabella` finds a name and marks it; `/58/glubig` opens one entry's reading help (`/58/glubig-2` for a second one on the page). The older `#p=`, `#n=` and `#e=` links still work. When `book.js`, `style.css` or `book/data` change, bump the `?v=` in `index.html`: the book fetches its data with the same version, so no browser mixes a new release with page files kept from the last one. Shared links get their own preview card (`functions/[[path]].js` sets the tags, `functions/og.js` draws the card in IM Fell with resvg; no scan images).

**Reading help.** *How sure?* shows each reading's status (faint: best guess; orange: blurry). Tapping a doubtful entry shows its scan crop (Google's scan of the University of Michigan copy, one line at a time, served by Apelyido rather than kept in this repo), the OCR reading and the other scan's OCR, where it falls in the book's order, and readers' readings. Readers vote for a reading or type their own; tallies show after voting. The server (`functions/api`, `lib/readings.js`, a Cloudflare D1 database) checks every reading against the book: the page's letter, the order of the first three letters, 2-20 letters, only the book's characters, close to what's printed. Votes keep only the reading and a hash of a random code made up by the browser. Readings that readers agree on are checked by hand before they change `catalogo_1849.csv`. The database's tables are in `schema.sql`. Votes are kept by entry position (page, column, row), so a re-layout that moves entries needs the votes remapped first.

### Reviewing reader votes

`tools/review_votes.py` is how votes reach the dataset: a person looks at each one first. It reads an export of the vote database (readings and per-day counts, never who voted) and opens a review page on your own machine: for each entry whose leading reading isn't the OCR reading and has at least two votes (`--min-votes`), the scan crop, the OCR reading and both scans', every reading with its votes, the entry's neighbours in the book's order, and what the book's rules (`lib/readings.js`, the same code the vote server runs) say about each. Keys: `a` accept, `e` edit, `r` reject, `s` skip. Decisions are saved in `review/votes/` (not in git), so a reviewed entry doesn't come back; accepted readings go to `review/votes/corrections.csv`, in the format of Apelyido's corrections file. `tools/votes.example.json` is a made-up export to try it on. `tools/review_reference.py` works the same way against another reading of the names, a reference list kept outside this repository: it pairs the two itself (including names a misread letter re-sorted), and the reference only says where to look, since what goes into a correction is what the reviewer reads on the 1849 scan.

    python tools/review_votes.py votes.json

The order, from votes to the published book:

1. **Export** the votes from the D1 database (readings and per-day voter counts only).
2. **Review** them with `tools/review_votes.py`.
3. **Hand** `corrections.csv` to the Apelyido pipeline, which adds it to its `data/catalogo/corrections.csv` and rebuilds the dataset. This tool never changes the dataset itself.
4. **Merge** there, then run its sync check: if entries moved to other columns or rows, remap the votes first (they're kept by position).
5. **Rebuild both:** copy the new `catalogo_1849.csv` here, run `tools/build_book.py`, and let Apelyido rebuild the crop strips in a new `/scan/<version>/` folder (bump `CROPS_V` and the `?v=` in `index.html`).
6. **Deploy in lockstep:** Apelyido first (its new crops), then this book.

## Further reading

- Narciso Clavería's decree of 21 November 1849, and Domingo Abella's introduction, in the *Catálogo alfabético de apellidos* (National Archives of the Philippines, 1973 reprint), pp. vii–xvi.
- Francis Alvarez Gealogo, "Looking for Claveria's Children: Church, State, Power, and the Individual in Philippine Naming Systems during the Late Nineteenth Century," in Zheng Yangwen and Charles J-H Macdonald, eds., *Personal Names in Asia: History, Culture and Identity* (Singapore: NUS Press, 2009), 37–51.
- Norman G. Owen, "The Principalia in Philippine History: Kabikolan, 1790–1898," *Philippine Studies* 22, no. 3 (1974).
- Ambeth R. Ocampo, "How Filipinos got their surnames," *Philippine Daily Inquirer*, 28 February 2020.

## Licence

The transcription is released under **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. You may use it for anything, including commercially, as long as you credit it, for example:

> *Catálogo alfabético de apellidos (1849), open transcription by Apelyido (apelyido.ruzcko.com), from the National Archives of the Philippines' 1973 reprint, digitized by Google from the University of Michigan's copy, with a second reading from the Filipinas Heritage Library's scan.*

The underlying 1849 text is in the public domain.

The code in `book/` and `tools/` is MIT-licensed (`LICENSE-CODE`). The book's typeface is IM Fell English by Igino Marini (SIL Open Font License), from the copies in `book/fonts`: the TTFs for the link-preview cards, and cut to Latin-1 as WOFF2 for the book.

## Corrections

Found a misread name? Open an issue or a pull request with the row's `book_page`, `column`, `row` and the correct reading, vote on it in the [virtual book](https://catalogo-1849.ruzcko.com), or write to hello@ruzcko.com.
