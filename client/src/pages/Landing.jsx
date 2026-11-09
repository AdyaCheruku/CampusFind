import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, BellRing, KeyRound, GraduationCap, Building2, FilePlus2, GitCompareArrows, BadgeCheck, Handshake, Mail, Phone, MapPin, Clock } from 'lucide-react';
import { Logo } from '../components/Shell';
import { useAuth } from '../auth';

const trust = [
  { icon: ShieldCheck, title: 'Verified Ownership', text: 'Every claim is checked by the admin desk against details only the real owner knows.' },
  { icon: BellRing, title: 'Match Notifications', text: 'We notify you as soon as a newly received item matches your report.' },
  { icon: KeyRound, title: 'Secure Handover', text: 'Items are released only at the desk, after an ID check, and every step is logged.' },
];

const steps = [
  { icon: FilePlus2, title: 'Report', text: 'Describe what you lost. Your description is locked once submitted.' },
  { icon: GitCompareArrows, title: 'Match', text: 'CampusFind compares your report with items handed in to the admin desk.' },
  { icon: BadgeCheck, title: 'Verify', text: 'Pick your item from blurred photos and answer verification questions.' },
  { icon: Handshake, title: 'Collect', text: 'Once approved, show your ID at the desk and collect your item.' },
];

const faqs = [
  ['Who can see the items that were found?', 'Nobody browses a public catalogue. You only see blurred photos of items that closely match your own report.'],
  ['Why can\'t I edit my report after submitting it?', 'Locking the original description stops anyone from adjusting their story after seeing found items. It protects real owners.'],
  ['I found something. What do I do?', 'Hand it in at the Admin Desk (Student Services, ground floor). The desk records it. Finders don\'t need an account.'],
  ['My claim was rejected. Can I appeal?', 'Yes. You can appeal a rejected claim once, with an explanation and supporting evidence such as a receipt or an old photo.'],
];

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const home = user ? (user.role === 'admin' ? '/admin' : '/student') : null;

  return (
    <div className="min-h-screen">
      <header className="bg-forest-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          <Logo />
          <nav className="hidden md:flex gap-6 text-sm text-forest-100">
            <a href="#top" className="hover:text-gold-light">Home</a>
            <a href="#contact" className="hover:text-gold-light">Contact</a>
            <a href="#help" className="hover:text-gold-light">Help Centre</a>
            <a href="#pickup" className="hover:text-gold-light">Pickup Guidelines</a>
          </nav>
          {home
            ? <Link to={home} className="btn-gold btn-sm">Go to dashboard</Link>
            : <a href="#login" className="btn-gold btn-sm">Login</a>}
        </div>
      </header>

      <section id="top" className="bg-forest-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-12 pb-20 grid lg:grid-cols-[1.2fr_1fr] gap-12 items-center">
          <div>
            <span className="inline-block rounded-full bg-forest-700 px-3 py-1 text-xs font-semibold text-gold-light">Campus Lost &amp; Found</span>
            <h1 className="mt-5 text-4xl sm:text-5xl font-extrabold leading-tight">
              Lost Something On Campus? <span className="text-gold-light">Let&apos;s Help You Find It.</span>
            </h1>
            <p className="mt-5 text-lg text-forest-100 max-w-xl">
              Report lost items, get matched with found items, and reclaim what&apos;s yours through a verified process.
            </p>
            <div className="mt-8 grid sm:grid-cols-3 gap-4">
              {trust.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl bg-forest-800/70 p-4 border border-forest-700">
                  <Icon className="text-gold-light" size={22} />
                  <div className="mt-2 font-semibold text-sm">{title}</div>
                  <div className="mt-1 text-xs text-forest-100/80">{text}</div>
                </div>
              ))}
            </div>
          </div>

          <div id="login" className="rounded-3xl bg-cream text-forest-950 p-6 sm:p-8 shadow-2xl">
            <h2 className="text-2xl font-bold">Login to CampusFind</h2>
            <p className="text-sm text-stone-500 mt-1">Choose your role to continue</p>
            <div className="mt-6 space-y-3">
              <button onClick={() => navigate('/login?role=student')} className="w-full text-left card p-4 flex gap-4 items-center hover:border-forest-600 hover:shadow-md transition">
                <span className="rounded-xl bg-mint p-3 text-forest-800"><GraduationCap /></span>
                <span><span className="block font-semibold">Student Login</span><span className="block text-sm text-stone-500">Report lost items and track your claims.</span></span>
              </button>
              <button onClick={() => navigate('/login?role=admin')} className="w-full text-left card p-4 flex gap-4 items-center hover:border-forest-600 hover:shadow-md transition">
                <span className="rounded-xl bg-amber-100 p-3 text-amber-800"><Building2 /></span>
                <span><span className="block font-semibold">Admin Login</span><span className="block text-sm text-stone-500">Register found items and verify ownership claims.</span></span>
              </button>
            </div>
            <p className="mt-5 text-sm text-center text-stone-500">New student? <Link to="/register" className="font-semibold text-forest-700 hover:underline">Create an account</Link></p>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-8 py-16">
        <h2 className="text-2xl font-bold text-center">How CampusFind works</h2>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="card p-5">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-mint p-2.5 text-forest-800"><Icon size={20} /></span><span className="text-xs font-bold text-gold">STEP {i + 1}</span></div>
              <div className="mt-3 font-semibold">{title}</div>
              <p className="mt-1 text-sm text-stone-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="help" className="bg-white border-y border-cream-dark">
        <div className="max-w-4xl mx-auto px-4 sm:px-8 py-16">
          <h2 className="text-2xl font-bold">Help Centre</h2>
          <div className="mt-6 space-y-3">
            {faqs.map(([q, a]) => (
              <details key={q} className="card p-4 group">
                <summary className="font-semibold cursor-pointer">{q}</summary>
                <p className="mt-2 text-sm text-stone-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="pickup" className="max-w-4xl mx-auto px-4 sm:px-8 py-16">
        <h2 className="text-2xl font-bold">Pickup Guidelines</h2>
        <ul className="mt-6 grid sm:grid-cols-2 gap-3 text-sm">
          {[
            'Collect your item only after your claim shows Approved.',
            'Bring your college ID card. Items are released only to the verified claimant.',
            'Collect before the pickup deadline shown on your claim, or the approval may lapse.',
            'The desk records every handover, including which ID was checked.',
            'If someone else needs to collect for you, contact the desk first.',
            'Check the item at the desk before you leave.',
          ].map((t) => <li key={t} className="card p-4 flex gap-3"><BadgeCheck className="text-forest-600 shrink-0" size={18} />{t}</li>)}
        </ul>
      </section>

      <footer id="contact" className="bg-forest-900 text-forest-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-12 grid md:grid-cols-3 gap-8 text-sm">
          <div><Logo /><p className="mt-3 text-forest-100/70">Campus lost-and-found with ownership verification.</p></div>
          <div className="space-y-2">
            <div className="font-semibold text-white">Admin Desk</div>
            <div className="flex gap-2"><MapPin size={16} /> Student Services, Ground Floor, Admin Block</div>
            <div className="flex gap-2"><Clock size={16} /> Mon–Sat, 9:00 AM – 5:00 PM</div>
          </div>
          <div className="space-y-2">
            <div className="font-semibold text-white">Contact</div>
            <div className="flex gap-2"><Mail size={16} /> lostandfound@campusfind.edu</div>
            <div className="flex gap-2"><Phone size={16} /> Extension 2140</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
