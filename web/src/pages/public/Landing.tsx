import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowRight,
  Building2,
  Check,
  Code2,
  Disc3,
  Headphones,
  ListTree,
  Minus,
  PhoneCall,
  PhoneIncoming,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '../../lib/api';
import { IVR_TIER_LABELS, formatBdt, limitLabel } from '../../lib/format';
import type { Package } from '../../lib/types';
import { Button } from '../../components/ui';
import { PublicLayout } from './PublicLayout';

/** A small, honest picture of the product: what the dashboard shows during a working day. */
function ProductPreview() {
  return (
    <div className="relative" aria-hidden>
      <div className="absolute -inset-x-8 -inset-y-10 rounded-[3rem] bg-gradient-to-br from-brand-200/50 via-brand-100/30 to-transparent blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-slate-200" />
          <span className="size-2.5 rounded-full bg-slate-200" />
          <span className="size-2.5 rounded-full bg-slate-200" />
          <span className="ml-3 text-[11px] text-slate-400">envo · Dashboard</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5 p-4">
          {[
            ['Calls today', '148', 'text-brand-600'],
            ['Answered', '94%', 'text-emerald-600'],
            ['Live now', '3', 'text-violet-600'],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-slate-100 p-3">
              <div className="text-[10.5px] text-slate-500">{l}</div>
              <div className={clsx('mt-1 text-lg font-semibold tabular-nums', c)}>{v}</div>
            </div>
          ))}
        </div>
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-slate-100">
            {[
              ['Hotline 09644…', 'Ringing Sales · 1001', 'bg-amber-400', 'Ringing'],
              ['01711 23…', 'Talking to Nadia · 1002', 'bg-emerald-500', '04:12'],
              ['01819 87…', 'In queue Support', 'bg-brand-500', '00:38'],
            ].map(([who, what, dot, t]) => (
              <div key={who} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
                <span className={clsx('size-2 rounded-full', dot)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-slate-800">{who}</div>
                  <div className="truncate text-[11px] text-slate-500">{what}</div>
                </div>
                <span className="text-[11px] text-slate-500 tabular-nums">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-4 hidden w-56 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-[var(--shadow-raise)] sm:block lg:-left-10">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <PhoneIncoming className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-slate-800">Incoming call</div>
            <div className="text-[11px] text-slate-500">Answer in your browser</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="rounded-lg bg-rose-50 py-1.5 text-center text-[11px] font-medium text-rose-600">Decline</span>
          <span className="rounded-lg bg-emerald-500 py-1.5 text-center text-[11px] font-medium text-white">Answer</span>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: PhoneCall, title: 'A phone in every browser', text: 'Make and take calls from the dashboard, on a laptop or your phone. No app to install, no desk phone required.' },
  { icon: ListTree, title: 'IVR and call flows', text: 'Greet callers with "press 1 for sales", route by office hours and holidays, and send calls where they belong.' },
  { icon: Users, title: 'Ring groups and queues', text: 'Ring a team at once or one by one, queue callers with music and position announcements.' },
  { icon: Disc3, title: 'Call recording', text: 'Record incoming and outgoing calls, play them back in the browser and keep them as long as your package allows.' },
  { icon: Building2, title: 'One account, several offices', text: 'Run separate phone systems for branches or brands, each with its own numbers and extensions.' },
  { icon: Code2, title: 'Live monitoring and an API', text: 'See every call as it happens, and connect your website or CRM to place calls and receive call events.' },
];

const FAQ = [
  ['Do I need a phone number from you?', 'Bring the IP phone number (09xxx) you already have from your IPTSP. You connect it once in the dashboard and calls start arriving in Envo.'],
  ['How do I pay?', 'Pay online with bKash, Nagad, Rocket, cards or internet banking through SSLCommerz, or by bank transfer. Packages renew monthly and you get an invoice every time.'],
  ['Can I change my package later?', 'Yes. Upgrades start right away and you pay only the difference for the rest of the month. Smaller packages start at your next renewal.'],
  ['What phones can I use?', 'The web phone in your browser, any SIP desk phone (Yealink, Grandstream, Fanvil…) or softphone apps like Zoiper and MicroSIP.'],
  ['What happens if I forget to renew?', 'You get a renewal invoice a week before and a few days of grace after the due date. Your settings, numbers and recordings are kept if the system pauses.'],
  ['Who can see my calls and recordings?', 'Only the people you add to your account. Every customer runs in its own isolated phone system.'],
];

function PricingCards() {
  const q = useQuery({ queryKey: ['public', 'packages'], queryFn: () => api.get<Package[]>('/api/public/packages') });
  const info = useQuery({ queryKey: ['public', 'info'], queryFn: () => api.get<{ business: { name: string; email: string; phone: string } }>('/api/public/info') });
  const list = q.data ?? [];
  const contact = info.data?.business;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {list.map((p) => {
        const custom = p.price_monthly === null;
        return (
          <div
            key={p.id}
            className={clsx(
              'relative flex flex-col rounded-3xl border bg-white p-6',
              p.highlight ? 'border-brand-500 shadow-[0_20px_50px_-20px_rgb(31_87_235/0.45)] ring-4 ring-brand-500/10' : 'border-slate-200',
            )}
          >
            {p.highlight && <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-[11.5px] font-semibold text-white">Most popular</span>}
            <h3 className="text-[17px] font-semibold tracking-tight text-slate-900">{p.name}</h3>
            <p className="mt-0.5 text-[13px] text-slate-500">{p.tagline}</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-[32px] leading-none font-semibold tracking-tight text-slate-900">{custom ? 'Custom' : formatBdt(p.price_monthly)}</span>
            </div>
            <p className="mt-1 text-[13px] text-slate-500">{custom ? 'Talk to us' : 'per month'}</p>
            <ul className="mt-6 space-y-2.5 text-[13.5px]">
              <li className="flex gap-2 text-slate-700">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" />
                {limitLabel(p.max_extensions)} extensions
              </li>
              <li className="flex gap-2 text-slate-700">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" />
                {limitLabel(p.max_channels)} concurrent call{p.max_channels === 1 ? '' : 's'}
              </li>
              <li className="flex gap-2 text-slate-700">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" />
                {p.max_dids === null ? 'Unlimited' : p.max_dids} IP number{p.max_dids === 1 ? '' : 's'}
              </li>
              <li className={clsx('flex gap-2', p.recording_days ? 'text-slate-700' : 'text-slate-400')}>
                {p.recording_days ? <Check className="mt-0.5 size-4 shrink-0 text-brand-600" /> : <Minus className="mt-0.5 size-4 shrink-0" />}
                {p.recording_days ? `Call recording, ${p.recording_days} days${p.recording_mb ? ` / ${p.recording_mb >= 1024 ? `${p.recording_mb / 1024} GB` : `${p.recording_mb} MB`}` : ''}` : 'Call recording'}
              </li>
              <li className="flex gap-2 text-slate-700">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" />
                IVR · {IVR_TIER_LABELS[p.ivr_tier]}
              </li>
              <li className={clsx('flex gap-2', p.call_monitoring ? 'text-slate-700' : 'text-slate-400')}>
                {p.call_monitoring ? <Check className="mt-0.5 size-4 shrink-0 text-brand-600" /> : <Minus className="mt-0.5 size-4 shrink-0" />}
                Live call monitoring
              </li>
              <li className={clsx('flex gap-2', p.api_access ? 'text-slate-700' : 'text-slate-400')}>
                {p.api_access ? <Check className="mt-0.5 size-4 shrink-0 text-brand-600" /> : <Minus className="mt-0.5 size-4 shrink-0" />}
                Developer API
              </li>
              {p.display_rows.map((r) => (
                <li key={r.label} className="flex gap-2 text-slate-500">
                  <span className="mt-0.5 size-4 shrink-0" />
                  {r.label}: {r.value}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-7">
              {custom ? (
                <div className="space-y-1 text-center text-[13px] text-slate-600">
                  {contact?.phone && <div className="font-medium text-slate-900">{contact.phone}</div>}
                  {contact?.email && <div className="break-all">{contact.email}</div>}
                  {!contact?.phone && !contact?.email && <div>Contact Enfinito</div>}
                </div>
              ) : (
                <Link to={`/signup?package=${p.slug}`}>
                  <Button className="w-full" size="lg" variant={p.highlight ? 'primary' : 'secondary'}>
                    Get started
                  </Button>
                </Link>
              )}
            </div>
          </div>
        );
      })}
      {q.isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-[480px] rounded-3xl" />)}
    </div>
  );
}

export function LandingPage() {
  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(50rem_30rem_at_70%_-10%,rgb(31_87_235/0.12),transparent_70%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pt-10 pb-20 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:pb-28">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50/70 px-3 py-1 text-[12.5px] font-medium text-brand-700">
              <Headphones className="size-3.5" /> Cloud PBX for Bangladeshi businesses
            </div>
            <h1 className="mt-5 text-[40px] leading-[1.06] font-semibold tracking-tight text-balance text-slate-950 sm:text-[54px]">Your company's phone system, running in the cloud.</h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-slate-600">
              Connect your IP number, give every colleague an extension, greet callers with an IVR and answer from any browser. Set up in minutes, billed monthly in taka.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup">
                <Button variant="primary" size="lg" className="w-full sm:w-auto">
                  Start now <ArrowRight className="size-4" />
                </Button>
              </Link>
              <a href="#pricing">
                <Button size="lg" className="w-full sm:w-auto">
                  See pricing
                </Button>
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <Wallet className="size-4 text-slate-400" /> Pay with bKash, Nagad or card
              </span>
              <span className="flex items-center gap-1.5">
                <Smartphone className="size-4 text-slate-400" /> Works on your phone
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-slate-400" /> Your own isolated system
              </span>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section id="features" className="scroll-mt-20 border-t border-slate-100 bg-slate-50/50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="max-w-2xl text-[30px] leading-tight font-semibold tracking-tight text-balance text-slate-950 sm:text-[38px]">Everything a business phone line needs, without the hardware.</h2>
          <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-[var(--shadow-card)] ring-1 ring-slate-200/80">
                  <f.icon className="size-5" />
                </div>
                <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-[30px] font-semibold tracking-tight text-slate-950 sm:text-[38px]">Live in three steps</h2>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            ['Create your account', 'Choose a package and pay online. Your phone system and first extensions are created right away.'],
            ['Connect your IP number', 'Enter the username and password your IPTSP gave you. Envo registers the line and shows when it is online.'],
            ['Start taking calls', 'Open the web phone or sign in on a desk phone. Calls to your number ring your team.'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-3xl border border-slate-200 p-6">
              <span className="flex size-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{i + 1}</span>
              <h3 className="mt-4 font-semibold tracking-tight text-slate-900">{t}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-slate-600">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="pricing" className="scroll-mt-20 border-t border-slate-100 bg-gradient-to-b from-slate-50/70 to-white">
        <div className="mx-auto max-w-[1360px] px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-[30px] font-semibold tracking-tight text-slate-950 sm:text-[38px]">Simple monthly packages</h2>
            <p className="mt-3 text-[16px] text-slate-600">All prices in Bangladeshi taka. Upgrade or change any time.</p>
          </div>
          <div className="mt-12">
            <PricingCards />
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <h2 className="text-[30px] font-semibold tracking-tight text-slate-950 sm:text-[38px]">Questions</h2>
        <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium text-slate-900">
                {q}
                <span className="text-slate-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 py-14 text-center text-white sm:px-12">
          <div className="absolute -top-24 -right-20 size-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
          <h2 className="relative text-[28px] font-semibold tracking-tight text-balance sm:text-[36px]">Give your business a proper phone line today.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-brand-100">Sign up, pay with bKash or card, and make your first call in minutes.</p>
          <Link to="/signup" className="relative mt-8 inline-block">
            <Button size="lg" className="border-0 bg-white text-brand-700 hover:bg-brand-50">
              Create your account <ArrowRight className="size-4" />
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
