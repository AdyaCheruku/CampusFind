import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, X, Search } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { fmtDateTime } from './ui';

export function Logo({ light = true, to = '/' }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-extrabold text-lg">
      <span className="rounded-lg bg-gold p-1.5 text-forest-900"><Search size={18} strokeWidth={2.5} /></span>
      <span className={light ? 'text-white' : 'text-forest-900'}>Campus<span className="text-gold">Find</span></span>
    </Link>
  );
}

function NotificationBell({ base }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unreadCount: 0 });
  const ref = useRef(null);
  const navigate = useNavigate();

  const load = () => api.get('/notifications', { params: { limit: 8 } }).then((r) => setData(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => { clearInterval(t); document.removeEventListener('mousedown', close); };
  }, []);

  const openNotif = async (n) => {
    if (!n.is_read) await api.post(`/notifications/${n.notif_id}/read`).catch(() => {});
    setOpen(false); load();
    if (base === '/student') {
      if (n.claim_id) navigate(`/student/claims/${n.claim_id}`);
      else if (n.report_id) navigate(`/student/reports/${n.report_id}`);
    } else if (n.claim_id) navigate(`/admin/claims/${n.claim_id}`);
    else if (n.report_id) navigate(`/admin/lost-reports/${n.report_id}`);
  };

  return (
    <div className="relative" ref={ref}>
      <button className="relative rounded-xl p-2 hover:bg-mint text-forest-800" onClick={() => { setOpen(!open); if (!open) load(); }} aria-label="Notifications">
        <Bell size={20} />
        {data.unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-gold text-forest-950 text-[10px] font-bold px-1.5">{data.unreadCount}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] card z-40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-cream-dark">
            <span className="font-semibold text-sm">Notifications</span>
            {data.unreadCount > 0 && <button className="text-xs text-forest-700 hover:underline" onClick={async () => { await api.post('/notifications/read-all'); load(); }}>Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.notifications.length === 0 && <p className="p-4 text-sm text-stone-500">No notifications yet.</p>}
            {data.notifications.map((n) => (
              <button key={n.notif_id} onClick={() => openNotif(n)} className={`block w-full text-left px-4 py-3 border-b border-cream-dark hover:bg-cream ${n.is_read ? '' : 'bg-mint/40'}`}>
                <div className="text-sm font-semibold">{n.title}</div>
                <div className="text-xs text-stone-600 line-clamp-2">{n.message}</div>
                <div className="text-[11px] text-stone-400 mt-1">{fmtDateTime(n.created_at)}</div>
              </button>
            ))}
          </div>
          <Link to={`${base}/notifications`} onClick={() => setOpen(false)} className="block text-center text-sm py-2 text-forest-700 hover:bg-cream font-medium">View all</Link>
        </div>
      )}
    </div>
  );
}

export default function Shell({ nav, base, roleLabel }) {
  const { user, logout } = useAuth();
  const [mobile, setMobile] = useState(false);
  const navigate = useNavigate();

  const sidebar = (
    <nav className="flex flex-col gap-1 p-3">
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={() => setMobile(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-gold text-forest-950' : 'text-forest-100 hover:bg-forest-700'}`}>
          <Icon size={18} />{label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex">
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-forest-900 sticky top-0 h-screen">
        <div className="px-5 py-5"><Logo to={base} /></div>
        <div className="px-5 text-[11px] uppercase tracking-wider text-forest-100/60 font-semibold">{roleLabel}</div>
        <div className="flex-1 overflow-y-auto">{sidebar}</div>
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden bg-black/40" onClick={() => setMobile(false)}>
          <aside className="w-64 h-full bg-forest-900" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-5 flex justify-between items-center"><Logo to={base} /><button className="text-white" onClick={() => setMobile(false)}><X /></button></div>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-cream/95 backdrop-blur border-b border-cream-dark">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-8 h-16">
            <button className="lg:hidden text-forest-800" onClick={() => setMobile(true)} aria-label="Menu"><Menu /></button>
            <div className="hidden lg:block text-sm text-stone-500">Welcome back, <span className="font-semibold text-forest-900">{user?.fullName}</span></div>
            <div className="flex items-center gap-2">
              <NotificationBell base={base} />
              <div className="hidden sm:flex items-center gap-2 pl-2">
                <div className="h-9 w-9 rounded-full bg-forest-800 text-gold-light flex items-center justify-center font-bold text-sm">
                  {user?.fullName?.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </div>
                <div className="text-xs leading-tight"><div className="font-semibold">{user?.fullName}</div><div className="text-stone-500">{user?.email}</div></div>
              </div>
              <button className="btn-ghost btn-sm" onClick={async () => { await logout(); navigate('/'); }}><LogOut size={16} /><span className="hidden sm:inline">Log out</span></button>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 sm:px-8 py-6 max-w-7xl w-full mx-auto"><Outlet /></main>
      </div>
    </div>
  );
}
