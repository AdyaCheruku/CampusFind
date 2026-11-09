import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, X, Inbox, ImageOff } from 'lucide-react';
import { api, errMsg } from '../api';

// ---------------------------------------------------------------- data hook
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: errMsg(e) });
    }
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/** Wraps an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(errMsg(e)); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

// ---------------------------------------------------------------- formatting
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const toLocalInput = (d = new Date()) => {
  const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};
export const humanize = (s) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '');

// ---------------------------------------------------------------- status chip
const CHIP = {
  ACTIVE: 'bg-mint text-forest-800', MATCHED: 'bg-amber-100 text-amber-800', RESOLVED: 'bg-forest-800 text-white',
  WITHDRAWN: 'bg-stone-200 text-stone-600', CLOSED: 'bg-stone-200 text-stone-600',
  DRAFT: 'bg-stone-200 text-stone-700', IN_CUSTODY: 'bg-mint text-forest-800', CLAIM_PENDING: 'bg-amber-100 text-amber-800',
  RETURNED: 'bg-forest-800 text-white', ARCHIVED: 'bg-stone-200 text-stone-600',
  QUEUED: 'bg-sky-100 text-sky-800', PENDING: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700', COMPLETED: 'bg-forest-800 text-white',
  STRONG: 'bg-emerald-100 text-emerald-800', MODERATE: 'bg-amber-100 text-amber-800', WEAK: 'bg-red-100 text-red-700',
  INSUFFICIENT_DATA: 'bg-stone-200 text-stone-600',
};
export function StatusChip({ status, className = '' }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${CHIP[status] || 'bg-stone-100 text-stone-700'} ${className}`}>
      {humanize(status)}
    </span>
  );
}

// ---------------------------------------------------------------- feedback
export function Spinner({ label = 'Loading…' }) {
  return <div className="flex items-center gap-2 text-stone-500 py-10 justify-center"><Loader2 className="animate-spin" size={18} />{label}</div>;
}
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{error}</div>
      {onRetry && <button className="underline font-medium" onClick={onRetry}>Retry</button>}
    </div>
  );
}
export function SuccessBox({ children }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      <CheckCircle2 size={18} className="mt-0.5 shrink-0" /><div>{children}</div>
    </div>
  );
}
export function Empty({ icon: Icon = Inbox, title, children }) {
  return (
    <div className="text-center py-12 px-4">
      <Icon className="mx-auto text-forest-600/60" size={36} />
      <p className="mt-3 font-semibold text-forest-900">{title}</p>
      {children && <div className="mt-1 text-sm text-stone-500 max-w-md mx-auto">{children}</div>}
    </div>
  );
}

/** Renders loading / error / children(data). */
export function Loader({ q, children }) {
  if (q.loading && !q.data) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  return children(q.data);
}

// ---------------------------------------------------------------- layout bits
export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {back && <Link to={back.to} className="text-sm text-forest-700 hover:underline">← {back.label}</Link>}
        <h1 className="text-2xl font-bold text-forest-900">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, tone = 'mint', to }) {
  const tones = { mint: 'bg-mint text-forest-800', gold: 'bg-amber-100 text-amber-800', forest: 'bg-forest-800 text-gold-light', stone: 'bg-stone-100 text-stone-700' };
  const body = (
    <div className="card p-4 flex items-center gap-4 h-full hover:shadow-md transition">
      <div className={`rounded-xl p-3 ${tones[tone]}`}><Icon size={22} /></div>
      <div><div className="text-2xl font-bold">{value ?? '—'}</div><div className="text-xs text-stone-500">{label}</div></div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function Section({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-cream-dark px-5 py-3">
          <h2 className="font-semibold text-forest-900">{title}</h2>
          <div className="flex gap-2">{actions}</div>
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, required }) {
  return (
    <label className="block">
      <span className="label">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && <span className="block text-xs text-stone-500 mt-1">{hint}</span>}
    </label>
  );
}

export function DL({ rows }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-stone-500">{k}</dt>
          <dd className="text-forest-950 break-words">{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-cream-dark px-5 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-800" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Modal asking for a reason / text before running an action. */
export function ReasonModal({ open, title, label, minLength = 5, confirmLabel = 'Confirm', danger, onClose, onSubmit, children }) {
  const [text, setText] = useState('');
  const act = useAction();
  useEffect(() => { if (open) { setText(''); act.setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await act.run(() => onSubmit(text.trim()));
        if (ok !== undefined) onClose();
      }}>
        {children}
        <Field label={label} required>
          <textarea className="input min-h-24" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <ErrorBox error={act.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={act.busy || text.trim().length < minLength}>
            {act.busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- images
export function Photo({ src, alt = '', className = '' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className={`flex items-center justify-center bg-cream-dark text-stone-400 ${className}`}><ImageOff size={24} /></div>;
  }
  return <img src={src} alt={alt} className={`object-cover bg-cream-dark ${className}`} onError={() => setFailed(true)} loading="lazy" />;
}

export function ScoreBar({ score, threshold }) {
  const s = Math.round(Number(score) || 0);
  const tone = s >= 70 ? 'bg-forest-700' : s >= (threshold ?? 40) ? 'bg-gold' : 'bg-stone-400';
  return (
    <div className="flex items-center gap-2 min-w-28">
      <div className="h-2 flex-1 rounded-full bg-stone-200 overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${s}%` }} /></div>
      <span className="text-xs font-semibold w-8 text-right">{s}</span>
    </div>
  );
}

const BREAKDOWN_LABELS = { category: 'Category', brand_model: 'Brand / model', colour: 'Colour', location: 'Location', time: 'Time', description: 'Description', features: 'Features' };
export function Breakdown({ breakdown }) {
  if (!breakdown) return null;
  return (
    <div className="space-y-2">
      {Object.entries(BREAKDOWN_LABELS).map(([k, label]) => {
        const b = breakdown[k]; if (!b) return null;
        return (
          <div key={k} className="text-sm">
            <div className="flex justify-between"><span>{label}</span><span className="font-semibold">{b.points} / {b.weight}</span></div>
            <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden"><div className="h-full bg-forest-600" style={{ width: `${(b.points / (b.weight || 1)) * 100}%` }} /></div>
            {b.note && <div className="text-xs text-stone-500">{b.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function Timeline({ history }) {
  if (!history?.length) return <p className="text-sm text-stone-500">No status changes yet.</p>;
  return (
    <ol className="relative border-l-2 border-mint ml-2 space-y-4">
      {history.map((h, i) => (
        <li key={i} className="ml-4">
          <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-forest-600" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {h.old_status && <><StatusChip status={h.old_status} /><span>→</span></>}
            <StatusChip status={h.new_status} />
            <span className="text-xs text-stone-500">{fmtDateTime(h.changed_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</span>
          </div>
          {h.reason && <p className="text-sm text-stone-600 mt-1">{h.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

export function Pager({ total, limit, offset, onChange }) {
  if (!total || total <= limit) return null;
  return (
    <div className="flex items-center justify-between text-sm text-stone-600 mt-4">
      <span>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
      <div className="flex gap-2">
        <button className="btn-outline btn-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button>
        <button className="btn-outline btn-sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</button>
      </div>
    </div>
  );
}

export function useLookups() {
  return useApi(async () => (await api.get('/lookups')).data, []);
}
