import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, Download, Phone, PhoneIncoming } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { formatBdt } from '../../lib/format';
import { useAuth } from '../../state/auth';
import type { PhoneConfig } from '../../personal/api';
import { SitePage, WRAP } from './site';
import { AuthShell, FormError, FormNote, PasswordInput, SiteField, SiteInput, SubmitButton, TextLink } from './auth';

/*
 * The website's personal side: Envo Phone, a number of your own for people who don't need a phone
 * system. Prices and the first recharge come from the admin's phone app settings.
 */

function usePublicPhoneConfig() {
  return useQuery({ queryKey: ['public', 'phone-config'], queryFn: () => api.get<PhoneConfig>('/api/public/phone/config'), staleTime: 5 * 60_000 });
}

/** The app, drawn small: the number card and a call from another Envo number coming in. Example data. */
function PhoneMock({ free }: { free: boolean }) {
  return (
    <div className="relative mx-auto w-full max-w-[340px]" aria-hidden>
      <div className="rounded-[44px] bg-[#0b0d12] p-3 shadow-[0_40px_80px_-30px_rgb(11_13_18/0.55)]">
        <div className="overflow-hidden rounded-[34px] bg-gradient-to-b from-[#14306f] via-[#0b0d12] to-[#0b0d12] px-6 pt-12 pb-10 text-white">
          <div className="rounded-3xl bg-white/[0.07] p-5 ring-1 ring-white/10">
            <div className="flex items-center justify-between text-[12px] text-white/60">
              Your number
              <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 font-semibold text-emerald-400">Active</span>
            </div>
            <div className="font-display mt-2 text-[28px] font-semibold tracking-[0.02em] tabular-nums">09639 437 015</div>
            <div className="mt-2 text-[12px] text-white/55">Balance BDT 245.50</div>
          </div>
          <div className="mt-10 text-center">
            <div className="text-[11px] font-medium tracking-wide text-white/50 uppercase">Envo call{free ? ' · free' : ''}</div>
            <div className="font-display mt-2 text-[26px] font-semibold">Karim Hossain</div>
            <div className="mt-1 text-[13px] text-white/55 tabular-nums">09639 437 022</div>
            <div className="mx-auto mt-7 flex size-24 items-center justify-center rounded-full bg-white/[0.08] text-[30px] font-semibold ring-8 ring-white/[0.04]">KH</div>
          </div>
          <div className="mt-10 flex justify-around">
            <span className="flex size-14 items-center justify-center rounded-full bg-rose-500">
              <Phone className="size-6 rotate-[135deg]" />
            </span>
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500">
              <PhoneIncoming className="size-6" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PersonalLandingPage() {
  const config = usePublicPhoneConfig();
  const c = config.data;
  const rate = c ? formatBdt(c.rate_per_min) : 'BDT 0.40';
  const start = c ? formatBdt(c.activation_min) : 'BDT 100';
  // Calls between Envo numbers are free only while the admin setting says so.
  const free = !!c?.free_onnet;
  const faq: [string, string][] = [
    ['Is the number really mine?', `Yes. It is registered in your name with ${c?.operator || 'the operator'}, as the BTRC requires, and it stays yours while you use it.`],
    ['What do I need to sign up?', 'Your NID, a photo of yourself and a photo of the front of your NID. You can take both photos with your phone while you sign up.'],
    ['How soon can I call?', 'Your number is chosen the moment you send the registration. After your first recharge we register it in your name, usually within a few hours, and email you when it is ready.'],
    ['Where can I use it?', 'In the Envo Phone app on Android, and in any browser on envo.enfinito.cloud. Calls to your number ring wherever you are signed in.'],
    ['Is there a monthly fee?', `No. You only pay for calls to other networks, ${rate} a minute, from the balance you recharge.${free ? ' Calls to other Envo numbers are free.' : ''}`],
    ['Need a phone system for a business?', 'Envo also runs phone systems for teams, with extensions, call menus and queues. See Envo for business.'],
  ];
  return (
    <SitePage audience="personal">
      <section className={clsx(WRAP, 'grid items-center gap-14 pt-12 pb-20 sm:pt-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-20 lg:pt-24 lg:pb-28')}>
        <div>
          <p className="site-label">Envo Phone · for you</p>
          <h1 className="font-display mt-5 text-[44px] leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-[64px] xl:text-[76px]">Your own phone number, wherever you are.</h1>
          <p className="mt-6 max-w-[32rem] text-[17px] leading-[1.6] text-[#5b616e] sm:text-[18px]">
            Get a 09639 number in minutes. Call any phone in Bangladesh from your Android phone or your browser{free ? ', and call other Envo numbers for free' : ''}.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link to="/phone/signup" className="site-btn site-btn-lg">
              Get my number <ArrowRight className="size-4" />
            </Link>
            {c?.update_url && (
              <a href={c.update_url} className="group flex items-center gap-2 text-[15px] font-medium">
                <Download className="size-4" /> Get the Android app
              </a>
            )}
          </div>
          <p className="mt-5 text-[14px] text-[#8a8f9a]">No monthly fee. Start with {start}, all of it for calls.</p>
        </div>
        <PhoneMock free={free} />
      </section>

      <section className="bg-[#0b0d12] text-white">
        <dl className={clsx(WRAP, 'grid gap-x-10 gap-y-10 py-16 sm:grid-cols-2 sm:py-20', free ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
          {[
            ['No fee', 'Every month. No package, no contract.'],
            [rate, 'A minute to any mobile or landline in Bangladesh.'],
            ...(free ? [['Free', 'Calls between Envo numbers, as long as you like.']] : []),
            [start, 'Your first recharge activates the number and all of it is yours to call with.'],
          ].map(([big, d]) => (
            <div key={d} className="border-t border-[#262a35] pt-5">
              <dt className="font-display text-[44px] leading-none font-medium tracking-[-0.035em]">{big}</dt>
              <dd className="mt-3 max-w-[16rem] text-[14.5px] leading-relaxed text-[#9aa1b0]">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="how" className={clsx(WRAP, 'scroll-mt-16 py-20 sm:py-28')}>
        <p className="site-label">How it works</p>
        <h2 className="site-h2 mt-4 max-w-[40rem]">A number of your own in four steps.</h2>
        <ol className="mt-14 grid gap-10 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
          {[
            ['Sign up', 'Your name, mobile number and email. We send a code to confirm the email.'],
            ['Register with your NID', 'The details the BTRC asks for every number, and two photos. About three minutes.'],
            ['Activate', `Recharge ${start} or more online through Enfinito Pay: bKash, Nagad, Rocket or card. All of it becomes your calling balance.`],
            ['Call', 'We register the number in your name, usually within a few hours. Then call from the app or the browser.'],
          ].map(([t, d], i) => (
            <li key={t} className="border-t border-[#e7e8ec] pt-5">
              <span className="font-gmono text-[13px] text-[#1f57eb]">0{i + 1}</span>
              <h3 className="font-display mt-3 text-[21px] font-semibold tracking-[-0.02em]">{t}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#5b616e]">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="faq" className="scroll-mt-16 border-t border-[#e7e8ec]">
        <div className={clsx(WRAP, 'grid gap-10 py-20 sm:py-28 lg:grid-cols-[1fr_2fr] lg:gap-16')}>
          <div>
            <p className="site-label">FAQ</p>
            <h2 className="site-h2 mt-4">Questions, answered.</h2>
          </div>
          <dl className="grid gap-x-12 sm:grid-cols-2">
            {faq.map(([q, a]) => (
              <div key={q} className="border-t border-[#e7e8ec] pt-5 pb-9">
                <dt className="font-display text-[18px] leading-snug font-medium tracking-[-0.01em]">{q}</dt>
                <dd className="mt-2.5 text-[15px] leading-relaxed text-[#5b616e]">
                  {a}
                  {q.startsWith('Need a phone system') && (
                    <>
                      {' '}
                      <Link to="/home" className="font-medium text-[#0b0d12] underline underline-offset-4">
                        Envo for business
                      </Link>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-t border-[#e7e8ec]">
        <div className={clsx(WRAP, 'py-24 sm:py-32')}>
          <h2 className="font-display max-w-[52rem] text-[48px] leading-[0.95] font-semibold tracking-[-0.05em] text-balance sm:text-[80px]">Your number is waiting.</h2>
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <Link to="/phone/signup" className="site-btn site-btn-lg">
              Get my number <ArrowRight className="size-4" />
            </Link>
            <Link to="/login" className="text-[15px] font-medium hover:text-[#1f57eb]">
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </SitePage>
  );
}

const MOBILE = /^(?:\+?88)?01[3-9]\d{8}$/;

export function PersonalSignupPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const config = usePublicPhoneConfig();
  const [form, setForm] = useState({ name: '', mobile: '', email: '', password: '', website: '' });
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const signup = useMutation({
    mutationFn: () => api.post('/api/public/phone/signup', { ...form, client: 'web' }),
    onSuccess: async () => {
      await refresh();
      navigate('/phone', { replace: true });
    },
  });
  const mobileOk = MOBILE.test(form.mobile.replace(/[\s-]/g, ''));

  return (
    <AuthShell
      title="Get your number."
      lede="It takes about three minutes. Next we ask for your NID, as the BTRC requires for every number."
      top={
        <>
          <span className="hidden sm:inline">Have an account? </span>
          <TextLink to="/login">Sign in</TextLink>
        </>
      }
    >
      {config.data && !config.data.signups ? (
        <FormNote>New numbers are not available right now. Please check back soon.</FormNote>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            signup.mutate();
          }}
        >
          <SiteField label="Full name" hint="As written on your NID.">
            <SiteInput value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" required minLength={2} maxLength={60} autoFocus />
          </SiteField>
          <SiteField label="Mobile number" hint="We send important messages here.">
            <SiteInput type="tel" inputMode="tel" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} autoComplete="tel" required placeholder="01712345678" maxLength={16} />
          </SiteField>
          <SiteField label="Email" hint="We send a code to confirm it.">
            <SiteInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" required placeholder="you@example.com" />
          </SiteField>
          <SiteField label="Password" hint="At least 8 characters.">
            <PasswordInput value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
          </SiteField>
          {/* Honeypot: hidden from people, filled in by bots. */}
          <input type="text" name="website" value={form.website} onChange={(e) => set('website', e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <FormError>{signup.error ? errorMessage(signup.error) : form.mobile && !mobileOk && form.mobile.length >= 11 ? 'Enter your mobile number like 01712345678' : null}</FormError>
          <div className="pt-2">
            <SubmitButton busy={signup.isPending}>Continue</SubmitButton>
            <p className="mt-4 text-center text-[13px] text-[#8a8f9a]">By continuing you agree to Enfinito's terms and privacy policy.</p>
          </div>
          <p className="border-t border-[#e7e8ec] pt-5 text-[14px] text-[#5b616e]">
            Setting up phones for a team? <TextLink to="/signup">Create a business account</TextLink>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
