import { Link } from 'react-router-dom';
import { Boxes, FileSearch, ListChecks, Handshake, PackageCheck, FilePen, PackagePlus, Users } from 'lucide-react';
import { api } from '../../api';
import { Loader, PageHeader, Photo, Section, StatCard, StatusChip, fmtDateTime, humanize, useApi } from '../../components/ui';

export default function AdminDashboard() {
  const q = useApi(async () => (await api.get('/admin/dashboard')).data, []);
  return (
    <>
      <PageHeader title="Admin dashboard" subtitle="Custody, claims and handovers at a glance."
        actions={<Link to="/admin/intake" className="btn-gold"><PackagePlus size={18} />Register found item</Link>} />
      <Loader q={q}>{(d) => {
        const s = d.stats;
        const maxCat = Math.max(1, ...d.byCategory.map((c) => c.items));
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={Boxes} label="Items in custody" value={s.items_in_custody} to="/admin/inventory" />
              <StatCard icon={ListChecks} label="Claims to review" value={s.pending_claims} tone="gold" to="/admin/claims" />
              <StatCard icon={Handshake} label="Awaiting pickup" value={s.awaiting_pickup} tone="stone" to="/admin/handovers" />
              <StatCard icon={PackageCheck} label="Items returned" value={s.returned_items} tone="forest" to="/admin/handovers" />
              <StatCard icon={FileSearch} label="Open lost reports" value={s.open_lost_reports} to="/admin/lost-reports" />
              <StatCard icon={FilePen} label="Draft items" value={s.draft_items} tone="stone" to="/admin/inventory" />
              <StatCard icon={FileSearch} label="Total lost reports" value={s.total_lost_reports} tone="stone" to="/admin/lost-reports" />
              <StatCard icon={Users} label="Registered students" value={s.students} tone="stone" to="/admin/users" />
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              <Section title="Claim queue" actions={<Link className="btn-ghost btn-sm" to="/admin/claims">Open</Link>}>
                {d.claimQueue.length === 0 ? <p className="text-sm text-stone-500">No claims waiting.</p> : (
                  <ul className="divide-y divide-cream-dark -my-2">{d.claimQueue.map((c) => (
                    <li key={c.claim_id}><Link to={`/admin/claims/${c.claim_id}`} className="flex justify-between items-center py-2 hover:bg-cream -mx-2 px-2 rounded-lg">
                      <div className="text-sm"><b>{c.reference_code}</b> · {c.student_name}<div className="text-xs text-stone-500">{c.item_ref} · {c.category} · {fmtDateTime(c.created_at)}</div></div>
                      <StatusChip status={c.status} />
                    </Link></li>
                  ))}</ul>
                )}
              </Section>
              <Section title="Upcoming pickups" actions={<Link className="btn-ghost btn-sm" to="/admin/handovers">Open</Link>}>
                {d.pickups.length === 0 ? <p className="text-sm text-stone-500">No approved claims awaiting pickup.</p> : (
                  <ul className="divide-y divide-cream-dark -my-2">{d.pickups.map((p) => (
                    <li key={p.claim_id} className="flex justify-between items-center py-2 text-sm">
                      <div><b>{p.student_name}</b> · {p.item_ref}<div className="text-xs text-stone-500">{p.storage_location}</div></div>
                      <div className={`text-xs ${p.overdue ? 'text-red-700 font-semibold' : 'text-stone-500'}`}>{p.overdue ? 'Overdue · ' : 'By '}{fmtDateTime(p.pickup_deadline)}</div>
                    </li>
                  ))}</ul>
                )}
              </Section>
              <Section title="Items by category">
                <div className="space-y-2">{d.byCategory.map((c) => (
                  <div key={c.category} className="text-sm">
                    <div className="flex justify-between"><span>{c.category}</span><span className="text-stone-500">{c.in_custody || 0} in custody / {c.items} total</span></div>
                    <div className="h-2 rounded-full bg-stone-100 overflow-hidden flex">
                      <div className="h-full bg-forest-700" style={{ width: `${((c.in_custody || 0) / maxCat) * 100}%` }} />
                      <div className="h-full bg-gold/60" style={{ width: `${((c.items - (c.in_custody || 0)) / maxCat) * 100}%` }} />
                    </div>
                  </div>
                ))}</div>
              </Section>
              <Section title="Recently registered" actions={<Link className="btn-ghost btn-sm" to="/admin/inventory">Inventory</Link>}>
                <ul className="divide-y divide-cream-dark -my-2">{d.recentItems.map((i) => (
                  <li key={i.item_id}><Link to={`/admin/inventory/${i.item_id}`} className="flex gap-3 items-center py-2 hover:bg-cream -mx-2 px-2 rounded-lg">
                    <Photo src={i.primary_photo_id ? `/api/admin/photos/${i.primary_photo_id}/thumb` : null} className="h-10 w-10 rounded-lg shrink-0" />
                    <div className="flex-1 min-w-0 text-sm"><b>{i.reference_code}</b> · {i.category}<div className="text-xs text-stone-500 truncate">{i.found_location}</div></div>
                    <StatusChip status={i.status} />
                  </Link></li>
                ))}</ul>
              </Section>
            </div>
            <Section title="Recent activity" actions={<Link className="btn-ghost btn-sm" to="/admin/audit">Audit log</Link>}>
              <ul className="space-y-2 text-sm">{d.activity.map((a) => (
                <li key={a.log_id} className="flex flex-wrap gap-x-3"><span className="text-stone-400 w-40 shrink-0">{fmtDateTime(a.at)}</span>
                  <span className="font-semibold">{humanize(a.action)}</span><span className="text-stone-600">{a.actor_name || 'System'}{a.target_table ? ` · ${a.target_table} #${a.target_id}` : ''}</span></li>
              ))}</ul>
            </Section>
          </div>
        );
      }}</Loader>
    </>
  );
}
