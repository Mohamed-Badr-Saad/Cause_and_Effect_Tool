/** Identity key for a tag: case/whitespace-insensitive, ignores a leading "%". */
export function normTag(tag: string): string {
  return tag.trim().replace(/^%/, '').replace(/\s+/g, ' ').toUpperCase();
}

/** Core instrument tag: drops voting/parenthetical suffixes ("_200LIT2036A/B/C (HH)" → "_200LIT2036A/B/C"). */
export function coreTag(tag: string): string {
  return normTag(tag).replace(/\s*\(.*?\)\s*/g, ' ').trim().split(' ')[0] ?? '';
}

/**
 * Expands compound tags into individual instrument tags:
 *   _200XY080C/081C/082C/086C → _200XY080C, _200XY081C, _200XY082C, _200XY086C
 *   _200LIT036A/B/C          → _200LIT036A, _200LIT036B, _200LIT036C
 */
export function expandTag(tag: string): string[] {
  const core = coreTag(tag);
  const parts = core.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return core && core !== normTag(tag) ? [core] : [];
  const base = parts[0];
  const out = [base];
  for (const p of parts.slice(1)) {
    out.push(p.length >= base.length ? p : base.slice(0, base.length - p.length) + p);
  }
  return out;
}

export const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
