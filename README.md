# C&E Explorer

A web app for looking up cause & effect (C&E) signals: what a signal trips, and what trips it.
It reads the same Excel sheets as `CE_search_37.xlsm`. Everything happens inside the browser, so nothing is uploaded.

## Just use it

Open **`CE_Explorer.html`** (double-click it; Chrome or Edge recommended), then drop your C&E workbooks onto the page.

- You can import `CE_search_37.xlsm` on its own, or the separate `ESD CE 1.xlsx`, `ESD CE 2.xlsx`, `FG CE.xlsx`
  and `ESD Packages trip signals.xlsx` files.
- Imported data stays in the browser for next time. Importing a sheet with the same name again replaces the old copy
  (use this after a C&E revision).
- The file is fully self-contained (fonts included), so you can copy it to a shared drive or host it on any intranet
  web server. Each user's browser keeps its own imported data.

## What it does

| Old macro tool | C&E Explorer |
| --- | --- |
| Four separate search boxes (ESD causes, ESD effects, F&G causes, F&G effects) | One search box over every sheet, matching tags **and** descriptions |
| Exact tag text only | Ignores case and punctuation (`xs001` finds `_200XS001`); finds compound tags by any part (`_200XY081C` finds `_200XY080C/081C/082C/086C`) |
| Result saved as a new Excel file, then the workbook closes | Results on screen at once, with filters by action code and sheet, sorting, grouping, then **Export to Excel**, **Copy** or **Print** |
| — | Click any tag to jump to it, so you can walk cause → effect → cause |
| — | **Trip chain**: follows signals across sheets (e.g. an F&G detector → confirmed fire → ESD shutdown actions) and exports everything reached |
| — | **Matrix view** of each sheet with sticky headers, filters, and a cell readout (cause, action meaning, effect) |
| Trip-signal buttons per package | Trip-signal lists with links into the C&E and effect counts |
| — | Action code legend from the chart notes (X, T…, Tx/Ty/Tz, A, R, H) |
| — | Set points, ranges, MOS/SOS, voting, effect actions and chart notes on every signal |

Keyboard: <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> focuses search, <kbd>Enter</kbd> opens the top result, and the arrow keys move through results.

## Sheet layouts recognised

**C&E matrix**: a row with `TAG No.` in column C. Effect tags run to the right on that row, with effect
descriptions in the row above and effect numbers in the row below. Cause tag, description and number are in
columns A, B and C, with the action code where each cause row meets an effect column.

**Trip-signal list**: a row with `Cause Tag | Description` repeated for each group, and the group name in the row
above. A line with text but no description is treated as a sub-heading.

**Set points and notes** (optional), in either form:

- Info columns to the right of a C&E matrix, with the header in the effect-number row (row 3): `Set point`,
  `Range`, `Units`, `MOS`, `SOS`, `Healthy`, `Voting`, `Action`, `Notes` (note numbers) or `Note text`.
  Any other header there is shown too, under its own name.
- A **Signal data** sheet: a header row with `Tag` plus any of the columns above, and optionally `Role` and
  `Source`. Rows attach to the C&E signal with the same tag (punctuation and voting suffixes are ignored when
  that is unambiguous).
- Note numbers are looked up in a **Notes** sheet with `No.` and `Note` columns (and an optional `Sheet` column
  naming the C&E sheet the numbering belongs to).

**C&E chart converted from PDF** (Acrobat "Export PDF → Spreadsheet" or similar, imported as it comes out: one
`Table N` sheet per PDF page). A page is recognised by the `NOTES / ACTION / HEALTHY / DESCRIPTION / TAG No.`
labels above the effects and the `TAG No. | DESCRIPTION | SETTING | RANGE | MOS | SOS | HEALTHY | NOTES` header
above the causes. Pages that repeat the same causes (the plant shutdown levels) are merged into one matrix and the
others into a second, named after the file and the chart sheet numbers. Set points, sections, effect actions and the
numbered notes printed on each page are attached to the signals ("note 25 on sheets 1, 2"). Handled converter
quirks: marks of neighbouring columns merged into one cell (`X   X`), two pages in one sheet, landscape pages
written rotated, a page written twice, descriptions split over two cells, note numbers written `25.32`, and one
tag spelled differently on different pages (the spelling on the lowest sheet is used; the other is shown as
"Tag on chart"). Code in `src/lib/parseConverted.ts`.

F&G tags that carry their own voting and level, such as `FZ02DGC015/16_01 2OO2 @ 49%LEL`, show that set point
and voting automatically.

Set points appear in the signal header, in a data panel with all notes, as a column in result tables and
exports, and beside each cause in the matrix view.

Other sheets in a workbook are skipped. The "Imported files" page shows what was recognised in each file.

## Develop

Requires Node.js 18+.

```bash
npm install
npm run dev      # http://localhost:5173 with hot reload
npm run build    # writes dist/index.html (single self-contained file)
```

Stack: React 18 + TypeScript + Vite. Excel files are read with a small built-in parser (`src/lib/xlsxRead.ts`,
using `fflate` to unzip), which only reads cell values and never runs macros. Parsing runs in a Web Worker so the
page stays responsive. Results are exported with `src/lib/xlsxWrite.ts`.

```
src/
  lib/xlsxRead.ts     read .xlsx/.xlsm cell values
  lib/parseCE.ts      detect C&E matrices and trip-signal lists
  lib/ceIndex.ts      search index, cause→effect / effect→cause lookups, chain links
  lib/codes.ts        action code meanings and colours
  lib/signalData.ts   set points / notes: info columns, Signal data sheets, Notes sheets
  lib/tags.ts         tag normalising and compound-tag expansion
  pages/              Search, Signal, Matrix, Trip signals, Action codes, Imported files
  components/         shared UI and the trip-chain view
```

After `npm run build`, copy `dist/index.html` over `CE_Explorer.html` to update the shareable file.
