import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, AlertTriangle } from 'lucide-react';
import { api, errMsg } from '../../api';
import { ErrorBox, Field, Loader, PageHeader, Section, toLocalInput, useLookups } from '../../components/ui';

const empty = { categoryId: '', brand: '', model: '', colourId: '', description: '', features: '', serialHint: '', lostLocationId: '', lostLocationDetail: '', lostAt: '' };

export default function ReportNew() {
  const lookups = useLookups();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [photo, setPhoto] = useState(null);
  const [step, setStep] = useState('form'); // form | confirm
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (v === '') return;
        fd.append(k, k === 'lostAt' ? new Date(v).toISOString() : v);
      });
      if (photo) fd.append('proofPhoto', photo);
      const { data } = await api.post('/lost-reports', fd);
      navigate(`/student/reports/${data.report.report_id}`, { state: { justFiled: true } });
    } catch (e) {
      setError(errMsg(e)); setStep('form');
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Report a lost item" subtitle="The more specific you are, the better your matches will be." />
      <Loader q={lookups}>{(L) => {
        const name = (list, id) => list.find((x) => String(x.id) === String(id))?.name;
        if (step === 'confirm') {
          return (
            <Section title="Review and submit">
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex gap-3 text-sm text-amber-900">
                <Lock className="shrink-0" size={20} />
                <p>Once submitted, your lost-item description will be locked. You will not be able to modify the original identifying details after viewing potential matches.</p>
              </div>
              <dl className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[['Category', name(L.categories, form.categoryId)], ['Brand', form.brand], ['Model', form.model],
                  ['Colour', name(L.colours, form.colourId)], ['Lost at', name(L.locations, form.lostLocationId)],
                  ['Location detail', form.lostLocationDetail], ['Date & time lost', form.lostAt && new Date(form.lostAt).toLocaleString()],
                  ['Serial / ID hint', form.serialHint], ['Proof photo', photo?.name]].map(([k, v]) => (
                  <div key={k}><dt className="text-stone-500">{k}</dt><dd className="font-medium">{v || '—'}</dd></div>
                ))}
                <div className="sm:col-span-2"><dt className="text-stone-500">Description</dt><dd className="font-medium whitespace-pre-wrap">{form.description}</dd></div>
                {form.features && <div className="sm:col-span-2"><dt className="text-stone-500">Distinguishing features</dt><dd className="font-medium whitespace-pre-wrap">{form.features}</dd></div>}
              </dl>
              <label className="mt-6 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 accent-forest-700" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I confirm these details are accurate and understand they will be locked after submission.
              </label>
              <ErrorBox error={error} />
              <div className="mt-6 flex justify-between gap-2">
                <button className="btn-outline" onClick={() => setStep('form')} disabled={busy}>Back to edit</button>
                <button className="btn-primary" onClick={submit} disabled={!confirmed || busy}><Lock size={16} />{busy ? 'Submitting…' : 'Submit and lock report'}</button>
              </div>
            </Section>
          );
        }
        return (
          <form onSubmit={(e) => { e.preventDefault(); setError(null); setConfirmed(false); setStep('confirm'); }} className="space-y-6">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex gap-3 text-sm text-amber-900">
              <AlertTriangle className="shrink-0" size={20} />
              <p>Once submitted, your lost-item description will be locked. You will not be able to modify the original identifying details after viewing potential matches.</p>
            </div>
            <Section title="What did you lose?">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Category" required>
                  <select className="input" value={form.categoryId} onChange={set('categoryId')} required>
                    <option value="">Select a category</option>
                    {[...new Set(L.categories.map((c) => c.group))].map((g) => (
                      <optgroup key={g} label={g}>{L.categories.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                    ))}
                  </select>
                </Field>
                <Field label="Colour">
                  <select className="input" value={form.colourId} onChange={set('colourId')}>
                    <option value="">Not sure / multiple</option>
                    {L.colours.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Brand"><input className="input" value={form.brand} onChange={set('brand')} placeholder="e.g. Apple, Casio, Milton" maxLength={60} /></Field>
                <Field label="Model"><input className="input" value={form.model} onChange={set('model')} placeholder="e.g. iPhone 14, fx-991ES" maxLength={80} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Description" required hint={`At least 20 characters. ${form.description.length}/1000`}>
                    <textarea className="input min-h-28" value={form.description} onChange={set('description')} required minLength={20} maxLength={1000}
                      placeholder="Describe the item: size, material, case, condition, what was inside…" />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Distinguishing features" hint="Stickers, scratches, engravings, keychains… things only the owner would know.">
                    <textarea className="input min-h-20" value={form.features} onChange={set('features')} maxLength={500} />
                  </Field>
                </div>
                <Field label="Serial / ID hint" hint="For example the last 4 digits of the serial number. Never shown to anyone except the admin.">
                  <input className="input" value={form.serialHint} onChange={set('serialHint')} maxLength={80} />
                </Field>
                <Field label="Proof photo (optional)" hint="An old photo of you with the item, or the box/receipt. JPEG/PNG/WebP, max 5 MB.">
                  <input type="file" accept="image/*" className="input" onChange={(e) => setPhoto(e.target.files[0] || null)} />
                </Field>
              </div>
            </Section>
            <Section title="Where and when?">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Where did you lose it?">
                  <select className="input" value={form.lostLocationId} onChange={set('lostLocationId')}>
                    <option value="">Not sure</option>
                    {L.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
                <Field label="Location detail"><input className="input" value={form.lostLocationDetail} onChange={set('lostLocationDetail')} placeholder="e.g. 2nd floor, near window seats" maxLength={120} /></Field>
                <Field label="Date and time lost (best guess)" required>
                  <input type="datetime-local" className="input" value={form.lostAt} onChange={set('lostAt')} max={toLocalInput()} required />
                </Field>
              </div>
            </Section>
            <ErrorBox error={error} />
            <div className="flex justify-end"><button className="btn-primary">Review report</button></div>
          </form>
        );
      }}</Loader>
    </>
  );
}
