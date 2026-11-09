import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../api';
import { Empty, Loader, PageHeader, Photo, StatusChip, fmtDate, fmtDateTime, useApi } from '../../components/ui';

export default function MyClaims() {
  const q = useApi(async () => (await api.get('/claims/mine')).data.claims, []);
  return (
    <>
      <PageHeader title="My Claims" subtitle="Ownership claims you've submitted and their progress." />
      <Loader q={q}>{(claims) => claims.length === 0
        ? <div className="card"><Empty icon={ShieldCheck} title="No claims yet">Open a report with potential matches and choose &quot;This is mine&quot; to start a claim.</Empty></div>
        : (
          <div className="space-y-3">
            {claims.map((c) => (
              <Link key={c.claim_id} to={`/student/claims/${c.claim_id}`} className="card p-4 flex gap-4 items-center hover:shadow-md transition">
                <Photo src={c.primary_photo_id ? `/api/photos/${c.primary_photo_id}` : null} className="h-16 w-16 rounded-xl shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.reference_code}</span><StatusChip status={c.status} />
                    {c.appeal_of_claim_id && <span className="text-xs rounded-full bg-sky-50 text-sky-700 px-2 py-0.5">Appeal</span>}
                  </div>
                  <div className="text-sm text-stone-600 truncate">{c.colour} {c.category}: {c.public_description}</div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    {c.status === 'APPROVED' ? `Collect by ${fmtDateTime(c.pickup_deadline)}`
                      : c.status === 'QUEUED' ? `Queue position ${c.queue_position}`
                        : c.status === 'COMPLETED' ? `Collected ${fmtDate(c.handed_at)}` : `Submitted ${fmtDate(c.created_at)} · report ${c.report_ref}`}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Loader>
    </>
  );
}
