import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, Check, Phone, PhoneOff, Play } from 'lucide-react';
import { api } from '../../lib/api';
import { IVR_TIER_LABELS } from '../../lib/format';
import type { Package } from '../../lib/types';
import { SitePage, WRAP } from './site';
import { LiveBoard } from './LiveBoard';

/* ------------------------------------------------------------------ product fragments */

/** Pieces of the real interface, drawn small. Example data. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[22px] bg-[#f3f4f6] p-3 sm:p-8" aria-hidden>
      {children}
    </div>
  );
}

const CARD = 'rounded-2xl bg-white shadow-[0_1px_2px_rgb(11_13_18/0.05),0_12px_32px_-14px_rgb(11_13_18/0.16)]';

function RingingFragment() {
  return (
    <Frame>
      <div className="mx-auto max-w-[380px]">
        <div className={clsx(CARD, 'p-5')}>
          <div className="flex items-center justify-between">
            <span className="site-label">Incoming call</span>
            <span className="font-gmono flex items-center gap-1.5 text-[11.5px] text-[#8a8f9a]">
              <span className="size-1.5 animate-pulse rounded-full bg-[#f5a524] motion-reduce:animate-none" /> Ringing
            </span>
          </div>
          <div className="font-display mt-4 text-[26px] leading-none tracking-[-0.02em]">+880 1911 234 567</div>
          <div className="mt-2 text-[13.5px] text-[#5b616e]">Hotline 09612 345 678 → Sales</div>
          <div className="mt-6 grid grid-cols-2 gap-2.5 text-[14px] font-medium">
            <span className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#fbeceb] text-[#b42318]">
              <PhoneOff className="size-4" /> Decline
            </span>
            <span className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#12a15f] text-white">
              <Phone className="size-4" /> Answer
            </span>
          </div>
        </div>
        <div className={clsx(CARD, 'mt-3 px-5 py-4')}>
          <div className="site-label">Ringing together</div>
          <ul className="mt-3 space-y-3 text-[13.5px]">
            {[
              ['Front desk', '101', 'This browser'],
              ['Nadia', '102', 'Android app'],
              ['Rafi', '103', 'Yealink desk phone'],
            ].map(([name, ext, where]) => (
              <li key={ext} className="flex items-center gap-3">
                <span className="font-gmono w-8 text-[12px] text-[#8a8f9a]">{ext}</span>
                <span className="flex-1">{name}</span>
                <span className="text-[12.5px] text-[#8a8f9a]">{where}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Frame>
  );
}

function FlowFragment() {
  const keys = [
    ['1', 'Sales', 'Ring group · 3 phones'],
    ['2', 'Support', 'Queue with hold music'],
    ['0', 'Reception', 'Extension 101'],
  ];
  return (
    <Frame>
      <div className={clsx(CARD, 'mx-auto max-w-[420px] p-5 sm:p-6')}>
        <ol className="space-y-0">
          {[
            ['Number', '09612 345 678', null],
            ['Office hours', 'Sun – Thu, 9:00 – 18:00', 'Closed → voicemail'],
            ['Menu', '“Welcome to Acme. Press 1 for sales…”', null],
          ].map(([label, title, aside]) => (
            <li key={label} className="relative border-l border-[#d5d9e0] pb-5 pl-5 last:pb-3">
              <span className="absolute top-1 -left-[4.5px] size-2 rounded-full bg-[#0b0d12]" />
              <div className="site-label">{label}</div>
              <div className="mt-1 text-[15px] font-medium">{title}</div>
              {aside && <div className="mt-0.5 text-[12.5px] text-[#8a8f9a]">{aside}</div>}
            </li>
          ))}
        </ol>
        <ul className="mt-1 space-y-2 pl-5">
          {keys.map(([k, team, how]) => (
            <li key={k} className="flex items-center gap-3 rounded-xl border border-[#eceef1] px-3 py-2.5">
              <span className="font-gmono flex size-7 items-center justify-center rounded-lg bg-[#0b0d12] text-[13px] text-white">{k}</span>
              <span className="text-[14px] font-medium">{team}</span>
              <span className="ml-auto text-[12.5px] text-[#8a8f9a]">{how}</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

const WAVE = [30, 52, 40, 68, 82, 58, 44, 72, 90, 64, 48, 36, 56, 78, 62, 40, 28, 46, 70, 84, 60, 42, 54, 74, 50, 34, 44, 66, 58, 38, 26, 40, 62, 48, 32, 22];

function LogFragment() {
  return (
    <Frame>
      <div className={clsx(CARD, 'mx-auto max-w-[460px] overflow-hidden')}>
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[14.5px] font-medium">+880 1811 234 567 → Sales</span>
            <span className="font-gmono text-[12px] text-[#8a8f9a]">14:02</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-[#8a8f9a]">Answered by Nadia · 4:37 · recorded</div>
          <div className="mt-4 flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0b0d12] text-white">
              <Play className="size-3.5 translate-x-px fill-current" />
            </span>
            <div className="flex h-9 flex-1 items-center gap-[3px]">
              {WAVE.map((h, i) => (
                <span key={i} className={clsx('w-full rounded-full', i < 17 ? 'bg-[#1f57eb]' : 'bg-[#d5d9e0]')} style={{ height: `${h}%` }} />
              ))}
            </div>
            <span className="font-gmono shrink-0 text-[11.5px] text-[#5b616e]">2:14</span>
          </div>
        </div>
        <ul className="border-t border-[#eff0f3] text-[13.5px]">
          {[
            ['13:48', '101 → +880 1711 234 567', '1:12', 'Outgoing', 'text-[#5b616e]'],
            ['13:31', '+880 1611 234 567 → Support', '—', 'Missed', 'text-[#b42318]'],
            ['13:05', '+880 1511 234 567 → Sales', '7:51', 'Answered', 'text-[#5b616e]'],
          ].map(([t, who, d, s, tone]) => (
            <li key={t} className="flex items-center gap-3 border-b border-[#eff0f3] px-5 py-3 last:border-b-0">
              <span className="font-gmono w-11 text-[12px] text-[#8a8f9a]">{t}</span>
              <span className="min-w-0 flex-1 truncate">{who}</span>
              <span className="font-gmono hidden w-10 text-right text-[12px] text-[#8a8f9a] sm:block">{d}</span>
              <span className={clsx('w-[68px] text-right text-[12.5px]', tone)}>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

const ROWS = [
  {
    label: 'Web phone',
    title: 'Answer in the browser, on a mobile or at a desk.',
    text: 'Every extension gets a phone built into the dashboard. The same call can ring a laptop, an Android app and a Yealink on the desk at once — whoever is free picks up.',
    fragment: <RingingFragment />,
  },
  {
    label: 'Call flows',
    title: 'Callers reach the right person the first time.',
    text: 'Greet callers with your own recording, offer a menu, and send them to a ring group, a queue or a single person. Nights and weekends follow their own rules.',
    fragment: <FlowFragment />,
  },
  {
    label: 'Call log',
    title: 'Every call on the record.',
    text: 'See who called, who answered and how long they talked. Play recordings right in the log, and keep them as long as your package allows.',
    fragment: <LogFragment />,
  },
];

const MORE = [
  ['Ring groups', 'Ring the whole team at once, or one phone after another.'],
  ['Queues', 'Callers wait in line with music until someone is free.'],
  ['Office hours', 'Different routing for nights, weekends and days off.'],
  ['Voicemail', 'Callers leave a message; you listen in the dashboard.'],
  ['Your own greetings', 'Upload recordings for menus, hold and closed hours.'],
  ['Conference rooms', 'One number your team and clients dial into.'],
  ['Blocked numbers', 'Keep spam and unwanted callers out.'],
  ['Several SIP servers', 'Separate phone systems for branches or brands.'],
  ['API and webhooks', 'Place calls from your CRM and receive call events.'],
];

/* ------------------------------------------------------------------ pricing */

type Cell = ReactNode;
const dash = <span className="text-[#c3c7cf]">—</span>;
const yes = <Check className="mx-auto size-4 text-[#0b0d12] md:mx-0" aria-label="Included" />;

function count(v: number | null): Cell {
  if (v === null) return 'Unlimited';
  if (v === 0) return dash;
  return v.toLocaleString();
}

function storage(mb: number | null): string {
  if (mb === null) return 'unlimited';
  return mb >= 1024 ? `${(mb / 1024).toLocaleString()} GB` : `${mb} MB`;
}

function priceRows(list: Package[]): { label: string; cell: (p: Package) => Cell }[] {
  const extras = [...new Set(list.flatMap((p) => p.display_rows.map((r) => r.label)))];
  return [
    { label: 'Extensions', cell: (p) => count(p.max_extensions) },
    { label: 'Calls at the same time', cell: (p) => count(p.max_channels) },
    { label: 'IP numbers', cell: (p) => count(p.max_dids) },
    { label: 'SIP servers', cell: (p) => count(p.max_servers) },
    { label: 'IVR menus', cell: (p) => count(p.max_ivrs) },
    { label: 'IVR', cell: (p) => IVR_TIER_LABELS[p.ivr_tier] ?? p.ivr_tier },
    { label: 'Call recording', cell: (p) => (p.recording_days ? `${p.recording_days} days · ${storage(p.recording_mb)}` : dash) },
    { label: 'Live call monitoring', cell: (p) => (p.call_monitoring ? yes : dash) },
    { label: 'API and webhooks', cell: (p) => (p.api_access ? yes : dash) },
    ...extras.map((label) => ({ label, cell: (p: Package) => p.display_rows.find((r) => r.label === label)?.value ?? dash })),
  ];
}

function Price({ p, size = 'md' }: { p: Package; size?: 'md' | 'lg' }) {
  if (p.price_monthly === null) return <div className={clsx('font-display tracking-[-0.03em]', size === 'lg' ? 'text-[40px]' : 'text-[30px]')}>Custom</div>;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={clsx('font-display tracking-[-0.03em]', size === 'lg' ? 'text-[40px]' : 'text-[30px]')}>
        <span className="mr-1.5 text-[0.55em] tracking-normal">BDT</span>
        {Number(p.price_monthly).toLocaleString('en-US')}
      </span>
      <span className="text-[13px] text-[#8a8f9a]">/ month</span>
    </div>
  );
}

function PackageAction({ p, contact, short, className }: { p: Package; contact?: { email: string; phone: string }; short?: boolean; className?: string }) {
  if (p.price_monthly !== null) {
    return (
      <Link to={`/signup?package=${p.slug}`} className={clsx(p.highlight ? 'site-btn' : 'site-btn-ghost', 'w-full justify-center whitespace-nowrap', className)}>
        {short ? 'Choose' : `Choose ${p.name.replace(/ PBX$/, '')}`}
      </Link>
    );
  }
  if (contact?.email) {
    return (
      <a href={`mailto:${contact.email}?subject=${encodeURIComponent(`${p.name} package`)}`} className={clsx('site-btn-ghost w-full justify-center', className)}>
        Talk to us
      </a>
    );
  }
  if (contact?.phone) {
    return (
      <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className={clsx('site-btn-ghost w-full justify-center', className)}>
        Call {contact.phone}
      </a>
    );
  }
  return <div className={clsx('flex h-10 items-center justify-center text-[13.5px] text-[#5b616e]', className)}>Contact Enfinito</div>;
}

function Pricing() {
  const q = useQuery({ queryKey: ['public', 'packages'], queryFn: () => api.get<Package[]>('/api/public/packages') });
  const info = useQuery({ queryKey: ['public', 'info'], queryFn: () => api.get<{ business: { name: string; email: string; phone: string } }>('/api/public/info') });
  const list = q.data ?? [];
  const contact = info.data?.business;
  const rows = priceRows(list);
  const [picked, setPicked] = useState<number | null>(null);
  const current = list.find((p) => p.id === picked) ?? list.find((p) => p.highlight) ?? list[0];

  if (q.isLoading) return <div className="skeleton mt-14 h-[520px] rounded-[22px]" />;
  if (!list.length) return <p className="mt-10 text-[15px] text-[#5b616e]">Packages are being prepared. Please check back soon.</p>;

  return (
    <>
      {/* Desktop: one table, every package side by side. */}
      <div className="mt-14 hidden md:block">
        <table className="w-full table-fixed border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className="w-[21%] align-bottom" />
              {list.map((p) => (
                <th key={p.id} scope="col" className={clsx('px-4 pt-5 pb-6 align-top font-normal', p.highlight && 'rounded-t-[18px] bg-[#f3f5fa]')}>
                  <div className={clsx('font-gmono h-4 text-[11px] tracking-[0.06em] uppercase', p.highlight ? 'text-[#1f57eb]' : 'text-transparent')}>{p.highlight ? 'Most chosen' : '·'}</div>
                  <div className="font-display mt-2 text-[19px] font-medium tracking-[-0.01em]">{p.name}</div>
                  <div className="mt-0.5 text-[13px] text-[#8a8f9a]">{p.tagline}</div>
                  <div className="mt-5">
                    <Price p={p} />
                  </div>
                  <PackageAction p={p} contact={contact} short className="mt-5" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-[14px]">
            {rows.map((r, i) => (
              <tr key={r.label}>
                <th scope="row" className="border-t border-[#e7e8ec] py-3.5 pr-4 font-normal text-[#5b616e]">
                  {r.label}
                </th>
                {list.map((p) => (
                  <td key={p.id} className={clsx('border-t border-[#e7e8ec] px-4 py-3.5 tabular-nums', p.highlight && 'bg-[#f3f5fa]', p.highlight && i === rows.length - 1 && 'rounded-b-[18px]')}>
                    {r.cell(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: pick a package, read its sheet. */}
      <div className="mt-10 md:hidden">
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Packages">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={current?.id === p.id}
              onClick={() => setPicked(p.id)}
              className={clsx(
                'h-10 shrink-0 rounded-full px-4 text-[14px] whitespace-nowrap transition',
                current?.id === p.id ? 'bg-[#0b0d12] text-white' : 'border border-[#dfe1e6] text-[#2a2e37]',
              )}
            >
              {p.name.replace(/ PBX$/, '')}
            </button>
          ))}
        </div>
        {current && (
          <div className="mt-5 rounded-[22px] bg-[#f3f5fa] p-5" role="tabpanel">
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-display text-[22px] font-medium tracking-[-0.01em]">{current.name}</div>
              {current.highlight && <div className="font-gmono text-[11px] tracking-[0.06em] text-[#1f57eb] uppercase">Most chosen</div>}
            </div>
            <div className="text-[13.5px] text-[#8a8f9a]">{current.tagline}</div>
            <div className="mt-4">
              <Price p={current} size="lg" />
            </div>
            <dl className="mt-5 text-[14px]">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-4 border-t border-[#e2e5ec] py-3">
                  <dt className="text-[#5b616e]">{r.label}</dt>
                  <dd className="text-right tabular-nums">{r.cell(current)}</dd>
                </div>
              ))}
            </dl>
            <PackageAction p={current} contact={contact} className="site-btn-lg mt-4" />
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ page */

const FAQ = [
  ['Do I need a new phone number?', 'No. Bring the IP number (09…) you already have from your IPTSP. You enter its details once in the dashboard and calls to it start ringing in Envo.'],
  ['Which phones work with Envo?', 'The web phone in the dashboard works on any computer or mobile browser. Any SIP desk phone (Yealink, Grandstream, Fanvil…) and softphone apps like Zoiper or MicroSIP work too.'],
  ['How do I pay?', 'Online through Enfinito Pay, with bKash, Nagad, Rocket, cards or internet banking. Packages renew monthly and every payment comes with an invoice.'],
  ['Can I change my package later?', 'Yes. A bigger package starts right away and you pay only the difference for the rest of the month. A smaller one starts at your next renewal.'],
  ['What happens if I miss a renewal?', 'You get the invoice a week early and a few days of grace after the due date. If your system pauses, your settings, numbers and recordings are kept.'],
  ['Who can see my calls and recordings?', 'Only the people you add to your account. Each customer runs in a separate phone system with its own extensions and logins.'],
];

export function LandingPage() {
  return (
    <SitePage>
      {/* Hero */}
      <section className="relative">
        <div className={clsx(WRAP, 'grid grid-cols-1 gap-8 pt-12 sm:pt-20 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end lg:gap-16 lg:pt-24')}>
          <div>
            <p className="site-label">Cloud phone system for Bangladesh</p>
            <h1 className="font-display mt-5 text-[44px] leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-[64px] xl:text-[80px]">
              Turn your 09 number into a full phone system.
            </h1>
          </div>
          <div className="lg:pb-2">
            <p className="max-w-[30rem] text-[17px] leading-[1.6] text-[#5b616e] sm:text-[18px]">
              Envo connects the number you already have to extensions, call menus and queues — with a phone in every browser. Set up in an afternoon, paid monthly in taka.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4">
              <Link to="/signup" className="site-btn site-btn-lg">
                Get started <ArrowRight className="size-4" />
              </Link>
              <a href="#pricing" className="group flex items-center gap-1.5 text-[15px] font-medium">
                See pricing <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </a>
            </div>
            <p className="mt-6 text-[14px] text-[#8a8f9a]">
              Just want a number for yourself?{' '}
              <Link to="/home/phone" className="font-medium text-[#0b0d12] underline decoration-[#c6cad2] underline-offset-4 hover:decoration-[#0b0d12]">
                Get Envo Phone
              </Link>
            </p>
          </div>
        </div>

        {/* The product at work, on a band that runs the full width of the screen. */}
        <div className="relative mt-14 sm:mt-20">
          <div className="absolute inset-x-0 top-[30%] bottom-0 bg-[#f4f5f7]" aria-hidden />
          <div className="relative mx-auto w-full max-w-[1440px] px-5 sm:px-8 xl:px-12">
            <LiveBoard />
          </div>
          <div className={clsx(WRAP, 'relative py-12 sm:py-16')}>
            <div className="flex flex-col items-center gap-x-10 gap-y-5 text-center lg:flex-row lg:justify-between lg:text-left">
              <p className="site-label shrink-0">Works with the phones you have</p>
              <ul className="font-display flex flex-wrap items-center justify-center gap-x-9 gap-y-3 text-[19px] font-medium tracking-[-0.01em] text-[#9aa0ab] sm:text-[21px]">
                {['Any browser', 'Android & iPhone', 'Yealink', 'Grandstream', 'Fanvil', 'Zoiper', 'MicroSIP'].map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Product */}
      <section id="product" className="scroll-mt-16">
        <div className={clsx(WRAP, 'py-20 sm:py-28')}>
          <div className="max-w-[44rem]">
            <p className="site-label">Product</p>
            <h2 className="site-h2 mt-4">A switchboard for the whole team, without the hardware.</h2>
          </div>
          <div className="mt-16 space-y-20 sm:mt-20 sm:space-y-28">
            {ROWS.map((r, i) => (
              <div key={r.label} className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-16">
                <div className={clsx('max-w-[30rem]', i % 2 === 1 && 'lg:order-2 lg:justify-self-end')}>
                  <p className="site-label">{r.label}</p>
                  <h3 className="font-display mt-3 text-[26px] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[32px]">{r.title}</h3>
                  <p className="mt-4 text-[16px] leading-[1.65] text-[#5b616e]">{r.text}</p>
                </div>
                {r.fragment}
              </div>
            ))}
          </div>
          <div className="mt-24 border-t border-[#0b0d12] pt-6 sm:mt-32">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-baseline">
              <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em]">Also in Envo</h3>
              <p className="text-[14px] text-[#8a8f9a]">What you can use depends on your package.</p>
            </div>
            <dl className="mt-8 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
              {MORE.map(([t, d]) => (
                <div key={t}>
                  <dt className="text-[15px] font-medium">{t}</dt>
                  <dd className="mt-1 text-[14.5px] leading-relaxed text-[#5b616e]">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Bangladesh */}
      <section className="bg-[#0b0d12] text-white">
        <div className={clsx(WRAP, 'grid gap-14 py-20 sm:py-28 lg:grid-cols-[1fr_1.2fr] lg:gap-20')}>
          <div>
            <p className="site-label !text-[#7d8494]">Made for here</p>
            <p lang="bn" className="font-bangla mt-5 text-[40px] leading-[1.2] font-medium sm:text-[52px]">
              আপনার ব্যবসার ফোন, এখন ক্লাউডে।
            </p>
            <p className="mt-4 text-[16px] text-[#9aa1b0]">Your business phone, now in the cloud.</p>
          </div>
          <dl className="grid gap-x-10 gap-y-10 self-end sm:grid-cols-2">
            {[
              ['BDT 499', 'Packages start here. Billed monthly in taka, with an invoice every time.'],
              ['09', 'Bring the IP number from your IPTSP. Envo registers it and keeps it online.'],
              ['bKash', 'Or Nagad, Rocket, cards and internet banking, all online through Enfinito Pay.'],
              ['0', 'Servers, PBX boxes or phones to buy. Start with the browser you have.'],
            ].map(([big, d]) => (
              <div key={big} className="border-t border-[#262a35] pt-5">
                <dt className="font-display text-[44px] leading-none font-medium tracking-[-0.035em]">{big}</dt>
                <dd className="mt-3 max-w-[18rem] text-[14.5px] leading-relaxed text-[#9aa1b0]">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Steps */}
      <section className={clsx(WRAP, 'py-20 sm:py-28')}>
        <p className="site-label">Getting started</p>
        <h2 className="site-h2 mt-4 max-w-[40rem]">Live in an afternoon.</h2>
        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {[
            ['Create your account', 'Pick a package and pay online. Your phone system and first extensions are made for you.'],
            ['Connect your number', 'Enter the line details from your IPTSP. Envo shows the moment your number is online.'],
            ['Take your first call', 'Open the web phone or sign in on a desk phone. Calls to your number now ring your team.'],
          ].map(([t, d], i) => (
            <li key={t} className="border-t border-[#e7e8ec] pt-5">
              <span className="font-gmono text-[13px] text-[#1f57eb]">0{i + 1}</span>
              <h3 className="font-display mt-3 text-[21px] font-semibold tracking-[-0.02em]">{t}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#5b616e]">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 border-t border-[#e7e8ec]">
        <div className={clsx(WRAP, 'py-20 sm:py-28')}>
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <p className="site-label">Pricing</p>
              <h2 className="site-h2 mt-4 max-w-[36rem]">One flat price a month.</h2>
            </div>
            <p className="max-w-[26rem] text-[15.5px] leading-relaxed text-[#5b616e]">
              Prices in taka. Move to a bigger package any time and pay only the difference for the rest of the month.
            </p>
          </div>
          <Pricing />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 border-t border-[#e7e8ec]">
        <div className={clsx(WRAP, 'grid gap-10 py-20 sm:py-28 lg:grid-cols-[1fr_2fr] lg:gap-16')}>
          <div>
            <p className="site-label">FAQ</p>
            <h2 className="site-h2 mt-4 lg:sticky lg:top-24">Questions, answered.</h2>
          </div>
          <dl className="grid gap-x-12 sm:grid-cols-2">
            {FAQ.map(([q, a]) => (
              <div key={q} className="border-t border-[#e7e8ec] pt-5 pb-9">
                <dt className="font-display text-[18px] leading-snug font-medium tracking-[-0.01em]">{q}</dt>
                <dd className="mt-2.5 text-[15px] leading-relaxed text-[#5b616e]">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Closing */}
      <section className="border-t border-[#e7e8ec]">
        <div className={clsx(WRAP, 'py-24 sm:py-36')}>
          <h2 className="font-display max-w-[56rem] text-[48px] leading-[0.95] font-semibold tracking-[-0.05em] text-balance sm:text-[88px]">
            Ready for the next call.
          </h2>
          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[30rem] text-[17px] leading-relaxed text-[#5b616e]">Create an account, connect your number and answer your first call in the browser today.</p>
            <div className="flex items-center gap-6">
              <Link to="/signup" className="site-btn site-btn-lg">
                Get started <ArrowRight className="size-4" />
              </Link>
              <Link to="/login" className="text-[15px] font-medium hover:text-[#1f57eb]">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </SitePage>
  );
}
