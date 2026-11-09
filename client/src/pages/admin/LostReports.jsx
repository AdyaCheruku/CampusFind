import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSearch } from 'lucide-react';
import { api } from '../../api';
import { Empty, Loader, PageHeader, Pager, StatusChip, fmtDate, fmtDateTime, useApi, useLookups } from '../../components/ui';

const LIMIT = 20;

export default function LostReports() {
  const lookups = useLookups();
  const [f, setF] = useState({ status: '', categoryId: '', q: '', offset: 0 });
  const q = useApi(async () => (await api.get('/admin/lost-reports', {
    params: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), limit: LIMIT },
  })).data, [f.status, f.categoryId, f.q, f.offset]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, offset: 0 });

  return (
    <>
      <PageHeader title="Lost reports" subtitle="All student reports, with their best match score." />
      <div className="card p-4 mb-4 grid sm:grid-cols-3 gap-3">
        <input className="input" placeholder="Search reference, student, description…"
          onKeyDown={(e) => { if (e.key === 'Enter') setF({ ...f, q: e.target.value, offset: 0 }); }}
          onBlur={(e) => e.target.value !== f.q && setF({ ...f, q: e.target.value, offset: 0 })} />
        <select className="input" value={f.status} onChange={set('status')}>
          {['', 'ACTIVE', 'MATCHED', 'RESOLVED', 'WITHDRAWN', 'CLOSED'].map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <select className="input" value={f.categoryId} onChange={set('categoryId')}>
          <option value="">All categories</option>
          {lookups.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Loader q={q}>{(d) => d.reports.length === 0 ? <div className="card"><Empty icon={FileSearch} title="No reports found" /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead><tr><th className="th">Report</th><th className="th">Student</th><th className="th">Lost</th><th className="th">Candidates</th><th className="th">Best score</th><th className="th">Status</th></tr></thead>
            <tbody>
              {d.reports.map((r) => (
                <tr key={r.report_id} className="hover:bg-cream">
                  <td className="td"><Link to={`/admin/lost-reports/${r.report_id}`} className="font-semibold text-forest-800 hover:underline">{r.reference_code}</Link>
                    <div className="text-xs text-stone-500 line-clamp-1 max-w-xs">{[r.colour, r.brand, r.category].filter(Boolean).join(' ')}</div></td>
                  <td className="td">{r.student_name}<div className="text-xs text-stone-500">{r.student_roll_no}</div></td>
                  <td className="td">{r.lost_location || '—'}<div className="text-xs text-stone-500">{fmtDateTime(r.lost_at)}</div></td>
                  <td className="td">{r.candidate_count}</td>
                  <td className="td">{r.best_score != null ? Math.round(r.best_score) : '—'}</td>
                  <td className="td"><StatusChip status={r.status} /><div className="text-xs text-stone-500 mt-1">{fmtDate(r.created_at)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-4"><Pager total={d.total} limit={LIMIT} offset={f.offset} onChange={(offset) => setF({ ...f, offset })} /></div>
        </div>
      )}</Loader>
    </>
  );
}
