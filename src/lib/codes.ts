// Action codes found at C&E intersections, with meanings taken from the chart notes
// (ESD_CE_APR26 / FGS_CE_JAN26 legends).
export type CodeClass = 'action' | 'delay' | 'abort' | 'reset' | 'inhibit' | 'other';

export function classify(code: string): CodeClass {
  const s = code.trim().toUpperCase();
  if (s === '(X)' || s === 'Z1' || s === 'Z2') return 'action';
  if (/^X/.test(s)) return /T\s*\d|T[XYZ]\b/.test(s) ? 'delay' : 'action';
  if (/^T/.test(s)) return 'delay';
  if (s === 'A') return 'abort';
  if (s === 'R') return 'reset';
  if (s === 'H') return 'inhibit';
  return 'other';
}

/** Short text that fits in a matrix cell. */
export function shortCode(code: string): string {
  const s = code.trim();
  const u = s.toUpperCase();
  if (u.length <= 2 || u === '(X)') return s;
  const t = u.match(/T\s*(\d+)\s*(MIN|HR|SEC|H|S|M)?/g);
  if (t && t.length > 1) return 'Tx';
  if (/^X/.test(u) && t) return 'X+';
  const m = /T\s*(\d+)\s*(MIN|HR|SEC|H|S|M)?/.exec(u);
  if (m) {
    const unit = (m[2] ?? '').startsWith('H') ? 'h' : (m[2] ?? '').startsWith('S') ? 's' : m[2] ? 'm' : 'h';
    return m[2] ? m[1] + unit : 'T' + m[1];
  }
  return s.slice(0, 2);
}

export function describeCode(code: string): string {
  const s = code.trim().toUpperCase().replace(/\s+/g, ' ');
  if (s === 'X') return 'Action (immediate)';
  if (s === 'XS') return 'Trip with selector in the right position';
  if (s === '(X)') return 'Through a lower ESD level (the levels cascade)';
  if (s === 'Z1') return 'In zone 1 (SCA and SSS)';
  if (s === 'Z2') return 'In zone 2 (booster & main compressors)';
  if (s === 'A') return 'Abort blowdown within 1 min';
  if (s === 'R') return 'Reset';
  if (s === 'H') return 'Inhibit';
  if (s === 'C') return 'Closed';
  if (s === 'O') return 'Open';
  if (s === 'O / C' || s === 'O/C') return 'Open / closed';
  if (s === 'M') return 'Modulate / control';
  if (s === 'MO') return 'Modulate open';
  if (s === 'MC') return 'Modulate closed';
  if (s === 'X1') return 'First occurrence';
  if (s === 'X2') return 'Second occurrence';
  if (s === 'T3') return 'After 3 hours time delay';
  if (s === 'T') return 'After time delay (see chart notes)';
  const many = [...s.matchAll(/T ?(\d+) ?(MIN|HR|SEC|H|S)?/g)].map(fmtDelay);
  if (many.length > 1)
    return `${many[0]} if slug catcher pressure is below 0 bar, otherwise ${many[many.length - 1]} (Tx/Ty)`;
  if (many.length === 1) {
    return s.startsWith('X')
      ? `Immediate if slug catcher pressure is below 0 bar, otherwise after ${many[0]} (Tz)`
      : `After ${many[0]} time delay`;
  }
  return 'See chart notes';
}

function fmtDelay(m: RegExpMatchArray): string {
  const unit = !m[2] || m[2].startsWith('H') ? 'hour' : m[2].startsWith('S') ? 'second' : 'minute';
  const n = Number(m[1]);
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

export const CLASS_LABEL: Record<CodeClass, string> = {
  action: 'Action',
  delay: 'Time delayed',
  abort: 'Abort',
  reset: 'Reset',
  inhibit: 'Inhibit',
  other: 'Other',
};

export const LEGEND: { code: string; meaning: string }[] = [
  { code: 'X', meaning: 'Cause initiates the effect immediately' },
  { code: 'T …', meaning: 'Effect initiated after the time delay shown (e.g. T 1Min, T 3Hr, T 30Sec)' },
  { code: 'T3', meaning: '3 hours time delay' },
  { code: 'Tx / Ty', meaning: '1 min if slug catcher pressure is below 0 bar, otherwise 60 min (Tx) or 40 min (Ty)' },
  { code: 'X - T …', meaning: 'Tz: no delay if slug catcher pressure is below 0 bar, otherwise after the delay shown' },
  { code: 'A', meaning: 'Abort blowdown within 1 min' },
  { code: 'R', meaning: 'Reset' },
  { code: 'H', meaning: 'Inhibit' },
  { code: 'C / O', meaning: 'Package charts: valve or pump closed / open in that step or situation' },
  { code: 'M, MO, MC', meaning: 'Package charts: modulate / control, modulate open, modulate closed' },
  { code: 'X1 / X2', meaning: 'Package charts: first / second occurrence' },
  { code: 'XS', meaning: 'Trip with selector in the right position' },
  { code: '(X)', meaning: 'ESD levels chart: done through a lower level, because each level also initiates the levels below it' },
  { code: 'Z1 / Z2', meaning: 'ESD levels chart: the input starts that level in zone 1 (SCA and SSS) or zone 2 (booster & main compressors)' },
  { code: 'N/A', meaning: 'Not applicable. Kept in the Excel sheet but not shown as an action' },
  { code: 'P …', meaning: 'Other codes are shown exactly as written in the chart; check the chart notes' },
];
