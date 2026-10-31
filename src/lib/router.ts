import { useEffect, useState } from 'react';

// Hash-based routing so the app also works when opened straight from a file (file://) or a shared drive.
export type Page = 'home' | 'signal' | 'matrix' | 'trips' | 'data' | 'legend';
export interface Route {
  page: Page;
  arg?: string;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  const [seg, ...rest] = path.split('/');
  const params = new URLSearchParams(qs);
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : undefined;
  const pages: Page[] = ['signal', 'matrix', 'trips', 'data', 'legend'];
  const page = (pages as string[]).includes(seg) ? (seg as Page) : 'home';
  return { page, arg, params };
}

export function href(page: Page, arg?: string, params?: Record<string, string | undefined>): string {
  let h = '#/' + (page === 'home' ? '' : page);
  if (arg !== undefined) h += '/' + encodeURIComponent(arg);
  if (params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    const s = p.toString();
    if (s) h += '?' + s;
  }
  return h;
}

export function navigate(h: string, replace = false) {
  if (replace) {
    history.replaceState(null, '', h);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else window.location.hash = h;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
