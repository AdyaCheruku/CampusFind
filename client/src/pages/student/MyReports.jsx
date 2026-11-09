import { Link } from 'react-router-dom';
import { FilePlus2, FileSearch } from 'lucide-react';
import { api } from '../../api';
import { Empty, Loader, PageHeader, StatusChip, fmtDate, fmtDateTime, useApi } from '../../components/ui';

export default function MyReports() {
  const q = useApi(async () => (await api.get('/lost-reports/mine')).data.reports, []);
  return (
    <>
      <PageHeader title="My Reports" subtitle="Your lost-item reports and their potential matches."
        actions={<Link to="/student/report" className="btn-gold"><FilePlus2 size={18} />New report</Link>} />
      <Loader q={q}>{(reports) => reports.length === 0
        ? <div className="card"><Empty icon={FileSearch} title="You haven't reported anything yet" /></div>
        : (
          <div className="grid md:grid-cols-2 gap-4">
            {reports.map((r) => (
              <Link key={r.report_id} to={`/student/reports/${r.report_id}`} className="card p-5 hover:shadow-md transition block">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-stone-500">{r.reference_code}</div>
                    <div className="font-semibold text-lg">{[r.colour, r.brand, r.category].filter(Boolean).join(' · ')}</div>
                  </div>
                  <StatusChip status={r.status} />
                </div>
                <p className="mt-2 text-sm text-stone-600 line-clamp-2">{r.description}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                  <span>Lost {fmtDateTime(r.lost_at)}</span>
                  {r.lost_location && <span>{r.lost_location}</span>}
                  <span>Filed {fmtDate(r.created_at)}</span>
                </div>
                <div className="mt-3 text-sm font-semibold">
                  {r.open_claim_status ? <span className="text-forest-700">Claim {r.open_claim_ref}: <StatusChip status={r.open_claim_status} /></span>
                    : r.status === 'ACTIVE' ? (r.candidate_count > 0 ? <span className="text-amber-700">{r.candidate_count} potential match{r.candidate_count > 1 ? 'es' : ''} to review →</span> : <span className="text-stone-500">No matches yet</span>)
                      : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Loader>
    </>
  );
}
