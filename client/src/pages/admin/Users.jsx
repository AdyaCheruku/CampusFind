import { useState } from 'react';
import { api } from '../../api';
import { ErrorBox, Loader, PageHeader, fmtDate, fmtDateTime, useAction, useApi } from '../../components/ui';

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const q = useApi(async () => (await api.get('/admin/users', { params: { q: search || undefined, limit: 200 } })).data.users, [search]);
  const act = useAction();

  const toggle = (u) => act.run(async () => {
    if (u.is_active && !window.confirm(`Deactivate ${u.full_name}? They will be logged out immediately.`)) return null;
    await api.patch(`/admin/users/${u.user_id}`, { isActive: !u.is_active });
    q.reload(); return true;
  });

  return (
    <>
      <PageHeader title="Students" subtitle="Registered student accounts." />
      <div className="card p-4 mb-4">
        <input className="input sm:max-w-sm" placeholder="Search name, email or roll number…"
          onKeyDown={(e) => { if (e.key === 'Enter') setSearch(e.target.value); }} onBlur={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorBox error={act.error} />
      <Loader q={q}>{(users) => (
        <div className="card overflow-x-auto mt-2">
          <table className="w-full min-w-[760px]">
            <thead><tr><th className="th">Student</th><th className="th">Roll no.</th><th className="th">Reports</th><th className="th">Claims</th><th className="th">Joined</th><th className="th">Last login</th><th className="th">Status</th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.user_id}>
                <td className="td"><div className="font-semibold">{u.full_name}</div><div className="text-xs text-stone-500">{u.email}</div></td>
                <td className="td">{u.roll_no}</td><td className="td">{u.reports}</td><td className="td">{u.claims}</td>
                <td className="td">{fmtDate(u.created_at)}</td><td className="td">{fmtDateTime(u.last_login_at)}</td>
                <td className="td"><button className={u.is_active ? 'btn-outline btn-sm' : 'btn-danger btn-sm'} disabled={act.busy} onClick={() => toggle(u)}>
                  {u.is_active ? 'Active · Deactivate' : 'Inactive · Reactivate'}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}</Loader>
    </>
  );
}
