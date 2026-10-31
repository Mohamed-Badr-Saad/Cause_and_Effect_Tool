import ParseWorker from './parse.worker?worker&inline';
import { readWorkbook } from './xlsxRead';
import { parseSheets } from './parseCE';
import type { Dataset, ParseResult } from './model';

function parseInWorker(name: string, buf: ArrayBuffer): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new ParseWorker();
    } catch {
      // Workers unavailable (very old browser / locked-down policy): parse on the main thread.
      try {
        resolve(parseSheets(readWorkbook(buf), name));
      } catch (e) {
        reject(e);
      }
      return;
    }
    w.onmessage = (ev) => {
      w.terminate();
      if (ev.data.ok) resolve(ev.data.res as ParseResult);
      else reject(new Error(ev.data.error));
    };
    w.onerror = (ev) => {
      w.terminate();
      try {
        resolve(parseSheets(readWorkbook(buf), name));
      } catch {
        reject(new Error(ev.message || 'Could not read the workbook'));
      }
    };
    w.postMessage({ name, buf });
  });
}

export interface ImportOutcome {
  dataset: Dataset;
  messages: { file: string; ok: boolean; text: string }[];
}

/** Reads the files and merges them into the dataset. A sheet with the same name replaces the older copy. */
export async function importFiles(files: File[], current: Dataset): Promise<ImportOutcome> {
  const ds: Dataset = {
    matrices: [...current.matrices],
    tripGroups: [...current.tripGroups],
    signalData: [...(current.signalData ?? [])],
    files: [...current.files],
  };
  const messages: ImportOutcome['messages'] = [];
  for (const f of files) {
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) {
      messages.push({
        file: f.name,
        ok: false,
        text: /\.xls$/i.test(f.name)
          ? 'Old .xls format. Open it in Excel and save as .xlsx, then import again.'
          : 'Not an Excel workbook (.xlsx or .xlsm).',
      });
      continue;
    }
    try {
      const buf = await f.arrayBuffer();
      const res = await parseInWorker(f.name, buf);
      let replaced = 0;
      for (const m of res.matrices) {
        const at = ds.matrices.findIndex((x) => x.name.toLowerCase() === m.name.toLowerCase());
        if (at >= 0) {
          ds.matrices[at] = m;
          replaced++;
        } else ds.matrices.push(m);
      }
      const tripSheets = new Set(res.tripGroups.map((g) => g.sheet.toLowerCase()));
      if (tripSheets.size) {
        const before = ds.tripGroups.length;
        ds.tripGroups = ds.tripGroups.filter((g) => !tripSheets.has(g.sheet.toLowerCase()));
        replaced += before - ds.tripGroups.length > 0 ? 1 : 0;
        ds.tripGroups.push(...res.tripGroups);
      }
      // signal data from the same workbook replaces the earlier import of it
      ds.signalData = (ds.signalData ?? []).filter((d) => d.file !== f.name).concat(res.signalData);
      ds.files = ds.files.filter((x) => x.name !== f.name);
      ds.files.push({ name: f.name, importedAt: new Date().toISOString(), report: res.report });
      const parts: string[] = [];
      if (res.matrices.length) parts.push(`${res.matrices.length} C&E sheet${res.matrices.length > 1 ? 's' : ''}`);
      if (res.tripGroups.length) parts.push(`${res.tripGroups.length} trip groups`);
      if (res.signalData.length) parts.push(`set points / notes for ${res.signalData.length.toLocaleString()} signals`);
      const skipped = res.report.filter((r) => r.status === 'skipped').length;
      messages.push({
        file: f.name,
        ok: parts.length > 0,
        text: parts.length
          ? `Imported ${parts.join(' and ')}${replaced ? ` (${replaced} replaced an earlier copy)` : ''}${skipped ? `. Skipped ${skipped} other sheet${skipped > 1 ? 's' : ''}.` : '.'}`
          : 'No C&E matrix, trip-signal list or signal data found. Check the expected layouts under "Imported files".',
      });
    } catch (e) {
      messages.push({ file: f.name, ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }
  return { dataset: ds, messages };
}
