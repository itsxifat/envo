import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../state/auth';
import type { Package } from '../../lib/types';
import { AuthShell, FormError, FormNote, PasswordInput, SiteField, SiteInput, Spinner, SubmitButton, TextLink } from './auth';

const taka = (p: Package) => (p.price_monthly === null ? 'Custom' : `৳${Number(p.price_monthly).toLocaleString('en-US')}`);
const many = (v: number | null, one: string, more = `${one}s`) => (v === null ? `Unlimited ${more}` : `${v} ${v === 1 ? one : more}`);

/** The SIP server name the first payment creates (same rule as the server's provisioning). */
function serverSlug(company: string): string {
  const base = company.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[^a-z]+/, '').slice(0, 14) || 'office';
  return base.length >= 2 ? base : `${base}pbx`;
}

/** Sign-up's right-hand column: the phone system this form will create, filling in as you type. */
function SystemPreview({ company, name, pkg }: { company: string; name: string; pkg?: Package }) {
  const slug = serverSlug(company);
  const exts = Math.max(1, Math.min(3, pkg?.max_extensions ?? 3));
  const filled = 'text-white';
  const empty = 'text-[#5c6372]';
  return (
    <div className="sticky top-8 rounded-[22px] bg-[#0e1016] p-2 text-white shadow-[0_30px_80px_-30px_rgb(11_13_18/0.55)]" aria-hidden>
      <div className="flex items-center justify-between px-4 pt-3 pb-2.5">
        <span className="font-gmono text-[11px] tracking-[0.08em] text-[#7d8494] uppercase">Your phone system</span>
        <span className="font-gmono text-[11px] text-[#7d8494]">Preview</span>
      </div>
      <div className="space-y-2">
        <div className="rounded-[16px] bg-[#161922] px-5 py-5">
          <div className="font-gmono text-[10.5px] tracking-[0.08em] text-[#6b7282] uppercase">SIP server</div>
          <div className={clsx('font-display mt-1.5 truncate text-[28px] leading-tight tracking-[-0.025em] transition-colors', company ? filled : empty)}>{company || 'Your company'}</div>
          <div className="font-gmono mt-1 text-[12.5px] text-[#7d8494]">{company ? slug : 'name'}</div>
        </div>
        <div className="rounded-[16px] bg-[#161922] px-5 py-4">
          <div className="font-gmono text-[10.5px] tracking-[0.08em] text-[#6b7282] uppercase">Extensions</div>
          <ul className="mt-3 space-y-2.5">
            {Array.from({ length: exts }, (_, i) => {
              const n = 101 + i;
              const you = i === 0;
              return (
                <li key={n} className="flex items-center gap-4 text-[14px]">
                  <span className="font-gmono w-8 text-[#7d8494]">{n}</span>
                  <span className={clsx('min-w-0 flex-1 truncate transition-colors', you && name ? filled : you ? empty : 'text-[#aab0bd]')}>{you ? name || 'You' : `Extension ${n}`}</span>
                  {you ? (
                    <span className="rounded-full bg-[#1d2a4d] px-2 py-0.5 text-[11.5px] text-[#9fb6ff]">your web phone</span>
                  ) : (
                    <span className="font-gmono hidden text-[11.5px] text-[#5c6372] xl:inline">
                      {n}_{company ? slug : 'name'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-[16px] bg-[#161922] px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-gmono text-[10.5px] tracking-[0.08em] text-[#6b7282] uppercase">Package</div>
            {pkg && <div className="font-gmono text-[12px] text-[#7d8494]">{taka(pkg)} / month</div>}
          </div>
          {pkg ? (
            <>
              <div className="font-display mt-1.5 text-[20px] tracking-[-0.01em]">{pkg.name}</div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] text-[#aab0bd]">
                <span>{many(pkg.max_extensions, 'extension')}</span>
                <span>{many(pkg.max_channels, 'call')} at once</span>
                <span>{many(pkg.max_dids, 'IP number')}</span>
                <span>{pkg.recording_days ? `Recording ${pkg.recording_days} days` : 'No recording'}</span>
              </div>
            </>
          ) : (
            <div className="mt-1.5 text-[14px] text-[#7d8494]">You choose after confirming your email.</div>
          )}
        </div>
      </div>
      <p className="px-4 pt-3 pb-2 text-[12.5px] leading-relaxed text-[#7d8494]">Everything above is created the moment your first payment goes through. Then connect your number.</p>
    </div>
  );
}

export function SignupPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const packages = useQuery({ queryKey: ['public', 'packages'], queryFn: () => api.get<Package[]>('/api/public/packages') });
  const status = useQuery({ queryKey: ['public', 'setup-status'], queryFn: () => api.get<{ needsSetup: boolean }>('/api/public/setup-status') });
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', password: '', package: params.get('package') ?? '', website: '' });
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const buyable = (packages.data ?? []).filter((p) => p.price_monthly !== null);
  const pkg = buyable.find((p) => p.slug === form.package);
  const signup = useMutation({
    mutationFn: () => api.post('/api/public/signup', { ...form, package: form.package || undefined }),
    onSuccess: () => navigate(`/check-email?email=${encodeURIComponent(form.email)}`),
  });

  return (
    <AuthShell
      title="Create your account."
      lede="Your phone system is ready a few minutes after you pay."
      top={
        <>
          <span className="hidden sm:inline">Have an account? </span>
          <TextLink to="/login">Sign in</TextLink>
        </>
      }
      aside={!status.data?.needsSetup && <SystemPreview company={form.company.trim()} name={form.name.trim()} pkg={pkg} />}
    >
      {status.data?.needsSetup ? (
        <FormNote>Sign-ups open soon. We are getting Envo ready — please check back shortly.</FormNote>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            signup.mutate();
          }}
        >
          <SiteField label="Company name">
            <SiteInput value={form.company} onChange={(e) => set('company', e.target.value)} autoComplete="organization" required minLength={2} maxLength={80} autoFocus placeholder="Acme Ltd" />
          </SiteField>
          <div className="grid gap-5 sm:grid-cols-2">
            <SiteField label="Your name">
              <SiteInput value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" required maxLength={60} />
            </SiteField>
            <SiteField label={<span>Mobile <span className="font-normal text-[#8a8f9a]">(optional)</span></span>}>
              <SiteInput type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" maxLength={30} placeholder="01XXXXXXXXX" />
            </SiteField>
          </div>
          <SiteField label="Work email" hint="We send a link to confirm it.">
            <SiteInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" required placeholder="you@company.com" />
          </SiteField>
          <SiteField label="Password" hint="At least 8 characters.">
            <PasswordInput value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
          </SiteField>

          <fieldset>
            <legend className="mb-2 text-[14px] font-medium">Package</legend>
            <div className="space-y-2">
              {buyable.map((p) => (
                <PackageOption key={p.id} checked={form.package === p.slug} onChange={() => set('package', p.slug)}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-medium">{p.name}</span>
                    <span className="block truncate text-[12.5px] text-[#8a8f9a]">
                      {many(p.max_extensions, 'extension')} · {many(p.max_channels, 'call')} at once
                    </span>
                  </span>
                  <span className="font-display shrink-0 text-[17px] tracking-[-0.01em]">
                    {taka(p)}
                    <span className="font-geist text-[12px] text-[#8a8f9a]"> /mo</span>
                  </span>
                </PackageOption>
              ))}
              {packages.isLoading && Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[62px] rounded-xl" />)}
              <PackageOption checked={!form.package} onChange={() => set('package', '')}>
                <span className="text-[14.5px] text-[#5b616e]">Decide after confirming my email</span>
              </PackageOption>
            </div>
          </fieldset>

          {/* Phones: the preview column is hidden, so show its gist here. */}
          {form.company.trim() && (
            <div className="rounded-xl bg-[#0e1016] px-4 py-3.5 text-[13.5px] text-[#aab0bd] lg:hidden" aria-live="polite">
              You get SIP server <span className="font-gmono text-white">{serverSlug(form.company.trim())}</span> with extension 101
              {form.name.trim() ? ` for ${form.name.trim()}` : ''}
              {pkg ? ` on ${pkg.name}, ${taka(pkg)} a month.` : '.'}
            </div>
          )}

          {/* Honeypot: hidden from people, filled in by bots. */}
          <input type="text" name="website" value={form.website} onChange={(e) => set('website', e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <FormError>{signup.error ? errorMessage(signup.error) : null}</FormError>
          <div className="pt-2">
            <SubmitButton busy={signup.isPending}>Create account</SubmitButton>
            <p className="mt-4 text-center text-[13px] text-[#8a8f9a]">No payment yet — you pay after confirming your email.</p>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

function PackageOption({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-center gap-3.5 rounded-xl border px-4 py-3 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#0b0d12]/10',
        checked ? 'border-[#0b0d12] bg-[#fafafb] shadow-[inset_0_0_0_1px_#0b0d12]' : 'border-[#dfe1e6] hover:border-[#c6cad2]',
      )}
    >
      <input type="radio" name="package" checked={checked} onChange={onChange} className="sr-only" />
      <span className={clsx('flex size-[18px] shrink-0 items-center justify-center rounded-full border transition', checked ? 'border-[#0b0d12] bg-[#0b0d12]' : 'border-[#c6cad2]')} aria-hidden>
        {checked && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      {children}
    </label>
  );
}

function mailboxLink(email: string): { href: string; label: string } | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return { href: 'https://mail.google.com/', label: 'Open Gmail' };
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return { href: 'https://outlook.live.com/mail/', label: 'Open Outlook' };
  if (domain.startsWith('yahoo.')) return { href: 'https://mail.yahoo.com/', label: 'Open Yahoo Mail' };
  return null;
}

export function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [sent, setSent] = useState(false);
  const resend = useMutation({
    mutationFn: () => api.post('/api/public/resend-verification', { email }),
    onSuccess: () => setSent(true),
  });
  const mailbox = mailboxLink(email);
  return (
    <AuthShell
      title="Check your inbox."
      lede={
        <>
          We sent a confirmation link to <span className="font-medium text-[#0b0d12]">{email || 'your email'}</span>. Open it to finish creating your account.
        </>
      }
      top={<TextLink to="/login">Sign in</TextLink>}
    >
      <div className="space-y-4">
        {mailbox && (
          <a href={mailbox.href} target="_blank" rel="noreferrer" className="site-btn site-btn-lg w-full justify-center">
            {mailbox.label} <ArrowUpRight className="size-4" />
          </a>
        )}
        <div className="border-t border-[#e7e8ec] pt-5 text-[14.5px] leading-relaxed text-[#5b616e]">
          No email after a few minutes? Look in the spam folder
          {sent ? (
            '. We sent it again — the newest link is the one that works.'
          ) : (
            <>
              , or{' '}
              <button type="button" disabled={!email || resend.isPending} onClick={() => resend.mutate()} className="font-medium text-[#0b0d12] underline decoration-[#c6cad2] underline-offset-4 hover:decoration-[#0b0d12] disabled:opacity-50">
                send the link again
              </button>
              .
            </>
          )}
        </div>
        <FormError>{resend.error ? errorMessage(resend.error) : null}</FormError>
      </div>
    </AuthShell>
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
    <AuthShell title={error ? 'This link does not work.' : 'Confirming your email…'}>
      {error ? (
        <div className="space-y-5">
          <FormError>{error}</FormError>
          <p className="text-[14.5px] text-[#5b616e]">
            Already confirmed? <TextLink to="/login">Sign in</TextLink>. Otherwise sign in and ask for a new link.
          </p>
        </div>
      ) : (
        <Spinner />
      )}
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => api.post('/api/public/forgot-password', { email }),
    onSuccess: () => setSent(true),
  });
  return (
    <AuthShell title="Reset your password." lede={sent ? undefined : 'Enter your email and we send you a link to choose a new one.'} top={<TextLink to="/login">Sign in</TextLink>}>
      {sent ? (
        <FormNote>
          If an account exists for <span className="font-medium">{email}</span>, a reset link is on its way. It works for one hour.
        </FormNote>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <SiteField label="Email">
            <SiteInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus placeholder="you@company.com" />
          </SiteField>
          <FormError>{send.error ? errorMessage(send.error) : null}</FormError>
          <div className="pt-2">
            <SubmitButton busy={send.isPending}>Send reset link</SubmitButton>
          </div>
        </form>
      )}
    </AuthShell>
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
  });
  return (
    <AuthShell title="Choose a new password." top={<TextLink to="/login">Sign in</TextLink>}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate();
        }}
      >
        <SiteField label="New password" hint="At least 8 characters.">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required autoFocus />
        </SiteField>
        <FormError>{reset.error ? errorMessage(reset.error) : null}</FormError>
        <div className="pt-2">
          <SubmitButton busy={reset.isPending}>Save and sign in</SubmitButton>
        </div>
      </form>
    </AuthShell>
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
  });
  if (status.isLoading) {
    return (
      <AuthShell title="Set up Envo.">
        <Spinner />
      </AuthShell>
    );
  }
  if (!status.data?.needsSetup) {
    return (
      <AuthShell title="Envo is already set up.">
        <TextLink to="/login">Sign in</TextLink>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Set up Envo." lede="Create the platform administrator. This page works once, with the link from the server.">
      {!token ? (
        <FormNote>Open the one-time setup link from the server to continue.</FormNote>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setup.mutate();
          }}
        >
          <SiteField label="Your company" hint="Your own SIP servers live in this account, never billed or limited.">
            <SiteInput value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} required />
          </SiteField>
          <SiteField label="Your name">
            <SiteInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required autoFocus />
          </SiteField>
          <SiteField label="Email">
            <SiteInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required />
          </SiteField>
          <SiteField label="Password" hint="At least 12 characters. This account controls everything.">
            <PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" minLength={12} required />
          </SiteField>
          <FormError>{setup.error ? errorMessage(setup.error) : null}</FormError>
          <div className="pt-2">
            <SubmitButton busy={setup.isPending}>Create administrator</SubmitButton>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
