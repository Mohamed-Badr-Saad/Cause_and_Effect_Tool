import { getPref, setPref } from './store';

export function getRecent(): string[] {
  try {
    const v = JSON.parse(getPref('recent') ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecent(key: string) {
  const list = [key, ...getRecent().filter((k) => k !== key)].slice(0, 12);
  setPref('recent', JSON.stringify(list));
}
