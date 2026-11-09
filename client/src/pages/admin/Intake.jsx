import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Star } from 'lucide-react';
import { api, clean, errMsg } from '../../api';
import { ErrorBox, Field, Loader, PageHeader, Section, toLocalInput, useLookups } from '../../components/ui';
import ItemFields, { emptyItem, itemPayload } from './ItemFields';

export default function Intake() {
  const lookups = useLookups();
  const navigate = useNavigate();
  const [item, setItem] = useState(emptyItem());
  const [priv, setPriv] = useState({ serialNo: '', hiddenMarks: '', privateNotes: '' });
  const [finder, setFinder] = useState({ finderName: '', finderContact: '', finderRollNo: '', foundWhere: '', foundWhen: '', circumstances: '' });
  const [questions, setQuestions] = useState([{ questionText: '', expectedAnswer: '' }]);
  const [photos, setPhotos] = useState([]);
  const [primary, setPrimary] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const setF = (k) => (e) => setFinder({ ...finder, [k]: e.target.value });
  const setP = (k) => (e) => setPriv({ ...priv, [k]: e.target.value });

  const addPhotos = (files) => setPhotos([...photos, ...files].slice(0, 6));

  const submit = async (publish) => {
    setBusy(true); setError(null);
    try {
      const data = {
        item: clean(itemPayload(item)),
        private: clean(priv),
        finder: clean({ ...finder, foundWhen: finder.foundWhen ? new Date(finder.foundWhen).toISOString() : '' }),
        questions: questions.filter((q) => q.questionText.trim() || q.expectedAnswer.trim()),
        publish,
        primaryIndex: primary,
      };
      const fd = new FormData();
      fd.append('data', JSON.stringify(data));
      photos.forEach((p) => fd.append('photos', p));
      const { data: res } = await api.post('/admin/found-items', fd);
      navigate(`/admin/inventory/${res.itemId}`, { state: { created: res } });
    } catch (e) { setError(errMsg(e)); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Register found item" subtitle="Record an item handed in at the desk. Save it as a draft, or publish it to start matching." />
      <Loader q={lookups}>{(L) => (
        <form onSubmit={(e) => { e.preventDefault(); submit(true); }} className="space-y-6">
          <ErrorBox error={error} />
          <Section title="1. Item details (public and matching)"><ItemFields value={item} onChange={setItem} lookups={L} /></Section>

          <Section title="2. Photos">
            <input type="file" accept="image/*" multiple className="input" onChange={(e) => { addPhotos([...e.target.files]); e.target.value = ''; }} />
            <p className="text-xs text-stone-500 mt-1">Up to 6 photos. At least one is required to publish. Students only ever see blurred copies.</p>
            {photos.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {photos.map((p, i) => (
                  <div key={i} className={`relative rounded-xl overflow-hidden border-2 ${i === primary ? 'border-gold' : 'border-cream-dark'}`}>
                    <img src={URL.createObjectURL(p)} alt="" className="h-24 w-24 object-cover" />
                    <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1">
                      <button type="button" title="Primary photo" onClick={() => setPrimary(i)} className={i === primary ? 'text-gold-light' : 'text-white'}><Star size={14} fill={i === primary ? 'currentColor' : 'none'} /></button>
                      <button type="button" title="Remove" onClick={() => { setPhotos(photos.filter((_, j) => j !== i)); setPrimary(0); }} className="text-white"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <Section title="3. Private details (admin only)">
              <div className="space-y-4">
                <Field label="Serial / IMEI number"><input className="input" value={priv.serialNo} onChange={setP('serialNo')} maxLength={80} /></Field>
                <Field label="Hidden marks" hint="Compared against the claimant's locked description."><textarea className="input min-h-16" value={priv.hiddenMarks} onChange={setP('hiddenMarks')} maxLength={500} /></Field>
                <Field label="Private notes"><textarea className="input min-h-16" value={priv.privateNotes} onChange={setP('privateNotes')} maxLength={1000} /></Field>
              </div>
            </Section>
            <Section title="4. Finder statement">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Finder name" required><input className="input" value={finder.finderName} onChange={setF('finderName')} required minLength={2} maxLength={100} /></Field>
                <Field label="Finder contact"><input className="input" value={finder.finderContact} onChange={setF('finderContact')} maxLength={100} /></Field>
                <Field label="Finder roll no."><input className="input" value={finder.finderRollNo} onChange={setF('finderRollNo')} maxLength={30} /></Field>
                <Field label="Found when"><input type="datetime-local" className="input" value={finder.foundWhen} max={toLocalInput()} onChange={setF('foundWhen')} /></Field>
                <div className="sm:col-span-2"><Field label="Where it was found" required><input className="input" value={finder.foundWhere} onChange={setF('foundWhere')} required minLength={2} maxLength={200} /></Field></div>
                <div className="sm:col-span-2"><Field label="Circumstances"><textarea className="input min-h-16" value={finder.circumstances} onChange={setF('circumstances')} maxLength={1000} /></Field></div>
              </div>
            </Section>
          </div>

          <Section title="5. Verification questions" actions={questions.length < 5 && <button type="button" className="btn-outline btn-sm" onClick={() => setQuestions([...questions, { questionText: '', expectedAnswer: '' }])}><Plus size={14} />Add question</button>}>
            <p className="text-sm text-stone-500 mb-3">Ask about details only the real owner would know (lock-screen wallpaper, sticker, contents). Leave blank to skip.</p>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div key={i} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <Field label={`Question ${i + 1}`}><input className="input" value={q.questionText} maxLength={200} onChange={(e) => setQuestions(questions.map((x, j) => j === i ? { ...x, questionText: e.target.value } : x))} /></Field>
                  <Field label="Expected answer"><input className="input" value={q.expectedAnswer} maxLength={200} onChange={(e) => setQuestions(questions.map((x, j) => j === i ? { ...x, expectedAnswer: e.target.value } : x))} /></Field>
                  <button type="button" className="btn-ghost" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} aria-label="Remove question"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </Section>

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" className="btn-outline" disabled={busy} onClick={(e) => { const form = e.currentTarget.form; if (form.reportValidity()) submit(false); }}>Save as draft</button>
            <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Publish and run matching'}</button>
          </div>
        </form>
      )}</Loader>
    </>
  );
}
