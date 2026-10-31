import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/context';
import { causesOf, dataValue, effectsOf, entryDesc, entryNotes, search, type Role } from '../lib/ceIndex';
import { href, navigate } from '../lib/router';
import { getRecent } from '../lib/recent';
import { DropZone, Highlight } from '../components/bits';

export function HomePage({ query, params }: { query: string; params: URLSearchParams }) {
  const { ds, ix } = useApp();
  const role = (params.get('role') as Role | 'all' | null) ?? 'all';
  const sheet = params.get('sheet') ?? '';
  const mIndex = sheet ? ds.matrices.findIndex((m) => m.id === sheet) : -1;
  const hits = useMemo(
    () => search(ix, query, 300, role, mIndex >= 0 ? mIndex : undefined),
    [ix, query, role, mIndex]
  );
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = () => {
      if (hits[0]) navigate(href('signal', hits[0].entry.key));
    };
    window.addEventListener('ce-open-first', open);
    return () => window.removeEventListener('ce-open-first', open);
  }, [hits]);

  if (!ds.matrices.length && !ds.tripGroups.length && !ds.signalData?.length) return <Welcome />;
  if (!query.trim()) return <Overview />;

  const setParam = (k: string, v: string) =>
    navigate(href('home', undefined, { q: query, role, sheet, [k]: v }), true);

  return (
    <div className="page">
      <div className="results-head">
        <h1 className="page-title">
          {hits.length === 300 ? 'First 300 matches' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`}
        </h1>
        <div className="filters">
          <div className="seg" role="group" aria-label="Signal role">
            {(['all', 'cause', 'effect'] as const).map((r) => (
              <button key={r} className={role === r ? 'on' : ''} onClick={() => setParam('role', r)}>
                {r === 'all' ? 'All' : r === 'cause' ? 'Causes' : 'Effects'}
              </button>
            ))}
          </div>
          {ds.matrices.length > 1 && (
            <select value={sheet} onChange={(e) => setParam('sheet', e.target.value)} aria-label="Sheet">
              <option value="">All sheets</option>
              {ds.matrices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {hits.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No signal matches “{query}”.</p>
          <p>
            Try part of the tag (for example <code>XS001</code> instead of <code>_200XS001</code>) or a word from the
            description. Search ignores case, spaces and punctuation.
          </p>
        </div>
      ) : (
        <div
          className="results"
          ref={list}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = [...(list.current?.querySelectorAll<HTMLElement>('a.result') ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            const next = e.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : i - 1;
            if (next < 0) (document.querySelector('.search input') as HTMLElement | null)?.focus();
            else items[next]?.focus();
          }}
        >
          {hits.map(({ entry, via }) => {
            const nEff = entry.occ.some((o) => o.role === 'cause') ? effectsOf(ix, entry.key).length : 0;
            const nCau = entry.occ.some((o) => o.role === 'effect') ? causesOf(ix, entry.key).length : 0;
            return (
              <a key={entry.key} className="result" href={href('signal', entry.key)}>
                <span className="r-tag">
                  <Highlight text={entry.tag} query={query} />
                  {via && <span className="via">matches {via}</span>}
                </span>
                <span className="r-desc">
                  <Highlight text={entryDesc(entry) || '—'} query={query} />
                </span>
                <span className="r-where">
                  {entry.occ.map((o, i) => (
                    <span key={i} className={'where ' + o.role}>
                      {o.role === 'cause' ? 'Cause' : 'Effect'} in {ds.matrices[o.m].name}
                    </span>
                  ))}
                  {entry.trips.length > 0 && <span className="where trip">In {entry.trips.length} trip list{entry.trips.length > 1 ? 's' : ''}</span>}
                  {!entry.occ.length && <span className="where">Set point / note data only</span>}
                </span>
                <span className="r-counts">
                  {dataValue(entry, 'Set point') && <span className="r-sp">SP {dataValue(entry, 'Set point')}</span>}
                  {entryNotes(entry).length > 0 && (
                    <span>
                      {entryNotes(entry).length} note{entryNotes(entry).length > 1 ? 's' : ''}
                    </span>
                  )}
                  {nCau > 0 && <span title="Causes that act on this signal">{nCau} cause{nCau > 1 ? 's' : ''}</span>}
                  {nEff > 0 && <span title="Effects this signal acts on">{nEff} effect{nEff > 1 ? 's' : ''}</span>}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="page welcome">
      <h1 className="hero-title">Find what a signal trips, and what trips it.</h1>
      <p className="lede">
        Import your cause and effect workbooks. They are read inside this browser and are not uploaded anywhere. Once
        imported, they stay here for next time.
      </p>
      <DropZone />
      <LayoutHelp />
    </div>
  );
}

export function LayoutHelp() {
  return (
    <section className="layout-help">
      <h2>Sheet layouts the importer recognises</h2>
      <div className="lh-grid">
        <figure>
          <table className="mini">
            <tbody>
              <tr>
                <td />
                <td />
                <td className="h">Controller</td>
                <td className="d">Effect description…</td>
              </tr>
              <tr>
                <td />
                <td />
                <td className="h">TAG No.</td>
                <td className="t">_200XY063A/B …</td>
              </tr>
              <tr>
                <td />
                <td />
                <td />
                <td className="n">1 2 3 …</td>
              </tr>
              <tr>
                <td className="t">_200XS001</td>
                <td className="d">Cause description</td>
                <td className="n">1</td>
                <td>
                  <span className="code" data-c="action">X</span> <span className="code" data-c="delay">T 1Min</span>
                </td>
              </tr>
            </tbody>
          </table>
          <figcaption>
            <strong>C&amp;E matrix</strong> (ESD C&amp;E 1, ESD C&amp;E 2, F&amp;G C&amp;E). Effect descriptions in
            row 1, effect tags in the “TAG No.” row, causes from column A down, action codes where they meet.
          </figcaption>
        </figure>
        <figure>
          <table className="mini">
            <tbody>
              <tr>
                <td className="h" colSpan={2}>ESD 0</td>
                <td className="h" colSpan={2}>GTG's</td>
              </tr>
              <tr>
                <td className="h">Cause Tag</td>
                <td className="h">Description</td>
                <td className="h">Cause Tag</td>
                <td className="h">Description</td>
              </tr>
              <tr>
                <td className="d" colSpan={2}>Level 0 for Zone 1</td>
                <td className="t">_200XS001</td>
                <td className="d">Level 0 PB</td>
              </tr>
              <tr>
                <td className="t">_200XS001</td>
                <td className="d">Level 0 PB</td>
                <td className="t">_XS7000</td>
                <td className="d">Level 0 PB</td>
              </tr>
            </tbody>
          </table>
          <figcaption>
            <strong>Trip-signal list</strong> (ESD &amp; Packages trip signals). A group name over each pair of
            “Cause Tag / Description” columns. A line with no description is read as a sub-heading.
          </figcaption>
        </figure>
        <figure>
          <table className="mini">
            <tbody>
              <tr>
                <td className="h">Tag</td>
                <td className="h">Set point</td>
                <td className="h">Range</td>
                <td className="h">Notes</td>
              </tr>
              <tr>
                <td className="t">_200PAHH2017</td>
                <td className="n">65</td>
                <td className="n">0-250</td>
                <td className="n">25, 32</td>
              </tr>
              <tr>
                <td className="h">No.</td>
                <td className="h" colSpan={3}>Note</td>
              </tr>
              <tr>
                <td className="n">25</td>
                <td className="d" colSpan={3}>2OO2 low low level … will cause ESD2 after 1 hr</td>
              </tr>
            </tbody>
          </table>
          <figcaption>
            <strong>Set points and notes.</strong> Either columns to the right of a C&amp;E matrix (header in the
            effect-number row), or a “Signal data” sheet with a Tag column. Also recognised: Range, Units, MOS, SOS,
            Voting, Action, Note text. Note numbers are looked up in a “Notes” sheet (No. and Note columns, optional
            Sheet column).
          </figcaption>
        </figure>
        <figure>
          <table className="mini">
            <tbody>
              <tr>
                <td className="h">Table 2</td>
                <td className="h">Table 3</td>
                <td className="h">Table 4</td>
                <td className="h">…</td>
              </tr>
              <tr>
                <td className="d" colSpan={4}>NOTES / ACTION / HEALTHY / DESCRIPTION / TAG No. above the effects</td>
              </tr>
              <tr>
                <td className="h">TAG No.</td>
                <td className="h">DESCRIPTION</td>
                <td className="h">SETTING</td>
                <td className="h">NOTES</td>
              </tr>
              <tr>
                <td className="t">_200XS001</td>
                <td className="d">Level 0 PB</td>
                <td className="n" />
                <td>
                  <span className="code" data-c="action">X</span> <span className="code" data-c="delay">Tx</span>
                </td>
              </tr>
            </tbody>
          </table>
          <figcaption>
            <strong>Chart converted from PDF</strong> (e.g. As Configured ESD C&amp;E saved to Excel by Acrobat or a
            converter), imported as it comes: one sheet per PDF page. Pages that repeat the same causes become one
            matrix, the rest another. Set points, sections, actions and the numbered notes printed on each page are
            attached to the signals. Merged mark cells, rotated landscape pages and two pages in one sheet are handled.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function Overview() {
  const { ds, ix } = useApp();
  const [recent] = useState(getRecent);
  const recents = recent.map((k) => ix.byKey.get(k)).filter(Boolean);
  return (
    <div className="page">
      <h1 className="page-title">Start with a tag, or open a sheet</h1>
      <p className="lede small">
        Type in the search box above (press <kbd>/</kbd> to jump there). Results cover every imported sheet, and
        compound tags such as <code>_200XY080C/081C/082C</code> are found by any of their parts.
      </p>
      <div className="sheet-list">
        {ds.matrices.map((m) => (
          <a key={m.id} className="sheet-card" href={href('matrix', m.id)}>
            <span className="sc-name">{m.name}</span>
            <span className="sc-meta">
              {m.causes.length} causes, {m.effects.length} effects, {m.links.length.toLocaleString()} marks
            </span>
            <span className="sc-src">{m.source}</span>
          </a>
        ))}
        {ds.tripGroups.length > 0 && (
          <a className="sheet-card" href={href('trips')}>
            <span className="sc-name">Trip signals</span>
            <span className="sc-meta">{ds.tripGroups.length} packages and shutdown levels</span>
            <span className="sc-src">{ds.tripGroups[0].source}</span>
          </a>
        )}
      </div>
      {recents.length > 0 && (
        <section className="recent">
          <h2>Recently opened</h2>
          <ul>
            {recents.map((e) => (
              <li key={e!.key}>
                <a className="tag" href={href('signal', e!.key)}>
                  {e!.tag}
                </a>
                <span>{entryDesc(e)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
