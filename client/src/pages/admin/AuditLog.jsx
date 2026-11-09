import { useState } from 'react';
import { api } from '../../api';
import { Loader, PageHeader, Pager, fmtDateTime, humanize, useApi } from '../../components/ui';

const LIMIT = 50;
const ACTIONS = ['', 'LOGIN', 'ITEM_CREATE', 'ITEM_UPDATE', 'ITEM_PUBLISH', 'ITEM_ARCHIVE', 'ITEM_RESTORE', 'ITEM_DRAFT_DELETE',
  'CLAIM_SUBMIT', 'CLAIM_APPEAL', 'CLAIM_APPROVE', 'CLAIM_REJECT', 'HANDOVER', 'PRIVATE_VIEW', 'PHOTO_VIEW_ORIGINAL',
  'PHOTO_VIEW_BLURRED', 'EVIDENCE_VIEW', 'CANDIDATE_DISMISS', 'CANDIDATES_NONE', 'REPORT_WITHDRAW', 'REPORT_CLOSE',
  'USER_STATUS_CHANGE', 'CONFIG_CHANGE', 'REMATCH_ALL', 'MAINTENANCE'];

export default function AuditLog() {
  const [f, setF] = useState({ action: '', table: '', from: '', to: '', offset: 0 });
  const q = useApi(async () => (await api.get('/admin/audit-log', {
    params: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), limit: LIMIT },
  })).data, [f.action, f.table, f.from, f.to, f.offset]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, offset: 0 });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of sensitive actions. It cannot be edited or deleted, even by admins." />
      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3">
        <select className="input" value={f.action} onChange={set('action')}>{ACTIONS.map((a) => <option key={a} value={a}>{a ? humanize(a) : 'All actions'}</option>)}</select>
        <select className="input" value={f.table} onChange={set('table')}>
          {['', 'users', 'found_items', 'lost_reports', 'ownership_claims', 'item_photos', 'claim_evidence', 'handovers', 'app_config'].map((t) => <option key={t} value={t}>{t || 'All tables'}</option>)}
        </select>
        <input type="date" className="input" value={f.from} onChange={set('from')} />
        <input type="date" className="input" value={f.to} onChange={set('to')} />
      </div>
      <Loader q={q}>{(d) => (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead><tr><th className="th">When</th><th className="th">Action</th><th className="th">Actor</th><th className="th">Target</th><th className="th">Details</th></tr></thead>
            <tbody>{d.entries.map((a) => (
              <tr key={a.log_id}>
                <td className="td whitespace-nowrap">{fmtDateTime(a.at)}</td>
                <td className="td font-semibold">{humanize(a.action)}</td>
                <td className="td">{a.actor_name || 'System'}{a.actor_role && <div className="text-xs text-stone-500">{a.actor_role}</div>}</td>
                <td className="td">{a.target_table ? `${a.target_table} #${a.target_id ?? '—'}` : '—'}</td>
                <td className="td text-xs text-stone-600 font-mono break-all max-w-sm">{a.details ? JSON.stringify(a.details) : ''}</td>
              </tr>
            ))}</tbody>
          </table>
          {d.entries.length === 0 && <p className="p-6 text-sm text-stone-500">No entries.</p>}
          <div className="px-4 pb-4"><Pager total={d.total} limit={LIMIT} offset={f.offset} onChange={(offset) => setF({ ...f, offset })} /></div>
        </div>
      )}</Loader>
    </>
  );
}
