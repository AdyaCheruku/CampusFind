import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { api } from '../../api';
import { Empty, Loader, PageHeader, Pager, StatusChip, fmtDateTime, useApi } from '../../components/ui';

const LIMIT = 25;
const TABS = [['PENDING,QUEUED', 'Needs review'], ['APPROVED', 'Awaiting pickup'], ['COMPLETED', 'Completed'], ['REJECTED', 'Rejected'], ['', 'All']];

export default function Claims() {
  const [f, setF] = useState({ status: 'PENDING,QUEUED', q: '', offset: 0 });
  const q = useApi(async () => (await api.get('/admin/claims', {
    params: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), limit: LIMIT },
  })).data, [f.status, f.q, f.offset]);

  return (
    <>
      <PageHeader title="Claims review" subtitle="Claims are reviewed in order. Queued claims wait behind the pending one for the same item." />
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map(([s, label]) => (
          <button key={label} onClick={() => setF({ ...f, status: s, offset: 0 })} className={f.status === s ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}>{label}</button>
        ))}
        <input className="input sm:max-w-xs sm:ml-auto" placeholder="Search claim, item, student…"
          onKeyDown={(e) => { if (e.key === 'Enter') setF({ ...f, q: e.target.value, offset: 0 }); }}
          onBlur={(e) => e.target.value !== f.q && setF({ ...f, q: e.target.value, offset: 0 })} />
      </div>
      <Loader q={q}>{(d) => d.claims.length === 0 ? <div className="card"><Empty icon={ListChecks} title="No claims here" /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead><tr><th className="th">Claim</th><th className="th">Student</th><th className="th">Item</th><th className="th">Score at claim</th><th className="th">Submitted</th><th className="th">Status</th></tr></thead>
            <tbody>{d.claims.map((c) => (
              <tr key={c.claim_id} className="hover:bg-cream">
                <td className="td"><Link className="font-semibold text-forest-700 hover:underline" to={`/admin/claims/${c.claim_id}`}>{c.reference_code}</Link>
                  {c.appeal_of_claim_id && <div className="text-xs text-sky-700">Appeal</div>}</td>
                <td className="td">{c.student_name}<div className="text-xs text-stone-500">{c.student_roll_no}</div></td>
                <td className="td">{c.item_ref}<div className="text-xs text-stone-500">{c.category}</div></td>
                <td className="td">{c.match_score_at_claim != null ? Math.round(c.match_score_at_claim) : '—'}</td>
                <td className="td">{fmtDateTime(c.created_at)}</td>
                <td className="td"><StatusChip status={c.status} />{c.queue_position && <div className="text-xs text-stone-500 mt-1">Queue #{c.queue_position}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="px-4 pb-4"><Pager total={d.total} limit={LIMIT} offset={f.offset} onChange={(offset) => setF({ ...f, offset })} /></div>
        </div>
      )}</Loader>
    </>
  );
}
