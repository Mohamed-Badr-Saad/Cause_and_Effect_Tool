import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppCtx, useApp, type AppState, type Toast } from './lib/context';
import { buildIndex } from './lib/ceIndex';
import { emptyDataset, type Dataset } from './lib/model';
import { importFiles as runImport } from './lib/importFiles';
import { loadDataset, saveDataset, getPref, setPref } from './lib/store';
import { href, navigate, useRoute } from './lib/router';
import { HomePage } from './pages/HomePage';
import { SignalPage } from './pages/SignalPage';
import { MatrixPage } from './pages/MatrixPage';
import { TripsPage } from './pages/TripsPage';
import { DataPage } from './pages/DataPage';
import { LegendPage } from './pages/LegendPage';

type Theme = 'light' | 'dark' | 'system';

export default function App() {
  const [ds, setDs] = useState<Dataset>(emptyDataset);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => (getPref('theme') as Theme) || 'system');
  const [navOpen, setNavOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toastId = useRef(1);
  const route = useRoute();
  const ix = useMemo(() => buildIndex(ds), [ds]);

  useEffect(() => {
    loadDataset().then((d) => {
      if (d && Array.isArray(d.matrices)) setDs(d);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    setPref('theme', theme === 'system' ? null : theme);
  }, [theme]);

  useEffect(() => setNavOpen(false), [route.page, route.arg]);

  const notify = useCallback((t: Omit<Toast, 'id'>) => {
    const id = toastId.current++;
    setToasts((ts) => [...ts, { ...t, id }]);
    if (t.tone !== 'error') setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.action ? 12000 : 7000);
  }, []);

  const commit = useCallback(
    (next: Dataset) => {
      setDs(next);
      saveDataset(next).then((ok) => {
        if (!ok)
          notify({
            tone: 'info',
            text: 'This browser would not keep the data, so you will need to import the files again next time.',
          });
      });
    },
    [notify]
  );

  const doImport = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy(`Reading ${files.length === 1 ? files[0].name : files.length + ' files'}…`);
      try {
        const out = await runImport(files, ds);
        commit(out.dataset);
        const good = out.messages.filter((m) => m.ok);
        const bad = out.messages.filter((m) => !m.ok);
        if (good.length === 1) notify({ tone: 'ok', title: good[0].file, text: good[0].text });
        else if (good.length > 1) {
          const n = out.dataset.matrices.length;
          const g = out.dataset.tripGroups.length;
          notify({
            tone: 'ok',
            title: `Imported ${good.length} files`,
            text: `${n} C&E sheet${n === 1 ? '' : 's'}${g ? ` and ${g} trip groups` : ''} are now loaded.`,
          });
        }
        for (const m of bad) notify({ tone: 'error', title: m.file, text: m.text });
        if (out.messages.some((m) => m.ok) && route.page === 'home' && !ds.matrices.length) navigate(href('home'));
      } finally {
        setBusy(null);
      }
    },
    [ds, commit, notify, route.page]
  );

  // Drop files anywhere in the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      if (--depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      doImport([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [doImport]);

  // Every removal can be undone from the notice that follows it.
  const removeWithUndo = (next: Dataset, message: string) => {
    const prev = ds;
    commit(next);
    notify({ tone: 'info', text: message, action: { label: 'Undo', run: () => commit(prev) } });
  };

  const state: AppState = {
    ds,
    ix,
    busy,
    importFiles: doImport,
    openPicker: () => fileInput.current?.click(),
    removeMatrix: (id) =>
      removeWithUndo({ ...ds, matrices: ds.matrices.filter((m) => m.id !== id) }, `Removed C&E sheet ${ds.matrices.find((m) => m.id === id)?.name ?? id}.`),
    removeTrips: () => removeWithUndo({ ...ds, tripGroups: [] }, 'Removed the trip-signal lists.'),
    removeSignalData: (file) =>
      removeWithUndo({ ...ds, signalData: (ds.signalData ?? []).filter((d) => d.file !== file) }, `Removed set points and notes from ${file}.`),
    removeFile: (name) => {
      const sheets = ds.matrices.filter((m) => m.source === name).length;
      const next: Dataset = {
        matrices: ds.matrices.filter((m) => m.source !== name),
        tripGroups: ds.tripGroups.filter((g) => g.source !== name),
        signalData: (ds.signalData ?? []).filter((d) => d.file !== name),
        files: ds.files.filter((f) => f.name !== name),
      };
      removeWithUndo(next, sheets ? `Removed ${name} and its ${sheets} C&E sheet${sheets > 1 ? 's' : ''}.` : `Removed ${name}.`);
    },
    clearAll: () => removeWithUndo(emptyDataset(), 'Removed all imported data.'),
    notify,
  };

  const hasData = ds.matrices.length > 0 || ds.tripGroups.length > 0 || (ds.signalData?.length ?? 0) > 0;
  let page;
  if (!loaded) page = <div className="loading">Loading saved data…</div>;
  else if (route.page === 'signal' && route.arg) page = <SignalPage key={route.arg} sigKey={route.arg} params={route.params} />;
  else if (route.page === 'matrix') page = <MatrixPage key={route.arg} id={route.arg} params={route.params} />;
  else if (route.page === 'trips') page = <TripsPage groupId={route.arg} />;
  else if (route.page === 'data') page = <DataPage />;
  else if (route.page === 'legend') page = <LegendPage />;
  else page = <HomePage query={route.params.get('q') ?? ''} params={route.params} />;

  const nextTheme: Record<Theme, Theme> = { system: 'dark', dark: 'light', light: 'system' };

  return (
    <AppCtx.Provider value={state}>
      <div className="shell">
        <TopBar
          hasData={hasData}
          theme={theme}
          onTheme={() => setTheme(nextTheme[theme])}
          onMenu={() => setNavOpen((v) => !v)}
          query={route.page === 'home' ? route.params.get('q') ?? '' : ''}
        />
        <nav className={'sidebar' + (navOpen ? ' open' : '')} aria-label="Sections">
          <SideNav />
        </nav>
        <main className="main" id="main">
          {page}
        </main>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".xlsx,.xlsm,.xls"
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          doImport(files);
        }}
      />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div>Drop to import C&E workbooks</div>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {busy && <div className="toast info">{busy}</div>}
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.tone}>
            <div>
              {t.title && <strong>{t.title}</strong>}
              <span>{t.text}</span>
            </div>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  setToasts((ts) => ts.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Dismiss" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

function TopBar({
  hasData,
  theme,
  onTheme,
  onMenu,
  query,
}: {
  hasData: boolean;
  theme: Theme;
  onTheme: () => void;
  onMenu: () => void;
  query: string;
}) {
  const { openPicker, busy } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(query);
  const route = useRoute();
  useEffect(() => {
    if (route.page === 'home') setValue(query);
  }, [query, route.page]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const themeLabel = theme === 'system' ? 'Theme: system' : theme === 'dark' ? 'Theme: dark' : 'Theme: light';
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open sections">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
      <a className="brand" href={href('home')}>
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="9" y="7" width="14" height="18" rx="1.5" className="b-box" />
          <path d="M2 12h7M2 20h7" className="b-in" />
          <path d="M23 16h7" className="b-out" />
        </svg>
        <span>C&amp;E Explorer</span>
      </a>
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('ce-open-first'));
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M13 13l4.5 4.5" />
        </svg>
        <input
          ref={input}
          value={value}
          disabled={!hasData}
          onChange={(e) => {
            setValue(e.target.value);
            navigate(href('home', undefined, { q: e.target.value }), route.page === 'home');
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              (document.querySelector('.results a.result') as HTMLElement | null)?.focus();
            } else if (e.key === 'Escape') {
              setValue('');
              navigate(href('home'), true);
            }
          }}
          placeholder={hasData ? 'Search a tag or description, e.g. XS001 or confirmed fire' : 'Import a C&E workbook to start searching'}
          aria-label="Search signals"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd>/</kbd>
      </form>
      <div className="top-actions">
        <button className="btn" onClick={openPicker} disabled={!!busy}>
          Import Excel
        </button>
        <button className="icon-btn" onClick={onTheme} aria-label={themeLabel} title={themeLabel}>
          {theme === 'dark' ? (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z" />
            </svg>
          ) : theme === 'light' ? (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="3.5" />
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 3a7 7 0 0 1 0 14z" className="fill" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}

function SideNav() {
  const { ds } = useApp();
  const route = useRoute();
  const is = (p: string, arg?: string) => route.page === p && (arg === undefined || route.arg === arg);
  return (
    <>
      <a className={'nav-item' + (is('home') ? ' active' : '')} href={href('home')}>
        Search
      </a>
      <p className="nav-group">C&amp;E sheets</p>
      {ds.matrices.length === 0 && <p className="nav-note">None imported yet</p>}
      {ds.matrices.map((m, i) => (
        <a
          key={m.id}
          className={'nav-item' + (is('matrix', m.id) || (route.page === 'matrix' && !route.arg && i === 0) ? ' active' : '')}
          href={href('matrix', m.id)}
        >
          <span>{m.name}</span>
          <span className="count">{m.causes.length}×{m.effects.length}</span>
        </a>
      ))}
      <p className="nav-group">Packages</p>
      <a className={'nav-item' + (is('trips') ? ' active' : '')} href={href('trips')}>
        <span>Trip signals</span>
        {ds.tripGroups.length > 0 && <span className="count">{ds.tripGroups.length}</span>}
      </a>
      <p className="nav-group">Reference</p>
      <a className={'nav-item' + (is('legend') ? ' active' : '')} href={href('legend')}>
        Action codes
      </a>
      <a className={'nav-item' + (is('data') ? ' active' : '')} href={href('data')}>
        Imported files
      </a>
      <div className="credit">
        <span>Developed by</span>
        <strong>Mohamed Badr</strong>
        <span className="credit-links">
          <a href="https://mohamed-badr-nine.vercel.app/" target="_blank" rel="noopener noreferrer">Portfolio</a>
          <span aria-hidden="true">·</span>
          <a href="https://www.linkedin.com/in/mohamed-badr-95283b278" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        </span>
      </div>
    </>
  );
}
