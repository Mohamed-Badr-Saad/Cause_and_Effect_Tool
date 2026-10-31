import { useRef, useState, type ReactNode } from 'react';
import { classify, describeCode, shortCode } from '../lib/codes';
import { href } from '../lib/router';
import { normTag } from '../lib/tags';
import { useApp } from '../lib/context';

export function CodeChip({ code, short = false }: { code: string; short?: boolean }) {
  return (
    <span className="code" data-c={classify(code)} title={`${code}: ${describeCode(code)}`}>
      {short ? shortCode(code) : code}
    </span>
  );
}

export function TagLink({ tag, children }: { tag: string; children?: ReactNode }) {
  return (
    <a className="tag" href={href('signal', normTag(tag))}>
      {children ?? tag}
    </a>
  );
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return <>{text}</>;
  const re = new RegExp(`(${tokens.join('|')})`, 'ig');
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

export function DropZone({ compact = false }: { compact?: boolean }) {
  const { importFiles, openPicker, busy } = useApp();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return (
    <div
      className={'dropzone' + (over ? ' over' : '') + (compact ? ' compact' : '')}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        depth.current++;
        setOver(true);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        if (--depth.current <= 0) setOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        importFiles([...e.dataTransfer.files]);
      }}
    >
      <svg className="dz-icon" viewBox="0 0 48 40" aria-hidden="true">
        <rect x="14" y="6" width="20" height="28" rx="2" />
        <path d="M2 13h12M2 20h12M2 27h12M34 20h12" />
      </svg>
      <div>
        <p className="dz-title">{busy ?? 'Drop C&E workbooks here'}</p>
        <p className="dz-sub">
          .xlsx or .xlsm. You can drop several files at once, for example ESD C&E 1, ESD C&E 2, F&G C&E and the
          trip-signals sheet, or one workbook that contains all of them.
        </p>
      </div>
      <button className="btn primary" onClick={openPicker} disabled={!!busy}>
        Choose files
      </button>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
