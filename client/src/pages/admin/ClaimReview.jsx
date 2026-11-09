import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock, PackageSearch, ShieldAlert, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { api, errMsg } from '../../api';
import {
  Breakdown, DL, ErrorBox, Field, Loader, Modal, PageHeader, Photo, ReasonModal, Section, StatusChip, Timeline,
  fmtDateTime, humanize, toLocalInput, useApi,
} from '../../components/ui';

const VERDICT = { MATCH: 'text-emerald-700', PARTIAL: 'text-amber-700', NO_MATCH: 'text-red-700' };

function ApproveModal({ claimId, onClose, onDone }) {
  const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(17, 0, 0, 0);
  const [v, setV] = useState({ reason: '', pickupInstructions: 'Collect from the Admin Desk, Student Services, ground floor (Mon–Sat, 9 AM – 5 PM). Bring your college ID.', pickupDeadline: toLocalInput(d) });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title="Approve claim" onClose={onClose}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          await api.post(`/admin/claims/${claimId}/approve`, { ...v, pickupDeadline: new Date(v.pickupDeadline).toISOString() });
          onDone(); onClose();
        } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
      }}>
        <Field label="Decision reason" required hint="Recorded in the claim history and shown to the student.">
          <textarea className="input min-h-20" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} minLength={5} required />
        </Field>
        <Field label="Pickup instructions" required><textarea className="input min-h-16" value={v.pickupInstructions} onChange={(e) => setV({ ...v, pickupInstructions: e.target.value })} minLength={5} required /></Field>
        <Field label="Pickup deadline" required><input type="datetime-local" className="input" value={v.pickupDeadline} min={toLocalInput()} onChange={(e) => setV({ ...v, pickupDeadline: e.target.value })} required /></Field>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Approving…' : 'Approve claim'}</button></div>
      </form>
    </Modal>
  );
}

export default function ClaimReview() {
  const { id } = useParams();
  const q = useApi(async () => (await api.get(`/admin/claims/${id}`)).data.claim, [id]);
  const [modal, setModal] = useState(null);

  return (
    <Loader q={q}>{(c) => {
      const v = c.verification;
      return (
        <>
          <PageHeader back={{ to: '/admin/claims', label: 'Claims' }} title={`Claim ${c.reference_code}`}
            subtitle={`${c.student_name} (${c.student_roll_no}) · ${c.student_email} · submitted ${fmtDateTime(c.created_at)}`}
            actions={<>
              <StatusChip status={c.status} className="self-center text-sm" />
              {c.status === 'PENDING' && <>
                <button className="btn-primary" onClick={() => setModal('approve')}><CheckCircle2 size={16} />Approve</button>
                <button className="btn-danger" onClick={() => setModal('reject')}><XCircle size={16} />Reject</button>
              </>}
              {c.status === 'QUEUED' && <button className="btn-danger" onClick={() => setModal('reject')}>Reject</button>}
              {c.status === 'APPROVED' && <Link to="/admin/handovers" className="btn-gold">Record handover</Link>}
            </>} />

          {c.status === 'QUEUED' && <p className="mb-4 text-sm rounded-xl bg-sky-50 border border-sky-200 p-3 text-sky-900">This claim is queued behind another claim for the same item. It can be approved only once it is promoted to pending.</p>}
          {c.appeal_of_claim_id && <div className="mb-4 card p-4 text-sm"><b>Appeal</b> of an earlier rejected claim. Statement: <span className="text-stone-700">{c.appeal_statement}</span></div>}
          {c.decision_reason && <div className="mb-4 card p-4 text-sm"><b>Decision</b> by {c.decided_by_name} ({fmtDateTime(c.decided_at)}): {c.decision_reason}
            {c.pickup_deadline && <div className="text-stone-500 mt-1">Pickup: {c.pickup_instructions}. Deadline {fmtDateTime(c.pickup_deadline)}</div>}</div>}

          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <Section title={<span className="flex items-center gap-2"><Lock size={16} className="text-gold" />Claimant&apos;s locked report {c.report_ref}</span>}>
              <DL rows={[
                ['Category', c.report_category], ['Brand / model', [c.report_brand, c.report_model].filter(Boolean).join(' ')],
                ['Colour', c.report_colour], ['Description', c.report_description], ['Features', c.report_features],
                ['Serial hint', c.report_serial_hint], ['Lost at', [c.report_location, c.report_location_detail].filter(Boolean).join(', ')],
                ['When', fmtDateTime(c.report_lost_at)], ['Locked', fmtDateTime(c.locked_at)],
                ['Proof photo', c.report_has_proof ? <a className="text-forest-700 underline" target="_blank" rel="noreferrer" href={`/api/admin/lost-reports/${c.report_id}/proof`}>View</a> : 'None'],
              ]} />
            </Section>
            <Section title={<span className="flex items-center gap-2"><PackageSearch size={16} className="text-forest-600" />Found item <Link className="underline" to={`/admin/inventory/${c.item_id}`}>{c.item_ref}</Link></span>}>
              {c.photos.length > 0 && (
                <div className="flex gap-2 mb-4 overflow-x-auto">
                  {c.photos.map((p) => <a key={p.photo_id} href={`/api/admin/photos/${p.photo_id}/original`} target="_blank" rel="noreferrer"><Photo src={`/api/admin/photos/${p.photo_id}/original`} className="h-24 w-24 rounded-lg" /></a>)}
                </div>
              )}
              <DL rows={[
                ['Category', c.item_category], ['Brand / model', [c.item_brand, c.item_model].filter(Boolean).join(' ')],
                ['Colour', c.item_colour], ['Public desc.', c.item_public_description], ['Visible marks', c.item_visible_marks],
                ['Contents', c.item_contents], ['Found at', [c.item_location, c.item_location_detail].filter(Boolean).join(', ')],
                ['When', fmtDateTime(c.item_found_at)], ['Storage', c.storage_location],
                ['Serial (private)', c.private_serial_no], ['Hidden marks (private)', c.private_hidden_marks], ['Notes (private)', c.private_notes],
              ]} />
            </Section>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 items-start mt-6">
            <Section title={<span className="flex items-center gap-2"><ShieldAlert size={16} />Verification guide</span>} className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <StatusChip status={v.overall} className="text-sm" />
                <span className="text-sm text-stone-500">{v.points} / {v.max_points} points</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 text-sm mb-4">
                <div className="rounded-xl bg-cream p-3"><div className="font-semibold">Serial number: {humanize(v.serial.result)}</div>
                  <div className="text-stone-600">Claimant hint: {v.serial.claimant_hint || '—'} · Recorded: {v.serial.recorded || '—'}</div></div>
                <div className="rounded-xl bg-cream p-3"><div className="font-semibold">Hidden marks: {humanize(v.hidden_marks.result)}</div>
                  <div className="text-stone-600">Recorded: {v.hidden_marks.recorded || '—'}{v.hidden_marks.similarity != null && ` (similarity ${v.hidden_marks.similarity})`}</div></div>
              </div>
              {v.questions.length > 0 ? (
                <table className="w-full text-sm">
                  <thead><tr><th className="th px-2!">Question</th><th className="th px-2!">Claimant answer</th><th className="th px-2!">Expected</th><th className="th px-2!">Result</th></tr></thead>
                  <tbody>{v.questions.map((x, i) => (
                    <tr key={i}><td className="td px-2!">{x.question}</td><td className="td px-2! font-medium">{x.answer || '—'}</td><td className="td px-2!">{x.expected}</td>
                      <td className={`td px-2! font-semibold ${VERDICT[x.verdict] || ''}`}>{humanize(x.verdict)} <span className="text-xs text-stone-400">({x.similarity})</span></td></tr>
                  ))}</tbody>
                </table>
              ) : <p className="text-sm text-stone-500">No verification questions for this item.</p>}
              <p className="text-xs text-stone-500 mt-3">{v.note}</p>
            </Section>
            <Section title={`Match score ${c.current_score != null ? Math.round(c.current_score) : '—'}`}>
              <Breakdown breakdown={c.score_breakdown} />
            </Section>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 items-start mt-6">
            <Section title="Evidence">
              {c.evidence.length === 0 ? <p className="text-sm text-stone-500">None uploaded.</p> : c.evidence.map((e) => (
                <a key={e.evidence_id} href={`/api/admin/evidence/${e.evidence_id}`} target="_blank" rel="noreferrer" className="flex gap-2 items-center text-sm text-forest-700 hover:underline py-1">
                  <FileText size={16} />{humanize(e.type)}{e.note ? `: ${e.note}` : ''}
                </a>
              ))}
            </Section>
            <Section title="Finder statements">
              {c.finder_statements.map((f, i) => (
                <div key={i} className="text-sm mb-3"><div className="font-semibold">{f.finder_name}</div><div>{f.found_where}</div>{f.circumstances && <div className="text-stone-600">{f.circumstances}</div>}</div>
              ))}
            </Section>
            <Section title="Other claims on this item">
              {c.other_claims.length === 0 ? <p className="text-sm text-stone-500">None.</p> : c.other_claims.map((o) => (
                <div key={o.claim_id} className="flex justify-between items-center text-sm py-1">
                  <Link className="text-forest-700 hover:underline" to={`/admin/claims/${o.claim_id}`}>{o.reference_code} · {o.student_name}</Link><StatusChip status={o.status} />
                </div>
              ))}
            </Section>
          </div>
          <div className="mt-6"><Section title="Claim history"><Timeline history={c.history} /></Section></div>

          {modal === 'approve' && <ApproveModal claimId={c.claim_id} onClose={() => setModal(null)} onDone={q.reload} />}
          <ReasonModal open={modal === 'reject'} title="Reject claim" label="Reason (shown to the student)" confirmLabel="Reject claim" danger
            onClose={() => setModal(null)}
            onSubmit={async (reason) => { await api.post(`/admin/claims/${c.claim_id}/reject`, { reason }); q.reload(); return true; }}>
            <p className="text-sm text-stone-600">If other claims are queued, the next one becomes pending. Otherwise the item returns to custody and matching re-runs.</p>
          </ReasonModal>
        </>
      );
    }}</Loader>
  );
}
