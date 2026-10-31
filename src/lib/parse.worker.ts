/// <reference lib="webworker" />
import { readWorkbook } from './xlsxRead';
import { parseSheets } from './parseCE';

self.onmessage = (ev: MessageEvent<{ name: string; buf: ArrayBuffer }>) => {
  const { name, buf } = ev.data;
  try {
    const res = parseSheets(readWorkbook(buf), name);
    (self as unknown as Worker).postMessage({ ok: true, res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
