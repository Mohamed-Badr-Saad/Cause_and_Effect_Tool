import { useMemo, useState } from 'react';
import { useApp } from '../lib/context';
import {
  causesOf,
  continuesAsCause,
  continuesAsEffect,
  effectsOf,
  entryDesc,
  type CEIndex,
  type LinkRow,
} from '../lib/ceIndex';
import { describeCode } from '../lib/codes';
import { downloadXlsx } from '../lib/xlsxWrite';
import { CodeChip, TagLink } from './bits';

type Dir = 'down' | 'up';
const MAX_DEPTH = 6;

const step = (ix: CEIndex, key: string, dir: Dir) => (dir === 'down' ? effectsOf(ix, key) : causesOf(ix, key));
const cont = (ix: CEIndex, key: string, dir: Dir) => (dir === 'down' ? continuesAsCause(ix, key) : continuesAsEffect(ix, key));

export function hasChain(ix: CEIndex, key: string): boolean {
  return effectsOf(ix, key).some((r) => continuesAsCause(ix, r.otherKey)) || causesOf(ix, key).some((r) => continuesAsEffect(ix, r.otherKey));
}

interface Reached {
  row: LinkRow;
  depth: number;
  path: string[];
}

function reachAll(ix: CEIndex, root: string, dir: Dir): Reached[] {
  const out: Reached[] = [];
  const seen = new Set<string>([root]);
  let frontier: { key: string; path: string[] }[] = [{ key: root, path: [] }];
  for (let depth = 1; depth <= MAX_DEPTH && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      for (const row of step(ix, f.key, dir)) {
        out.push({ row, depth, path: f.path });
        const c = cont(ix, row.otherKey, dir);
        if (c && !seen.has(c.key)) {
          seen.add(c.key);
          next.push({ key: c.key, path: [...f.path, row.other.tag] });
        }
      }
    }
    frontier = next;
  }
  return out;
}

export function TraceView({ root }: { root: string }) {
  const { ix, ds } = useApp();
  const entry = ix.byKey.get(root)!;
  const down = useMemo(() => reachAll(ix, root, 'down'), [ix, root]);
  const up = useMemo(() => reachAll(ix, root, 'up'), [ix, root]);
  const downChains = down.some((r) => r.depth > 1);
  const upChains = up.some((r) => r.depth > 1);

  const exportAll = (dir: Dir, list: Reached[]) => {
    const label = dir === 'down' ? 'Effect' : 'Cause';
    downloadXlsx(
      [
        {
          name: dir === 'down' ? 'Everything it trips' : 'Everything that trips it',
          rows: [
            ['Signal', entry.tag],
            ['Description', entryDesc(entry)],
            [dir === 'down' ? 'All effects reached through the trip chain' : 'All causes reached through the trip chain', `${list.length} rows`],
            [],
            ['Step', `${label} tag`, 'Action', 'Meaning', `${label} description`, 'Sheet', 'Via'],
            ...list.map((r) => [
              r.depth,
              r.row.other.tag,
              r.row.code,
              describeCode(r.row.code),
              r.row.other.desc,
              ds.matrices[r.row.m].name,
              r.path.join(dir === 'down' ? ' → ' : ' ← '),
            ]),
          ],
          titleRows: [0],
          headerRows: [4],
          widths: [6, 30, 16, 40, 56, 14, 40],
        },
      ],
      `${entry.tag.replace(/\//g, '-')} trip chain ${dir === 'down' ? 'downstream' : 'upstream'}.xlsx`
    );
  };

  return (
    <div className="trace">
      <p className="lede small">
        Some effects in one sheet are causes in another. For example a confirmed fire from the F&amp;G C&amp;E
        triggers shutdown actions in the ESD C&amp;E. This view follows those links in both directions.
      </p>
      {upChains && (
        <section className="trace-sec">
          <header>
            <h2>What leads to this signal</h2>
            <span>{up.length} causes over {Math.max(...up.map((r) => r.depth))} steps</span>
            <button className="btn" onClick={() => exportAll('up', up)}>
              Export all
            </button>
          </header>
          <ChainNode keyName={root} dir="up" depth={0} seen={new Set([root])} />
        </section>
      )}
      {downChains && (
        <section className="trace-sec">
          <header>
            <h2>What this signal ends up tripping</h2>
            <span>{down.length} effects over {Math.max(...down.map((r) => r.depth))} steps</span>
            <button className="btn" onClick={() => exportAll('down', down)}>
              Export all
            </button>
          </header>
          <ChainNode keyName={root} dir="down" depth={0} seen={new Set([root])} />
        </section>
      )}
    </div>
  );
}

function ChainNode({ keyName, dir, depth, seen }: { keyName: string; dir: Dir; depth: number; seen: Set<string> }) {
  const { ix, ds } = useApp();
  const rows = useMemo(() => step(ix, keyName, dir), [ix, keyName, dir]);
  const linked = rows
    .map((r) => ({ r, c: cont(ix, r.otherKey, dir) }))
    .filter((x): x is { r: LinkRow; c: { key: string; count: number } } => !!x.c);
  const terminal = rows.length - linked.length;
  const [open, setOpen] = useState<Set<string>>(() => new Set(depth === 0 && linked.length <= 3 ? linked.map((x) => x.c.key) : []));
  const [showEnds, setShowEnds] = useState(false);
  const ends = rows.filter((r) => !cont(ix, r.otherKey, dir));
  return (
    <ul className="chain">
      {linked.map(({ r, c }, i) => {
        const isOpen = open.has(c.key);
        const loop = seen.has(c.key);
        return (
          <li key={i}>
            <div className="chain-row">
              <CodeChip code={r.code} />
              <TagLink tag={r.other.tag} />
              <span className="chain-desc">{r.other.desc}</span>
              <span className="chain-sheet">{ds.matrices[r.m].name}</span>
              {loop ? (
                <span className="chain-note">already shown above</span>
              ) : depth + 1 >= MAX_DEPTH ? (
                <span className="chain-note">open the signal to go further</span>
              ) : (
                <button
                  className="chain-toggle"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(c.key)) n.delete(c.key);
                      else n.add(c.key);
                      return n;
                    })
                  }
                >
                  {isOpen ? 'Hide' : dir === 'down' ? `Then ${c.count} effect${c.count === 1 ? '' : 's'}` : `From ${c.count} cause${c.count === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
            {isOpen && !loop && <ChainNode keyName={c.key} dir={dir} depth={depth + 1} seen={new Set([...seen, c.key])} />}
          </li>
        );
      })}
      {terminal > 0 && (
        <li className="chain-ends">
          <button className="link" onClick={() => setShowEnds((v) => !v)} aria-expanded={showEnds}>
            {showEnds ? 'Hide' : 'Show'} {terminal} {dir === 'down' ? 'effect' : 'cause'}
            {terminal > 1 ? 's' : ''} that {dir === 'down' ? 'end' : 'start'} here
          </button>
          {showEnds && (
            <table className="grid compact">
              <tbody>
                {ends.map((r, i) => (
                  <tr key={i}>
                    <td className="c-code">
                      <CodeChip code={r.code} />
                    </td>
                    <td className="c-tag">
                      <TagLink tag={r.other.tag} />
                    </td>
                    <td className="c-desc">{r.other.desc}</td>
                    <td className="c-sheet">{ds.matrices[r.m].name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </li>
      )}
    </ul>
  );
}
