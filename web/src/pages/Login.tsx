import { useState } from 'react';
import { AudioLines, LockKeyhole, Mail, PhoneCall, Server, ShieldCheck } from 'lucide-react';
import { useAuth } from '../state/auth';
import { errorMessage } from '../lib/api';
import { Button, Field, Input } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink-950 lg:block">
        <div className="absolute -top-40 -left-40 size-[520px] rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -right-32 bottom-0 size-[420px] rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-cyan-600">
              <AudioLines className="size-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Envo</span>
          </div>
          <div className="max-w-md">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight">Your phone system, controlled from one dashboard.</h1>
            <p className="mt-4 text-slate-300">
              Create SIP servers, connect trunks and IP phone numbers, design IVRs and call flows, and make or take calls right in your browser.
            </p>
            <div className="mt-10 space-y-4 text-sm text-slate-300">
              {[
                [Server, 'Multi-tenant SIP servers on Asterisk 22'],
                [PhoneCall, 'Built-in WebRTC softphone'],
                [ShieldCheck, 'Channel limits, recordings and live call control'],
              ].map(([Icon, text]) => {
                const I = Icon as typeof Server;
                return (
                  <div key={text as string} className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-white/[0.07]">
                      <I className="size-4 text-brand-300" />
                    </div>
                    {text as string}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} Envo</p>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <form
          className="w-full max-w-sm"
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
          <div className="mb-8 lg:hidden">
            <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-cyan-600 text-white">
              <AudioLines className="size-5" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Welcome back. Enter your account details.</p>
          <div className="mt-8 space-y-4">
            <Field label="Email">
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" autoComplete="username" autoFocus required />
              </div>
            </Field>
            <Field label="Password">
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" autoComplete="current-password" required />
              </div>
            </Field>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              Sign in
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
