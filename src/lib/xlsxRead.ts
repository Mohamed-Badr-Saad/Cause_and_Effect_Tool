// Minimal, dependency-light reader for .xlsx / .xlsm workbooks.
// Reads cell *values* only (cached results for formulas), which is all a C&E chart needs.
// Macros (vbaProject.bin) are never decompressed or executed.
import { unzipSync, strFromU8 } from 'fflate';

export interface RawSheet {
  name: string;
  /** rows[r][c] — 0-based, sparse; missing cells are undefined */
  rows: (string | undefined)[][];
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  if (s.indexOf('&') === -1 && s.indexOf('_x') === -1) return s;
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return String.fromCodePoint(code);
      }
      return ENTITY[e];
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function textOf(fragment: string): string {
  // Concatenate every <t> run, ignoring phonetic runs.
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out += m[1];
  return decodeXml(out);
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(tag);
  return m ? m[1] : undefined;
}

function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const ch = ref.charCodeAt(i);
    if (ch < 65 || ch > 90) break;
    n = n * 26 + (ch - 64);
  }
  return n - 1;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ('xl/' + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

export function readWorkbook(buf: ArrayBuffer | Uint8Array): RawSheet[] {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new Error(
      'This file is not an .xlsx/.xlsm workbook. If it is an old .xls file, open it in Excel and save it as .xlsx first.'
    );
  }
  const files = unzipSync(data, {
    filter: (f) =>
      f.name === 'xl/workbook.xml' ||
      f.name === 'xl/_rels/workbook.xml.rels' ||
      f.name === 'xl/sharedStrings.xml' ||
      f.name.startsWith('xl/worksheets/sheet'),
  });
  const wbXml = files['xl/workbook.xml'];
  if (!wbXml) throw new Error('Workbook structure not found (missing xl/workbook.xml).');
  const wb = strFromU8(wbXml);
  const relsXml = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';

  const rels: Record<string, string> = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) rels[id] = resolveTarget(target);
  }

  const shared: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const ss = strFromU8(files['xl/sharedStrings.xml']);
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? textOf(m[1]) : '');
  }

  const sheets: RawSheet[] = [];
  let ordinal = 0;
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    ordinal++;
    const name = decodeXml(attr(m[0], 'name') ?? `Sheet${ordinal}`);
    const rid = attr(m[0], 'r:id') ?? /\s\w+:id="([^"]+)"/.exec(m[0])?.[1];
    const path = (rid && rels[rid]) || `xl/worksheets/sheet${ordinal}.xml`;
    const xml = files[path];
    if (!xml) continue; // chart sheets etc.
    sheets.push({ name, rows: parseSheet(strFromU8(xml), shared) });
  }
  return sheets;
}

function parseSheet(xml: string, shared: string[]): (string | undefined)[][] {
  const rows: (string | undefined)[][] = [];
  const sd = xml.indexOf('<sheetData');
  if (sd === -1) return rows;
  const body = xml.slice(sd);
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowCounter = -1;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(body))) {
    const rAttr = attr(rm[1], 'r');
    const r = rAttr ? parseInt(rAttr, 10) - 1 : rowCounter + 1;
    rowCounter = r;
    if (!rm[2]) continue;
    const row: (string | undefined)[] = [];
    let colCounter = -1;
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rm[2]))) {
      const a = cm[1];
      const ref = attr(a, 'r');
      const c = ref ? colIndex(ref) : colCounter + 1;
      colCounter = c;
      const inner = cm[2];
      if (!inner) continue;
      const t = attr(a, 't');
      let v: string | undefined;
      if (t === 'inlineStr') {
        const is = /<is>([\s\S]*?)<\/is>/.exec(inner);
        v = is ? textOf(is[1]) : undefined;
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vm) {
          if (t === 's') v = shared[parseInt(vm[1], 10)];
          else if (t === 'b') v = vm[1] === '1' ? 'TRUE' : 'FALSE';
          else v = decodeXml(vm[1]);
        }
      }
      if (v !== undefined && v !== '') row[c] = v;
    }
    rows[r] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}
