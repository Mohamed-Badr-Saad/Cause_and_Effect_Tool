// Set points, ranges, voting, notes … attached to signals.
//
// Three ways to provide them in Excel:
//  1. Info columns to the right of a C&E matrix, with their header in the effect-number row
//     (e.g. "Set point", "Range", "Notes"). One value per cause row.
//  2. A "Signal data" sheet: a header row with "Tag" plus any of Set point, Range, Units, MOS, SOS, Healthy,
//     Voting, Action, Notes / Note refs, Note text, Role, Source. One row per signal.
//  3. A "Notes" sheet: columns "No." and "Note" (and optionally "Sheet") that resolve the note numbers
//     written in (1) or (2).
import type { RawSheet } from './xlsxRead';
import type { SignalData, SignalNote } from './model';

const clean = (v: string | undefined) => (v ?? '').replace(/[ \t]+/g, ' ').trim();

export type Field = 'tag' | 'role' | 'source' | 'refs' | 'noteText' | 'value';

/** Canonical label for a column header, and what kind of field it is. */
export function headerField(h: string): { field: Field; label: string } {
  const t = clean(h);
  const u = t.toUpperCase().replace(/[.\s_/-]+/g, ' ').trim();
  if (/^(TAG|TAG NO|TAG NUMBER|SIGNAL|SIGNAL TAG|CAUSE TAG)$/.test(u)) return { field: 'tag', label: 'Tag' };
  if (/^ROLE$/.test(u)) return { field: 'role', label: 'Role' };
  if (/^(SOURCE|SHEET|FROM)$/.test(u)) return { field: 'source', label: 'Source' };
  if (/^(NOTE|NOTES|NOTE REF|NOTE REFS|NOTE NO|NOTE NOS|NOTE NUMBERS?)$/.test(u)) return { field: 'refs', label: 'Notes' };
  if (/^(NOTE TEXT|NOTES TEXT|NOTE DESCRIPTION|REMARKS?|COMMENTS?)$/.test(u)) return { field: 'noteText', label: 'Note text' };
  if (/^(SET ?POINT|SETPOINT|SETPOINTS|SETTING|SETTINGS|SP|TRIP SETTING|TRIP SET ?POINT|ALARM SET ?POINT)$/.test(u)) return { field: 'value', label: 'Set point' };
  if (/^RANGES?$/.test(u)) return { field: 'value', label: 'Range' };
  if (/^(UNIT|UNITS|EU|ENG UNITS)$/.test(u)) return { field: 'value', label: 'Units' };
  if (/^MOS$/.test(u)) return { field: 'value', label: 'MOS' };
  if (/^SOS$/.test(u)) return { field: 'value', label: 'SOS' };
  if (/^HEALTHY( STATE)?$/.test(u)) return { field: 'value', label: 'Healthy' };
  if (/^VOT+ING$/.test(u)) return { field: 'value', label: 'Voting' };
  if (/^ACTION$/.test(u)) return { field: 'value', label: 'Action' };
  return { field: 'value', label: t };
}

const isRecognised = (h: string) => {
  const f = headerField(h);
  return f.field !== 'value' || ['Set point', 'Range', 'Units', 'MOS', 'SOS', 'Healthy', 'Voting', 'Action'].includes(f.label);
};

export function splitRefs(s: string): string[] {
  return (s.match(/\b\d{1,3}[A-Z]?\b/g) ?? []).filter((x, i, a) => a.indexOf(x) === i);
}

/** "TEXT  [note 25 on sheets 1, 2]" → { text, where } */
export function parseNoteLine(line: string): SignalNote | null {
  const t = clean(line);
  if (!t) return null;
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(t);
  if (m && m[1]) return { text: m[1], where: m[2] };
  const n = /^note\s+(\d{1,3})\s*(?:\(([^)]*)\))?\s*[:.-]\s*(.+)$/i.exec(t);
  if (n) return { ref: n[1], text: n[3], where: n[2] ? `note ${n[1]} on ${n[2]}` : `note ${n[1]}` };
  return { text: t };
}

// ---------------------------------------------------------------- Notes sheet
export interface NotesBook {
  /** scope ('' = whole workbook, otherwise a sheet/matrix name, lower case) → note no. → text */
  byScope: Map<string, Map<string, string>>;
}

export function detectNotesSheet(sheet: RawSheet): NotesBook | null {
  for (let r = 0; r < Math.min(8, sheet.rows.length); r++) {
    const row = sheet.rows[r] ?? [];
    let noCol = -1, textCol = -1, scopeCol = -1, hasTag = false;
    row.forEach((v, c) => {
      const u = clean(v).toUpperCase().replace(/[.\s]+/g, ' ').trim();
      if (/^(NO|NOTE NO|NOTE NUMBER|REF|#)$/.test(u)) noCol = c;
      else if (/^(NOTE|NOTES|NOTE TEXT|TEXT|DESCRIPTION)$/.test(u)) textCol = c;
      else if (/^(SHEET|MATRIX|C&E SHEET|SCOPE)$/.test(u)) scopeCol = c;
      else if (/^TAG/.test(u)) hasTag = true;
    });
    if (noCol < 0 || textCol < 0 || hasTag) continue;
    const byScope = new Map<string, Map<string, string>>();
    for (let i = r + 1; i < sheet.rows.length; i++) {
      const rr = sheet.rows[i] ?? [];
      const no = clean(rr[noCol]).replace(/\.$/, '');
      const text = clean(rr[textCol]);
      if (!no || !text || !/^\d{1,3}[A-Z]?$/i.test(no)) continue;
      const scope = scopeCol >= 0 ? clean(rr[scopeCol]).toLowerCase() : '';
      if (!byScope.has(scope)) byScope.set(scope, new Map());
      byScope.get(scope)!.set(no.toUpperCase(), text);
    }
    if (byScope.size) return { byScope };
  }
  return null;
}

export function resolveNote(books: NotesBook[], scope: string, ref: string): string | undefined {
  const s = scope.toLowerCase();
  for (const b of books) {
    const t = b.byScope.get(s)?.get(ref.toUpperCase());
    if (t) return t;
  }
  for (const b of books) {
    const t = b.byScope.get('')?.get(ref.toUpperCase());
    if (t) return t;
  }
  return undefined;
}

// ---------------------------------------------------------------- Signal data sheet
export interface PendingData extends SignalData {
  /** note refs still to be resolved against a Notes sheet */
  refs: string[];
  scope: string;
}

export function detectSignalDataSheet(sheet: RawSheet, file: string): PendingData[] | null {
  for (let r = 0; r < Math.min(6, sheet.rows.length); r++) {
    const row = sheet.rows[r] ?? [];
    const fields = row.map((v) => (clean(v) ? headerField(clean(v)) : null));
    const tagCol = fields.findIndex((f) => f?.field === 'tag');
    if (tagCol < 0) continue;
    const recognised = row.filter((v, c) => c !== tagCol && clean(v) && isRecognised(clean(v))).length;
    if (!recognised) continue;
    const out: PendingData[] = [];
    for (let i = r + 1; i < sheet.rows.length; i++) {
      const rr = sheet.rows[i] ?? [];
      const tag = clean(rr[tagCol]);
      if (!tag) continue;
      const d: PendingData = { tag, source: sheet.name, file, values: [], notes: [], refs: [], scope: '' };
      fields.forEach((f, c) => {
        if (!f || c === tagCol) return;
        const raw = (rr[c] ?? '').trim();
        const v = clean(raw);
        if (!v) return;
        if (f.field === 'role') d.role = /^e/i.test(v) ? 'effect' : /^c/i.test(v) ? 'cause' : undefined;
        else if (f.field === 'source') {
          d.source = v;
          d.scope = v;
        } else if (f.field === 'refs') d.refs = splitRefs(v);
        else if (f.field === 'noteText') {
          for (const line of raw.split(/\r?\n/)) {
            const n = parseNoteLine(line);
            if (n) d.notes.push(n);
          }
        } else d.values.push({ label: f.label, value: v });
      });
      if (d.values.length || d.notes.length || d.refs.length) out.push(d);
    }
    return out.length ? out : null;
  }
  return null;
}

// ---------------------------------------------------------------- info columns beside a matrix
/** Columns right of the last effect column that have a header in the effect-number row. */
export function infoColumns(numRow: (string | undefined)[], firstFree: number): { col: number; header: string }[] {
  const out: { col: number; header: string }[] = [];
  for (let c = firstFree; c < numRow.length; c++) {
    const h = clean(numRow[c]);
    if (h && !/^\d+$/.test(h)) out.push({ col: c, header: h });
  }
  return out;
}

export function rowData(
  row: (string | undefined)[],
  cols: { col: number; header: string }[],
  tag: string,
  matrixName: string,
  file: string,
  role: 'cause' | 'effect'
): PendingData | null {
  const d: PendingData = { tag, role, source: matrixName, file, values: [], notes: [], refs: [], scope: matrixName };
  for (const { col, header } of cols) {
    const raw = (row[col] ?? '').trim();
    const v = clean(raw);
    if (!v) continue;
    const f = headerField(header);
    if (f.field === 'refs') d.refs = splitRefs(v);
    else if (f.field === 'noteText') raw.split(/\r?\n/).forEach((l) => {
      const n = parseNoteLine(l);
      if (n) d.notes.push(n);
    });
    else if (f.field === 'value') d.values.push({ label: f.label, value: v });
  }
  return d.values.length || d.notes.length || d.refs.length ? d : null;
}

export function finalise(pending: PendingData[], books: NotesBook[]): SignalData[] {
  return pending.map(({ refs, scope, ...d }) => {
    const notes = [...d.notes];
    if (notes.length) return { ...d, notes }; // note text given directly: numbers are only references
    const have = new Set(notes.map((n) => n.ref).filter(Boolean));
    for (const ref of refs) {
      if (have.has(ref)) continue;
      const text = resolveNote(books, scope, ref);
      notes.push({ ref, text: text ?? 'Note text not found in this workbook', where: `note ${ref}` });
    }
    return { ...d, notes };
  });
}

// ---------------------------------------------------------------- values written inside a tag
/** F&G style tags carry voting and level: "FZ02DGC015/16_01 2OO2 @ 49%LEL". */
export function dataFromTag(tag: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const sp = /@\s*([<>]?\s*[\d.]+\s*%?\s*(?:LEL|LFL|PPM|BARG?|°C|DEGC|M3\/H|%)?)/i.exec(tag);
  if (sp) out.push({ label: 'Set point', value: sp[1].replace(/\s+/g, ' ').trim() });
  const vt = /\b(\d+\s?OO\s?\d+)\b/i.exec(tag);
  if (vt) out.push({ label: 'Voting', value: vt[1].replace(/\s/g, '').toUpperCase() });
  return out;
}
