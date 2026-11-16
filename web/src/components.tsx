import { useEffect, useId, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X, Plus, Trash2, Search, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { api } from './api';

export type Row = Record<string, any>;
export function useData<T = any>(path: string, revision: number = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<T>(path)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return { data, error, loading };
}
export function Notice({
  children,
  kind = 'info',
}: {
  children: ReactNode;
  kind?: 'info' | 'error' | 'success';
}) {
  return (
    <div className={'notice ' + kind} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" size={24} />
      Loading records…
    </div>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={'badge ' + tone}>{children}</span>;
}
export type Column = { label: string; key: string; render?: (r: Row) => ReactNode };
export function DataTable({
  rows,
  columns,
  empty = 'No records yet. Add your first record to get started.',
}: {
  rows: Row[];
  columns: Column[];
  empty?: string;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="empty">{empty}</div>
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={row.id ?? i}>
                {columns.map((c) => (
                  <td key={c.key}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Pager({
  page,
  total,
  limit = 25,
  onChange,
}: {
  page: number;
  total: number;
  limit?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {total
          ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`
          : '0 records'}
      </span>
      <div>
        <button
          className="icon-btn"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>Page {page}</span>
        <button
          className="icon-btn"
          aria-label="Next page"
          disabled={page * limit >= total}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
export function SearchBox({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <label className="search">
      <Search size={17} />
      <input
        aria-label="Search records"
        placeholder="Search records…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  help?: string;
  min?: number;
  max?: number;
  step?: string;
  disabled?: boolean;
};
export function Fields({
  fields,
  value,
  onChange,
}: {
  fields: Field[];
  value: Row;
  onChange: (value: Row) => void;
}) {
  return (
    <div className="form-grid">
      {fields.map((f) => (
        <label key={f.name} className={f.type === 'textarea' ? 'wide' : ''}>
          <span>
            {f.label}
            {f.required !== false && f.type !== 'checkbox' ? <b aria-hidden="true"> *</b> : null}
          </span>
          {f.type === 'select' ? (
            <select
              aria-label={f.label}
              required={f.required !== false}
              value={value[f.name] ?? ''}
              onChange={(e) => onChange({ ...value, [f.name]: e.target.value })}
              disabled={f.disabled}
            >
              <option value="">Choose…</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === 'checkbox' ? (
            <input
              aria-label={f.label}
              type="checkbox"
              checked={!!value[f.name]}
              onChange={(e) => onChange({ ...value, [f.name]: e.target.checked })}
              disabled={f.disabled}
            />
          ) : f.type === 'textarea' ? (
            <textarea
              aria-label={f.label}
              required={f.required !== false}
              value={value[f.name] ?? ''}
              onChange={(e) => onChange({ ...value, [f.name]: e.target.value })}
            />
          ) : (
            <input
              aria-label={f.label}
              type={f.type ?? 'text'}
              required={f.required !== false}
              value={value[f.name] ?? ''}
              min={f.min ?? (f.type === 'number' ? 0 : undefined)}
              max={f.max}
              step={f.step ?? 'any'}
              maxLength={f.type === 'password' ? 72 : 500}
              disabled={f.disabled}
              onChange={(e) => onChange({ ...value, [f.name]: e.target.value })}
            />
          )}{' '}
          {f.help && <small>{f.help}</small>}
        </label>
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.activeElement as HTMLElement;
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function FormModal({
  title,
  fields,
  initial = {},
  onSubmit,
  onClose,
  submit = 'Save record',
  children,
}: {
  title: string;
  fields: Field[];
  initial?: Row;
  onSubmit: (data: Row) => Promise<void>;
  onClose: () => void;
  submit?: string;
  children?: ReactNode;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(value);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={save}>
        <div className="modal-body">
          {children}
          <Fields fields={fields} value={value} onChange={setValue} />
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy}>{busy ? 'Saving…' : submit}</button>
        </div>
      </form>
    </Modal>
  );
}
export function LinesEditor({
  lines,
  onChange,
  fields,
  blank,
  label = 'Line',
}: {
  lines: Row[];
  onChange: (rows: Row[]) => void;
  fields: Field[];
  blank: () => Row;
  label?: string;
}) {
  return (
    <div className="lines-editor">
      {lines.map((line, i) => (
        <div className="line" key={i}>
          <div className="line-title">
            <strong>
              {label} {i + 1}
            </strong>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((_, j) => i !== j))}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <Fields
            fields={fields}
            value={line}
            onChange={(v) => onChange(lines.map((l, j) => (j === i ? v : l)))}
          />
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...lines, blank()])}>
        <Plus size={16} />
        Add {label.toLowerCase()}
      </button>
    </div>
  );
}
