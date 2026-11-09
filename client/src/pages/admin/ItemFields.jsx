import { Field, toLocalInput } from '../../components/ui';

export const emptyItem = () => ({
  categoryId: '', brand: '', model: '', colourId: '', sizeDesc: '', contents: '', visibleMarks: '',
  publicDescription: '', foundLocationId: '', foundLocationDetail: '', foundAt: toLocalInput(), storageLocation: '',
});

export const itemFromRow = (i) => ({
  categoryId: i.category_id, brand: i.brand || '', model: i.model || '', colourId: i.colour_id, sizeDesc: i.size_desc || '',
  contents: i.contents || '', visibleMarks: i.visible_marks || '', publicDescription: i.public_description,
  foundLocationId: i.found_location_id, foundLocationDetail: i.found_location_detail || '',
  foundAt: toLocalInput(i.found_at), storageLocation: i.storage_location,
});

export const itemPayload = (f) => ({
  ...f,
  categoryId: Number(f.categoryId), colourId: Number(f.colourId), foundLocationId: Number(f.foundLocationId),
  foundAt: new Date(f.foundAt).toISOString(),
});

export default function ItemFields({ value, onChange, lookups: L }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label="Category" required>
        <select className="input" value={value.categoryId} onChange={set('categoryId')} required>
          <option value="">Select</option>
          {[...new Set(L.categories.map((c) => c.group))].map((g) => (
            <optgroup key={g} label={g}>{L.categories.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
          ))}
        </select>
      </Field>
      <Field label="Colour" required>
        <select className="input" value={value.colourId} onChange={set('colourId')} required>
          <option value="">Select</option>
          {L.colours.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Brand"><input className="input" value={value.brand} onChange={set('brand')} maxLength={60} /></Field>
      <Field label="Model"><input className="input" value={value.model} onChange={set('model')} maxLength={80} /></Field>
      <div className="sm:col-span-2">
        <Field label="Public description" required hint="Shown to matched students. Keep identifying details (serials, stickers, contents) out of it.">
          <textarea className="input min-h-20" value={value.publicDescription} onChange={set('publicDescription')} minLength={10} maxLength={500} required />
        </Field>
      </div>
      <Field label="Size"><input className="input" value={value.sizeDesc} onChange={set('sizeDesc')} maxLength={60} /></Field>
      <Field label="Visible marks" hint="Used for matching; never shown to students."><input className="input" value={value.visibleMarks} onChange={set('visibleMarks')} maxLength={500} /></Field>
      <div className="sm:col-span-2"><Field label="Contents" hint="Admin-only; used for matching."><input className="input" value={value.contents} onChange={set('contents')} maxLength={500} /></Field></div>
      <Field label="Found location" required>
        <select className="input" value={value.foundLocationId} onChange={set('foundLocationId')} required>
          <option value="">Select</option>
          {L.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="Location detail"><input className="input" value={value.foundLocationDetail} onChange={set('foundLocationDetail')} maxLength={120} /></Field>
      <Field label="Found date and time" required><input type="datetime-local" className="input" value={value.foundAt} onChange={set('foundAt')} max={toLocalInput()} required /></Field>
      <Field label="Storage location" required hint="Where the item is kept at the desk, e.g. Shelf B3"><input className="input" value={value.storageLocation} onChange={set('storageLocation')} maxLength={80} required /></Field>
    </div>
  );
}
