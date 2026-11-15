import { useRef, useState } from 'react';
import { cleanSheetName, downloadTemplate, INFO_HEADERS } from '../lib/template';

const clamp = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** Button + dialog that downloads a blank C&E workbook in the layout the importer reads. */
export function TemplateButton({ className = 'btn' }: { className?: string }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('New C&E');
  const [effects, setEffects] = useState('20');
  const [causes, setCauses] = useState('50');
  const [notes, setNotes] = useState(true);
  const [effectData, setEffectData] = useState(true);
  const nE = clamp(Number(effects), 1, 300, 20);
  const nC = clamp(Number(causes), 1, 3000, 50);
  return (
    <>
      <button type="button" className={className} onClick={() => dlg.current?.showModal()}>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="btn-ico">
          <rect x="3" y="3" width="14" height="14" rx="1.5" />
          <path d="M3 8h14M8 8v9M10 5.5h0" />
        </svg>
        Blank C&amp;E sheet
      </button>
      <dialog ref={dlg} className="tmpl-dialog" onClick={(e) => e.target === dlg.current && dlg.current?.close()}>
        <form
          method="dialog"
          onSubmit={() => downloadTemplate({ name, effects: nE, causes: nC, notes, effectData })}
        >
          <h2>Blank C&amp;E sheet</h2>
          <p className="tmpl-sub">
            An Excel workbook already laid out the way this app reads it. Fill it in (offline, in Excel), then import it.
          </p>
          <label className="tmpl-field">
            <span>Chart name (sheet name)</span>
            <input className="filter" value={name} maxLength={31} onChange={(e) => setName(e.target.value)} placeholder="e.g. N2 Package CE" />
          </label>
          <div className="tmpl-row">
            <label className="tmpl-field">
              <span>Effect columns</span>
              <input className="filter" type="number" min={1} max={300} value={effects} onChange={(e) => setEffects(e.target.value)} />
            </label>
            <label className="tmpl-field">
              <span>Cause rows</span>
              <input className="filter" type="number" min={1} max={3000} value={causes} onChange={(e) => setCauses(e.target.value)} />
            </label>
          </div>
          <label className="tmpl-check">
            <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> Notes sheet (numbered chart notes)
          </label>
          <label className="tmpl-check">
            <input type="checkbox" checked={effectData} onChange={(e) => setEffectData(e.target.checked)} /> Effect data sheet (actions, notes for effects)
          </label>
          <figure className="tmpl-fig" aria-label="Layout of the sheet">
            <table>
              <tbody>
                <tr><td className="k">A</td><td className="k">B</td><td className="k">C</td><td className="k">D …</td><td className="k">then</td></tr>
                <tr><td /><td /><td className="h">Description</td><td className="e">effect description</td><td /></tr>
                <tr><td /><td /><td className="h">TAG No.</td><td className="e t">effect tag</td><td /></tr>
                <tr><td className="h">TAG No.</td><td className="h">Description</td><td className="h">No.</td><td className="e">1, 2, 3 …</td><td className="i">{INFO_HEADERS.slice(0, 3).join(', ')} …</td></tr>
                <tr><td className="t">cause tag</td><td>description</td><td>1</td><td className="x">X</td><td>set point …</td></tr>
              </tbody>
            </table>
            <figcaption>
              {nE} effect column{nE === 1 ? '' : 's'} × {nC} cause row{nC === 1 ? '' : 's'}, an action-code dropdown and a “How to fill” sheet.
              Spare rows and columns can stay empty.
            </figcaption>
          </figure>
          <div className="tmpl-actions">
            <button type="button" className="btn" onClick={() => dlg.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Download {cleanSheetName(name)}.xlsx
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
