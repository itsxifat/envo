import { useState } from 'react';
import { LockKeyhole, Mail, PhoneCall, PhoneIncoming, Server, ShieldCheck } from 'lucide-react';
import { useAuth } from '../state/auth';
import { errorMessage } from '../lib/api';
import { Button, Field, Input } from '../components/ui';
import { LogoMark } from '../components/Layout';

/** Decorative product glimpse for the brand panel: an answered call and a live channel meter. */
function CallGlimpse() {
  return (
    <div className="relative mt-12 max-w-sm" aria-hidden>
      <div className="absolute -inset-6 rounded-[2rem] bg-white/[0.03] blur-xl" />
      <div className="relative rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
            <PhoneIncoming className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white">Incoming · Hotline</div>
            <div className="text-xs text-slate-300">Answered on ext 1001 · 00:35</div>
          </div>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Live</span>
        </div>
        <div className="mt-4 flex h-8 items-end justify-between">
          {[40, 65, 50, 85, 60, 95, 70, 55, 80, 45, 75, 90, 62, 50, 70, 58, 82, 48, 66, 88].map((h, i) => (
            <span key={i} className="eq-bar w-1 rounded-full bg-gradient-to-t from-brand-400/70 to-brand-200" style={{ height: `${h}%`, animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>
      </div>
      <div className="relative mt-3 ml-10 flex items-center justify-between rounded-2xl bg-white/[0.05] px-4 py-3 ring-1 ring-white/10 backdrop-blur-md">
        <div className="text-xs text-slate-300">Channels in use</div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-2/3 rounded-full bg-brand-300" />
          </div>
          <span className="text-xs font-medium text-white tabular-nums">2 / 3</span>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid min-h-full bg-white lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink-950 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(60rem_40rem_at_-10%_-10%,rgb(31_87_235/0.55),transparent_60%),radial-gradient(40rem_30rem_at_110%_110%,rgb(97_143_250/0.25),transparent_60%)]" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)', backgroundSize: '44px 44px', maskImage: 'radial-gradient(ellipse at 30% 30%, black, transparent 70%)' }}
        />
        <div className="relative flex h-full flex-col justify-between p-12 text-white xl:p-16">
          <div className="flex items-center gap-3">
            <LogoMark className="ring-1 ring-white/20" />
            <span className="text-lg font-semibold tracking-tight">Envo</span>
          </div>
          <div className="max-w-lg">
            <h1 className="text-[40px] leading-[1.1] font-semibold tracking-tight">Your business phone system, run from one dashboard.</h1>
            <p className="mt-5 text-[15px] leading-relaxed text-slate-300">
              Connect your IP numbers, design call flows and IVRs, and make or take calls right in the browser or from your phone.
            </p>
            <div className="mt-8 grid gap-3 text-sm text-slate-200">
              {[
                [Server, 'Cloud PBX on Asterisk 22, ready in minutes'],
                [PhoneCall, 'Web phone built in, no app to install'],
                [ShieldCheck, 'Call recording, channel limits and live call control'],
              ].map(([Icon, text]) => {
                const I = Icon as typeof Server;
                return (
                  <div key={text as string} className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-white/[0.08] ring-1 ring-white/10">
                      <I className="size-4 text-brand-200" />
                    </div>
                    {text as string}
                  </div>
                );
              })}
            </div>
            <CallGlimpse />
          </div>
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} Enfinito · Envo Cloud PBX</p>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12 sm:px-10">
        <form
          className="w-full max-w-[380px]"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await login(email, password);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <LogoMark />
            <span className="text-lg font-semibold tracking-tight text-slate-900">Envo</span>
          </div>
          <h2 className="text-[28px] leading-tight font-semibold tracking-tight text-slate-900">Welcome back</h2>
          <p className="mt-2 text-[15px] text-slate-500">Sign in to manage your phone system.</p>
          <div className="mt-8 space-y-5">
            <Field label="Email">
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 pl-10 sm:h-11" autoComplete="username" autoFocus required placeholder="you@company.com" />
              </div>
            </Field>
            <Field label="Password">
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 pl-10 sm:h-11" autoComplete="current-password" required placeholder="••••••••" />
              </div>
            </Field>
            {error && <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 ring-1 ring-rose-600/10">{error}</p>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              Sign in
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
