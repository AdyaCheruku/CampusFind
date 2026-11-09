import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, Loader, PageHeader, fmtDateTime, useApi } from '../components/ui';

export default function Notifications() {
  const { user } = useAuth();
  const base = user?.role === 'admin' ? '/admin' : '/student';
  const q = useApi(async () => (await api.get('/notifications', { params: { limit: 100 } })).data, []);

  const markRead = async (id) => { await api.post(`/notifications/${id}/read`); q.reload(); };
  const linkFor = (n) => n.claim_id ? `${base}/claims/${n.claim_id}` : n.report_id ? `${base}/${base === '/admin' ? 'lost-reports' : 'reports'}/${n.report_id}` : null;

  return (
    <>
      <PageHeader title="Notifications" subtitle="Updates about your reports, matches and claims."
        actions={<button className="btn-outline" onClick={async () => { await api.post('/notifications/read-all'); q.reload(); }}>Mark all as read</button>} />
      <Loader q={q}>{(d) => d.notifications.length === 0
        ? <div className="card"><Empty icon={Bell} title="No notifications yet" /></div>
        : (
          <div className="card divide-y divide-cream-dark">
            {d.notifications.map((n) => (
              <div key={n.notif_id} className={`p-4 flex gap-4 items-start ${n.is_read ? '' : 'bg-mint/40'}`}>
                <div className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${n.is_read ? 'bg-stone-300' : 'bg-gold'}`} />
                <div className="flex-1">
                  <div className="font-semibold">{n.title}</div>
                  <p className="text-sm text-stone-600">{n.message}</p>
                  <div className="text-xs text-stone-400 mt-1">{fmtDateTime(n.created_at)}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {linkFor(n) && <Link className="btn-outline btn-sm" to={linkFor(n)} onClick={() => !n.is_read && api.post(`/notifications/${n.notif_id}/read`)}>Open</Link>}
                  {!n.is_read && <button className="btn-ghost btn-sm" onClick={() => markRead(n.notif_id)}>Mark read</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Loader>
    </>
  );
}
