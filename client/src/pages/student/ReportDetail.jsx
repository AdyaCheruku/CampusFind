import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Lock, SearchX, Eye, X } from 'lucide-react';
import { api } from '../../api';
import {
  DL, Empty, ErrorBox, Loader, PageHeader, Photo, ReasonModal, Section, StatusChip, SuccessBox, Timeline,
  fmtDate, fmtDateTime, useAction, useApi,
} from '../../components/ui';

function Candidates({ reportId, onChange }) {
  const q = useApi(async () => (await api.get(`/lost-reports/${reportId}/candidates`)).data, [reportId]);
  const act = useAction();
  const [confirmNone, setConfirmNone] = useState(false);

  const dismiss = (itemId) => act.run(async () => { await api.post(`/lost-reports/${reportId}/candidates/${itemId}/dismiss`); q.reload(); onChange(); });
  const none = () => act.run(async () => { await api.post(`/lost-reports/${reportId}/none-of-these`); setConfirmNone(false); q.reload(); onChange(); });

  return (
    <Loader q={q}>{({ report, candidates }) => {
      if (report.status !== 'ACTIVE') return null;
      return (
        <Section title="Potential matches" actions={candidates.length > 0 && (
          confirmNone
            ? <><span className="text-sm text-stone-600 self-center">Hide all?</span><button className="btn-danger btn-sm" disabled={act.busy} onClick={none}>Yes, none are mine</button><button className="btn-outline btn-sm" onClick={() => setConfirmNone(false)}>Cancel</button></>
            : <button className="btn-outline btn-sm" onClick={() => setConfirmNone(true)}>None of these</button>
        )}>
          <ErrorBox error={act.error} />
          {candidates.length === 0 ? (
            <Empty icon={SearchX} title="No matches yet">
              Your report is still active. We&apos;ll show potential matches when a newly received item matches your report.
            </Empty>
          ) : (
            <>
              <p className="text-sm text-stone-500 mb-4">Photos are blurred for privacy. Choose &quot;This is mine&quot; only if you are confident. You will answer verification questions, and the admin desk reviews every claim.</p>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {candidates.map((c) => (
                  <div key={c.item_id} className="rounded-2xl border border-cream-dark overflow-hidden bg-cream/40 flex flex-col">
                    <Photo src={c.photo_ids[0] ? `/api/photos/${c.photo_ids[0]}` : null} className="h-44 w-full" />
                    <div className="p-4 flex-1 flex flex-col">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{c.colour} {c.category}</span>
                        <span className="text-xs font-bold rounded-full bg-mint text-forest-800 px-2 py-0.5">#{c.rank}</span>
                      </div>
                      <p className="text-sm text-stone-600 mt-1 line-clamp-3">{c.public_description}</p>
                      <div className="text-xs text-stone-500 mt-2">Found at {c.found_location} · {fmtDate(c.found_date)}</div>
                      {c.under_review && <div className="text-xs text-amber-700 mt-1 font-medium">Another claim is under review. You can still claim; you&apos;ll be queued.</div>}
                      <div className="mt-auto pt-4 flex gap-2">
                        {c.already_claimed
                          ? <Link className="btn-outline btn-sm flex-1" to="/student/claims">Already claimed</Link>
                          : <Link to={`/student/reports/${reportId}/candidates/${c.item_id}`} className="btn-primary btn-sm flex-1"><Eye size={14} />Review &amp; claim</Link>}
                        {!c.already_claimed && <button className="btn-ghost btn-sm" disabled={act.busy} onClick={() => dismiss(c.item_id)} title="Not mine"><X size={14} />Dismiss</button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      );
    }}</Loader>
  );
}

export default function ReportDetail() {
  const { id } = useParams();
  const loc = useLocation();
  const q = useApi(async () => (await api.get(`/lost-reports/${id}`)).data.report, [id]);
  const [withdraw, setWithdraw] = useState(false);

  return (
    <Loader q={q}>{(r) => (
      <>
        <PageHeader back={{ to: '/student/reports', label: 'My Reports' }} title={`${r.reference_code} · ${r.category}`}
          subtitle={`Filed ${fmtDateTime(r.created_at)}`}
          actions={<>
            <StatusChip status={r.status} className="self-center text-sm" />
            {r.status === 'ACTIVE' && !r.open_claim_id && <button className="btn-outline" onClick={() => setWithdraw(true)}>Withdraw report</button>}
          </>} />
        {loc.state?.justFiled && <div className="mb-4"><SuccessBox>Your report has been submitted and locked. We checked it against every item at the desk.</SuccessBox></div>}
        {r.open_claim_id && (
          <div className="mb-4 card p-4 flex flex-wrap items-center justify-between gap-3 border-forest-600/40">
            <div className="text-sm">You have a claim in progress: <b>{r.open_claim_ref}</b> <StatusChip status={r.open_claim_status} /></div>
            <Link to={`/student/claims/${r.open_claim_id}`} className="btn-primary btn-sm">View claim</Link>
          </div>
        )}
        <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
          <div className="space-y-6">
            {r.status === 'ACTIVE' && <Candidates reportId={id} onChange={q.reload} />}
            {r.status !== 'ACTIVE' && !r.open_claim_id && (
              <Section title="Report status">
                <p className="text-sm text-stone-600">
                  {r.status === 'RESOLVED' && 'This item has been returned to you. The report is resolved.'}
                  {r.status === 'WITHDRAWN' && `You withdrew this report. Reason: ${r.withdrawn_reason || '—'}`}
                  {r.status === 'CLOSED' && `The admin desk closed this report. Reason: ${r.closed_reason || '—'}`}
                  {r.status === 'MATCHED' && 'A claim is being processed for this report.'}
                </p>
              </Section>
            )}
            <Section title="Status history"><Timeline history={r.history} /></Section>
          </div>
          <Section title={<span className="flex items-center gap-2"><Lock size={16} className="text-gold" />Locked description</span>}>
            <DL rows={[
              ['Category', r.category], ['Brand', r.brand], ['Model', r.model], ['Colour', r.colour],
              ['Description', <span className="whitespace-pre-wrap">{r.description}</span>],
              ['Features', r.features], ['Serial hint', r.serial_hint],
              ['Lost at', r.lost_location], ['Detail', r.lost_location_detail], ['When', fmtDateTime(r.lost_at)],
              ['Proof photo', r.has_proof_photo ? 'Attached' : 'None'], ['Locked', fmtDateTime(r.locked_at)],
            ]} />
          </Section>
        </div>
        <ReasonModal open={withdraw} title="Withdraw report" label="Why are you withdrawing this report?" confirmLabel="Withdraw" danger
          onClose={() => setWithdraw(false)}
          onSubmit={async (reason) => { await api.post(`/lost-reports/${id}/withdraw`, { reason }); q.reload(); return true; }}>
          <p className="text-sm text-stone-600">Withdrawn reports stop matching. This can&apos;t be undone. You&apos;d need to file a new report.</p>
        </ReasonModal>
      </>
    )}</Loader>
  );
}
