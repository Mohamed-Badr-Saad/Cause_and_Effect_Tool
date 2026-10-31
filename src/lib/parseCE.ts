// Detects and converts sheets into C&E matrices or trip-signal lists.
//
// C&E matrix layout (same as ESD C&E 1 / ESD C&E 2 / F&G C&E):
//            col A       col B         col C      col D …
//   row 1                              Controller  <effect description>
//   row 2                              TAG No.     <effect tag>
//   row 3                                          <effect number>
//   row 4+   <cause tag> <cause desc>  <cause no.> <action code: X, T 3Hr, A, R …>
//
// A chart converted from PDF to Excel as-is (one "Table N" sheet per page) is read by parseConverted.ts.
//
// Trip-signal list layout (ESD & Packages trip signals):
//   row 1: group name over each pair of columns; row 2: "Cause Tag" | "Description"; row 3+: entries.
//   An entry with text but no description (e.g. "Level 0 for Zone 1") is a sub-heading.
import type { RawSheet } from './xlsxRead';
import type { Matrix, ParseResult, SheetReport, TripGroup, TripItem, Signal } from './model';
import { parseConverted } from './parseConverted';
import { detectNotesSheet, detectSignalDataSheet, finalise, infoColumns, rowData, type NotesBook, type PendingData } from './signalData';

const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

function detectMatrix(sheet: RawSheet): { tagRow: number; labelCol: number } | null {
  const rows = sheet.rows;
  for (let r = 0; r < Math.min(12, rows.length); r++) {
    for (let c = 0; c < 6; c++) {
      const v = clean(rows[r]?.[c]).toUpperCase().replace(/[\s.]/g, '');
      if (v === 'TAGNO' || v === 'TAG' || v === 'TAGNUMBER') {
        const row = rows[r];
        // Cause tags need a column left of the label; a row of column names (Set point, Range …) is a data table.
        if (c === 0) continue;
        const named = row.filter((x) => x && /^(set ?point|setting|range|units?|mos|sos|healthy|vot+ing|notes?|note text|role|source)$/i.test(clean(x))).length;
        if (named >= 2) continue;
        // Need several effect tags to the right of the label to call it a matrix.
        let n = 0;
        for (let k = c + 1; k < row.length && n < 3; k++) if (clean(row[k])) n++;
        if (n >= 3) return { tagRow: r, labelCol: c };
      }
    }
  }
  return null;
}

function parseMatrix(sheet: RawSheet, file: string, tagRow: number, labelCol: number): { matrix: Matrix; data: PendingData[] } {
  const rows = sheet.rows;
  const tagR = rows[tagRow] ?? [];
  const descR = tagRow > 0 ? rows[tagRow - 1] ?? [] : [];
  const numR = rows[tagRow + 1] ?? [];
  const effects: Signal[] = [];
  const colToEffect = new Map<number, number>();
  const width = Math.max(tagR.length, descR.length);
  for (let c = labelCol + 1; c < width; c++) {
    const tag = clean(tagR[c]);
    const desc = clean(descR[c]);
    if (!tag && !desc) continue;
    colToEffect.set(c, effects.length);
    effects.push({ tag: tag || `(column ${c + 1})`, desc, num: clean(numR[c]) });
  }

  // Info columns (Set point, Notes …) right of the last effect column, headed in the effect-number row.
  const lastEffectCol = Math.max(labelCol, ...colToEffect.keys());
  const info = infoColumns(numR, lastEffectCol + 1);
  const name = /^sheet\s*\d*$/i.test(sheet.name.trim()) ? file.replace(/\.(xlsx|xlsm)$/i, '') : sheet.name.trim();
  const data: PendingData[] = [];

  // Cause tag / description / number columns sit left of the label column.
  const tagCol = Math.max(0, labelCol - 2);
  const descCol = labelCol - 1 >= 0 ? labelCol - 1 : 1;
  const numCol = labelCol;
  const causes: Signal[] = [];
  const links: [number, number, string][] = [];
  for (let r = tagRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const tag = clean(row[tagCol]);
    const desc = clean(row[descCol]);
    // Skip the effect-number row and repeated header rows.
    if (!tag && !desc) continue;
    const up = tag.toUpperCase().replace(/[\s.]/g, '');
    if (up === 'TAGNO' || up === 'TAG') continue;
    // A row with a title but no tag and no marks is a section heading ("PLANT SHUTDOWN - LEVEL 0 (ZONE 1)").
    if (!tag && ![...colToEffect.keys()].some((c) => clean(row[c]) && !/^(N\/?A|-+|—)$/i.test(clean(row[c])))) continue;
    const ci = causes.length;
    causes.push({ tag: tag || `(row ${r + 1})`, desc, num: clean(row[numCol]) });
    if (info.length) {
      const d = rowData(row, info, causes[ci].tag, name, file, 'cause');
      if (d) data.push(d);
    }
    for (const [c, ei] of colToEffect) {
      const v = clean(row[c]);
      // "N/A" and dashes mean no action on vendor charts.
      if (v && !/^(N\/?A|-+|—)$/i.test(v)) links.push([ci, ei, v]);
    }
  }
  // Generic sheet names ("Sheet1") are replaced by the file name so different files don't collide.
  return { matrix: { id: name, name, source: file, causes, effects, links }, data };
}

function detectTrips(sheet: RawSheet): number | null {
  for (let r = 0; r < Math.min(6, sheet.rows.length); r++) {
    const row = sheet.rows[r] ?? [];
    let n = 0;
    for (const v of row) if (/^cause\s*tag$/i.test(clean(v))) n++;
    if (n >= 2) return r;
  }
  return null;
}

function looksLikeHeading(text: string): boolean {
  // Signal tags have no spaces and usually start with "_" / "%" / letters+digits.
  return /\s/.test(text) && !/^[_%]/.test(text) && !/^[A-Z0-9_]+\s+\d?OO\d/i.test(text);
}

function parseTrips(sheet: RawSheet, file: string, headerRow: number): TripGroup[] {
  const rows = sheet.rows;
  const head = rows[headerRow] ?? [];
  const names = headerRow > 0 ? rows[headerRow - 1] ?? [] : [];
  const groups: TripGroup[] = [];
  for (let c = 0; c < head.length; c++) {
    if (!/^cause\s*tag$/i.test(clean(head[c]))) continue;
    const name = clean(names[c]) || clean(names[c + 1]) || `Group ${groups.length + 1}`;
    const items: TripItem[] = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const tag = clean(rows[r]?.[c]);
      const desc = clean(rows[r]?.[c + 1]);
      if (!tag && !desc) continue;
      if (tag && !desc && looksLikeHeading(tag)) items.push({ kind: 'heading', text: tag });
      else items.push({ kind: 'signal', tag: tag || desc, desc: tag ? desc : '' });
    }
    groups.push({ id: `${file}::${sheet.name}::${c}`, name, source: file, sheet: sheet.name, items });
  }
  return groups;
}

export function parseSheets(sheets: RawSheet[], file: string): ParseResult {
  const res: ParseResult = { matrices: [], tripGroups: [], signalData: [], report: [] };
  const pending: PendingData[] = [];
  const books: NotesBook[] = [];
  // a chart converted from PDF ("Table 1", "Table 2" … one sheet per page) is read page by page and merged
  const conv = parseConverted(sheets, file);
  res.matrices.push(...conv.matrices);
  const convertedBook = conv.handled.size > 0;
  for (const s of sheets) {
    if (conv.handled.has(s.name)) {
      res.report.push(...conv.report.filter((r) => r.sheet === s.name));
      continue;
    }
    const rep: SheetReport = { file, sheet: s.name, status: 'skipped', detail: '' };
    const m = detectMatrix(s);
    if (m) {
      const { matrix: mx, data } = parseMatrix(s, file, m.tagRow, m.labelCol);
      if (mx.causes.length && mx.effects.length) {
        res.matrices.push(mx);
        pending.push(...data);
        rep.status = 'matrix';
        rep.detail = `${mx.causes.length} causes × ${mx.effects.length} effects, ${mx.links.length.toLocaleString()} marks` +
          (data.length ? `, set points or notes for ${data.length} causes` : '');
        res.report.push(rep);
        continue;
      }
    }
    const t = detectTrips(s);
    if (t !== null) {
      const groups = parseTrips(s, file, t);
      if (groups.length) {
        res.tripGroups.push(...groups);
        rep.status = 'trips';
        rep.detail = `${groups.length} trip groups`;
        res.report.push(rep);
        continue;
      }
    }
    const sd = detectSignalDataSheet(s, file);
    if (sd) {
      pending.push(...sd);
      rep.status = 'data';
      rep.detail = `Set points / notes for ${sd.length.toLocaleString()} signals`;
      res.report.push(rep);
      continue;
    }
    const nb = detectNotesSheet(s);
    if (nb) {
      books.push(nb);
      let n = 0;
      nb.byScope.forEach((mp) => (n += mp.size));
      rep.status = 'notes';
      rep.detail = `${n} numbered notes`;
      res.report.push(rep);
      continue;
    }
    rep.detail = convertedBook
      ? 'Cover, legend or blank overflow page of the converted chart'
      : 'Not a C&E matrix, trip-signal list, signal data or notes sheet';
    res.report.push(rep);
  }
  res.signalData = finalise(pending, books).concat(conv.signalData);
  return res;
}
