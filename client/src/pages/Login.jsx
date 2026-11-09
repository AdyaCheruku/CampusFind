import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, Building2 } from 'lucide-react';
import { useAuth } from '../auth';
import { errMsg } from '../api';
import { Logo } from '../components/Shell';
import { ErrorBox, Field } from '../components/ui';

export default function Login({ register = false }) {
  const [params, setParams] = useSearchParams();
  const role = register ? 'student' : params.get('role') === 'admin' ? 'admin' : 'student';
  const auth = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ fullName: '', email: '', rollNo: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const user = register ? await auth.register(form) : await auth.login(role, form.email, form.password);
      const home = user.role === 'admin' ? '/admin' : '/student';
      const from = loc.state?.from;
      navigate(from && from.startsWith(home) ? from : home, { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-forest-900 flex flex-col">
      <div className="px-4 sm:px-8 h-16 flex items-center"><Logo /></div>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-cream p-6 sm:p-8 shadow-2xl">
          {!register && (
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-cream-dark p-1 mb-6">
              {[['student', 'Student', GraduationCap], ['admin', 'Admin', Building2]].map(([r, label, Icon]) => (
                <button key={r} type="button" onClick={() => { setParams({ role: r }); setError(null); }}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold ${role === r ? 'bg-forest-800 text-white' : 'text-forest-800'}`}>
                  <Icon size={16} />{label}
                </button>
              ))}
            </div>
          )}
          <h1 className="text-2xl font-bold">{register ? 'Create your student account' : role === 'admin' ? 'Admin Login' : 'Student Login'}</h1>
          <p className="text-sm text-stone-500 mt-1">
            {register ? 'Use your college email address.' : role === 'admin' ? 'Register found items and verify ownership claims.' : 'Report lost items and track your claims.'}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {register && (
              <>
                <Field label="Full name" required><input className="input" value={form.fullName} onChange={set('fullName')} required /></Field>
                <Field label="Roll number" required><input className="input" value={form.rollNo} onChange={set('rollNo')} required placeholder="e.g. 22CS101" /></Field>
              </>
            )}
            <Field label="Email" required><input className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} required /></Field>
            <Field label="Password" required hint={register ? 'At least 8 characters, with a letter and a number.' : null}>
              <input className="input" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} required />
            </Field>
            <ErrorBox error={error} />
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Login'}</button>
          </form>

          <div className="mt-5 text-sm text-center text-stone-500 space-y-1">
            {register
              ? <p>Already registered? <Link className="font-semibold text-forest-700 hover:underline" to="/login?role=student">Log in</Link></p>
              : role === 'student' && <p>New student? <Link className="font-semibold text-forest-700 hover:underline" to="/register">Create an account</Link></p>}
            <p><Link to="/" className="hover:underline">← Back to home</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
}
