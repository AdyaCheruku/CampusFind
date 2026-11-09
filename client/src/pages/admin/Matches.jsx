import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GitCompareArrows } from 'lucide-react';
import { api } from '../../api';
import { Breakdown, Empty, Loader, Modal, PageHeader, Pager, ScoreBar, StatusChip, useApi } from '../../components/ui';

const LIMIT = 25;

export default function Matches() {
  const [f, setF] = useState({ visibility: 'all', q: '', offset: 0 });
  const [bd, setBd] = useState(null);
  const q = useApi(async () => (await api.get('/admin/matches', {
    params: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), limit: LIMIT },
  })).data, [f.visibility, f.q, f.offset]);

  return (
    <>
      <PageHeader title="Matches" subtitle="Every stored report–item pair. Rows below the student threshold are greyed out." />
      <div className="card p-4 mb-4 grid sm:grid-cols-2 gap-3">
        <input className="input" placeholder="Search report, item or student…"
          onKeyDown={(e) => { if (e.key === 'Enter') setF({ ...f, q: e.target.value, offset: 0 }); }}
          onBlur={(e) => e.target.value !== f.q && setF({ ...f, q: e.target.value, offset: 0 })} />
        <select className="input" value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value, offset: 0 })}>
          <option value="all">All stored matches</option><option value="visible">Visible to students</option>
          <option value="above">At or above threshold</option><option value="below">Below threshold</option>
        </select>
      </div>
      <Loader q={q}>{(d) => d.matches.length === 0 ? <div className="card"><Empty icon={GitCompareArrows} title="No matches" /></div> : (
        <div className="card overflow-x-auto">
          <div className="px-4 pt-3 text-xs text-stone-500">Student threshold: <b>{d.threshold}</b></div>
          <table className="w-full min-w-[820px]">
            <thead><tr><th className="th">Report</th><th className="th">Item</th><th className="th">Category</th><th className="th">Score</th><th className="th">Student view</th><th className="th"></th></tr></thead>
            <tbody>{d.matches.map((m) => (
              <tr key={`${m.report_id}-${m.item_id}`} className={`hover:bg-cream ${m.above_threshold ? '' : 'opacity-55'}`}>
                <td className="td"><Link className="font-semibold text-forest-700 hover:underline" to={`/admin/lost-reports/${m.report_id}`}>{m.report_ref}</Link>
                  <div className="text-xs text-stone-500">{m.student_name}</div><StatusChip status={m.report_status} /></td>
                <td className="td"><Link className="font-semibold text-forest-700 hover:underline" to={`/admin/inventory/${m.item_id}`}>{m.item_ref}</Link>
                  <div className="text-xs text-stone-500 line-clamp-1 max-w-56">{m.public_description}</div><StatusChip status={m.item_status} /></td>
                <td className="td">{m.category}</td>
                <td className="td"><ScoreBar score={m.score} threshold={d.threshold} /></td>
                <td className="td text-xs">{m.visible_to_student ? <span className="text-emerald-700 font-semibold">Visible #{m.rank}</span> : m.dismissed ? 'Dismissed' : m.above_threshold ? 'Hidden (rank/status)' : 'Below threshold'}</td>
                <td className="td"><button className="btn-ghost btn-sm" onClick={() => setBd(m)}>Breakdown</button></td>
              </tr>
            ))}</tbody>
          </table>
          <div className="px-4 pb-4"><Pager total={d.total} limit={LIMIT} offset={f.offset} onChange={(offset) => setF({ ...f, offset })} /></div>
        </div>
      )}</Loader>
      <Modal open={!!bd} title={bd ? `Score ${Math.round(bd.score)}: ${bd.report_ref} vs ${bd.item_ref}` : ''} onClose={() => setBd(null)}>
        {bd && <Breakdown breakdown={bd.breakdown} />}
      </Modal>
    </>
  );
}
