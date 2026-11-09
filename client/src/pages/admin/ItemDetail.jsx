import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Star, Trash2, Pencil, Plus, Upload } from 'lucide-react';
import { api, clean, errMsg } from '../../api';
import {
  DL, ErrorBox, Field, Loader, Modal, PageHeader, Photo, ReasonModal, ScoreBar, Section, StatusChip, SuccessBox, Timeline,
  fmtDateTime, useAction, useApi, useLookups,
} from '../../components/ui';
import ItemFields, { itemFromRow, itemPayload } from './ItemFields';

function EditItem({ item, onClose, onSaved }) {
  const lookups = useLookups();
  const [v, setV] = useState(itemFromRow(item));
  const act = useAction();
  return (
    <Modal open title="Edit item details" onClose={onClose}>
      <Loader q={lookups}>{(L) => (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await act.run(() => api.put(`/admin/found-items/${item.item_id}`, clean(itemPayload(v))));
          if (ok) { onSaved(); onClose(); }
        }}>
          <ItemFields value={v} onChange={setV} lookups={L} />
          <p className="text-xs text-stone-500">Changing matching fields re-runs matching for this item.</p>
          <ErrorBox error={act.error} />
          <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Save</button></div>
        </form>
      )}</Loader>
    </Modal>
  );
}

function PrivateForm({ item, onSaved }) {
  const [v, setV] = useState({ serialNo: item.private?.serial_no || '', hiddenMarks: item.private?.hidden_marks || '', privateNotes: item.private?.private_notes || '' });
  const act = useAction();
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setSaved(false); };
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await act.run(() => api.put(`/admin/found-items/${item.item_id}/private`, v));
      if (ok) { setSaved(true); onSaved(); }
    }}>
      <Field label="Serial / IMEI"><input className="input" value={v.serialNo} onChange={set('serialNo')} maxLength={80} /></Field>
      <Field label="Hidden marks"><textarea className="input min-h-16" value={v.hiddenMarks} onChange={set('hiddenMarks')} maxLength={500} /></Field>
      <Field label="Private notes"><textarea className="input min-h-16" value={v.privateNotes} onChange={set('privateNotes')} maxLength={1000} /></Field>
      <ErrorBox error={act.error} />{saved && <SuccessBox>Saved.</SuccessBox>}
      <button className="btn-outline btn-sm" disabled={act.busy}>Save private details</button>
    </form>
  );
}

function AddQuestion({ itemId, onSaved }) {
  const [v, setV] = useState({ questionText: '', expectedAnswer: '' });
  const act = useAction();
  return (
    <form className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end mt-4" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await act.run(() => api.post(`/admin/found-items/${itemId}/questions`, v));
      if (ok) { setV({ questionText: '', expectedAnswer: '' }); onSaved(); }
    }}>
      <Field label="New question"><input className="input" value={v.questionText} onChange={(e) => setV({ ...v, questionText: e.target.value })} minLength={5} maxLength={200} required /></Field>
      <Field label="Expected answer"><input className="input" value={v.expectedAnswer} onChange={(e) => setV({ ...v, expectedAnswer: e.target.value })} maxLength={200} required /></Field>
      <button className="btn-outline" disabled={act.busy}><Plus size={16} />Add</button>
      <div className="sm:col-span-3"><ErrorBox error={act.error} /></div>
    </form>
  );
}

function AddFinder({ itemId, onClose, onSaved }) {
  const [v, setV] = useState({ finderName: '', finderContact: '', finderRollNo: '', foundWhere: '', foundWhen: '', circumstances: '' });
  const act = useAction();
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal open title="Add finder statement" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await act.run(() => api.post(`/admin/found-items/${itemId}/finder-statements`,
          clean({ ...v, foundWhen: v.foundWhen ? new Date(v.foundWhen).toISOString() : '' })));
        if (ok) { onSaved(); onClose(); }
      }}>
        <Field label="Finder name" required><input className="input" value={v.finderName} onChange={set('finderName')} required minLength={2} /></Field>
        <Field label="Contact"><input className="input" value={v.finderContact} onChange={set('finderContact')} /></Field>
        <Field label="Roll no."><input className="input" value={v.finderRollNo} onChange={set('finderRollNo')} /></Field>
        <Field label="Where found" required><input className="input" value={v.foundWhere} onChange={set('foundWhere')} required minLength={2} /></Field>
        <Field label="When found"><input type="datetime-local" className="input" value={v.foundWhen} onChange={set('foundWhen')} /></Field>
        <Field label="Circumstances"><textarea className="input" value={v.circumstances} onChange={set('circumstances')} /></Field>
        <ErrorBox error={act.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={act.busy}>Save</button></div>
      </form>
    </Modal>
  );
}

export default function ItemDetail() {
  const { id } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const q = useApi(async () => (await api.get(`/admin/found-items/${id}`)).data.item, [id]);
  const act = useAction();
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState(loc.state?.created
    ? `Item ${loc.state.created.reference} saved as ${loc.state.created.status.replace('_', ' ').toLowerCase()}${loc.state.created.candidates != null ? `. Matching found ${loc.state.created.candidates} candidate report(s).` : '.'}`
    : null);

  const doAct = async (fn, msg) => { const r = await act.run(fn); if (r !== undefined) { setFlash(msg); q.reload(); } };

  return (
    <Loader q={q}>{(i) => {
      const editable = !['RETURNED'].includes(i.status);
      return (
        <>
          <PageHeader back={{ to: '/admin/inventory', label: 'Inventory' }} title={`${i.reference_code} · ${i.category}`}
            subtitle={`Registered by ${i.created_by_name} on ${fmtDateTime(i.created_at)}`}
            actions={<>
              <StatusChip status={i.status} className="self-center text-sm" />
              {editable && <button className="btn-outline" onClick={() => setModal('edit')}><Pencil size={16} />Edit</button>}
              {i.status === 'DRAFT' && <button className="btn-primary" disabled={act.busy} onClick={() => doAct(async () => {
                const { data } = await api.post(`/admin/found-items/${id}/publish`); return data;
              }, 'Published. Matching has run against all active reports.')}>Publish</button>}
              {i.status === 'DRAFT' && <button className="btn-danger" disabled={act.busy} onClick={async () => {
                if (!window.confirm('Delete this draft permanently?')) return;
                const ok = await act.run(() => api.delete(`/admin/found-items/${id}`));
                if (ok) navigate('/admin/inventory');
              }}><Trash2 size={16} />Delete draft</button>}
              {i.status === 'IN_CUSTODY' && <button className="btn-outline" onClick={() => setModal('archive')}>Archive</button>}
              {i.status === 'ARCHIVED' && <button className="btn-primary" disabled={act.busy} onClick={() => doAct(() => api.post(`/admin/found-items/${id}/restore`), 'Item restored to custody and re-matched.')}>Restore</button>}
            </>} />
          <div className="space-y-3 mb-4"><SuccessBox>{flash}</SuccessBox><ErrorBox error={act.error} /></div>

          <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
            <div className="space-y-6">
              <Section title={`Photos (${i.photos.length})`} actions={editable && (
                <label className="btn-outline btn-sm cursor-pointer"><Upload size={14} />Add photos
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                    const fd = new FormData(); [...e.target.files].forEach((f) => fd.append('photos', f)); e.target.value = '';
                    doAct(() => api.post(`/admin/found-items/${id}/photos`, fd), 'Photos added.');
                  }} />
                </label>
              )}>
                {i.photos.length === 0 ? <p className="text-sm text-stone-500">No photos yet. Add at least one before publishing.</p> : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {i.photos.map((p) => (
                      <div key={p.photo_id} className={`relative rounded-xl overflow-hidden border-2 ${p.is_primary ? 'border-gold' : 'border-cream-dark'}`}>
                        <a href={`/api/admin/photos/${p.photo_id}/original`} target="_blank" rel="noreferrer">
                          <Photo src={`/api/admin/photos/${p.photo_id}/original`} className="h-36 w-full" />
                        </a>
                        {editable && (
                          <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1.5">
                            <button title="Make primary" className={p.is_primary ? 'text-gold-light' : 'text-white'} disabled={p.is_primary}
                              onClick={() => doAct(() => api.post(`/admin/photos/${p.photo_id}/primary`), 'Primary photo updated.')}><Star size={16} fill={p.is_primary ? 'currentColor' : 'none'} /></button>
                            <button title="Delete photo" className="text-white" onClick={() => window.confirm('Delete this photo?') && doAct(() => api.delete(`/admin/photos/${p.photo_id}`), 'Photo deleted.')}><Trash2 size={16} /></button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-stone-500 mt-2">Original photos are visible to admins only. Each view is recorded in the audit log.</p>
              </Section>

              <Section title="Item details">
                <DL rows={[
                  ['Category', `${i.category} (${i.category_group})`], ['Brand / model', [i.brand, i.model].filter(Boolean).join(' ')],
                  ['Colour', i.colour], ['Size', i.size_desc], ['Public description', i.public_description],
                  ['Visible marks', i.visible_marks], ['Contents', i.contents],
                  ['Found at', `${i.found_location}${i.found_location_detail ? `, ${i.found_location_detail}` : ''}`],
                  ['Found on', fmtDateTime(i.found_at)], ['Storage', i.storage_location], ['Published', fmtDateTime(i.published_at)],
                ]} />
              </Section>

              <Section title={`Matched lost reports (${i.matches.length})`}>
                {i.matches.length === 0 ? <p className="text-sm text-stone-500">No stored matches.</p> : (
                  <ul className="divide-y divide-cream-dark -my-2">
                    {i.matches.map((m) => (
                      <li key={m.report_id} className={`py-2 flex items-center gap-3 text-sm ${m.above_threshold ? '' : 'opacity-60'}`}>
                        <Link className="font-semibold text-forest-700 hover:underline w-24" to={`/admin/lost-reports/${m.report_id}`}>{m.report_ref}</Link>
                        <span className="flex-1 truncate">{m.student_name}</span>
                        {m.visible_to_student && <span className="text-xs text-emerald-700">visible #{m.rank}</span>}
                        {m.dismissed && <span className="text-xs text-stone-500">dismissed</span>}
                        <ScoreBar score={m.score} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={`Claims (${i.claims.length})`}>
                {i.claims.length === 0 ? <p className="text-sm text-stone-500">No claims yet.</p> : (
                  <ul className="divide-y divide-cream-dark -my-2">
                    {i.claims.map((c) => (
                      <li key={c.claim_id} className="py-2 flex items-center gap-3 text-sm">
                        <Link className="font-semibold text-forest-700 hover:underline" to={`/admin/claims/${c.claim_id}`}>{c.reference_code}</Link>
                        <span className="flex-1">{c.student_name}</span><StatusChip status={c.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            <div className="space-y-6">
              <Section title="Private details"><PrivateForm item={i} onSaved={q.reload} /></Section>
              <Section title="Verification questions">
                {i.questions.length === 0 ? <p className="text-sm text-stone-500">No questions.</p> : (
                  <ul className="space-y-2 text-sm">
                    {i.questions.map((qq) => (
                      <li key={qq.question_id} className="flex gap-2 justify-between">
                        <div><div>{qq.question_text}</div><div className="text-stone-500">Expected: {qq.expected_answer}</div></div>
                        {editable && <button className="text-stone-400 hover:text-red-600" title="Delete question"
                          onClick={() => doAct(() => api.delete(`/admin/questions/${qq.question_id}`), 'Question removed.')}><Trash2 size={16} /></button>}
                      </li>
                    ))}
                  </ul>
                )}
                {editable && i.questions.length < 5 && <AddQuestion itemId={i.item_id} onSaved={q.reload} />}
              </Section>
              <Section title="Finder statements" actions={editable && <button className="btn-outline btn-sm" onClick={() => setModal('finder')}><Plus size={14} />Add</button>}>
                {i.finderStatements.map((f) => (
                  <div key={f.statement_id} className="text-sm border-b border-cream-dark last:border-0 pb-3 mb-3 last:mb-0">
                    <div className="font-semibold">{f.finder_name} {f.finder_roll_no && <span className="text-stone-500 font-normal">({f.finder_roll_no})</span>}</div>
                    {f.finder_contact && <div className="text-stone-500">{f.finder_contact}</div>}
                    <div>Found: {f.found_where}{f.found_when ? `, ${fmtDateTime(f.found_when)}` : ''}</div>
                    {f.circumstances && <div className="text-stone-600">{f.circumstances}</div>}
                  </div>
                ))}
              </Section>
              <Section title="Status history"><Timeline history={i.history} /></Section>
            </div>
          </div>

          {modal === 'edit' && <EditItem item={i} onClose={() => setModal(null)} onSaved={() => { setFlash('Item updated.'); q.reload(); }} />}
          {modal === 'finder' && <AddFinder itemId={i.item_id} onClose={() => setModal(null)} onSaved={q.reload} />}
          <ReasonModal open={modal === 'archive'} title="Archive item" label="Reason" minLength={0} confirmLabel="Archive"
            onClose={() => setModal(null)}
            onSubmit={async (reason) => { await api.post(`/admin/found-items/${id}/archive`, clean({ reason })); setFlash('Item archived.'); q.reload(); return true; }} />
        </>
      );
    }}</Loader>
  );
}
