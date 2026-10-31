import { useMemo, useState } from 'react';
import { useApp } from '../lib/context';
import { entryDesc, resolveTripTag, sameSignal, type TripMatch } from '../lib/ceIndex';
import { href } from '../lib/router';
import { normTag } from '../lib/tags';
import { downloadXlsx } from '../lib/xlsxWrite';
import { DropZone, Empty } from '../components/bits';

export function TripsPage({ groupId }: { groupId?: string }) {
  const { ds, ix } = useApp();
  const [filter, setFilter] = useState('');
  const groups = ds.tripGroups;
  const g = groups.find((x) => x.id === groupId) ?? groups[0];

  const counts = useMemo(
    () => groups.map((gr) => gr.items.filter((i) => i.kind === 'signal').length),
    [groups]
  );

  if (!groups.length) {
    return (
      <div className="page">
        <h1 className="page-title">Trip signals</h1>
        <p className="lede small">
          Import the “ESD &amp; Packages trip signals” sheet to see which signals trip each shutdown level and package
          (ESD 0, ESD 1, compressors, GTGs, fire water pumps and so on).
        </p>
        <DropZone compact />
      </div>
    );
  }

  const f = filter.trim().toUpperCase();
  const resolved = new Map<string, TripMatch>();
  const match = (tag: string) => {
    if (!resolved.has(tag)) resolved.set(tag, resolveTripTag(ix, tag));
    return resolved.get(tag)!;
  };
  const shownItems = g.items.map((it) =>
    it.kind === 'signal' && !it.desc && match(it.tag).how === 'none' ? { kind: 'heading' as const, text: it.tag } : it
  );
  const items = shownItems.filter(
    (it) => it.kind === 'heading' || !f || (it.tag + ' ' + it.desc).toUpperCase().includes(f)
  );
  // drop headings with nothing under them after filtering
  const visible = items.filter((it, i) => {
    if (it.kind !== 'heading' || !f) return true;
    const next = items[i + 1];
    return next && next.kind === 'signal';
  });

  const exportGroup = () => {
    const rows: (string | number)[][] = [[g.name], [], ['Cause tag', 'Description', 'In the C&E']];
    for (const it of shownItems) {
      if (it.kind === 'heading') rows.push([it.text]);
      else rows.push([it.tag, it.desc || entryDesc(ix.byKey.get(normTag(it.tag))), describeMatch(match(it.tag))]);
    }
    downloadXlsx([{ name: g.name, rows, titleRows: [0], headerRows: [2], widths: [30, 60, 60] }], `Trip signals for ${g.name}.xlsx`);
  };

  return (
    <div className="page trips-page">
      <h1 className="page-title">Trip signals</h1>
      <div className="trips-layout">
        <ul className="trip-groups" aria-label="Packages and shutdown levels">
          {groups.map((gr, i) => (
            <li key={gr.id}>
              <a href={href('trips', gr.id)} className={gr.id === g.id ? 'on' : ''} aria-current={gr.id === g.id ? 'page' : undefined}>
                <span>{gr.name}</span>
                <span className="count">{counts[i]}</span>
              </a>
            </li>
          ))}
        </ul>
        <section className="trip-detail">
          <div className="toolbar">
            <h2>{g.name}</h2>
            <div className="spacer" />
            <input
              className="filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter this list"
              aria-label="Filter trip signals"
            />
            <button className="btn" onClick={exportGroup}>
              Export to Excel
            </button>
          </div>
          {visible.length === 0 ? (
            <Empty title="No signal in this list matches the filter." />
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th className="c-tag">Cause tag</th>
                  <th className="c-desc">Description</th>
                  <th className="c-cont">In the C&amp;E</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((it, i) =>
                  it.kind === 'heading' ? (
                    <tr key={i} className="group-row">
                      <td colSpan={3}>{it.text}</td>
                    </tr>
                  ) : (
                    <TripRow key={i} tag={it.tag} desc={it.desc} m={match(it.tag)} />
                  )
                )}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function describeMatch(m: TripMatch): string {
  if (m.how === 'none') return 'Not in imported C&E sheets';
  return m.targets
    .map((t) => `${m.how === 'exact' ? '' : m.how === 'part' ? `part of ${t.tag}: ` : `${t.tag}: `}${t.effects} effect${t.effects === 1 ? '' : 's'} in ${t.sheets.join(', ')}`)
    .join('; ');
}

function TripRow({ tag, desc, m }: { tag: string; desc: string; m: TripMatch }) {
  const { ix } = useApp();
  const key = normTag(tag);
  const e = ix.byKey.get(key);
  // nothing matched: point to rows for the same device written with another voting ("… 2OO4" vs "… 1OO4")
  const similar = m.how === 'none' ? sameSignal(ix, key).filter((r) => r.key !== key && r.occ.some((o) => o.role === 'cause')) : [];
  const linkKey = m.how === 'exact' ? key : m.targets.length === 1 ? m.targets[0].key : e?.occ.length ? key : undefined;
  return (
    <tr>
      <td className="c-tag">{linkKey ? <a className="tag" href={href('signal', linkKey)}>{tag}</a> : <span className="tag plain">{tag}</span>}</td>
      <td className="c-desc">{desc || entryDesc(e) || entryDesc(m.targets[0] && ix.byKey.get(m.targets[0].key))}</td>
      <td className="c-cont trip-match">
        {m.how === 'none' ? (
          <>
            <span className="muted" title="No cause row with this tag in the imported C&E sheets">
              Not in imported C&amp;E sheets
            </span>
            {similar.map((r) => (
              <a key={r.key} className="cont tm-similar" href={href('signal', r.key)}>
                <span className="tm-how">The C&amp;E has a different voting: </span>
                {r.tag}
              </a>
            ))}
          </>
        ) : (
          m.targets.map((t) => (
            <a key={t.key} className="cont" href={href('signal', t.key)} title={m.how === 'exact' ? undefined : `Written as ${t.tag} in the C&E`}>
              {m.how === 'variant' && <span className="tm-how">{t.tag.includes('(') ? t.tag.slice(t.tag.indexOf('(')) : t.tag}: </span>}
              {m.how === 'part' && <span className="tm-how">part of {t.tag}: </span>}
              {t.effects} effect{t.effects === 1 ? '' : 's'} in {t.sheets.join(', ')}
            </a>
          ))
        )}
      </td>
    </tr>
  );
}
