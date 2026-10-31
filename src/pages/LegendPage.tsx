import { useMemo } from 'react';
import { useApp } from '../lib/context';
import { classify, CLASS_LABEL, describeCode, LEGEND } from '../lib/codes';
import { CodeChip } from '../components/bits';

export function LegendPage() {
  const { ds } = useApp();
  const observed = useMemo(() => {
    const map = new Map<string, { label: string; n: number; sheets: Set<string> }>();
    for (const m of ds.matrices)
      for (const [, , code] of m.links) {
        const k = code.toUpperCase().replace(/\s+/g, ' ');
        const v = map.get(k) ?? { label: code, n: 0, sheets: new Set<string>() };
        v.n++;
        v.sheets.add(m.name);
        map.set(k, v);
      }
    return [...map.values()].sort((a, b) => b.n - a.n);
  }, [ds]);

  return (
    <div className="page legend-page">
      <h1 className="page-title">Action codes</h1>
      <p className="lede small">
        The code written where a cause row meets an effect column. Meanings come from the notes on the ESD and F&amp;G
        C&amp;E charts. Colours: red for immediate action, amber for delayed action, blue-grey for everything else.
      </p>
      <table className="grid legend">
        <thead>
          <tr>
            <th>Code</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {LEGEND.map((l) => (
            <tr key={l.code}>
              <td>
                <span className="code" data-c={classify(l.code.replace(' …', ' 1'))}>
                  {l.code}
                </span>
              </td>
              <td>{l.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {observed.length > 0 && (
        <section>
          <h2>Codes in your imported sheets</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>Code</th>
                <th>Type</th>
                <th>Read as</th>
                <th className="num">Used</th>
                <th>Sheets</th>
              </tr>
            </thead>
            <tbody>
              {observed.map((o) => (
                <tr key={o.label}>
                  <td>
                    <CodeChip code={o.label} />
                  </td>
                  <td>{CLASS_LABEL[classify(o.label)]}</td>
                  <td>{describeCode(o.label)}</td>
                  <td className="num">{o.n.toLocaleString()}</td>
                  <td className="muted">{[...o.sheets].join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
