import type { Dataset, Signal, SignalNote } from './model';
import { dataFromTag } from './signalData';
import { compact, coreTag, expandTag, normTag } from './tags';

export type Role = 'cause' | 'effect';
export interface Occ {
  m: number;
  role: Role;
  i: number;
}

export interface EntryData {
  source: string;
  role?: 'cause' | 'effect';
  values: { label: string; value: string }[];
  notes: SignalNote[];
}

export interface Entry {
  key: string;
  tag: string;
  descs: string[];
  occ: Occ[];
  trips: number[];
  /** set points, ranges, notes … (several sources possible) */
  data: EntryData[];
  aliases: string[];
  hay: string;
  hayC: string;
}

export interface LinkRow {
  m: number;
  /** index of the other signal (effect index for effectsOf, cause index for causesOf) */
  j: number;
  code: string;
  other: Signal;
  otherKey: string;
}

export interface CEIndex {
  ds: Dataset;
  entries: Entry[];
  byKey: Map<string, Entry>;
  byCore: Map<string, Entry[]>;
  causeLinks: [number, string][][][];
  effectLinks: [number, string][][][];
}

function sig(ds: Dataset, o: Occ): Signal {
  const m = ds.matrices[o.m];
  return o.role === 'cause' ? m.causes[o.i] : m.effects[o.i];
}

export function buildIndex(ds: Dataset): CEIndex {
  const byKey = new Map<string, Entry>();
  const get = (tag: string, desc: string): Entry => {
    const key = normTag(tag);
    let e = byKey.get(key);
    if (!e) {
      e = { key, tag: tag.trim(), descs: [], occ: [], trips: [], data: [], aliases: [], hay: '', hayC: '' };
      byKey.set(key, e);
    }
    if (desc && !e.descs.includes(desc)) e.descs.push(desc);
    return e;
  };

  const causeLinks: [number, string][][][] = [];
  const effectLinks: [number, string][][][] = [];
  ds.matrices.forEach((m, mi) => {
    m.causes.forEach((s, i) => get(s.tag, s.desc).occ.push({ m: mi, role: 'cause', i }));
    m.effects.forEach((s, i) => get(s.tag, s.desc).occ.push({ m: mi, role: 'effect', i }));
    const cl: [number, string][][] = m.causes.map(() => []);
    const el: [number, string][][] = m.effects.map(() => []);
    for (const [c, e, code] of m.links) {
      cl[c].push([e, code]);
      el[e].push([c, code]);
    }
    causeLinks.push(cl);
    effectLinks.push(el);
  });
  ds.tripGroups.forEach((g, gi) => {
    for (const it of g.items) {
      if (it.kind !== 'signal') continue;
      const e = get(it.tag, it.desc);
      if (!e.trips.includes(gi)) e.trips.push(gi);
    }
  });

  // Signal data: exact tag, else the same tag ignoring punctuation / voting suffix / compound parts.
  const loose = new Map<string, Entry[]>();
  const addLoose = (k: string, e: Entry) => {
    if (!k) return;
    const l = loose.get(k);
    if (!l) loose.set(k, [e]);
    else if (!l.includes(e)) l.push(e);
  };
  for (const e of byKey.values()) {
    addLoose(compact(coreTag(e.tag)), e);
    for (const a of expandTag(e.tag)) addLoose(compact(a), e);
  }
  for (const d of ds.signalData ?? []) {
    const item: EntryData = { source: d.source, role: d.role, values: d.values, notes: d.notes };
    let targets: Entry[] = [];
    const exact = byKey.get(normTag(d.tag));
    if (exact) targets = [exact];
    else {
      const l = loose.get(compact(coreTag(d.tag))) ?? loose.get(compact(d.tag)) ?? [];
      if (l.length === 1) targets = l; // only attach when it is unambiguous
    }
    if (!targets.length) targets = [get(d.tag, '')];
    for (const t of targets) t.data.push(item);
  }
  for (const e of byKey.values()) {
    if (!e.occ.length) continue;
    const fromTag = dataFromTag(e.tag);
    if (fromTag.length && !e.data.some((d) => d.values.some((v) => v.label === 'Set point'))) {
      e.data.push({ source: 'Written in the tag', values: fromTag, notes: [] });
    }
  }

  const byCore = new Map<string, Entry[]>();
  for (const e of byKey.values()) {
    e.aliases = expandTag(e.tag);
    for (const d of e.data) for (const v of d.values) if (v.label === 'Tag in PDF') e.aliases.push(...v.value.split(/,\s*/));
    e.hay = (e.key + ' ' + e.descs.join(' ') + ' ' + e.aliases.join(' ')).toUpperCase();
    e.hayC = compact(e.hay);
    const core = coreTag(e.tag);
    const list = byCore.get(core);
    if (list) list.push(e);
    else byCore.set(core, [e]);
  }
  return { ds, entries: [...byKey.values()], byKey, byCore, causeLinks, effectLinks };
}

export const entryDesc = (e: Entry | undefined) => e?.descs[0] ?? '';

/** All effects of a signal, across every matrix where it appears as a cause. */
export function effectsOf(ix: CEIndex, key: string): LinkRow[] {
  const e = ix.byKey.get(key);
  if (!e) return [];
  const rows: LinkRow[] = [];
  for (const o of e.occ) {
    if (o.role !== 'cause') continue;
    const m = ix.ds.matrices[o.m];
    for (const [j, code] of ix.causeLinks[o.m][o.i]) {
      rows.push({ m: o.m, j, code, other: m.effects[j], otherKey: normTag(m.effects[j].tag) });
    }
  }
  return rows;
}

/** All causes of a signal, across every matrix where it appears as an effect. */
export function causesOf(ix: CEIndex, key: string): LinkRow[] {
  const e = ix.byKey.get(key);
  if (!e) return [];
  const rows: LinkRow[] = [];
  for (const o of e.occ) {
    if (o.role !== 'effect') continue;
    const m = ix.ds.matrices[o.m];
    for (const [j, code] of ix.effectLinks[o.m][o.i]) {
      rows.push({ m: o.m, j, code, other: m.causes[j], otherKey: normTag(m.causes[j].tag) });
    }
  }
  return rows;
}

/** Entries that are the same signal (same tag, or same core tag ignoring voting / parentheses). */
export function sameSignal(ix: CEIndex, key: string): Entry[] {
  const out: Entry[] = [];
  const self = ix.byKey.get(key);
  if (self) out.push(self);
  for (const e of ix.byCore.get(coreTag(key)) ?? []) if (e !== self) out.push(e);
  return out;
}

/** If this exact tag is also a cause somewhere: the key to follow and how many effects it has. */
export function continuesAsCause(ix: CEIndex, key: string): { key: string; count: number } | null {
  // Only the identical tag continues the chain; related tags (same device, other condition) are not followed.
  for (const e of [ix.byKey.get(key)].filter((x): x is Entry => !!x)) {
    let n = 0;
    for (const o of e.occ) if (o.role === 'cause') n += ix.causeLinks[o.m][o.i].length;
    if (n) return { key: e.key, count: n };
  }
  return null;
}

/** If this signal is also an effect somewhere: the key to follow and how many causes it has. */
export function continuesAsEffect(ix: CEIndex, key: string): { key: string; count: number } | null {
  // Only the identical tag continues the chain; related tags (same device, other condition) are not followed.
  for (const e of [ix.byKey.get(key)].filter((x): x is Entry => !!x)) {
    let n = 0;
    for (const o of e.occ) if (o.role === 'effect') n += ix.effectLinks[o.m][o.i].length;
    if (n) return { key: e.key, count: n };
  }
  return null;
}

export interface Hit {
  entry: Entry;
  score: number;
  via?: string;
}

export function search(ix: CEIndex, q: string, limit = 300, role?: Role | 'all', matrix?: number): Hit[] {
  const query = q.trim().toUpperCase();
  if (!query) return [];
  const tokens = query.split(/\s+/).filter(Boolean);
  const tokC = tokens.map(compact);
  const qN = normTag(query);
  const qC = compact(query);
  const hits: Hit[] = [];
  for (const e of ix.entries) {
    if (role && role !== 'all' && !e.occ.some((o) => o.role === role && (matrix === undefined || o.m === matrix))) continue;
    if (matrix !== undefined && !e.occ.some((o) => o.m === matrix)) continue;
    let ok = true;
    for (let t = 0; t < tokens.length; t++) {
      if (e.hay.includes(tokens[t])) continue;
      if (tokC[t].length >= 3 && e.hayC.includes(tokC[t])) continue;
      ok = false;
      break;
    }
    if (!ok) continue;
    let score = 1;
    let via: string | undefined;
    const kC = compact(e.key);
    if (e.key === qN) score = 1000;
    else if (e.key.startsWith(qN) || kC.startsWith(qC)) score = 600;
    else if (qC.length >= 3 && kC.includes(qC)) score = 400;
    else {
      const a = e.aliases.find((x) => x === qN || compact(x).includes(qC));
      if (a && qC.length >= 3) {
        score = 350;
        via = a;
      } else score = 100;
    }
    score += e.occ.length ? 20 : 0;
    score -= Math.min(e.key.length, 40) / 10;
    hits.push({ entry: e, score, via });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key));
  return hits.slice(0, limit);
}

export function signalOf(ix: CEIndex, o: Occ): Signal {
  return sig(ix.ds, o);
}

/** First value with this label across an entry's data sources. */
export function dataValue(e: Entry | undefined, label: string): string | undefined {
  if (!e) return undefined;
  for (const d of e.data) for (const v of d.values) if (v.label === label) return v.value;
  return undefined;
}

/** Notes of an entry, same wording listed once. */
export function entryNotes(e: Entry | undefined): (SignalNote & { source: string })[] {
  if (!e) return [];
  const seen = new Set<string>();
  const out: (SignalNote & { source: string })[] = [];
  for (const d of e.data)
    for (const n of d.notes) {
      const k = n.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (seen.has(k) || /^DELETED\.?$/i.test(n.text)) continue;
      seen.add(k);
      out.push({ ...n, source: d.source });
    }
  return out;
}

export interface TripTarget {
  key: string;
  tag: string;
  effects: number;
  sheets: string[];
}
export interface TripMatch {
  /** exact: same tag · variant: same device with a suffix such as (HH)/(LL) · part: one tag inside a combined C&E tag */
  how: 'exact' | 'variant' | 'part' | 'none';
  targets: TripTarget[];
}

const partIndex = new WeakMap<CEIndex, Map<string, Entry[]>>();

function causeTarget(ix: CEIndex, e: Entry): TripTarget {
  const sheets = [...new Set(e.occ.filter((o) => o.role === 'cause').map((o) => ix.ds.matrices[o.m].name))];
  return { key: e.key, tag: e.tag, effects: effectsOf(ix, e.key).length, sheets };
}

/** Finds the C&E cause row(s) for a tag written in a trip-signal list. */
export function resolveTripTag(ix: CEIndex, tag: string): TripMatch {
  const key = normTag(tag);
  const isCause = (e: Entry) => e.occ.some((o) => o.role === 'cause');
  const exact = ix.byKey.get(key);
  if (exact && isCause(exact)) return { how: 'exact', targets: [causeTarget(ix, exact)] };
  // Same device with a qualifier: "_210PIT7203/4/5" → "_210PIT7203/4/5 (HH)" and "(LL)".
  // Only when the list's tag has no qualifier of its own, so "… 2OO4" never matches "… 1OO4".
  const variants = (ix.byCore.get(coreTag(key)) ?? []).filter((e) => isCause(e) && coreTag(e.tag) === key);
  if (variants.length) return { how: 'variant', targets: variants.map((e) => causeTarget(ix, e)) };
  // One instrument of a combined C&E tag: "_200XA2003" → "_200XA2003/2005".
  let parts = partIndex.get(ix);
  if (!parts) {
    parts = new Map();
    for (const e of ix.entries) {
      if (!isCause(e)) continue;
      for (const a of expandTag(e.tag)) {
        const k = normTag(a);
        if (k === e.key) continue;
        parts.set(k, [...(parts.get(k) ?? []), e]);
      }
    }
    partIndex.set(ix, parts);
  }
  const part = parts.get(key);
  if (part?.length) return { how: 'part', targets: part.map((e) => causeTarget(ix, e)) };
  return { how: 'none', targets: [] };
}
