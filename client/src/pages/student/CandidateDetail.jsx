import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api, errMsg } from '../../api';
import { DL, ErrorBox, Field, Loader, PageHeader, Photo, Section, fmtDate, useApi } from '../../components/ui';

export default function CandidateDetail() {
  const { id, itemId } = useParams();
  const navigate = useNavigate();
  const q = useApi(async () => (await api.get(`/lost-reports/${id}/candidates/${itemId}`)).data, [id, itemId]);
  const [answers, setAnswers] = useState({});
  const [active, setActive] = useState(0);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { data } = await api.post('/claims', { reportId: Number(id), itemId: Number(itemId), answers });
      navigate(`/student/claims/${data.claim.claim_id}`, { state: { justClaimed: true } });
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <Loader q={q}>{({ candidate: c, questions, report }) => (
      <>
        <PageHeader back={{ to: `/student/reports/${id}`, label: `Back to ${report.reference_code}` }}
          title={`Is this your ${c.category.toLowerCase()}?`} subtitle={`Potential match ${c.item_ref} for your report ${report.reference_code}`} />
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <Section title="Found item">
            <Photo src={c.photo_ids[active] ? `/api/photos/${c.photo_ids[active]}` : null} className="w-full h-72 rounded-xl" />
            {c.photo_ids.length > 1 && (
              <div className="mt-3 flex gap-2">
                {c.photo_ids.map((pid, i) => (
                  <button key={pid} onClick={() => setActive(i)} className={`rounded-lg overflow-hidden border-2 ${i === active ? 'border-gold' : 'border-transparent'}`}>
                    <Photo src={`/api/photos/${pid}`} className="h-14 w-14" />
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-stone-500 mt-2">Photos are blurred to protect identifying details. The admin desk has the originals.</p>
            <div className="mt-4"><DL rows={[
              ['Category', c.category], ['Colour', c.colour], ['Description', c.public_description],
              ['Found at', c.found_location], ['Found on', fmtDate(c.found_date)],
            ]} /></div>
            {c.under_review && <p className="mt-4 text-sm rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900">Another claim for this item is already under review. If you claim it, you&apos;ll join the queue and be reviewed in order.</p>}
          </Section>

          <Section title={<span className="flex items-center gap-2"><ShieldCheck size={18} className="text-forest-600" />Claim this item</span>}>
            {c.already_claimed ? <p className="text-sm text-stone-600">You have already claimed this item from this report.</p> : (
              <form onSubmit={submit} className="space-y-4">
                {questions.length > 0 ? (
                  <>
                    <p className="text-sm text-stone-600">Answer these questions set by the admin desk. Only the real owner should know the answers.</p>
                    {questions.map((qq, i) => (
                      <Field key={qq.question_id} label={`${i + 1}. ${qq.question_text}`} required>
                        <input className="input" maxLength={300} required value={answers[qq.question_id] || ''}
                          onChange={(e) => setAnswers({ ...answers, [qq.question_id]: e.target.value })} />
                      </Field>
                    ))}
                  </>
                ) : <p className="text-sm text-stone-600">There are no verification questions for this item. The admin will compare your locked report with the item, and may ask you to bring proof.</p>}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 accent-forest-700" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  I confirm this item is mine. False claims are logged and may lead to disciplinary action.
                </label>
                <ErrorBox error={error} />
                <button className="btn-primary w-full" disabled={!agree || busy}>{busy ? 'Submitting…' : 'This is mine. Submit claim'}</button>
              </form>
            )}
          </Section>
        </div>
      </>
    )}</Loader>
  );
}
