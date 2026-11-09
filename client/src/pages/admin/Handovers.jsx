import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake, AlertTriangle } from 'lucide-react';
import { api, errMsg } from '../../api';
import { Empty, ErrorBox, Field, Loader, Modal, PageHeader, Section, SuccessBox, fmtDateTime, useApi } from '../../components/ui';

function HandoverModal({ claim, onClose, onDone }) {
  const [v, setV] = useState({ idDocument: 'College ID card', idVerified: false, notes: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={`Record handover: ${claim.item_ref}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          await api.post(`/admin/handover/${claim.claim_id}`, { ...v, notes: v.notes.trim() || undefined });
          onDone(`Handover recorded. ${claim.item_ref} returned to ${claim.student_name}.`); onClose();
        } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
      }}>
        <div className="rounded-xl bg-cream p-3 text-sm">
          <div><b>{claim.student_name}</b> ({claim.student_roll_no})</div>
          <div className="text-stone-600">{claim.category}: {claim.public_description}</div>
          <div className="text-stone-600">Storage: <b>{claim.storage_location}</b></div>
        </div>
        <Field label="ID document checked" required><input className="input" value={v.idDocument} onChange={(e) => setV({ ...v, idDocument: e.target.value })} required minLength={2} maxLength={80} /></Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 accent-forest-700" checked={v.idVerified} onChange={(e) => setV({ ...v, idVerified: e.target.checked })} />
          I checked the ID in person and it matches {claim.student_name} ({claim.student_roll_no}).
        </label>
        <Field label="Notes"><textarea className="input" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={1000} /></Field>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !v.idVerified}>{busy ? 'Recording…' : 'Confirm handover'}</button></div>
      </form>
    </Modal>
  );
}

export default function Handovers() {
  const pending = useApi(async () => (await api.get('/admin/handovers/pending')).data.pending, []);
  const done = useApi(async () => (await api.get('/admin/handovers', { params: { limit: 50 } })).data.handovers, []);
  const [sel, setSel] = useState(null);
  const [flash, setFlash] = useState(null);

  return (
    <>
      <PageHeader title="Handovers" subtitle="Approved claims waiting for collection, and completed handovers." />
      <div className="mb-4"><SuccessBox>{flash}</SuccessBox></div>
      <Section title="Awaiting pickup" className="mb-6">
        <Loader q={pending}>{(rows) => rows.length === 0 ? <Empty icon={Handshake} title="Nothing awaiting pickup" /> : (
          <div className="overflow-x-auto -m-5"><table className="w-full min-w-[760px]">
            <thead><tr><th className="th">Claim</th><th className="th">Student</th><th className="th">Item</th><th className="th">Storage</th><th className="th">Deadline</th><th className="th"></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.claim_id}>
                <td className="td"><Link className="font-semibold text-forest-700 hover:underline" to={`/admin/claims/${r.claim_id}`}>{r.reference_code}</Link></td>
                <td className="td">{r.student_name}<div className="text-xs text-stone-500">{r.student_roll_no}</div></td>
                <td className="td">{r.item_ref}<div className="text-xs text-stone-500">{r.category}</div></td>
                <td className="td font-semibold">{r.storage_location}</td>
                <td className="td">{fmtDateTime(r.pickup_deadline)}{r.overdue && <div className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle size={12} />Overdue</div>}</td>
                <td className="td"><button className="btn-primary btn-sm" onClick={() => setSel(r)}>Record handover</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}</Loader>
      </Section>
      <Section title="Completed handovers">
        <Loader q={done}>{(rows) => rows.length === 0 ? <p className="text-sm text-stone-500">None yet.</p> : (
          <div className="overflow-x-auto -m-5"><table className="w-full min-w-[760px]">
            <thead><tr><th className="th">When</th><th className="th">Claim</th><th className="th">Student</th><th className="th">Item</th><th className="th">ID checked</th><th className="th">By</th></tr></thead>
            <tbody>{rows.map((h) => (
              <tr key={h.handover_id}>
                <td className="td">{fmtDateTime(h.handed_at)}</td>
                <td className="td"><Link className="text-forest-700 hover:underline" to={`/admin/claims/${h.claim_id}`}>{h.claim_ref}</Link></td>
                <td className="td">{h.student_name}<div className="text-xs text-stone-500">{h.student_roll_no}</div></td>
                <td className="td">{h.item_ref}<div className="text-xs text-stone-500">{h.category}</div></td>
                <td className="td">{h.id_document_checked}{h.notes && <div className="text-xs text-stone-500">{h.notes}</div>}</td>
                <td className="td">{h.handed_over_by_name}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}</Loader>
      </Section>
      {sel && <HandoverModal claim={sel} onClose={() => setSel(null)} onDone={(m) => { setFlash(m); pending.reload(); done.reload(); }} />}
    </>
  );
}
