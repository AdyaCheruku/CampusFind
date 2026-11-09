import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FileText, Upload, CalendarClock, MapPin } from 'lucide-react';
import { api, errMsg } from '../../api';
import { DL, ErrorBox, Field, Loader, PageHeader, Photo, ReasonModal, Section, StatusChip, SuccessBox, Timeline, fmtDate, fmtDateTime, humanize, useApi } from '../../components/ui';

const STATUS_TEXT = {
  QUEUED: 'Another student claimed this item first. Your claim is in the queue and will be reviewed in order.',
  PENDING: 'The admin desk is reviewing your claim against your locked report.',
  APPROVED: 'Your claim is approved. Collect your item from the desk with your college ID before the deadline.',
  REJECTED: 'Your claim was not approved.',
  COMPLETED: 'You collected this item. This claim is complete.',
};

function EvidenceUpload({ claimId, onDone }) {
  const [files, setFiles] = useState([]);
  const [type, setType] = useState('PHOTO');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const fd = new FormData();
      [...files].forEach((f) => fd.append('files', f));
      fd.append('evidenceType', type);
      if (note.trim()) fd.append('note', note.trim());
      await api.post(`/claims/${claimId}/evidence`, fd);
      setFiles([]); setNote(''); e.target.reset(); onDone();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3 mt-4 border-t border-cream-dark pt-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Evidence type"><select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="PHOTO">Photo of me with the item</option><option value="RECEIPT">Receipt / invoice</option><option value="OTHER">Other</option>
        </select></Field>
        <Field label="Files (up to 3)" hint="Images or PDF, max 5 MB each"><input type="file" multiple accept="image/*,application/pdf" className="input" onChange={(e) => setFiles(e.target.files)} /></Field>
      </div>
      <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      <ErrorBox error={error} />
      <button className="btn-outline" disabled={busy || files.length === 0}><Upload size={16} />{busy ? 'Uploading…' : 'Upload evidence'}</button>
    </form>
  );
}

export default function ClaimDetail() {
  const { id } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const q = useApi(async () => (await api.get(`/claims/${id}`)).data.claim, [id]);
  const [appeal, setAppeal] = useState(false);

  return (
    <Loader q={q}>{(c) => (
      <>
        <PageHeader back={{ to: '/student/claims', label: 'My Claims' }} title={`Claim ${c.reference_code}`}
          subtitle={`Item ${c.item_ref} · Report ${c.report_ref}`}
          actions={<>
            <StatusChip status={c.status} className="self-center text-sm" />
            {c.can_appeal && <button className="btn-gold" onClick={() => setAppeal(true)}>Appeal decision</button>}
          </>} />
        {loc.state?.justClaimed && <div className="mb-4"><SuccessBox>Claim submitted. The admin desk will review it and you&apos;ll be notified of the decision.</SuccessBox></div>}

        <div className={`mb-6 rounded-2xl p-5 ${c.status === 'APPROVED' ? 'bg-forest-800 text-white' : c.status === 'REJECTED' ? 'bg-red-50 border border-red-200' : 'card'}`}>
          <p className="font-semibold">{STATUS_TEXT[c.status]}</p>
          {c.status === 'QUEUED' && <p className="text-sm mt-1">Queue position: <b>{c.queue_position}</b></p>}
          {c.decision_reason && <p className="text-sm mt-2"><span className="opacity-75">Admin&apos;s note:</span> {c.decision_reason}</p>}
          {c.status === 'APPROVED' && (
            <div className="mt-3 grid sm:grid-cols-2 gap-3 text-sm">
              <div className="flex gap-2"><MapPin size={18} className="text-gold-light shrink-0" />{c.pickup_instructions}</div>
              <div className="flex gap-2"><CalendarClock size={18} className="text-gold-light shrink-0" />Collect by {fmtDateTime(c.pickup_deadline)}</div>
            </div>
          )}
          {c.status === 'REJECTED' && c.has_been_appealed && <p className="text-sm mt-2">You have already appealed this decision.</p>}
          {c.status === 'REJECTED' && c.can_appeal && <p className="text-sm mt-2">You can appeal once if you believe this is a mistake. Add evidence such as a receipt or an old photo.</p>}
          {c.status === 'COMPLETED' && <p className="text-sm mt-1">Collected on {fmtDateTime(c.handed_at)}.</p>}
        </div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-6">
            <Section title="Item">
              <div className="flex gap-4">
                <Photo src={c.primary_photo_id ? `/api/photos/${c.primary_photo_id}` : null} className="h-24 w-24 rounded-xl shrink-0" />
                <DL rows={[['Item', `${c.colour} ${c.category}`], ['Description', c.public_description], ['Found at', c.found_location], ['Found on', fmtDate(c.found_date)]]} />
              </div>
            </Section>
            <Section title="Your answers">
              {c.responses.length === 0 ? <p className="text-sm text-stone-500">No verification questions were asked.</p> : (
                <ul className="space-y-3 text-sm">{c.responses.map((r) => <li key={r.question_id}><div className="text-stone-500">{r.question_text}</div><div className="font-medium">{r.answer_text}</div></li>)}</ul>
              )}
              {c.appeal_statement && <div className="mt-4 text-sm"><div className="text-stone-500">Appeal statement</div><div>{c.appeal_statement}</div></div>}
            </Section>
          </div>
          <div className="space-y-6">
            <Section title="Supporting evidence">
              {c.evidence.length === 0 ? <p className="text-sm text-stone-500">No evidence uploaded.</p> : (
                <ul className="space-y-2">{c.evidence.map((e) => (
                  <li key={e.evidence_id}>
                    <a href={`/api/claims/${c.claim_id}/evidence/${e.evidence_id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-forest-700 hover:underline">
                      <FileText size={16} />{humanize(e.evidence_type)}{e.note ? `: ${e.note}` : ''} <span className="text-stone-400">({fmtDate(e.uploaded_at)})</span>
                    </a>
                  </li>
                ))}</ul>
              )}
              {['QUEUED', 'PENDING'].includes(c.status) && <EvidenceUpload claimId={c.claim_id} onDone={q.reload} />}
            </Section>
            <Section title="Timeline"><Timeline history={c.history} /></Section>
            <Link to={`/student/reports/${c.report_id}`} className="btn-outline">View report {c.report_ref}</Link>
          </div>
        </div>

        <ReasonModal open={appeal} title="Appeal this decision" label="Explain why this item is yours" minLength={10} confirmLabel="Submit appeal"
          onClose={() => setAppeal(false)}
          onSubmit={async (statement) => {
            const { data } = await api.post(`/claims/${c.claim_id}/appeal`, { statement });
            navigate(`/student/claims/${data.claim.claim_id}`);
            return true;
          }}>
          <p className="text-sm text-stone-600">You can appeal only once. Your appeal creates a new claim that the admin desk reviews again. You can attach evidence after submitting it.</p>
        </ReasonModal>
      </>
    )}</Loader>
  );
}
