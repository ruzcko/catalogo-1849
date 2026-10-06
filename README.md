# Catálogo alfabético de apellidos (1849): an open transcription

A machine-read, partly hand-checked list of the surnames in the **Catálogo alfabético de apellidos**: the book of about 61,000 surnames that Governor-General Narciso Clavería's decree of 21 November 1849 distributed across the Philippines, so families without fixed surnames could take one.

> **Status: in progress.** The OCR of all 140 name-list pages is finishing; `catalogo_1849.csv` will be added here when it's done.

This is the first open, searchable list of the book's names that we know of. It powers the "The book" chapter of [Apelyido](https://apelyido.ruzcko.com).

## Source and credit

- **The book:** *Catálogo alfabético de apellidos* (Manila, 1849). Public domain.
- **The edition read:** the 1973 reprint by the **National Archives of the Philippines**.
- **The scan:** digitized and made available online by the **Filipinas Heritage Library (Ayala Foundation)**: [Catálogo alfabético de apellidos on Issuu](https://issuu.com/filipinasheritagelibrary/docs/catalogo_alfabetico_de_apellidos). Thank you for preserving this book and making it accessible.
- **Transcription:** OCR with [Surya](https://github.com/datalab-to/surya), corrected using the book's alphabetical order, checked against hand-typed pages, by [Apelyido](https://apelyido.ruzcko.com).

This repository contains only the transcribed text, not the page images.

## Read this before using it

**This is a first, machine-read version.** The only scan online is about 910 pixels wide, so many letters are blurred. Measured against two pages typed by hand, the OCR reads 82–89% of names exactly and 96–99% within one letter. Every row says how much to trust it (see `status`). A higher-resolution scan would make it near-perfect, and corrections are very welcome.

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
| `sure` | Confident OCR (≥ 0.8) **and** a surname people still carry in the Philippines today |
| `likely` | Confident OCR (≥ 0.8), but not a surname found today (often an old native name) |
| `best_effort` | Less confident OCR (0.6–0.8): probably right, check before relying on it |
| `low` | Low-confidence OCR (< 0.6): often wrong |

For most uses, keep `hand`, `checked`, `sure` and `likely`.

## Licence

The transcription is released under **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. You may use it for anything, including commercially, as long as you credit it, for example:

> *Catálogo alfabético de apellidos (1849), open transcription by Apelyido (apelyido.ruzcko.com), from the National Archives of the Philippines' 1973 reprint as digitized by the Filipinas Heritage Library.*

The underlying 1849 text is in the public domain.

## Corrections

Found a misread name? Open an issue or a pull request with the row's `issuu_page`, `column`, `row` and the correct reading, or write to hello@ruzcko.com.
