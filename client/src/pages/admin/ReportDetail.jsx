import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { api } from '../../api';
import { Breakdown, DL, Loader, Modal, PageHeader, ReasonModal, ScoreBar, Section, StatusChip, Timeline, fmtDateTime, useApi } from '../../components/ui';

export default function AdminReportDetail() {
  const { id } = useParams();
  const q = useApi(async () => (await api.get(`/admin/lost-reports/${id}`)).data.report, [id]);
  const [close, setClose] = useState(false);
  const [bd, setBd] = useState(null);

  return (
    <Loader q={q}>{(r) => (
      <>
        <PageHeader back={{ to: '/admin/lost-reports', label: 'Lost reports' }} title={`${r.reference_code} · ${r.category}`}
          subtitle={`${r.student_name} (${r.student_roll_no}) · ${r.student_email}`}
          actions={<>
            <StatusChip status={r.status} className="self-center text-sm" />
            {r.status === 'ACTIVE' && <button className="btn-outline" onClick={() => setClose(true)}>Close report</button>}
          </>} />
        <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
          <div className="space-y-6">
            <Section title={`Matches (${r.matches.length})`}>
              {r.matches.length === 0 ? <p className="text-sm text-stone-500">No stored matches for this report.</p> : (
                <div className="overflow-x-auto"><table className="w-full min-w-[520px]">
                  <thead><tr><th className="th">Item</th><th className="th">Score</th><th className="th">Student sees</th><th className="th"></th></tr></thead>
                  <tbody>{r.matches.map((m) => (
                    <tr key={m.item_id} className={m.above_threshold ? '' : 'opacity-60'}>
                      <td className="td"><Link className="font-semibold text-forest-700 hover:underline" to={`/admin/inventory/${m.item_id}`}>{m.item_ref}</Link>
                        <div className="text-xs text-stone-500 line-clamp-1">{m.public_description}</div><StatusChip status={m.item_status} /></td>
                      <td className="td"><ScoreBar score={m.score} /></td>
                      <td className="td text-xs">{m.visible_to_student ? `Yes (#${m.rank})` : m.dismissed ? 'Dismissed' : m.above_threshold ? 'No (rank)' : 'Below threshold'}</td>
                      <td className="td"><button className="btn-ghost btn-sm" onClick={() => setBd(m)}>Breakdown</button></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Section>
            <Section title={`Claims (${r.claims.length})`}>
              {r.claims.length === 0 ? <p className="text-sm text-stone-500">No claims.</p> : r.claims.map((c) => (
                <div key={c.claim_id} className="flex items-center gap-3 text-sm py-1">
                  <Link className="font-semibold text-forest-700 hover:underline" to={`/admin/claims/${c.claim_id}`}>{c.reference_code}</Link>
                  <span className="flex-1">Item {c.item_ref}</span><StatusChip status={c.status} />
                </div>
              ))}
            </Section>
            <Section title="Status history"><Timeline history={r.history} /></Section>
          </div>
          <Section title={<span className="flex items-center gap-2"><Lock size={16} className="text-gold" />Locked description</span>}>
            <DL rows={[
              ['Brand / model', [r.brand, r.model].filter(Boolean).join(' ')], ['Colour', r.colour],
              ['Description', r.description], ['Features', r.features], ['Serial hint', r.serial_hint],
              ['Lost at', [r.lost_location, r.lost_location_detail].filter(Boolean).join(', ')], ['When', fmtDateTime(r.lost_at)],
              ['Filed', fmtDateTime(r.created_at)],
              ['Proof photo', r.has_proof_photo ? <a className="text-forest-700 underline" target="_blank" rel="noreferrer" href={`/api/admin/lost-reports/${r.report_id}/proof`}>View (audited)</a> : 'None'],
              r.withdrawn_reason && ['Withdrawn', r.withdrawn_reason], r.closed_reason && ['Closed', r.closed_reason],
            ]} />
          </Section>
        </div>
        <Modal open={!!bd} title={bd ? `Score ${Math.round(bd.score)}: ${bd.report_ref} vs ${bd.item_ref}` : ''} onClose={() => setBd(null)}>
          {bd && <Breakdown breakdown={bd.breakdown} />}
        </Modal>
        <ReasonModal open={close} title="Close report" label="Reason for closing" minLength={3} confirmLabel="Close report" danger
          onClose={() => setClose(false)}
          onSubmit={async (reason) => { await api.post(`/admin/lost-reports/${id}/close`, { reason }); q.reload(); return true; }} />
      </>
    )}</Loader>
  );
}
