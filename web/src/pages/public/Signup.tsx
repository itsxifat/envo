import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { formatBdt } from '../../lib/format';
import type { Package } from '../../lib/types';
import { Button, Field, Input, LoadingBlock, Notice, Select } from '../../components/ui';
import { AuthCard, PublicLayout } from './PublicLayout';

export function SignupPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const packages = useQuery({ queryKey: ['public', 'packages'], queryFn: () => api.get<Package[]>('/api/public/packages') });
  const status = useQuery({ queryKey: ['public', 'setup-status'], queryFn: () => api.get<{ needsSetup: boolean }>('/api/public/setup-status') });
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', password: '', package: params.get('package') ?? '', website: '' });
  const [show, setShow] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const buyable = (packages.data ?? []).filter((p) => p.price_monthly !== null);
  const signup = useMutation({
    mutationFn: () => api.post('/api/public/signup', { ...form, package: form.package || undefined }),
    onSuccess: () => navigate(`/check-email?email=${encodeURIComponent(form.email)}`),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <PublicLayout>
      <AuthCard
        title="Create your account"
        description="Your phone system is ready a few minutes after you pay."
        footer={
          <>
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-brand-700 hover:text-brand-800">
              Sign in
            </Link>
          </>
        }
      >
        {status.data?.needsSetup ? (
          <Notice tone="info" title="Sign-ups open soon">
            We are getting Envo ready. Please check back shortly.
          </Notice>
        ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            signup.mutate();
          }}
        >
          <Field label="Company name">
            <Input value={form.company} onChange={(e) => set('company', e.target.value)} autoComplete="organization" required autoFocus placeholder="Acme Ltd" />
          </Field>
          <Field label="Your name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" required />
          </Field>
          <Field label="Work email" hint="We send a link to confirm it">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" required placeholder="you@company.com" />
          </Field>
          <Field label="Mobile number">
            <Input type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" placeholder="01XXXXXXXXX" />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <div className="relative">
              <Input type={show ? 'text' : 'password'} value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" minLength={8} required className="pr-11" />
              <button type="button" onClick={() => setShow(!show)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Field label="Package" hint="You choose for sure after confirming your email">
            <Select value={form.package} onChange={(e) => set('package', e.target.value)}>
              <option value="">Decide later</option>
              {buyable.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name} · {formatBdt(p.price_monthly)}/month
                </option>
              ))}
            </Select>
          </Field>
          {/* Honeypot: hidden from people, filled in by bots. */}
          <input type="text" name="website" value={form.website} onChange={(e) => set('website', e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={signup.isPending}>
            Create account
          </Button>
        </form>
        )}
      </AuthCard>
    </PublicLayout>
  );
}

export function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [sent, setSent] = useState(false);
  const resend = useMutation({
    mutationFn: () => api.post('/api/public/resend-verification', { email }),
    onSuccess: () => setSent(true),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <PublicLayout>
      <AuthCard
        title="Check your inbox"
        description={
          <>
            We sent a confirmation link to <strong className="text-slate-800">{email || 'your email'}</strong>. Open it to finish creating your account.
          </>
        }
        footer={
          <Link to="/login" className="font-medium text-brand-700 hover:text-brand-800">
            Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-brand-50 text-brand-600">
            <MailCheck className="size-8" />
          </div>
          <p className="mt-5 text-sm text-slate-500">No email after a few minutes? Check the spam folder, or send it again.</p>
          {sent ? (
            <Notice tone="success" className="mt-4 w-full">
              Sent again. The newest link is the one that works.
            </Notice>
          ) : (
            <Button className="mt-4" loading={resend.isPending} disabled={!email} onClick={() => resend.mutate()}>
              Send the link again
            </Button>
          )}
        </div>
      </AuthCard>
    </PublicLayout>
  );
}

/** Opened from the welcome email: confirms, signs in, continues to choosing a package. */
export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const token = params.get('token') ?? '';
  const [error, setError] = useState('');
  // The link works once: send it once, even when React runs this effect twice (development).
  const request = useRef<Promise<{ ok: boolean; package_id: number | null }> | null>(null);
  useEffect(() => {
    let active = true;
    request.current ??= api.post<{ ok: boolean; package_id: number | null }>('/api/public/verify', { token });
    request.current
      .then(async (r) => {
        if (!active) return;
        await refresh();
        navigate(r.package_id ? `/billing?choose=${r.package_id}` : '/billing', { replace: true });
      })
      .catch((err) => active && setError(errorMessage(err)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return (
    <PublicLayout>
      <AuthCard title={error ? 'This link does not work' : 'Confirming your email…'}>
        {error ? (
          <div className="space-y-4">
            <Notice tone="danger">{error}</Notice>
            <Link to="/login">
              <Button className="w-full">Sign in</Button>
            </Link>
          </div>
        ) : (
          <LoadingBlock />
        )}
      </AuthCard>
    </PublicLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => api.post('/api/public/forgot-password', { email }),
    onSuccess: () => setSent(true),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <PublicLayout>
      <AuthCard
        title="Reset your password"
        description="Enter your email and we send you a link to choose a new password."
        footer={
          <Link to="/login" className="font-medium text-brand-700 hover:text-brand-800">
            Back to sign in
          </Link>
        }
      >
        {sent ? (
          <Notice tone="success" title="Check your inbox">
            If an account exists for {email}, a reset link is on its way. It works for one hour.
          </Notice>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate();
            }}
          >
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={send.isPending}>
              Send reset link
            </Button>
          </form>
        )}
      </AuthCard>
    </PublicLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api.post('/api/public/reset-password', { token: params.get('token') ?? '', password }),
    onSuccess: async () => {
      await refresh();
      toast.success('Password changed');
      navigate('/', { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <PublicLayout>
      <AuthCard title="Choose a new password">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={reset.isPending}>
            Save and sign in
          </Button>
        </form>
      </AuthCard>
    </PublicLayout>
  );
}

/** First run only: create the platform admin with the one-time link from the server. */
export function SetupPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const token = params.get('token') ?? '';
  const status = useQuery({ queryKey: ['public', 'setup-status'], queryFn: () => api.get<{ needsSetup: boolean }>('/api/public/setup-status') });
  const [form, setForm] = useState({ company: 'Enfinito', name: '', email: '', password: '' });
  const setup = useMutation({
    mutationFn: () => api.post('/api/public/setup', { ...form, token }),
    onSuccess: async () => {
      await refresh();
      toast.success('Welcome! You are the platform administrator.');
      navigate('/', { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (status.isLoading) return <LoadingBlock />;
  if (!status.data?.needsSetup) {
    return (
      <PublicLayout>
        <AuthCard title="Envo is already set up">
          <Link to="/login">
            <Button variant="primary" className="w-full" size="lg">
              Sign in
            </Button>
          </Link>
        </AuthCard>
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      <AuthCard title="Set up Envo" description="Create the platform administrator. This page works once, with the link from the server.">
        {!token ? (
          <Notice tone="warn">Open the one-time setup link from the server log to continue.</Notice>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setup.mutate();
            }}
          >
            <Field label="Your company" hint="Your own SIP servers live in this account, never billed or limited">
              <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} required />
            </Field>
            <Field label="Your name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required autoFocus />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required />
            </Field>
            <Field label="Password" hint="At least 12 characters; this account controls everything">
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" minLength={12} required />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={setup.isPending}>
              Create administrator
            </Button>
          </form>
        )}
      </AuthCard>
    </PublicLayout>
  );
}
