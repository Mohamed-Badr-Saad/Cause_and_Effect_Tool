import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../lib/context';
import {
  causesOf,
  continuesAsCause,
  continuesAsEffect,
  dataValue,
  effectsOf,
  entryDesc,
  entryNotes,
  sameSignal,
  type CEIndex,
  type Entry,
  type LinkRow,
} from '../lib/ceIndex';
import { classify, describeCode, type CodeClass } from '../lib/codes';
import { href, navigate } from '../lib/router';
import { pushRecent } from '../lib/recent';
import { downloadXlsx, type ExportSheet } from '../lib/xlsxWrite';
import { CodeChip, Empty, TagLink, copyText } from '../components/bits';
import { TraceView, hasChain } from '../components/TraceView';

type Tab = 'effects' | 'causes' | 'chain';
const CLASS_ORDER: CodeClass[] = ['action', 'delay', 'abort', 'reset', 'inhibit', 'other'];

export function SignalPage({ sigKey, params }: { sigKey: string; params: URLSearchParams }) {
  const { ds, ix } = useApp();
  const entry = ix.byKey.get(sigKey);
  const effects = useMemo(() => effectsOf(ix, sigKey), [ix, sigKey]);
  const causes = useMemo(() => causesOf(ix, sigKey), [ix, sigKey]);
  const chain = useMemo(() => hasChain(ix, sigKey), [ix, sigKey]);
  const related = useMemo(() => sameSignal(ix, sigKey).filter((e) => e.key !== sigKey), [ix, sigKey]);
  const defaultTab: Tab = effects.length || !causes.length ? 'effects' : 'causes';
  const tab = (params.get('tab') as Tab) || defaultTab;

  useEffect(() => {
    if (entry) pushRecent(entry.key);
  }, [entry]);

  if (!entry) {
    return (
      <div className="page">
        <Empty title={`No signal “${sigKey}” in the imported sheets.`}>
          <p>
            It may be in a C&amp;E sheet that has not been imported yet. <a href={href('home', undefined, { q: sigKey })}>Search for similar tags</a>{' '}
            or <a href={href('data')}>import more files</a>.
          </p>
        </Empty>
      </div>
    );
  }

  const setTab = (t: Tab) => navigate(href('signal', sigKey, { tab: t === defaultTab ? undefined : t }), true);
  const appearances = entry.occ.map((o) => {
    const m = ds.matrices[o.m];
    const s = o.role === 'cause' ? m.causes[o.i] : m.effects[o.i];
    return { ...o, name: m.name, num: s.num, id: m.id };
  });

  return (
    <div className="page signal-page">
      <FunctionBlock entry={entry} causes={causes} effects={effects} onTab={setTab} />

      <SignalDataPanel entry={entry} />

      <div className="sig-meta">
        {!entry.occ.length && (
          <span className="where">Not in any imported C&amp;E sheet; set point or note data only</span>
        )}
        {appearances.map((a, i) => (
          <a
            key={i}
            className={'where ' + a.role}
            href={href('matrix', a.id, a.role === 'cause' ? { c: entry.tag } : { e: entry.tag })}
            title="Show in the matrix"
          >
            {a.role === 'cause' ? 'Cause' : 'Effect'} {a.num && `no. ${a.num}`} in {a.name}
          </a>
        ))}
        {entry.trips.map((g) => (
          <a key={g} className="where trip" href={href('trips', ds.tripGroups[g].id)}>
            Trips {ds.tripGroups[g].name}
          </a>
        ))}
        {related.map((r) => (
          <a key={r.key} className="where related" href={href('signal', r.key)} title="Same device tag with a different condition or notation">
            Same device: {r.tag}
          </a>
        ))}
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'effects'} className={tab === 'effects' ? 'on' : ''} onClick={() => setTab('effects')}>
          Effects <span className="count">{effects.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'causes'} className={tab === 'causes' ? 'on' : ''} onClick={() => setTab('causes')}>
          Causes <span className="count">{causes.length}</span>
        </button>
        {chain && (
          <button role="tab" aria-selected={tab === 'chain'} className={tab === 'chain' ? 'on' : ''} onClick={() => setTab('chain')}>
            Trip chain
          </button>
        )}
      </div>

      {tab === 'chain' && chain ? (
        <TraceView root={sigKey} />
      ) : tab === 'causes' ? (
        <LinkTable key="c" ix={ix} rows={causes} kind="causes" signalTag={entry.tag} signalDesc={entryDesc(entry)} />
      ) : (
        <LinkTable key="e" ix={ix} rows={effects} kind="effects" signalTag={entry.tag} signalDesc={entryDesc(entry)} />
      )}
    </div>
  );
}

const MAIN_LABELS = ['Set point', 'Range', 'Units', 'MOS', 'SOS', 'Healthy', 'Voting', 'Action'];

function SignalDataPanel({ entry }: { entry: Entry }) {
  const notes = entryNotes(entry);
  const sources = entry.data.filter((d) => d.values.length);
  const [showAll, setShowAll] = useState(false);
  if (!sources.length && !notes.length) return null;
  const NOTE_LIMIT = 4;
  const shownNotes = showAll ? notes : notes.slice(0, NOTE_LIMIT);
  return (
    <section className="sig-data" aria-label="Set point and notes">
      {sources.length > 0 && (
        <div className="sd-values">
          {sources.map((d, i) => {
            const main = MAIN_LABELS.flatMap((l) => d.values.filter((v) => v.label === l));
            const other = d.values.filter((v) => !MAIN_LABELS.includes(v.label));
            return (
              <div className="sd-row" key={i}>
                <dl>
                  {[...main, ...other].map((v, j) => (
                    <div key={j} className={v.label === 'Set point' ? 'sd-sp' : ''}>
                      <dt>{v.label}</dt>
                      <dd>{v.value}</dd>
                    </div>
                  ))}
                </dl>
                <span className="sd-source">{d.source}</span>
              </div>
            );
          })}
        </div>
      )}
      {notes.length > 0 && (
        <div className="sd-notes">
          <h2>
            Notes <span className="count">{notes.length}</span>
          </h2>
          <ol>
            {shownNotes.map((n, i) => (
              <li key={i}>
                <p>{n.text}</p>
                <span className="sd-where">
                  {[n.where ?? (n.ref ? `note ${n.ref}` : ''), n.source.replace(/,\s*sheets?\s.*$/i, '')].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ol>
          {notes.length > NOTE_LIMIT && (
            <button className="link" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer notes' : `Show all ${notes.length} notes`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function FunctionBlock({
  entry,
  causes,
  effects,
  onTab,
}: {
  entry: Entry;
  causes: LinkRow[];
  effects: LinkRow[];
  onTab: (t: Tab) => void;
}) {
  const PINS = 4;
  const sp = dataValue(entry, 'Set point');
  const range = dataValue(entry, 'Range');
  const units = dataValue(entry, 'Units');
  const action = dataValue(entry, 'Action');
  const pick = (rows: LinkRow[]) => {
    // Prefer showing immediate actions first, then delayed, in chart order.
    return [...rows]
      .sort((a, b) => CLASS_ORDER.indexOf(classify(a.code)) - CLASS_ORDER.indexOf(classify(b.code)))
      .slice(0, PINS);
  };
  return (
    <section className="fblock" aria-label="Signal overview">
      <div className={'pins in' + (causes.length ? '' : ' none')}>
        {causes.length === 0 ? (
          <span className="pin-none">Not an effect in any imported sheet</span>
        ) : (
          <>
            {pick(causes).map((r, i) => (
              <a key={i} className="pin" href={href('signal', r.otherKey)} title={r.other.desc}>
                <span className="pin-tag">{r.other.tag}</span>
                <CodeChip code={r.code} short />
              </a>
            ))}
            {causes.length > PINS && (
              <button className="pin more" onClick={() => onTab('causes')}>
                {causes.length - PINS} more cause{causes.length - PINS > 1 ? 's' : ''}
              </button>
            )}
          </>
        )}
      </div>
      <div className="block">
        <div className="block-tag">{entry.tag}</div>
        <div className="block-desc">{entry.descs[0] || 'No description in the sheet'}</div>
        {entry.descs.length > 1 && <div className="block-alt">Also described as: {entry.descs.slice(1).join('; ')}</div>}
        {(sp || action) && (
          <div className="block-sp">
            {sp && (
              <>
                <span className="sp-label">Set point</span>
                <span className="sp-value">
                  {sp}
                  {units && !sp.includes(units) ? ` ${units}` : ''}
                </span>
                {range && <span className="sp-range">range {range}</span>}
              </>
            )}
            {!sp && action && (
              <>
                <span className="sp-label">Action</span>
                <span className="sp-value">{action}</span>
              </>
            )}
          </div>
        )}
        <div className="block-io">
          <button onClick={() => onTab('causes')} disabled={!causes.length}>
            <strong>{causes.length}</strong> cause{causes.length === 1 ? '' : 's'}
          </button>
          <button onClick={() => onTab('effects')} disabled={!effects.length}>
            <strong>{effects.length}</strong> effect{effects.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
      <div className={'pins out' + (effects.length ? '' : ' none')}>
        {effects.length === 0 ? (
          <span className="pin-none">Not a cause in any imported sheet</span>
        ) : (
          <>
            {pick(effects).map((r, i) => (
              <a key={i} className="pin" href={href('signal', r.otherKey)} title={r.other.desc}>
                <CodeChip code={r.code} short />
                <span className="pin-tag">{r.other.tag}</span>
              </a>
            ))}
            {effects.length > PINS && (
              <button className="pin more" onClick={() => onTab('effects')}>
                {effects.length - PINS} more effect{effects.length - PINS > 1 ? 's' : ''}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

type SortKey = 'chart' | 'code' | 'tag' | 'desc' | 'sheet';

function LinkTable({
  ix,
  rows,
  kind,
  signalTag,
  signalDesc,
}: {
  ix: CEIndex;
  rows: LinkRow[];
  kind: 'effects' | 'causes';
  signalTag: string;
  signalDesc: string;
}) {
  const { ds, notify } = useApp();
  const [filter, setFilter] = useState('');
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<number | null>(null);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'chart', dir: 1 });
  const [group, setGroup] = useState(false);

  const codeCounts = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const r of rows) {
      const k = r.code.toUpperCase().replace(/\s+/g, ' ');
      const v = m.get(k);
      if (v) v.n++;
      else m.set(k, { label: r.code, n: 1 });
    }
    return [...m.entries()].sort(
      (a, b) =>
        CLASS_ORDER.indexOf(classify(a[0])) - CLASS_ORDER.indexOf(classify(b[0])) || b[1].n - a[1].n
    );
  }, [rows]);
  const sheets = useMemo(() => [...new Set(rows.map((r) => r.m))], [rows]);

  const shown = useMemo(() => {
    const f = filter.trim().toUpperCase();
    let out = rows.filter(
      (r) =>
        (!codes.size || codes.has(r.code.toUpperCase().replace(/\s+/g, ' '))) &&
        (sheet === null || r.m === sheet) &&
        (!f || (r.other.tag + ' ' + r.other.desc).toUpperCase().includes(f))
    );
    const cmp: Record<SortKey, (a: LinkRow, b: LinkRow) => number> = {
      chart: (a, b) => a.m - b.m || a.j - b.j,
      code: (a, b) =>
        CLASS_ORDER.indexOf(classify(a.code)) - CLASS_ORDER.indexOf(classify(b.code)) || a.code.localeCompare(b.code) || a.j - b.j,
      tag: (a, b) => a.other.tag.localeCompare(b.other.tag, undefined, { numeric: true }),
      desc: (a, b) => a.other.desc.localeCompare(b.other.desc),
      sheet: (a, b) => ds.matrices[a.m].name.localeCompare(ds.matrices[b.m].name) || a.j - b.j,
    };
    return [...out].sort((a, b) => cmp[sort.k](a, b) * sort.dir);
  }, [rows, filter, codes, sheet, sort, ds.matrices]);

  const grouped = useMemo(() => {
    if (!group) return null;
    const g = new Map<string, LinkRow[]>();
    for (const r of shown) {
      const k = r.code.toUpperCase().replace(/\s+/g, ' ');
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(r);
    }
    return [...g.entries()].sort(
      (a, b) => CLASS_ORDER.indexOf(classify(a[0])) - CLASS_ORDER.indexOf(classify(b[0])) || b[1].length - a[1].length
    );
  }, [shown, group]);

  const otherLabel = kind === 'effects' ? 'Effect' : 'Cause';
  // Set point for causes, action (CLOSE / STOP …) for effects — whatever the imported data has.
  const dataLabel = kind === 'causes' ? 'Set point' : 'Action';
  const rowInfo = useMemo(() => {
    const m = new Map<string, { value?: string; notes: string[] }>();
    for (const r of rows) {
      if (m.has(r.otherKey)) continue;
      const e = ix.byKey.get(r.otherKey);
      m.set(r.otherKey, {
        value: dataValue(e, dataLabel) ?? (kind === 'causes' ? undefined : dataValue(e, 'Set point')),
        notes: entryNotes(e).map((n) => n.text),
      });
    }
    return m;
  }, [rows, ix, dataLabel, kind]);
  const hasValue = [...rowInfo.values()].some((v) => v.value);
  const hasNotes = [...rowInfo.values()].some((v) => v.notes.length);

  if (!rows.length) {
    return (
      <Empty title={kind === 'effects' ? 'This signal does not act on anything.' : 'Nothing in the imported sheets acts on this signal.'}>
        <p>
          {kind === 'effects'
            ? 'It does not appear as a cause (a row) in any imported C&E sheet.'
            : 'It does not appear as an effect (a column) in any imported C&E sheet.'}
        </p>
      </Empty>
    );
  }

  const exportRows = () => {
    const header = [`${otherLabel} tag`, 'Action', 'Meaning', `${otherLabel} description`, 'Sheet', `${otherLabel} no.`];
    if (hasValue) header.push(kind === 'causes' ? 'Set point' : 'Effect action');
    if (hasNotes) header.push('Notes');
    const body = shown.map((r) => {
      const info = rowInfo.get(r.otherKey);
      const row = [r.other.tag, r.code, describeCode(r.code), r.other.desc, ds.matrices[r.m].name, r.other.num];
      if (hasValue) row.push(info?.value ?? '');
      if (hasNotes) row.push((info?.notes ?? []).join('\n'));
      return row;
    });
    return { header, body };
  };

  const doExport = () => {
    const { header, body } = exportRows();
    const sheetDef: ExportSheet = {
      name: kind === 'effects' ? 'Effects' : 'Causes',
      rows: [
        ['Signal', signalTag],
        ['Description', signalDesc],
        [kind === 'effects' ? 'Effects of this signal' : 'Causes acting on this signal', `${body.length} rows`],
        [],
        header,
        ...body,
      ],
      titleRows: [0],
      headerRows: [4],
      widths: [30, 18, 44, 60, 16, 10, 14, 80],
    };
    downloadXlsx([sheetDef], `${signalTag.replace(/\//g, '-')} ${kind === 'effects' ? 'Effects' : 'Causes'}.xlsx`);
  };

  const doCopy = async () => {
    const { header, body } = exportRows();
    const ok = await copyText([header, ...body].map((r) => r.join('\t')).join('\n'));
    notify({ tone: ok ? 'ok' : 'error', text: ok ? `Copied ${body.length} rows. Paste into Excel or an email.` : 'Could not copy to the clipboard.' });
  };

  const th = (k: SortKey, label: string, cls?: string) => (
    <th className={cls} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        {sort.k === k && <span aria-hidden="true">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  );

  const renderRow = (r: LinkRow, i: number) => {
    const cont = kind === 'effects' ? continuesAsCause(ix, r.otherKey) : continuesAsEffect(ix, r.otherKey);
    return (
      <tr key={i} onClick={(e) => (e.target as HTMLElement).closest('a,button') || navigate(href('signal', r.otherKey))}>
        <td className="c-code">
          <CodeChip code={r.code} />
        </td>
        <td className="c-tag">
          <TagLink tag={r.other.tag} />
        </td>
        <td className="c-desc">
          {r.other.desc}
          {(rowInfo.get(r.otherKey)?.notes.length ?? 0) > 0 && (
            <span className="note-mark" title={rowInfo.get(r.otherKey)!.notes.join('\n\n')}>
              {rowInfo.get(r.otherKey)!.notes.length} note{rowInfo.get(r.otherKey)!.notes.length > 1 ? 's' : ''}
            </span>
          )}
        </td>
        {hasValue && <td className="c-sp">{rowInfo.get(r.otherKey)?.value}</td>}
        <td className="c-sheet">{ds.matrices[r.m].name}</td>
        <td className="c-num">{r.other.num}</td>
        <td className="c-cont">
          {cont && (
            <a
              href={href('signal', cont.key, { tab: kind === 'effects' ? undefined : 'causes' })}
              className="cont"
              title={kind === 'effects' ? 'This effect is also a cause in another sheet' : 'This cause is also an effect in another sheet'}
            >
              {kind === 'effects' ? `then ${cont.count} effect${cont.count === 1 ? '' : 's'}` : `from ${cont.count} cause${cont.count === 1 ? '' : 's'}`}
            </a>
          )}
        </td>
      </tr>
    );
  };

  return (
    <section className="link-table">
      <div className="toolbar">
        <input
          className="filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${kind} by tag or description`}
          aria-label={`Filter ${kind}`}
        />
        <div className="code-filters" role="group" aria-label="Filter by action code">
          {codeCounts.map(([k, v]) => (
            <button
              key={k}
              className={'code-toggle' + (codes.has(k) ? ' on' : '')}
              aria-pressed={codes.has(k)}
              data-c={classify(k)}
              title={describeCode(k)}
              onClick={() =>
                setCodes((s) => {
                  const n = new Set(s);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                })
              }
            >
              {v.label} <span>{v.n}</span>
            </button>
          ))}
        </div>
        {sheets.length > 1 && (
          <select value={sheet ?? ''} onChange={(e) => setSheet(e.target.value === '' ? null : Number(e.target.value))} aria-label="Sheet">
            <option value="">All sheets</option>
            {sheets.map((m) => (
              <option key={m} value={m}>
                {ds.matrices[m].name}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} /> Group by action
        </label>
        <div className="spacer" />
        <button className="btn" onClick={doCopy}>
          Copy
        </button>
        <button className="btn" onClick={doExport}>
          Export to Excel
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <p className="showing">
        Showing {shown.length} of {rows.length} {kind}
        {(codes.size > 0 || filter || sheet !== null) && (
          <button
            className="link"
            onClick={() => {
              setCodes(new Set());
              setFilter('');
              setSheet(null);
            }}
          >
            Clear filters
          </button>
        )}
      </p>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {th('code', 'Action', 'c-code')}
              {th('tag', `${otherLabel} tag`, 'c-tag')}
              {th('desc', 'Description', 'c-desc')}
              {hasValue && <th className="c-sp">{kind === 'causes' ? 'Set point' : 'Effect action'}</th>}
              {th('sheet', 'Sheet', 'c-sheet')}
              {th('chart', 'No.', 'c-num')}
              <th className="c-cont">{kind === 'effects' ? 'Continues' : 'Comes from'}</th>
            </tr>
          </thead>
          {grouped ? (
            grouped.map(([k, list]) => (
              <tbody key={k}>
                <tr className="group-row">
                  <td colSpan={hasValue ? 7 : 6}>
                    <CodeChip code={list[0].code} /> {describeCode(k)} <span className="count">{list.length}</span>
                  </td>
                </tr>
                {list.map(renderRow)}
              </tbody>
            ))
          ) : (
            <tbody>{shown.map(renderRow)}</tbody>
          )}
        </table>
      </div>
    </section>
  );
}
