// Reads a C&E chart that was converted from PDF to Excel (Acrobat / online converters), as it comes out of the
// converter — one "Table N" sheet per PDF page — and turns it into matrices plus set points and notes.
//
// Page layout recognised (labels as printed on the chart):
//
//            col A     col B …        SETTING RANGE MOS SOS HEALTHY NOTES  | label col | effect cols →
//   rows ↑                                                               | NOTES     | 2,8   …
//                                                                        | ACTION    | CLOSE …
//                                                                        | HEALTHY   | TRUE  …
//                                                                        | DESCRIPTION | SDV …
//                                                                        | TAG No.   | _200XY063A/B …
//   header   TAG No.   DESCRIPTION    SETTING RANGE MOS SOS HEALTHY NOTES  |           | 1  2  3 …
//   rows ↓   _200XS001 LEVEL 0 …                    TRUE    1          | 2 (row no.) | X  T  …
//
// Converter quirks handled:
//  • marks of neighbouring columns merged into one cell ("X   X") → spread over the next effect columns
//  • two PDF pages stacked in one sheet → split at each effect header
//  • landscape pages written rotated by 90° (cause tags across the top, effects down the side) → turned back
//  • a page written twice, the second copy as a few huge multi-line cells → ignored (no effect header)
//  • a description split over two cells → joined
//  • note numbers written "25.32" for "25, 32"
import type { RawSheet } from './xlsxRead';
import type { Matrix, SheetReport, Signal, SignalData, SignalNote } from './model';

type Grid = (string | undefined)[][];
const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
const up = (v: string | undefined) => clean(v).toUpperCase();
const isTagLabel = (v: string | undefined) => /^T?AG\s*N(O|UMBER)\.?$/.test(up(v).replace(/\s+/g, ' '));
const isLabel = (v: string | undefined, ...names: string[]) => names.includes(up(v).replace(/[.:]$/, ''));
const TITLE = /AS CONFIGURED|CAUSE AND EFFECT CHART|^PREPARED BY$|^DOCUMENT NUMBER|^APPROVED BY$/;
const CODE = /^(X|XS|X\d|T|T\d{1,2}|TX|TY|TZ|A|P|H|R|C|O|S|M|MO|MC)$/i;
const DELETED = '\u0000deleted';
const BLANK_MARK = /^(N\/?A|-+|—)$/i;

interface Block {
  grid: Grid;
  /** effect "TAG No." label cell */
  eR: number;
  eC: number;
  /** cause header row ("TAG No. | DESCRIPTION | SETTING …") */
  hR: number;
  /** columns of the block: cause "TAG No." column … first column after it (side-by-side pages after rotation) */
  colStart: number;
  colEnd: number;
  /** last row of the block (stacked pages) */
  rowEnd: number;
  /** first row of the block (stacked pages) */
  rowStart: number;
  rotated: boolean;
}

export interface ConvertedPage {
  sheet: string;
  /** sheet number printed in the title block, or counted on from the previous page */
  sheetNo: number;
  rotated: boolean;
  causes: { tag: string; desc: string; num: string; section: string; values: Record<string, string>; refs: string[] }[];
  effects: { tag: string; desc: string; num: string; values: Record<string, string>; refs: string[] }[];
  links: [number, number, string][];
  notes: Map<string, string>;
}

// ---------------------------------------------------------------- geometry
function width(g: Grid) {
  let w = 0;
  for (const r of g) if (r && r.length > w) w = r.length;
  return w;
}

/** Turn a rotated page back: cause tags run along a row towards the left; afterwards they run down a column. */
function rotate(g: Grid): Grid {
  const W = width(g);
  const out: Grid = Array.from({ length: W }, () => []);
  for (let r = 0; r < g.length; r++) {
    const row = g[r] ?? [];
    for (let c = 0; c < row.length; c++) if (row[c] !== undefined) out[W - 1 - c][r] = row[c];
  }
  return out;
}

/** Effect header: "TAG No." with DESCRIPTION and HEALTHY / ACTION above it in the same column. */
function effectAnchors(g: Grid): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  for (let r = 1; r < g.length; r++) {
    const row = g[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (!isTagLabel(row[c])) continue;
      let desc = false, other = false;
      for (let k = 1; k <= 6 && r - k >= 0; k++) {
        const v = g[r - k]?.[c];
        if (isLabel(v, 'DESCRIPTION')) desc = true;
        if (isLabel(v, 'HEALTHY', 'ACTION', 'NOTES')) other = true;
      }
      if (desc && other) out.push({ r, c });
    }
  }
  return out;
}

/** Rotated page: "TAG No." with DESCRIPTION right under it and SETTING / RANGE further down the same column. */
function looksRotated(g: Grid): boolean {
  for (let r = 0; r < g.length; r++) {
    const row = g[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (!isTagLabel(row[c])) continue;
      if (!isLabel(g[r + 1]?.[c], 'DESCRIPTION')) continue;
      for (let k = 2; k <= 6; k++) if (isLabel(g[r + k]?.[c], 'SETTING', 'RANGE')) return true;
    }
  }
  return false;
}

function causeHeaderRow(g: Grid, eR: number, eC: number): number {
  for (let r = eR + 1; r <= eR + 4 && r < g.length; r++) {
    const row = g[r] ?? [];
    let d = false, s = false;
    for (let c = 0; c < Math.min(row.length, eC); c++) {
      if (isLabel(row[c], 'DESCRIPTION')) d = true;
      if (isLabel(row[c], 'SETTING', 'RANGE', 'MOS', 'HEALTHY')) s = true;
    }
    if (d && s) return r;
  }
  return -1;
}

export function findBlocks(sheet: RawSheet): Block[] {
  let grid = sheet.rows;
  let rotated = false;
  let anchors = effectAnchors(grid);
  if (!anchors.length && looksRotated(grid)) {
    grid = rotate(grid);
    rotated = true;
    anchors = effectAnchors(grid);
  }
  const blocks: Block[] = [];
  for (const a of anchors) {
    const hR = causeHeaderRow(grid, a.r, a.c);
    if (hR < 0) continue;
    // the page's cause "TAG No." is the nearest one left of its effect labels
    let colStart = 0;
    for (let c = a.c - 1; c >= 0; c--) if (isTagLabel(grid[hR]?.[c])) { colStart = c; break; }
    blocks.push({ grid, eR: a.r, eC: a.c, hR, colStart, colEnd: Infinity, rowStart: 0, rowEnd: grid.length - 1, rotated });
  }
  // pages side by side (rotated sheets) end where the next page's cause columns start; stacked pages end above the next
  const byCol = [...blocks].sort((x, y) => x.eC - y.eC);
  for (let i = 0; i < byCol.length - 1; i++) {
    const nx = byCol[i + 1];
    if (nx.eC > byCol[i].eC + 3 && Math.abs(nx.eR - byCol[i].eR) < 10) byCol[i].colEnd = nx.colStart;
  }
  const byRow = [...blocks].sort((x, y) => x.eR - y.eR);
  for (let i = 0; i < byRow.length - 1; i++) {
    const nx = byRow[i + 1];
    if (nx.eR > byRow[i].hR) {
      byRow[i].rowEnd = Math.min(byRow[i].rowEnd, nx.eR - 6);
      nx.rowStart = byRow[i].rowEnd + 1;
    }
  }
  return blocks;
}

// ---------------------------------------------------------------- reading a block
/** Splits merged cells ("X   X") over the next columns of `cols`. Returns col → text. */
function spread(row: (string | undefined)[], cols: number[], lo: number, hi: number, codesOnly: boolean): Map<number, string> {
  const out = new Map<number, string>();
  const at = new Map(cols.map((c, i) => [c, i]));
  for (let c = lo; c < Math.min(hi, row.length); c++) {
    const raw = row[c];
    if (raw === undefined) continue;
    const v = clean(raw);
    if (!v) continue;
    let i = at.get(c);
    if (i === undefined) {
      // text slightly off its column: snap to the nearest effect column that is still free
      let best = -1, bd = 3;
      cols.forEach((cc, k) => {
        const d = Math.abs(cc - c);
        if (d < bd && !out.has(cc) && clean(row[cc]) === '') (best = k), (bd = d);
      });
      if (best < 0) continue;
      i = best;
    }
    const toks = v.split(' ');
    const split = toks.length > 1 && (!codesOnly || toks.every((t) => CODE.test(t))) && i + toks.length <= cols.length &&
      toks.slice(1).every((_, k) => clean(row[cols[i! + k + 1]]) === '' || cols[i! + k + 1] === c);
    if (split) toks.forEach((t, k) => out.set(cols[i! + k], t));
    else out.set(cols[i], v);
  }
  return out;
}

/** Sorts the words of a cause info cell: "65 0-250" under SETTING is a set point and a range. */
function classify(v: string, header: string): [string, string][] {
  const out: [string, string][] = [];
  const rest: string[] = [];
  // keep units with their number: "0-100 %" → "0-100%"
  const joined = v
    .replace(/(\d)\s+(%|BARG?|MM|°C|DEG ?C)(?=\s|$)/gi, '$1$2')
    .replace(/(-?\d+(?:\.\d+)?)\s+-\s+(-?\d+(?:\.\d+)?)/g, '$1\u00a0-\u00a0$2'); // "-40 - 40" is one range
  for (const t0 of joined.split(' ')) {
    const t = t0.replace(/\u00a0/g, ' ');
    if (/^(TRUE|FALSE)$/i.test(t)) out.push(['Healthy', t.toUpperCase()]);
    else if (/^MOS$/i.test(t)) out.push(['MOS', 'MOS']);
    else if (/^SOS$/i.test(t)) out.push(['SOS', 'SOS']);
    else if (/^-?\d+(\.\d+)?\s*-\s*-?\d+(\.\d+)?(%|BARG?|MM|°C|DEG ?C)?$/i.test(t) && header !== 'Notes') out.push(['Range', t]);
    else rest.push(t);
  }
  if (rest.length) {
    const r = rest.join(' ');
    // note numbers that slipped under the HEALTHY / SOS heading
    const asNotes = header === 'Notes' || (['Healthy', 'MOS', 'SOS'].includes(header) && /^\d{1,2}([.,]\d{1,2})*$/.test(r));
    out.push([asNotes ? 'Notes' : header === 'Range' && !out.some((x) => x[0] === 'Set point') ? 'Set point' : header, r]);
  }
  return out;
}

function splitRefs(v: string): string[] {
  return (clean(v).match(/\d{1,3}[A-Z]?/g) ?? []).filter((x, i, a) => a.indexOf(x) === i);
}

/** "NOTES:\n1. DELETED\n2. AFTER ESD …" → { 1: …, 2: AFTER ESD … }.
 *  Handles "16- TEXT", "14.TEXT", "2) TEXT", deleted lists ("6,7,8,9 DELETED"), notes glued to the previous line
 *  ("… 1 HR26. AFTER …") and a second copy of the list (fills gaps only). */
function readNotes(cells: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const lines: string[] = [];
  for (const cell of cells)
    for (const l of cell.split(/\r?\n/)) {
      if (/^\s*NOTES?\s*:/i.test(l)) lines.push('\u0000');
      const t = l.replace(/^\s*NOTES?\s*:/i, '').replace(/\s+/g, ' ').trim().replace(/^\.(?=\d)/, '');
      if (t) lines.push(t);
    }
  let cur = '';
  let last = 0;
  let fillOnly = false;
  const start = /^(\d{1,2})\s*(?:[.)]|-(?=\s*[A-Z]))\s*(.*)$/;
  for (const line0 of lines) {
    if (line0 === '\u0000') {
      if (out.size) (fillOnly = true), (last = 0), (cur = '');
      continue;
    }
    // split off notes glued to the end of a line: expected number only
    const segs: string[] = [];
    let rest = line0;
    let expect = (Number(start.exec(rest)?.[1] ?? last) || last) + 1;
    for (;;) {
      const re = /(?:[A-Z)\].%]|\s)(\d{1,2})\s*[.)]\s*(?=[A-Z(%_])/g;
      let g: RegExpExecArray | null;
      let cut = -1;
      while ((g = re.exec(rest))) {
        if (g.index > 0 && Number(g[1]) === expect) {
          cut = g.index + (/\s/.test(g[0][0]) ? 1 : 1);
          break;
        }
      }
      if (cut < 0) break;
      segs.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
      expect++;
    }
    segs.push(rest);
    for (const line of segs) {
      if (!line) continue;
      // "6,7,8,9 DELETED", "3,4,6,8 … 17, DELETED"
      if (/^\d{1,2}\s*\.?\s*,[\d,\s.]*DELETED\.?$/i.test(line)) {
        const nums = (line.match(/\d{1,2}/g) ?? []).map(Number);
        for (const x of nums) if (!out.has(String(x))) out.set(String(x), DELETED);
        last = Math.max(last, Math.min(...nums));
        cur = '';
        continue;
      }
      const m = start.exec(line);
      const n = m ? Number(m[1]) : 0;
      if (m && n > last && n <= last + 15) {
        last = n;
        cur = fillOnly && out.has(m[1]) && out.get(m[1]) !== DELETED ? '' : m[1];
        if (cur) out.set(cur, /^DELETED\.?$/i.test(m[2].trim()) ? DELETED : m[2]);
        if (out.get(cur) === DELETED) cur = '';
        continue;
      }
      // a legend line ("T3: 3 HOURS TIME DELAY", "A: ABORT …") ends the note list
      if (/^[A-Z][A-Z0-9]{0,2}\s*:/i.test(line)) {
        cur = '';
        continue;
      }
      if (cur) out.set(cur, `${out.get(cur)} ${line}`.trim());
    }
  }
  for (const [k, v] of out) out.set(k, v.replace(/\s+/g, ' ').trim());
  return out;
}

function sheetNumber(b: Block): number | null {
  const g = b.grid;
  for (let r = 0; r < g.length; r++) {
    const row = g[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (!/^SHEET\s*(NUMBER|NO\.?)$/i.test(clean(row[c]))) continue;
      if (b.rotated ? false : r < b.eR || r > b.rowEnd + 8) continue;
      let seen = 0;
      for (let k = c + 1; k < row.length && seen < 6; k++) {
        const v = clean(row[k]);
        if (!v) continue;
        seen++;
        if (/^\d{1,3}$/.test(v)) return Number(v);
        if (/^OF$/i.test(v)) break;
      }
    }
  }
  return null;
}

function readBlock(sheet: RawSheet, b: Block): ConvertedPage {
  const g = b.grid;
  const eRow = g[b.eR] ?? [];
  const hi = Math.min(b.colEnd, width(g));
  // effect columns
  const effCols: number[] = [];
  for (let c = b.eC + 1; c < Math.min(hi, eRow.length); c++) if (clean(eRow[c])) effCols.push(c);
  // labelled rows above the effect tags
  const labelRow: Record<string, number> = {};
  for (let k = 1; k <= 6 && b.eR - k >= 0; k++) {
    const v = up(g[b.eR - k]?.[b.eC]).replace(/[.:]$/, '');
    if (['DESCRIPTION', 'HEALTHY', 'ACTION', 'NOTES'].includes(v) && labelRow[v] === undefined) labelRow[v] = b.eR - k;
  }
  const descTop = labelRow.DESCRIPTION ?? b.eR - 1;
  const numbers = spread(g[b.hR] ?? [], effCols, b.eC + 1, hi, false);
  const effects: ConvertedPage['effects'] = effCols.map((c) => {
    const desc: string[] = [];
    for (let r = descTop; r < b.eR; r++) {
      const v = clean(g[r]?.[c]);
      if (v) desc.push(v);
    }
    const values: Record<string, string> = {};
    const act = labelRow.ACTION !== undefined ? clean(g[labelRow.ACTION]?.[c]) : '';
    const hl = labelRow.HEALTHY !== undefined ? clean(g[labelRow.HEALTHY]?.[c]) : '';
    if (act) values.Action = act;
    if (hl) values.Healthy = hl;
    const refs = labelRow.NOTES !== undefined ? splitRefs(clean(g[labelRow.NOTES]?.[c])) : [];
    return { tag: clean(eRow[c]), desc: desc.join(' '), num: numbers.get(c) ?? '', values, refs };
  });

  // cause header columns
  const hRow = g[b.hR] ?? [];
  let tagCol = b.colStart, descCol = b.colStart + 1;
  const infoCols: { c: number; label: string }[] = [];
  for (let c = b.colStart; c < Math.min(hRow.length, b.eC); c++) {
    const v = up(hRow[c]).replace(/[.:]$/, '');
    if (isTagLabel(hRow[c])) tagCol = c;
    else if (v === 'DESCRIPTION') descCol = c;
    else if (v === 'SETTING' || v === 'SET POINT') infoCols.push({ c, label: 'Set point' });
    else if (v === 'RANGE') infoCols.push({ c, label: 'Range' });
    else if (v === 'MOS') infoCols.push({ c, label: 'MOS' });
    else if (v === 'SOS') infoCols.push({ c, label: 'SOS' });
    else if (v === 'HEALTHY') infoCols.push({ c, label: 'Healthy' });
    else if (v === 'NOTES' || v === 'NOTE') infoCols.push({ c, label: 'Notes' });
  }
  const firstInfo = infoCols.length ? Math.min(...infoCols.map((x) => x.c)) : b.eC;

  const causes: ConvertedPage['causes'] = [];
  const spill: { label: string; v: string }[][] = [];
  const links: [number, number, string][] = [];
  let section = '';
  let prevHeading = false;
  const recent: string[] = [];
  let causeEnd = b.hR;
  for (let r = b.hR + 1; r <= b.rowEnd && r < g.length; r++, causeEnd = r - 1) {
    const row = g[r] ?? [];
    if (row.some((v, c) => c < hi && v && TITLE.test(up(v)))) break;
    const rawTag = row[tagCol] ?? '';
    if (rawTag.includes('\n')) break; // a garbled duplicate of the page starts here
    let tag = clean(rawTag);
    if (isTagLabel(tag)) break;
    const desc = row.slice(Math.max(b.colStart, Math.min(tagCol, descCol) + (tagCol < descCol ? 1 : 0)), firstInfo).map(clean).filter(Boolean)
      .filter((v) => v !== tag).join(' ').replace(/\s+/g, ' ').trim();
    const marks = spread(row, effCols, b.eC + 1, hi, true);
    for (const [c, v] of marks) if (BLANK_MARK.test(v)) marks.delete(c);
    if (!tag) {
      if (!marks.size) {
        // heading row; two stacked headings are joined
        if (desc) {
          section = prevHeading && section ? `${section} / ${desc}` : desc;
          prevHeading = true;
        }
        continue;
      }
      if (!desc) continue;
      // a voting row such as "2OO2 VIBRATION ALARM HIGH" under the sensors it votes on
      const vote = /^(\d+\s*OO\s*\d+)/i.exec(desc)?.[1].replace(/\s/g, '').toUpperCase() ?? 'VOTE';
      const [a, bb] = recent.slice(-2);
      let i = 0;
      if (a && bb) while (i < Math.min(a.length, bb.length) && a[i] === bb[i]) i++;
      tag = a && bb ? `${a}/${i ? bb.slice(i) : bb} ${vote}` : `${a || 'ROW ' + (r + 1)} ${vote}`;
    } else recent.push(tag);
    prevHeading = false;
    const values: Record<string, string> = {};
    const refs: string[] = [];
    const extra: { label: string; v: string }[] = [];
    for (let c = firstInfo; c < b.eC; c++) {
      const v = clean(row[c]);
      if (!v) continue;
      // value belongs to the nearest header at or left of it, unless its content says otherwise
      let lab: { c: number; label: string } | undefined;
      for (const x of infoCols) if (x.c <= c && (!lab || x.c > lab.c)) lab = x;
      if (!lab) continue;
      for (const [label, tok] of classify(v, lab.label)) {
        if (label === 'Notes') refs.push(...splitRefs(tok).filter((x) => !refs.includes(x)));
        else if (!values[label]) values[label] = tok;
        else if (b.rotated) extra.push({ label, v: tok }); // a cell shared with the next cause column
        else values[label] = `${values[label]} ${tok}`;
      }
    }
    const ci = causes.length;
    causes.push({ tag, desc, num: clean(row[b.eC]), section, values, refs });
    spill.push(extra);
    for (const [c, v] of marks) links.push([ci, effCols.indexOf(c), v]);
  }

  // rotated pages: a value cell spanning two cause columns belongs partly to the cause printed next to it
  spill.forEach((ex, i) => {
    for (const { label, v } of ex) {
      for (let k = i - 1; k >= 0; k--) {
        if (!causes[k].values[label]) {
          causes[k].values[label] = v;
          break;
        }
      }
    }
  });

  // notes text: cells starting "NOTES:" or "n. …" anywhere on the page
  const noteCells: string[] = [];
  const rLo = b.rotated ? 0 : b.rowStart;
  const rHi = b.rotated || b.rowEnd < g.length - 1 ? b.rowEnd : g.length - 1;
  const numbered = /^\s*\.?\d{1,2}\s*[.,)-]\s*\S/;
  for (let r = rLo; r <= rHi && r < g.length; r++) {
    const row = g[r] ?? [];
    const inCauses = r > b.hR && r <= causeEnd;
    for (let c = 0; c < row.length; c++) {
      if (b.rotated && (c >= hi || c < b.colStart)) continue;
      const v = row[c];
      if (!v) continue;
      if (/^\s*NOTES?\s*:/i.test(v)) noteCells.push(v);
      else if (!inCauses && c < b.eC && numbered.test(v) && v.trim().length > 8 && (b.rotated ? v.length > 25 : true))
        noteCells.push(v.replace(/^\s*\./, ''));
    }
  }
  return { sheet: sheet.name, sheetNo: 0, rotated: b.rotated, causes, effects, links, notes: readNotes(noteCells) };
}

// ---------------------------------------------------------------- whole workbook
export interface ConvertedResult {
  matrices: Matrix[];
  signalData: SignalData[];
  report: SheetReport[];
  /** sheets this reader took (the generic reader skips them) */
  handled: Set<string>;
}

const compact = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');
const lastNum = (t: string) => ((t.match(/\d+/g) ?? ['']).pop() ?? '').replace(/^0+/, '');
const dnorm = (d: string) => d.toUpperCase().replace(/[^A-Z0-9]/g, '');

function qualifier(desc: string): string {
  const d = desc.toUpperCase();
  for (const [k, q] of [['HIGH HIGH', 'HH'], ['LOW LOW', 'LL'], ['HIGH', 'H'], ['LOW', 'L']] as const) if (d.includes(k)) return q;
  return '';
}

function sheetList(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  return (s.length > 1 ? 'sheets ' : 'sheet ') + s.join(', ');
}

function rangeLabel(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] <= s[j] + 2) j++;
    parts.push(i === j ? `${s[i]}` : `${s[i]}–${s[j]}`);
    i = j + 1;
  }
  return (s.length > 1 ? 'sheets ' : 'sheet ') + parts.join(', ');
}

export function isConvertedWorkbook(sheets: RawSheet[]): boolean {
  return sheets.some((s) => findBlocks(s).length > 0);
}

export function parseConverted(sheets: RawSheet[], file: string): ConvertedResult {
  const res: ConvertedResult = { matrices: [], signalData: [], report: [], handled: new Set() };
  const pages: ConvertedPage[] = [];
  let lastNo = 0;
  for (const s of sheets) {
    const blocks = findBlocks(s);
    if (!blocks.length) {
      // blank overflow pages still carry the sheet number
      const t = s.rows.flat().map(clean).join(' ');
      const m = /SHEET\s*NUMBER\s+(\d{1,3})\s+OF/i.exec(t);
      if (m) lastNo = Math.max(lastNo, Number(m[1]));
      continue;
    }
    res.handled.add(s.name);
    const ordered = [...blocks].sort((a, b) => (a.rotated ? a.eC - b.eC : a.eR - b.eR));
    const got: ConvertedPage[] = [];
    for (const b of ordered) {
      const p = readBlock(s, b);
      const n = ordered.length === 1 ? sheetNumber(b) : null;
      p.sheetNo = n && n > lastNo - 1 && n <= lastNo + 3 ? n : lastNo + 1;
      lastNo = p.sheetNo;
      if (p.causes.length && p.effects.length) got.push(p);
    }
    pages.push(...got);
    res.report.push({
      file,
      sheet: s.name,
      status: got.length ? 'matrix' : 'skipped',
      detail: got.length
        ? got.map((p) => `chart sheet ${p.sheetNo}${p.rotated ? ' (rotated page)' : ''}: ${p.causes.length} causes × ${p.effects.length} effects, ${p.links.length} marks`).join('; ')
        : 'Converted page with no readable causes or effects',
    });
  }
  if (!pages.length) return res;

  // pages that repeat the same causes (plant shutdown levels against every effect) form one matrix, the rest another
  const pageCount = new Map<string, number>();
  for (const p of pages) for (const t of new Set(p.causes.map((c) => compact(c.tag)))) pageCount.set(t, (pageCount.get(t) ?? 0) + 1);
  const shared = (p: ConvertedPage) => p.causes.filter((c) => (pageCount.get(compact(c.tag)) ?? 0) >= 3).length >= p.causes.length / 2;
  const groups = [pages.filter(shared), pages.filter((p) => !shared(p))].filter((g) => g.length);

  // one instrument spelled differently on different pages (_XS7000 / _200XS7000): same row no. + description + number
  const alias = new Map<string, string>();
  for (const grp of groups) {
    const byRow = new Map<string, Map<string, number>>();
    const cnt = new Map<string, number>();
    // the spelling on the lowest chart sheet wins (it is the one the other C&E files and trip lists use)
    const first = new Map<string, number>();
    for (const p of grp)
      for (const c of p.causes) {
        cnt.set(c.tag, (cnt.get(c.tag) ?? 0) + 1);
        if (!first.has(c.tag)) first.set(c.tag, p.sheetNo);
        const k = `${c.num}|${dnorm(c.desc)}|${lastNum(c.tag)}`;
        if (!byRow.has(k)) byRow.set(k, new Map());
        byRow.get(k)!.set(c.tag, (byRow.get(k)!.get(c.tag) ?? 0) + 1);
      }
    for (const m of byRow.values()) {
      if (m.size < 2) continue;
      const main = [...m.keys()].sort((a, b) => (first.get(a) ?? 0) - (first.get(b) ?? 0) || (cnt.get(b) ?? 0) - (cnt.get(a) ?? 0))[0];
      for (const t of m.keys()) if (t !== main) alias.set(t, main);
    }
    const byCompact = new Map<string, string[]>();
    for (const t of cnt.keys()) byCompact.set(compact(t), [...(byCompact.get(compact(t)) ?? []), t]);
    for (const ts of byCompact.values()) {
      if (ts.length < 2) continue;
      const main = ts.sort((a, b) => (first.get(a) ?? 0) - (first.get(b) ?? 0) || (cnt.get(b) ?? 0) - (cnt.get(a) ?? 0))[0];
      for (const t of ts) if (t !== main && !alias.has(t)) alias.set(t, main);
    }
  }

  const base = file.replace(/\.(xlsx|xlsm)$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const data = new Map<string, {
    tag: string; role: 'cause' | 'effect'; source: string; values: Map<string, string[]>; sheets: number[];
    notes: Map<string, { ref: string; sheets: number[] }>;
  }>();
  const addData = (tag: string, role: 'cause' | 'effect', source: string, vals: Record<string, string>, refs: string[], p: ConvertedPage) => {
    const key = `${role}|${source}|${tag}`;
    if (!data.has(key)) data.set(key, { tag, role, source, values: new Map(), sheets: [], notes: new Map() });
    const d = data.get(key)!;
    d.sheets.push(p.sheetNo);
    for (const [k, v] of Object.entries(vals)) {
      if (!v) continue;
      const arr = d.values.get(k) ?? [];
      arr.push(v);
      d.values.set(k, arr);
    }
    for (const ref of refs) {
      if (p.notes.get(ref) === DELETED) continue; // the chart marks this note as deleted
      const text = p.notes.get(ref) ?? `(note ${ref} is not printed on chart sheet ${p.sheetNo})`;
      const k = `${ref}|${text.toUpperCase()}`;
      if (!d.notes.has(k)) d.notes.set(k, { ref, sheets: [] });
      d.notes.get(k)!.sheets.push(p.sheetNo);
    }
  };

  for (const grp of groups) {
    const name = groups.length > 1 ? `${base} (${rangeLabel(grp.map((p) => p.sheetNo))})` : base;
    const causes: Signal[] = [], effects: Signal[] = [];
    const cIdx = new Map<string, number>(), eIdx = new Map<string, number>();
    const cell = new Map<string, string>();
    for (const p of grp) {
      // same tag twice on one page (HIGH HIGH and LOW LOW rows) → add the qualifier
      const seen = new Map<string, number>();
      for (const c of p.causes) seen.set(c.tag, (seen.get(c.tag) ?? 0) + 1);
      const cmap = p.causes.map((c) => {
        let t = alias.get(c.tag) ?? c.tag;
        if ((seen.get(c.tag) ?? 0) > 1 && qualifier(c.desc)) t = `${t} (${qualifier(c.desc)})`;
        const k = t.toUpperCase();
        if (!cIdx.has(k)) {
          cIdx.set(k, causes.length);
          causes.push({ tag: t, desc: c.desc, num: c.num });
        }
        const vals = { ...c.values, ...(c.section ? { Section: c.section } : {}) };
        addData(t, 'cause', name, vals, c.refs, p);
        if (t !== c.tag) addData(t, 'cause', name, { 'Tag on chart': c.tag }, [], p);
        return cIdx.get(k)!;
      });
      const emap = p.effects.map((e) => {
        const k = e.tag.toUpperCase();
        if (!eIdx.has(k)) {
          eIdx.set(k, effects.length);
          effects.push({ tag: e.tag, desc: e.desc, num: e.num });
        }
        addData(e.tag, 'effect', name, e.values, e.refs, p);
        return eIdx.get(k)!;
      });
      for (const [ci, ei, v] of p.links) cell.set(`${cmap[ci]}|${emap[ei]}`, v);
    }
    const links: [number, number, string][] = [...cell].map(([k, v]) => {
      const [a, b] = k.split('|').map(Number);
      return [a, b, v];
    });
    res.matrices.push({ id: name, name, source: file, causes, effects, links });
  }

  for (const d of data.values()) {
    const values: { label: string; value: string }[] = [];
    const order = ['Section', 'Set point', 'Range', 'MOS', 'SOS', 'Healthy', 'Action', 'Tag on chart'];
    for (const k of [...d.values.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      const all = d.values.get(k)!;
      const uniq = [...new Set(all)];
      // the section heading can be lost on one page: take the one most pages agree on
      const value = k === 'Section'
        ? uniq.sort((a, b) => all.filter((x) => x === b).length - all.filter((x) => x === a).length)[0]
        : uniq.join(' / ');
      values.push({ label: k, value });
    }
    values.push({ label: 'Chart sheets', value: [...new Set(d.sheets)].sort((a, b) => a - b).join(', ') });
    const notes: SignalNote[] = [...d.notes].map(([k, n]) => ({
      ref: n.ref,
      text: textOf(k),
      where: `note ${n.ref} on ${sheetList(n.sheets)}`,
    }));
    res.signalData.push({ tag: d.tag, role: d.role, source: d.source, file, values, notes });
  }
  return res;

  function textOf(k: string): string {
    // keys keep the upper-cased text for grouping; return the original wording from any page
    const [ref, upText] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    for (const p of pages) {
      const t = p.notes.get(ref);
      if (t && t.toUpperCase() === upText) return t;
    }
    return upText;
  }
}
