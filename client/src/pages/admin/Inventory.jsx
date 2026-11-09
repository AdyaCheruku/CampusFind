import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PackagePlus, Boxes } from 'lucide-react';
import { api } from '../../api';
import { Empty, Loader, PageHeader, Pager, Photo, StatusChip, fmtDate, useApi, useLookups } from '../../components/ui';

const STATUSES = ['', 'DRAFT', 'IN_CUSTODY', 'CLAIM_PENDING', 'RETURNED', 'ARCHIVED'];
const LIMIT = 20;

export default function Inventory() {
  const lookups = useLookups();
  const [f, setF] = useState({ status: '', categoryId: '', q: '', offset: 0 });
  const q = useApi(async () => (await api.get('/admin/found-items', {
    params: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), limit: LIMIT },
  })).data, [f.status, f.categoryId, f.q, f.offset]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, offset: 0 });

  return (
    <>
      <PageHeader title="Inventory" subtitle="Every found item held by the desk."
        actions={<Link to="/admin/intake" className="btn-gold"><PackagePlus size={18} />Register found item</Link>} />
      <div className="card p-4 mb-4 grid sm:grid-cols-3 gap-3">
        <input className="input" placeholder="Search reference, description, brand…" defaultValue={f.q}
          onKeyDown={(e) => { if (e.key === 'Enter') setF({ ...f, q: e.target.value, offset: 0 }); }}
          onBlur={(e) => e.target.value !== f.q && setF({ ...f, q: e.target.value, offset: 0 })} />
        <select className="input" value={f.status} onChange={set('status')}>
          {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace('_', ' ') : 'All statuses'}</option>)}
        </select>
        <select className="input" value={f.categoryId} onChange={set('categoryId')}>
          <option value="">All categories</option>
          {lookups.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Loader q={q}>{(d) => d.items.length === 0 ? <div className="card"><Empty icon={Boxes} title="No items match these filters" /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead><tr><th className="th">Item</th><th className="th">Found</th><th className="th">Storage</th><th className="th">Matches</th><th className="th">Status</th></tr></thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.item_id} className="hover:bg-cream">
                  <td className="td">
                    <Link to={`/admin/inventory/${i.item_id}`} className="flex gap-3 items-center">
                      <Photo src={i.primary_photo_id ? `/api/admin/photos/${i.primary_photo_id}/thumb` : null} className="h-12 w-12 rounded-lg shrink-0" />
                      <div><div className="font-semibold text-forest-800 hover:underline">{i.reference_code} · {i.category}</div>
                        <div className="text-xs text-stone-500 line-clamp-1 max-w-xs">{[i.colour, i.brand, i.model].filter(Boolean).join(' ')}: {i.public_description}</div></div>
                    </Link>
                  </td>
                  <td className="td"><div>{i.found_location}</div><div className="text-xs text-stone-500">{fmtDate(i.found_at)}</div></td>
                  <td className="td">{i.storage_location}</td>
                  <td className="td">{i.candidate_count}{i.open_claims > 0 && <div className="text-xs text-amber-700">{i.open_claims} open claim(s)</div>}</td>
                  <td className="td"><StatusChip status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-4"><Pager total={d.total} limit={LIMIT} offset={f.offset} onChange={(offset) => setF({ ...f, offset })} /></div>
        </div>
      )}</Loader>
    </>
  );
}
