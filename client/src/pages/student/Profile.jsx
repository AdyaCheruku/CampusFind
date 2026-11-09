import { useState } from 'react';
import { api, errMsg } from '../../api';
import { useAuth } from '../../auth';
import { DL, ErrorBox, Field, PageHeader, Section, SuccessBox, fmtDate } from '../../components/ui';

export default function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.fullName);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null); setMsg(null);
    try {
      const { data } = await api.patch('/auth/me', { fullName: name });
      setUser(data.user); setMsg('Your name has been updated.');
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Profile" />
      <div className="grid md:grid-cols-2 gap-6 items-start">
        <Section title="Account">
          <DL rows={[['Name', user.fullName], ['Email', user.email], ['Roll number', user.rollNo], ['Role', 'Student'], ['Member since', fmtDate(user.memberSince)]]} />
        </Section>
        <Section title="Update your name">
          <form onSubmit={save} className="space-y-4">
            <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required /></Field>
            <ErrorBox error={error} /><SuccessBox>{msg}</SuccessBox>
            <button className="btn-primary" disabled={busy || name.trim() === user.fullName}>Save</button>
            <p className="text-xs text-stone-500">Email and roll number can only be changed by the admin desk.</p>
          </form>
        </Section>
      </div>
    </>
  );
}
