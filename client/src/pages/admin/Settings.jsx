import { useEffect, useState } from 'react';
import { api } from '../../api';
import { ErrorBox, Loader, PageHeader, Section, SuccessBox, fmtDateTime, useAction, useApi } from '../../components/ui';

const asText = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function SettingsPage() {
  const q = useApi(async () => (await api.get('/admin/config')).data.config, []);
  const act = useAction();
  const [msg, setMsg] = useState(null);
  const [draft, setDraft] = useState({});

  useEffect(() => { if (q.data) setDraft(Object.fromEntries(q.data.map((r) => [r.key, asText(r.value)]))); }, [q.data]);

  const changed = (q.data || []).filter((r) => draft[r.key] !== undefined && draft[r.key] !== asText(r.value));
  const weights = (q.data || []).filter((r) => r.key.startsWith('weight_'));
  const weightSum = weights.reduce((s, r) => s + (Number(draft[r.key]) || 0), 0);

  const save = () => act.run(async () => {
    const values = Object.fromEntries(changed.map((r) => [r.key, typeof r.value === 'number' ? Number(draft[r.key]) : draft[r.key]]));
    await api.patch('/admin/config', { values });
    setMsg(`Saved ${changed.length} setting(s).`); q.reload();
  });

  return (
    <>
      <PageHeader title="Settings" subtitle="Matching weights, thresholds and limits. Changes are saved together in one transaction." />
      <div className="space-y-3 mb-4"><SuccessBox>{msg}</SuccessBox><ErrorBox error={act.error} /></div>
      <Section title="Maintenance" className="mb-6">
        <div className="flex flex-wrap gap-3">
          <button className="btn-outline" disabled={act.busy} onClick={() => act.run(async () => {
            const { data } = await api.post('/admin/maintenance/rematch'); setMsg(`Matching re-run for ${data.reports} active report(s).`);
          })}>Re-run matching for all reports</button>
          <button className="btn-outline" disabled={act.busy} onClick={() => act.run(async () => {
            const { data } = await api.post('/admin/maintenance/archive'); setMsg(`Archive run complete: ${JSON.stringify(data)}`);
          })}>Archive stale items and reports</button>
        </div>
      </Section>
      <Loader q={q}>{(rows) => (
        <div className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-cream-dark">
            {weights.length > 0 && <span className={`text-sm font-semibold ${weightSum === 100 ? 'text-emerald-700' : 'text-red-700'}`}>Match weights total: {weightSum} / 100</span>}
            <div className="flex gap-2">
              <button className="btn-outline btn-sm" disabled={!changed.length} onClick={() => setDraft(Object.fromEntries(rows.map((r) => [r.key, asText(r.value)])))}>Reset</button>
              <button className="btn-primary btn-sm" disabled={!changed.length || act.busy} onClick={save}>Save {changed.length || ''} change{changed.length === 1 ? '' : 's'}</button>
            </div>
          </div>
          <table className="w-full min-w-[640px]">
            <thead><tr><th className="th">Setting</th><th className="th">Value</th><th className="th">Updated</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key} className={draft[r.key] !== asText(r.value) ? 'bg-amber-50' : ''}>
                <td className="td"><div className="font-mono text-xs font-semibold">{r.key}</div><div className="text-xs text-stone-500">{r.description}</div></td>
                <td className="td w-56"><input className="input" type={typeof r.value === 'number' ? 'number' : 'text'} step="any"
                  value={draft[r.key] ?? ''} onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })} /></td>
                <td className="td text-xs text-stone-500">{fmtDateTime(r.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}</Loader>
    </>
  );
}
