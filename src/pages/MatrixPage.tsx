import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/context';
import { classify, describeCode, shortCode } from '../lib/codes';
import { href, navigate } from '../lib/router';
import { normTag } from '../lib/tags';
import { dataValue, entryNotes } from '../lib/ceIndex';
import { downloadXlsx } from '../lib/xlsxWrite';
import { CodeChip, Empty } from '../components/bits';

const CW = 30; // column width
const RH = 26; // row height
const HH = 168; // column header height
const RW = 340; // row header width
const OVERSCAN = 6;

export function MatrixPage({ id, params }: { id?: string; params: URLSearchParams }) {
  const { ds, ix } = useApp();
  const mi = id ? ds.matrices.findIndex((m) => m.id === id) : 0;
  const m = ds.matrices[mi];
  const [cq, setCq] = useState(params.get('c') ?? '');
  const [eq, setEq] = useState(params.get('e') ?? '');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [pinned, setPinned] = useState<{ r: number; c: number } | null>(null);

  // Set point per cause row (from imported signal data), shown beside the row header
  const causeSp = useMemo(() => (m ? m.causes.map((c) => dataValue(ix.byKey.get(normTag(c.tag)), 'Set point') ?? '') : []), [m, ix]);

  // Lookup cell code by (cause, effect)
  const cellMap = useMemo(() => {
    const map = new Map<number, string>();
    if (!m) return map;
    const W = m.effects.length;
    for (const [c, e, code] of m.links) map.set(c * W + e, code);
    return map;
  }, [m]);

  const { rows, cols } = useMemo(() => {
    if (!m) return { rows: [] as number[], cols: [] as number[] };
    const match = (q: string, tag: string, desc: string) => {
      const terms = q
        .split(/[,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!terms.length) return true;
      const hay = (tag + ' ' + desc).toUpperCase();
      const nt = normTag(tag);
      return terms.some((t) => hay.includes(t) || nt === normTag(t));
    };
    let rws = m.causes.map((_, i) => i).filter((i) => match(cq, m.causes[i].tag, m.causes[i].desc));
    let cls = m.effects.map((_, i) => i).filter((i) => match(eq, m.effects[i].tag, m.effects[i].desc));
    if (hideEmpty) {
      const rowSet = new Set(rws);
      const colSet = new Set(cls);
      const usedC = new Set<number>();
      const usedR = new Set<number>();
      for (const [c, e] of m.links) {
        if (rowSet.has(c) && colSet.has(e)) {
          usedC.add(e);
          usedR.add(c);
        }
      }
      cls = cls.filter((c) => usedC.has(c));
      rws = rws.filter((r) => usedR.has(r));
    }
    return { rows: rws, cols: cls };
  }, [m, cq, eq, hideEmpty]);

  // keep URL in sync so a filtered view can be bookmarked or shared
  useEffect(() => {
    if (!m) return;
    const t = setTimeout(() => navigate(href('matrix', m.id, { c: cq || undefined, e: eq || undefined }), true), 300);
    return () => clearTimeout(t);
  }, [cq, eq, m]);

  if (!ds.matrices.length) {
    return (
      <div className="page">
        <Empty title="No C&E sheets imported yet.">
          <p>
            <a href={href('data')}>Import a workbook</a> to see its matrix here.
          </p>
        </Empty>
      </div>
    );
  }
  if (!m) {
    return (
      <div className="page">
        <Empty title={`Sheet “${id}” is not imported.`}>
          <p>Choose a sheet from the list on the left.</p>
        </Empty>
      </div>
    );
  }

  const focus = pinned ?? hover;
  const fCause = focus ? m.causes[focus.r] : null;
  const fEffect = focus ? m.effects[focus.c] : null;
  const fCode = focus ? cellMap.get(focus.r * m.effects.length + focus.c) : undefined;
  const fNotes = fCause ? entryNotes(ix.byKey.get(normTag(fCause.tag))).length : 0;

  const exportView = () => {
    const header = ['Cause tag', 'Cause description', 'Set point', ...cols.map((c) => m.effects[c].tag)];
    const descRow = ['', 'Effect description →', '', ...cols.map((c) => m.effects[c].desc)];
    const body = rows.map((r) => [
      m.causes[r].tag,
      m.causes[r].desc,
      causeSp[r] ?? '',
      ...cols.map((c) => cellMap.get(r * m.effects.length + c) ?? ''),
    ]);
    downloadXlsx(
      [{ name: m.name, rows: [descRow, header, ...body], headerRows: [1], widths: [26, 50, 12, ...cols.map(() => 14)] }],
      `${m.name} (filtered).xlsx`
    );
  };

  return (
    <div className="page matrix-page">
      <div className="matrix-head">
        <div>
          <h1 className="page-title">{m.name}</h1>
          <p className="sub">
            {m.source}. Showing {rows.length} of {m.causes.length} causes and {cols.length} of {m.effects.length} effects.
          </p>
        </div>
        <div className="toolbar">
          <input
            className="filter"
            value={cq}
            onChange={(e) => setCq(e.target.value)}
            placeholder="Filter causes (separate several with commas)"
            aria-label="Filter causes"
          />
          <input
            className="filter"
            value={eq}
            onChange={(e) => setEq(e.target.value)}
            placeholder="Filter effects"
            aria-label="Filter effects"
          />
          <label className="check">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty
            rows and columns
          </label>
          <button className="btn" onClick={exportView} disabled={!rows.length || !cols.length}>
            Export this view
          </button>
        </div>
      </div>

      {rows.length === 0 || cols.length === 0 ? (
        <Empty title="Nothing matches these filters.">
          <p>Clear a filter, or turn off “Hide empty rows and columns” to see signals without marks.</p>
        </Empty>
      ) : (
        <Grid
          rows={rows}
          cols={cols}
          m={m}
          cellMap={cellMap}
          causeSp={causeSp}
          hover={hover}
          pinned={pinned}
          onHover={setHover}
          onPin={(p) => setPinned((cur) => (cur && p && cur.r === p.r && cur.c === p.c ? null : p))}
        />
      )}

      <div className={'cell-info' + (focus ? '' : ' idle')}>
        {focus && fCause && fEffect ? (
          <>
            <a className="ci-sig" href={href('signal', normTag(fCause.tag))}>
              <span className="ci-role">Cause {fCause.num}</span>
              <span className="tag">{fCause.tag}</span>
              <span className="ci-desc">{fCause.desc}</span>
              {(causeSp[focus!.r] || fNotes > 0) && (
                <span className="ci-sp">
                  {[causeSp[focus!.r] && `Set point ${causeSp[focus!.r]}`, fNotes > 0 && `${fNotes} note${fNotes > 1 ? 's' : ''}`]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              )}
            </a>
            <div className="ci-code">
              {fCode ? (
                <>
                  <CodeChip code={fCode} />
                  <span>{describeCode(fCode)}</span>
                </>
              ) : (
                <span className="muted">No action</span>
              )}
            </div>
            <a className="ci-sig" href={href('signal', normTag(fEffect.tag))}>
              <span className="ci-role">Effect {fEffect.num}</span>
              <span className="tag">{fEffect.tag}</span>
              <span className="ci-desc">{fEffect.desc}</span>
            </a>
            {pinned && (
              <button className="link" onClick={() => setPinned(null)}>
                Unpin
              </button>
            )}
          </>
        ) : (
          <span className="muted">
            Point at a cell to read its cause, action and effect. Click a cell to pin it. Click a tag to open the signal.
          </span>
        )}
      </div>
    </div>
  );
}

function Grid({
  rows,
  cols,
  m,
  cellMap,
  causeSp,
  hover,
  pinned,
  onHover,
  onPin,
}: {
  rows: number[];
  cols: number[];
  m: { causes: { tag: string; desc: string; num: string }[]; effects: { tag: string; desc: string; num: string }[] };
  cellMap: Map<number, string>;
  causeSp: string[];
  hover: { r: number; c: number } | null;
  pinned: { r: number; c: number } | null;
  onHover: (h: { r: number; c: number } | null) => void;
  onPin: (p: { r: number; c: number } | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 1200, h: 700 });
  const raf = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
    update();
    const onScroll = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  const W = m.effects.length;
  const r0 = Math.max(0, Math.floor(view.top / RH) - OVERSCAN);
  const r1 = Math.min(rows.length, Math.ceil((view.top + view.h - HH) / RH) + OVERSCAN);
  const c0 = Math.max(0, Math.floor(view.left / CW) - OVERSCAN);
  const c1 = Math.min(cols.length, Math.ceil((view.left + view.w - RW) / CW) + OVERSCAN);

  const focus = pinned ?? hover;
  const cells = [];
  for (let ri = r0; ri < r1; ri++) {
    const r = rows[ri];
    for (let ci = c0; ci < c1; ci++) {
      const c = cols[ci];
      const code = cellMap.get(r * W + c);
      if (!code) continue;
      const isPin = pinned && pinned.r === r && pinned.c === c;
      cells.push(
        <div
          key={r * W + c}
          className={'mcell' + (isPin ? ' pinned' : '')}
          data-c={classify(code)}
          style={{ transform: `translate(${ci * CW}px, ${ri * RH}px)` }}
        >
          {shortCode(code)}
        </div>
      );
    }
  }
  const colHeads = [];
  for (let ci = c0; ci < c1; ci++) {
    const c = cols[ci];
    const e = m.effects[c];
    colHeads.push(
      <a
        key={c}
        className={'mcol' + (focus && focus.c === c ? ' hot' : '')}
        style={{ left: RW + ci * CW }}
        href={href('signal', normTag(e.tag))}
        title={`${e.num ? e.num + '. ' : ''}${e.tag}\n${e.desc}`}
      >
        <span>{e.tag}</span>
      </a>
    );
  }
  const rowHeads = [];
  for (let ri = r0; ri < r1; ri++) {
    const r = rows[ri];
    const s = m.causes[r];
    rowHeads.push(
      <a
        key={r}
        className={'mrow' + (focus && focus.r === r ? ' hot' : '')}
        style={{ top: ri * RH }}
        href={href('signal', normTag(s.tag))}
        title={`${s.num ? s.num + '. ' : ''}${s.tag}\n${s.desc}${causeSp[r] ? `\nSet point ${causeSp[r]}` : ''}`}
      >
        <span className="mr-num">{s.num}</span>
        <span className="mr-tag">{s.tag}</span>
        <span className="mr-desc">{s.desc}</span>
        {causeSp[r] && <span className="mr-sp">{causeSp[r]}</span>}
      </a>
    );
  }

  const cellFromEvent = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ci = Math.floor((e.clientX - rect.left) / CW);
    const ri = Math.floor((e.clientY - rect.top) / RH);
    if (ri < 0 || ci < 0 || ri >= rows.length || ci >= cols.length) return null;
    return { r: rows[ri], c: cols[ci], ri, ci };
  };

  const fri = focus ? rows.indexOf(focus.r) : -1;
  const fci = focus ? cols.indexOf(focus.c) : -1;

  return (
    <div className="mgrid" ref={ref} tabIndex={0} aria-label="Cause and effect matrix">
      <div style={{ width: RW + cols.length * CW, height: HH + rows.length * RH, position: 'relative' }}>
        <div className="mhead" style={{ width: RW + cols.length * CW, height: HH }}>
          <div className="mcorner" style={{ width: RW, height: HH }}>
            <span>Effects →</span>
            <span>Causes ↓</span>
          </div>
          {colHeads}
        </div>
        <div className="mbody" style={{ height: rows.length * RH, width: RW + cols.length * CW }}>
          <div className="mrows" style={{ width: RW, height: rows.length * RH }}>
            {rowHeads}
          </div>
          <div
            className="mcells"
            style={{ left: RW, width: cols.length * CW, height: rows.length * RH }}
            onMouseMove={(e) => {
              const p = cellFromEvent(e);
              if (!p) return onHover(null);
              if (!hover || hover.r !== p.r || hover.c !== p.c) onHover({ r: p.r, c: p.c });
            }}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => {
              const p = cellFromEvent(e);
              if (p) onPin({ r: p.r, c: p.c });
            }}
          >
            {fri >= 0 && <div className="mx-row" style={{ top: fri * RH, width: cols.length * CW }} />}
            {fci >= 0 && <div className="mx-col" style={{ left: fci * CW, height: rows.length * RH }} />}
            {cells}
          </div>
        </div>
      </div>
    </div>
  );
}
