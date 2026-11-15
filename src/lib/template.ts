// Blank C&E workbook in the layout the importer reads (see parseCE.ts), with shading, rotated effect headers,
// an action-code dropdown and a "How to fill" sheet. Built here so it works offline, with no template file to ship.
import { zipSync, strToU8 } from 'fflate';
import { downloadBlob } from './xlsxWrite';

export interface TemplateOptions {
  name: string;
  effects: number;
  causes: number;
  notes: boolean;
  effectData: boolean;
}

export const INFO_HEADERS = ['Section', 'Set point', 'Range', 'Units', 'Voting', 'Notes', 'Note text'];
const INFO_WIDTHS = [18, 11, 12, 8, 8, 8, 40];
const CODES = 'X,(X),T,A,R,H,N/A';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function col(i: number): string {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

// cellXfs indexes
const S = {
  title: 1, hint: 2, label: 3, effDesc: 4, effTag: 5, effNum: 6, infoHead: 7, causeTag: 8, causeDesc: 9,
  causeNum: 10, mark: 11, info: 12, h2: 13, body: 14, darkHead: 15, plain: 16, code: 17,
} as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="8">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><i/><sz val="9"/><color rgb="FF5B6670"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><name val="Calibri"/></font>
<font><sz val="9"/><name val="Calibri"/></font>
<font><b/><sz val="9"/><name val="Consolas"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><color rgb="FF1F5F8B"/><name val="Calibri"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE9ECEF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3A4650"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF6F7F8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB8BFC6"/></left><right style="thin"><color rgb="FFB8BFC6"/></right><top style="thin"><color rgb="FFB8BFC6"/></top><bottom style="thin"><color rgb="FFB8BFC6"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="18">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="bottom" textRotation="90" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="bottom" textRotation="90" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="6" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="1"><dxf><font><b/><color rgb="FFA4342A"/></font><fill><patternFill patternType="solid"><bgColor rgb="FFF2D7D4"/></patternFill></fill></dxf></dxfs>
</styleSheet>`;

type Cell = { v?: string | number; s?: number };

class Sheet {
  rows = new Map<number, Map<number, Cell>>();
  heights = new Map<number, number>();
  widths: number[] = [];
  tail = '';
  freeze = '';
  set(r: number, c: number, v: string | number | undefined, s = 0) {
    if (!this.rows.has(r)) this.rows.set(r, new Map());
    this.rows.get(r)!.set(c, { v, s });
  }
  xml(): string {
    const cols = this.widths.length
      ? '<cols>' + this.widths.map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '')).join('') + '</cols>'
      : '';
    const body = [...this.rows.keys()].sort((a, b) => a - b).map((r) => {
      const cells = [...this.rows.get(r)!.entries()].sort((a, b) => a[0] - b[0]).map(([c, { v, s }]) => {
        const ref = col(c) + (r + 1);
        const st = s ? ` s="${s}"` : '';
        if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
        if (v === undefined || v === '') return `<c r="${ref}"${st}/>`;
        return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      const h = this.heights.get(r);
      return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0" zoomScale="100">${this.freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData>${this.tail}</worksheet>`;
  }
}

function matrixSheet(o: TemplateOptions): Sheet {
  const sh = new Sheet();
  const E = o.effects, C = o.causes;
  const first = 3; // column D
  const lastEff = first + E - 1;
  const info0 = lastEff + 1;
  const lastRow = 3 + C - 1; // 0-based index of the last cause row

  sh.set(0, 0, o.name, S.title);
  sh.set(0, 1, 'Columns from D: row 1 = what the effect does, row 2 = effect tag, row 3 = effect number. ' +
    'Rows from 4: cause tag (A), description (B), number (C). Type the action code (X …) where a cause row meets an effect column. ' +
    'See the "How to fill" sheet.', S.hint);
  sh.set(1, 0, 'Causes start in row 4 ↓', S.hint);
  sh.set(1, 1, 'Effects →', S.hint);
  sh.set(0, 2, 'Description', S.label);
  sh.set(1, 2, 'TAG No.', S.label);
  sh.set(2, 0, 'TAG No.', S.label);
  sh.set(2, 1, 'Description', S.label);
  sh.set(2, 2, 'No.', S.label);
  for (let j = 0; j < E; j++) {
    sh.set(0, first + j, '', S.effDesc);
    sh.set(1, first + j, '', S.effTag);
    sh.set(2, first + j, j + 1, S.effNum);
  }
  INFO_HEADERS.forEach((h, k) => sh.set(2, info0 + k, h, S.infoHead));
  for (let i = 0; i < C; i++) {
    const r = 3 + i;
    sh.set(r, 0, '', S.causeTag);
    sh.set(r, 1, '', S.causeDesc);
    sh.set(r, 2, i + 1, S.causeNum);
    for (let j = 0; j < E; j++) sh.set(r, first + j, '', S.mark);
    INFO_HEADERS.forEach((_, k) => sh.set(r, info0 + k, '', S.info));
  }
  sh.heights.set(0, 170);
  sh.heights.set(1, 110);
  sh.heights.set(2, 18);
  sh.widths = [24, 46, 11, ...Array(E).fill(6), ...INFO_WIDTHS];
  sh.freeze = '<pane xSplit="3" ySplit="3" topLeftCell="D4" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="A4" sqref="A4"/>';
  const marks = `${col(first)}4:${col(lastEff)}${lastRow + 1}`;
  sh.tail =
    `<conditionalFormatting sqref="${marks}"><cfRule type="expression" dxfId="0" priority="1"><formula>LEN(TRIM(${col(first)}4))&gt;0</formula></cfRule></conditionalFormatting>` +
    `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" promptTitle="Action code" ` +
    `prompt="X = action. Also T 3Hr / T 30Sec (delay), A, R, H, (X) or your chart's own code. Leave empty for no action." sqref="${marks}">` +
    `<formula1>"${CODES}"</formula1></dataValidation></dataValidations>`;
  return sh;
}

function tableSheet(headers: string[], widths: number[], rows: number, hint: string): Sheet {
  const sh = new Sheet();
  headers.forEach((h, c) => sh.set(0, c, h, S.darkHead));
  for (let r = 1; r <= rows; r++) headers.forEach((_, c) => sh.set(r, c, '', S.plain));
  sh.set(0, headers.length + 1, hint, S.hint);
  sh.widths = [...widths, 3, 70];
  sh.freeze = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
  return sh;
}

function howToSheet(o: TemplateOptions): Sheet {
  const sh = new Sheet();
  const lastEff = col(3 + o.effects - 1);
  const info0 = col(3 + o.effects);
  const lines: [string, string][] = [
    ['', ''],
    ['Effects', `Columns D to ${lastEff} of the "${o.name}" sheet. Row 1: what the effect does (e.g. "CLOSE INLET VALVE"). Row 2: the effect tag, one per column. ` +
      'Row 3: the effect number, already filled in 1, 2, 3 … (change it to match your chart). A column with no tag and no description is ignored, so spare columns can stay empty.'],
    ['Causes', 'From row 4. Column A: cause tag. Column B: description. Column C: cause number. Empty rows are ignored. A row with a description but no tag and no marks is shown as a section heading.'],
    ['Marks', 'Type the action code where a cause row meets an effect column. The dropdown offers common codes, but any text is accepted: ' +
      'X (action), T 3Hr / T 1Min / T 30Sec (after a time delay), A (abort), R (reset), H (inhibit), (X) (through a lower level), or your chart\'s own code such as X(1). ' +
      'Empty, N/A or a dash means no action.'],
    ['Info columns', `From column ${info0}, headed in row 3: Section, Set point, Range, Units, Voting, Notes (note numbers, e.g. "3, 7") and Note text. ` +
      'They are shown with each cause in the app. Delete the ones you do not need, or add your own header in row 3: it is shown under its own name. Keep rows 1 and 2 above them empty.'],
    ['More columns', `To add effects, insert columns before "${INFO_HEADERS[0]}" (right-click the column letter, Insert), so the info columns stay to the right of the last effect. ` +
      'To add causes, just continue below the last row.'],
    ...(o.notes ? [['Notes sheet', 'Numbered chart notes: No. and Note. Numbers typed in the Notes info column are looked up here and the note text is shown with the signal.'] as [string, string]] : []),
    ...(o.effectData ? [['Effect data', 'Extra information for effects: Tag (exactly as in row 2), Action, Set point, Note text. Add any other column header and it is shown too.'] as [string, string]] : []),
    ['Several charts', 'Copy the sheet (right-click the sheet tab, Move or Copy, Create a copy) and rename it. The sheet name is the chart name in the app. ' +
      'Importing a sheet with the same name again replaces the older copy, so use this after a revision.'],
    ['Linking charts', 'Use exactly the same tag on both sides, e.g. the effect _200XY044C on the ESD chart and the cause _200XY044C on the package chart. ' +
      'The trip chain then follows from one chart into the other.'],
    ['Import', 'In C&E Explorer press Import Excel and pick this file. The Imported files page shows what was recognised on each sheet. This "How to fill" sheet is skipped.'],
  ];
  sh.set(0, 0, 'How to fill this C&E workbook', S.title);
  lines.forEach(([k, t], i) => {
    if (!k) return;
    sh.set(i + 1, 0, k, S.h2);
    sh.set(i + 1, 1, t, S.body);
  });
  sh.widths = [16, 120];
  return sh;
}

export function buildTemplate(o: TemplateOptions): Uint8Array {
  const sheets: { name: string; sh: Sheet }[] = [{ name: o.name, sh: matrixSheet(o) }];
  if (o.notes) sheets.push({ name: 'Notes', sh: tableSheet(['No.', 'Note'], [6, 90], 20, 'Numbered notes for the Notes info column of the C&E sheet.') });
  if (o.effectData) {
    sheets.push({
      name: 'Effect data',
      sh: tableSheet(['Tag', 'Action', 'Set point', 'Note text'], [26, 16, 12, 60], 30, 'Optional. Tag must match an effect tag in row 2 of the C&E sheet.'),
    });
  }
  sheets.push({ name: 'How to fill', sh: howToSheet(o) });
  const ct = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ct}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.sh.xml())));
  return zipSync(files, { level: 6 });
}

/** Excel sheet names: max 31 chars, none of \ / ? * [ ] : and not the names used by the other sheets. */
export function cleanSheetName(n: string): string {
  let s = n.replace(/[\\/?*[\]:]/g, '-').replace(/^'+|'+$/g, '').trim().slice(0, 31);
  if (!s) s = 'New C&E';
  if (/^(notes|effect data|how to fill|history)$/i.test(s)) s = (s + ' C&E').slice(0, 31);
  return s;
}

export function downloadTemplate(o: TemplateOptions) {
  const name = cleanSheetName(o.name);
  const file = name.replace(/[\\/:*?"<>|]/g, '-') + '.xlsx';
  downloadBlob(buildTemplate({ ...o, name }), file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
