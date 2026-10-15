# Catálogo book design system

The rules for how the virtual book (catalogo-1849.ruzcko.com) looks and sounds. Read this before you change `book/style.css`, the page drawing in `book/book.js` (the 3D book, its covers and pages), `book/index.html`, or the link previews in `functions/og.js`, and update it when a rule changes.

The look below, **the museum wing in the book's own type**, was chosen on **2026-10-15** and built the same day (asset v45, branch `museum`). The values come from `book/style.css` as of 2026-10-15; rows marked **Proposed** are not in the code yet. The comparison is in `design/directions.html`; open it directly in a browser.

**Contrast rule:** text needs at least **4.5:1** against its background (3:1 for text 24 px and up, or 19 px bold and up). Icons need **3:1**. Check both themes.

## 1. The idea

**A gallery in the Prado, with the 1849 book as the exhibit.** Garnet walls like the Prado's old galleries (the museum whose collection holds Clavería's portrait), the book under a spotlight on a plinth inside a gilt frame, and the foreword as the wall text beside it. It should feel quiet, warm and a little grand, the way a good room makes you lower your voice. It should **not** feel like an app (no pills, no gradients for show), a theme park (no fake parchment, no candles) or Apelyido's Wrapped look (no purple, nothing bouncy).

- **The book is the exhibit.** It is always on show and always browsable. The foreword is optional wall text beside it on a wide screen, and below it on a phone.
- **Signature detail:** the gilt frame. A thin gold rule (`--gilt`) frames the room, and the same gold marks the placard being read and the kicker above each placard. Nothing else is gold.
- **Colour is rationed.** The room is garnet, the chrome (bars, panels, dialogs) is plaster, and the text is ink. Gold is only for the frame and the placard you're reading. The OCR-certainty shades (section 2, meaning colours) are the only other colours.
- Colour always means something. Don't add colour for decoration.
- **The type is older than the book.** IM Fell is Igino Marini's digital revival of the Fell Types, collected at Oxford in the 1670s: an old letterpress face, in keeping with a book printed in 1849. Its small caps carry the headings, the way old title pages do.
- **Deliberate exceptions to Claude's defaults:**
  - **Small-caps kickers and headings** in IM Fell English SC, because old title pages and museum labels set them this way. They are not monospace, and not numbered "01 / 02".
  - **Italics in body text** (Spanish words, book titles) follow the 1849 convention. Headlines are never italic.
  - The placard number in the foreword (the small "1", "2" before a kicker) stays: a museum labels its objects in order. It is a single figure, never "01".

What stays fixed whatever the look:
- **The book first.** The 3D book is visible and usable on every screen; nothing covers it except a dialog you opened.
- **Every history line has a source line** under it (see `README.md` and the rules in the user's "Apelyido story" note).
- **A surname is not a guide to ancestry.** No copy suggests it is.

## 2. Colour

Design tokens are the CSS variables in `:root`. Always use a token, never a raw hex, so dark mode keeps working. Checked as token pairs before the build and on the built pages after it (section 8).

### The room

The page around the book is the gallery wall, garnet in both themes ("the same room after hours" in dark mode). Text that sits on the wall (the foreword) uses the `--wall-*` tokens.

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--wall` | `#5e1c1f` | `#3a1214` | The page background: the gallery wall around the book |
| `--wall-ink` | `#f6efe8` | `#f6efe8` | Text on the wall: the foreword placards (11.1:1 / 14.4:1) |
| `--wall-muted` | `#dcc3bd` | `#d5b6b0` | Source lines and faint placards on the wall (7.6:1 / 8.7:1) |
| `--gilt` | `#e9c27a` | `#e9c27a` | The frame, the lit placard's kicker, the 60,000 counter (7.5:1 / 9.8:1) |
| `--plinth` | `#cfd3d1` | `#4a4344` | The plinth under the closed book (read by `book.js` for the 3D block) |
| `--pool` | gilt at 20% | gilt at 13% | The pool of light on the wall where the book stands |

### Chrome: bars, panels, dialogs

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--bg` | `#dcdfdd` | `#151314` | Plaster: dialogs' page, the area behind panels |
| `--surface` | `#eceeed` | `#1f1c1d` | Panels, dialogs, rows, inputs |
| `--surface-2` | `#cfd3d1` | `#2a2627` | Wells inside a surface: the page-number box, segmented controls |
| `--bar` | `--surface` at 92% | `--surface` at 92% | Top and bottom bars over the wall (blurred) |
| `--ink` | `#1c1a1a` | `#ece8e6` | Main text on plaster (12.9:1 / 15.2:1) |
| `--muted` | `#4f4b4a` | `#b3aba8` | Secondary text (6.4:1 on `--bg`, 7.4:1 on `--surface` / 8.2:1, 7.5:1) |
| `--line` | `#b9bdbb` | `#3a3536` | Borders and dividers |
| `--focus` | `--gilt` | `--gilt` | Keyboard focus ring |

### Accent

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--accent` | `#8e2a2c` | `#c8585a` | Garnet for marks that aren't text or fills behind text |
| `--accent-ink` | `#7a2224` | `#e07a7b` | Garnet as **text** on plaster (8.7:1 / 5.8:1), and the fill of primary buttons |
| `--on-accent` | `#ffffff` | `#151314` | Text on a garnet fill (`--accent-ink`): 10.1:1 / 6.4:1 |

### Meaning colours

The four OCR-certainty shades in the Tags view stay as they are today (`--s1`…`--s4` and the `SHADE` table in `book.js`): green for sure or read by a person, blue for likely, amber for the OCR's best guess, orange for blurry. They are drawn on the page paper, not on the wall, so the new room doesn't change them. The page paper itself (the book's pages and the 1973 cover photo) keeps its own colours: it is the exhibit, not the room.

**Places that keep their own copy of the palette:** `functions/og.js` (link previews: `PAPER`, `INK`, `RED` and a gold rule; **Proposed:** the garnet wall and gilt frame) and the cover and page drawing in `book.js` (canvas). The 3D plinth reads `--plinth` from the CSS, so it follows the theme.

## 3. Type

**Fonts (chosen 2026-10-15):** **IM Fell English** for words, **IM Fell English SC** for headings and kickers, and **EB Garamond** for numbers. IM Fell is an old letterpress face, in keeping with the book; EB Garamond is an old-style serif that sits well beside it and has **tabular lining figures** (to confirm in the build: `tnum` and `lnum` in the self-hosted files), so page numbers and the counter don't jump. IM Fell's figures are old-style and of uneven width. Licence: SIL OFL for all three. All three are self-hosted in `book/fonts/`: IM Fell (`OFL-IM-Fell.txt`) and EB Garamond's Latin subset, a variable font covering 400–600 (`EBGaramond-latin.woff2`, `OFL-EB-Garamond.txt`, downloaded 2026-10-15 from Google Fonts).

| Token | Use for |
|---|---|
| `--text` | Everything by default: IM Fell English |
| `--display` | Headings, kickers, the title in the top bar, dialog titles: IM Fell English SC |
| `--num` | Page numbers ("p. 58", "pp. 40–41"), the page label, counts, the 60,000 counter, vote tallies: EB Garamond with `font-variant-numeric: tabular-nums lining-nums` |

In "p. 58" only the number is in `--num`; "p." stays in the text face. The page label does this by wrapping its digits in `<span class="n">` (`updateBar` in `book.js`).

The fonts are set in 3 places. Change them together:
1. `book/style.css`: the `@font-face` rules and the font tokens, plus the `<link rel="preload">` lines in `book/index.html`.
2. `book/book.js`: `FONT` and `FONT_SC`, which draw the pages, the title page and the covers on canvas (canvas only draws fonts that are already loaded, so the page waits for `document.fonts.load`).
3. `functions/og.js`: the link previews.

### Sizes

A **type scale** is a short, fixed list of sizes, so the page looks planned. Today's CSS uses 13 sizes; this cuts it to 7.

| Role | Size | Face |
|---|---|---|
| The 60,000 counter | `clamp(40px, 8vw, 64px)` | `--num` |
| Placard heading | `clamp(26px, 3vw, 34px)` | `--display` |
| Dialog title, entry name | 24 | `--display` / `--text` |
| Placard body | 19 | `--text` |
| Body, buttons | 16 | `--text` |
| Small text, source lines | 14 | `--text` |
| Kickers | 15, `letter-spacing: .08em` | `--display` |

**Weights:** IM Fell has one weight (plus italic); never ask for bold, the browser fakes it. EB Garamond: 400 and 600.

## 4. Shape and space

| | Value |
|---|---|
| Corner radius | **2 px** for buttons, inputs, chips, rows and dialogs; **0** for the frame and placards. Picture frames and museum labels are square. Today's 12 pill radii (`999px`) go. |
| Spacing | Steps of 4: 4, 8, 12, 16, 24, 32, 48 |
| Page width | The book fills the room; text panels max 520 px; dialogs max 520 px |
| Breakpoints | 760 px: below it the foreword sits under the book (phone); above it, beside the book |
| Shadow | One soft shadow under the book and the plinth only; none on UI |

## 5. Components

- **The room (hero):** the garnet wall, a gilt frame inset 6 px from the edges (a 3 px rule and a fine one inside it), a soft pool of light, and the 3D book. **Shut, the book is seen as in an isometric drawing** (chosen 2026-10-15): turned 45 degrees and seen from about 35 degrees above, standing on its plinth; the long camera lens keeps it close to a true isometric. **Open, the view is straight down on the pages** and the plinth fades away. The foreword's placards scroll beside the book, the one being read in full colour and the rest faint.
- **Placards:** kicker in small caps (gold when lit), heading, body, source line in `--wall-muted`. No box: text sits on the wall, as museum wall text does.
- **Bars:** plaster at 92% over the wall, blurred, with the title in small caps on the left and icon buttons on the right; the bottom bar holds ‹, the page label and ›, and View.
- **Buttons:** one primary per view (garnet fill, `--on-accent` text, 2 px corners): "Open the book", "Vote". Secondary: plaster with a `--line` border: "Skip to the book", "Not sure, just show the votes". No pills.
- **Rows** (search hits, names list, vote tallies): `--surface`, a `--surface-2` box for the page number in `--num`.
- **Chips** (the certainty tag in the entry dialog): 2 px corners, a fact, not a button.
- **Dialogs:** centred, plaster, 2 px corners, a `--line` border; a bottom sheet on phones.
- **Placard marks** (the foreword's progress): a small diamond per placard, gold for the one being read, each in a 44 × 44 px button; down the left margin beside the book, in a row above the placards on a phone.
- **Icons:** **Tabler** (MIT, on Iconify), outline, stroke width 1.75, round caps; inline SVG with `currentColor`, drawn at 22 px in 44 px buttons: search, contrast (theme), help, chevron left and right, x (close), arrows-minimize (zoom out). New icons come from the same pack; never hand-drawn.

## 6. Share cards and link previews

- **Link previews** (`functions/og.js`, 1200 × 630): today old paper with a brown double rule. Proposed: the garnet wall, a gilt double rule, the page's names on a paper panel, IM Fell. Check its text colours against the wall separately; they live in JS, so the lint and browser checks don't see them.
- No Story cards yet. If added: 1080 × 1920, content kept out of the top 14% and bottom 20%.

## 7. Voice

- **Plain and specific.** "Page 58. Read from the scan, column 3." Not "Discover the names of history!"
- **Honest about what we don't know.** The OCR's certainty is always shown in Tags view: "Best guess", "Blurry". "Some lines are blurry. You can help read them."
- **Every history line has its source** right under it: "Source: the decree, Arts. 1–3, 1973 reprint, pp. x–xi".
- **Short buttons that say what happens:** "Open the book", "Skip to the book", "Vote", "Go".
- **Avoid:** "seamless", "unlock", "journey", "elevate", "game-changer", "Get started", exclamation marks, emoji in the interface, and anything that suggests a surname shows ancestry.

## 8. Accessibility

Most visitors are on phones.

### Tap targets

- Every control has a hit area of at least **44 × 44 px**.
- A control can *look* smaller: give it an invisible `::after` hit area centred on it.
- Neighbouring controls' centres are at least 44 px apart.
- Exceptions: links inside a sentence (source lines, the About text). Names on the 3D pages are tapped on the canvas; the names list (the first button) gives a 44 px list for keyboards and screen readers.
- **Faint placards** (the foreword's placards above and below the one being read, at 40% opacity) measure about 2:1. They are previews: each reaches full contrast (11:1) when it's scrolled to the middle and lit.

### Contrast fixes made on 2026-10-15

| Problem | Fix |
|---|---|
| "List the names on these pages" (and every filled button): `--on-accent` on `--accent` was 4.4:1 in dark mode | Filled buttons use `--accent-ink` as their fill: 6.4:1 dark, 10.1:1 light |
| The foreword's placard marks were 44 × 30 px | 44 × 44 px buttons |
| The View panel's (i) buttons had a 42 × 43 px tap area | Their invisible `::after` area grows to 48 px |
| Short names in the names list were narrower than 44 px | Each name fills its column (at least 44 px tall) |
| On a narrow phone (320 px) the row of seven placard marks ran past the edge | The row starts 6 px from the edge: it fits from 320 px up |

### How to check

**2026-10-15**, on the built pages served locally (asset v45): the design lint on `book/` (3 files, 0 errors, 0 warnings); the contrast and tap-target snippets from the `design-brief` skill in **both themes** at **1024 px** and **375 px**, with the reading view, the foreword, the About, View (with an (i) open), Go to, names list and entry dialogs, and the search results each open. Contrast: about 2,500 text elements and icons checked across those states, **0 failures** after the fixes above (the faint placards are the listed exception). Tap targets: every control at least 44 × 44 px and **0 overlaps**, including all 852 names in the names list. Not yet checked: the link preview (`functions/og.js`, still the old palette).

## History

- **Until 2026-10-15: old paper and brown ink.** A warm light room (`#f1eee8`) with a faint dot grid, a brown accent, IM Fell everywhere. Chosen on 2026-10-11 over Apelyido's purple walls.
- **2026-10-15: the museum wing in the book's own type** (this file). Compared in `design/directions.html`: A · Museum wing (Bodoni and a grotesque on garnet), B · Reading room (typed call slips, archival green), C · Parish office, 1849 (rag paper, IM Fell). Picked: A's room with C's fonts.
