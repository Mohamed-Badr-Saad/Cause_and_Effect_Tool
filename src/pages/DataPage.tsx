import { useState } from 'react';
import { useApp } from '../lib/context';
import { DropZone } from '../components/bits';
import { LayoutHelp } from './HomePage';
import { href } from '../lib/router';

export function DataPage() {
  const { ds, removeMatrix, removeTrips, removeSignalData, removeFile, clearAll } = useApp();
  // Every workbook that is logged or still contributes something
  const names = [
    ...new Set([
      ...ds.files.map((f) => f.name),
      ...ds.matrices.map((m) => m.source),
      ...ds.tripGroups.map((g) => g.source),
      ...(ds.signalData ?? []).map((d) => d.file),
    ]),
  ];
  const fileList = names.map((name) => {
    const log = ds.files.find((f) => f.name === name);
    const sheets = ds.matrices.filter((m) => m.source === name);
    const trips = ds.tripGroups.filter((g) => g.source === name).length;
    const data = (ds.signalData ?? []).filter((d) => d.file === name).length;
    const parts: string[] = [];
    if (sheets.length) parts.push(`${sheets.length} C&E sheet${sheets.length > 1 ? 's' : ''} (${sheets.map((m) => m.name).join(', ')})`);
    if (trips) parts.push(`${trips} trip groups`);
    if (data) parts.push(`set points / notes for ${data.toLocaleString()} signals`);
    return { name, log, summary: parts.join('; ') };
  });
  const dataFiles = [...new Set((ds.signalData ?? []).map((d) => d.file))].map((f) => ({
    file: f,
    rows: (ds.signalData ?? []).filter((d) => d.file === f),
  }));
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <div className="page data-page">
      <h1 className="page-title">Imported files</h1>
      <p className="lede small">
        Data is kept in this browser only. Importing a sheet with the same name again replaces the older copy, so to
        update after a C&amp;E revision just import the new workbook.
      </p>
      <DropZone compact />

      {fileList.length > 0 && (
        <section>
          <h2>Files</h2>
          <ul className="file-list">
            {fileList.map((f) => (
              <li key={f.name}>
                <div className="fl-main">
                  <span className="fl-name">{f.name}</span>
                  <span className="fl-summary">
                    {f.summary || 'Nothing from this file is in use: its sheets were replaced by a later import.'}
                  </span>
                  {f.log && (
                    <details className="log">
                      <summary>
                        Imported {new Date(f.log.importedAt).toLocaleString()}, {f.log.report.length} sheet
                        {f.log.report.length === 1 ? '' : 's'} read
                      </summary>
                      <ul>
                        {f.log.report.map((r, i) => (
                          <li key={i} className={'log-' + r.status}>
                            <strong>{r.sheet}</strong>: {r.status === 'skipped' ? 'skipped. ' : ''}
                            {r.detail}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <button className="btn danger" onClick={() => removeFile(f.name)} aria-label={`Remove ${f.name}`}>
                  Remove file
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small-note">
            Removing a file takes its sheets, trip lists, set points and notes out of the tool. Your Excel file on disk is
            not touched, and you can undo straight after.
          </p>
        </section>
      )}

      {ds.matrices.length > 0 && (
        <section>
          <h2>C&amp;E sheets</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>Sheet</th>
                <th>From file</th>
                <th className="num">Causes</th>
                <th className="num">Effects</th>
                <th className="num">Marks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ds.matrices.map((m) => (
                <tr key={m.id}>
                  <td>
                    <a href={href('matrix', m.id)}>{m.name}</a>
                  </td>
                  <td className="muted">{m.source}</td>
                  <td className="num">{m.causes.length}</td>
                  <td className="num">{m.effects.length}</td>
                  <td className="num">{m.links.length.toLocaleString()}</td>
                  <td className="actions">
                    <button className="link danger" onClick={() => removeMatrix(m.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {ds.tripGroups.length > 0 && (
        <section>
          <h2>Trip-signal lists</h2>
          <p>
            {ds.tripGroups.length} groups from {[...new Set(ds.tripGroups.map((g) => `${g.sheet} (${g.source})`))].join(', ')}.{' '}
            <button className="link danger" onClick={removeTrips}>
              Remove
            </button>
          </p>
        </section>
      )}

      {dataFiles.length > 0 && (
        <section>
          <h2>Set points and notes</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>From file</th>
                <th className="num">Signals</th>
                <th className="num">With set point</th>
                <th className="num">With notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dataFiles.map(({ file, rows }) => (
                <tr key={file}>
                  <td>{file}</td>
                  <td className="num">{rows.length.toLocaleString()}</td>
                  <td className="num">{rows.filter((r) => r.values.some((v) => v.label === 'Set point')).length.toLocaleString()}</td>
                  <td className="num">{rows.filter((r) => r.notes.length).length.toLocaleString()}</td>
                  <td className="actions">
                    <button className="link danger" onClick={() => removeSignalData(file)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(ds.matrices.length > 0 || ds.tripGroups.length > 0 || dataFiles.length > 0) && (
        <section>
          <h2>Remove everything</h2>
          {confirmClear ? (
            <p>
              This removes all imported files from this browser. Your Excel files are not touched.{' '}
              <button className="btn danger" onClick={() => (clearAll(), setConfirmClear(false))}>
                Remove all data
              </button>{' '}
              <button className="btn" onClick={() => setConfirmClear(false)}>
                Keep data
              </button>
            </p>
          ) : (
            <button className="btn" onClick={() => setConfirmClear(true)}>
              Remove all data…
            </button>
          )}
        </section>
      )}

      <LayoutHelp />
    </div>
  );
}
