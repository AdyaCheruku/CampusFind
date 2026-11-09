import { Link } from 'react-router-dom';
import { FileSearch, Sparkles, ShieldCheck, PackageCheck, FilePlus2 } from 'lucide-react';
import { api } from '../../api';
import { Empty, Loader, PageHeader, Section, StatCard, StatusChip, fmtDate, fmtDateTime, useApi } from '../../components/ui';

export default function StudentDashboard() {
  const q = useApi(async () => (await api.get('/me/dashboard')).data, []);
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Track your lost-item reports, matches and claims."
        actions={<Link to="/student/report" className="btn-gold"><FilePlus2 size={18} />Report a lost item</Link>} />
      <Loader q={q}>{(d) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={FileSearch} label="Active reports" value={d.stats.active_reports} to="/student/reports" />
            <StatCard icon={Sparkles} label="Potential matches" value={d.stats.candidates} tone="gold" to="/student/reports" />
            <StatCard icon={ShieldCheck} label="Open claims" value={d.stats.open_claims} tone="stone" to="/student/claims" />
            <StatCard icon={PackageCheck} label="Items returned" value={d.stats.returned} tone="forest" to="/student/claims" />
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <Section title="Recent reports" actions={<Link className="btn-ghost btn-sm" to="/student/reports">View all</Link>}>
              {d.recentReports.length === 0 ? <Empty title="No reports yet">Lost something? File a report and we&apos;ll look for matches.</Empty> : (
                <ul className="divide-y divide-cream-dark -my-3">
                  {d.recentReports.map((r) => (
                    <li key={r.report_id}>
                      <Link to={`/student/reports/${r.report_id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-cream -mx-2 px-2 rounded-lg">
                        <div>
                          <div className="font-semibold text-sm">{r.reference_code} · {r.category}</div>
                          <div className="text-xs text-stone-500">Filed {fmtDate(r.created_at)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {r.status === 'ACTIVE' && r.candidate_count > 0 && <span className="text-xs font-semibold text-amber-700">{r.candidate_count} match{r.candidate_count > 1 ? 'es' : ''}</span>}
                          <StatusChip status={r.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Recent claims" actions={<Link className="btn-ghost btn-sm" to="/student/claims">View all</Link>}>
              {d.recentClaims.length === 0 ? <Empty title="No claims yet">When you recognise your item among your matches, choose &quot;This is mine&quot; to start a claim.</Empty> : (
                <ul className="divide-y divide-cream-dark -my-3">
                  {d.recentClaims.map((c) => (
                    <li key={c.claim_id}>
                      <Link to={`/student/claims/${c.claim_id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-cream -mx-2 px-2 rounded-lg">
                        <div>
                          <div className="font-semibold text-sm">{c.reference_code} · {c.category}</div>
                          <div className="text-xs text-stone-500">{c.status === 'APPROVED' ? `Collect by ${fmtDateTime(c.pickup_deadline)}` : `Submitted ${fmtDate(c.created_at)}`}</div>
                        </div>
                        <StatusChip status={c.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          <Section title="Latest notifications" actions={<Link className="btn-ghost btn-sm" to="/student/notifications">View all</Link>}>
            {d.notifications.length === 0 ? <p className="text-sm text-stone-500">Nothing new.</p> : (
              <ul className="space-y-3">
                {d.notifications.map((n) => (
                  <li key={n.notif_id} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.is_read ? 'bg-stone-300' : 'bg-gold'}`} />
                    <div><div className="text-sm font-semibold">{n.title}</div><div className="text-sm text-stone-600">{n.message}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}</Loader>
    </>
  );
}
