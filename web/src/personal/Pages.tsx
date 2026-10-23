import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowDownLeft, ArrowUpRight, Delete, Download, LifeBuoy, Phone, PhoneMissed, Plus, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatBdt, formatDateTime, formatDuration } from '../lib/format';
import { Button, Card, CardHeader, EmptyState, Field, Input, ListSkeleton, Notice, useConfirm } from '../components/ui';
import { usePhone } from '../phone/PhoneProvider';
import { useAuth } from '../state/auth';
import { formatNumber, useBalance, usePhoneCalls, usePhoneConfig, type PhoneCall, type PhoneMe } from './api';
import { RechargeHistory, RechargePanel } from './Recharge';

/** The person's number and balance, on top of every page of the phone. */
function NumberCard({ me }: { me: PhoneMe }) {
  const ready = me.stage === 'active';
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-950 p-6 text-white shadow-[0_24px_48px_-28px_rgb(31_87_235/0.8)]">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-medium text-white/65">
            <span className={clsx('size-2 rounded-full', ready ? 'bg-emerald-400' : 'bg-amber-400')} />
            {ready ? 'Your number' : 'Being registered'}
          </p>
          <p className="mt-2 text-[28px] leading-none font-semibold tracking-[0.02em] whitespace-nowrap tabular-nums sm:text-[34px]">{formatNumber(me.number) || '—'}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-[13px] font-medium text-white/65">Balance</p>
          <p className="mt-2 text-[22px] leading-none font-semibold whitespace-nowrap tabular-nums sm:text-[26px]">{formatBdt(me.balance)}</p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-white/60">Calls to other Envo numbers are free.</p>
        <Link to="/phone/balance" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13.5px] font-semibold text-ink-950 transition hover:bg-white/90">
          <Plus className="size-4" /> Recharge
        </Link>
      </div>
    </div>
  );
}

const KEYS = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
] as const;

const REG_TEXT = { off: 'Phone is off', connecting: 'Connecting…', registered: 'Ready to call', unregistered: 'Not connected', failed: 'Could not connect' } as const;

export function PhonePage({ me }: { me: PhoneMe }) {
  const phone = usePhone();
  const calls = usePhoneCalls();
  const [number, setNumber] = useState('');
  const active = me.stage === 'active';
  const canCall = active && phone.reg === 'registered' && number.replace(/\D/g, '').length >= 3;
  const call = (n = number) => {
    if (!n) return;
    phone.dial(n);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <div className="space-y-6">
        <NumberCard me={me} />
        {me.stage === 'registering' && (
          <Notice tone="warn" title="We're registering your number">
            Your payment is in. Registration with the operator usually takes a few hours; we email you the moment you can call.
          </Notice>
        )}
        <Card className="p-5 sm:p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canCall) call();
            }}
            className="mx-auto max-w-[300px]"
          >
            <div className="flex items-center gap-2">
              <input
                value={formatNumber(number) || number}
                onChange={(e) => setNumber(e.target.value.replace(/[^\d+*#]/g, '').slice(0, 20))}
                inputMode="tel"
                placeholder="Enter a number"
                aria-label="Number to call"
                className="h-14 min-w-0 flex-1 bg-transparent text-center text-[28px] font-semibold tracking-wide text-slate-950 tabular-nums outline-none placeholder:text-[20px] placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-300"
              />
            </div>
            <p className={clsx('mb-4 text-center text-[12.5px]', active && phone.reg === 'registered' ? 'text-emerald-600' : 'text-slate-400')}>
              {active ? (phone.config && !phone.config.enabled ? (phone.config.reason ?? REG_TEXT.off) : REG_TEXT[phone.reg]) : 'You can call once your number is registered'}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {KEYS.map(([k, letters]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setNumber((n) => (n + k).slice(0, 20))}
                  className="flex h-[66px] flex-col items-center justify-center rounded-full bg-slate-100 transition hover:bg-slate-200 active:bg-slate-300"
                >
                  <span className="text-[26px] leading-none font-medium text-slate-950">{k}</span>
                  {letters && <span className="mt-1 text-[9.5px] font-semibold tracking-[0.15em] text-slate-500">{letters}</span>}
                </button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 items-center gap-3">
              <span />
              <button
                type="submit"
                disabled={!canCall}
                aria-label="Call"
                className="mx-auto flex size-[66px] items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_12px_24px_-12px_rgb(16_185_129/0.9)] transition hover:bg-emerald-400 active:scale-95 disabled:opacity-40 disabled:shadow-none"
              >
                <Phone className="size-7" />
              </button>
              {number ? (
                <button type="button" onClick={() => setNumber((n) => n.slice(0, -1))} aria-label="Delete" className="mx-auto flex size-12 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
                  <Delete className="size-6" />
                </button>
              ) : (
                <span />
              )}
            </div>
          </form>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent calls" actions={<Link to="/phone/calls" className="text-[13px] font-medium text-brand-600 hover:text-brand-700">All calls</Link>} />
        <CallList calls={(calls.data ?? []).slice(0, 6)} loading={calls.isLoading} onCall={active ? (n) => call(n) : undefined} compact />
      </Card>
    </div>
  );
}

function CallList({ calls, loading, onCall, compact }: { calls: PhoneCall[]; loading: boolean; onCall?: (n: string) => void; compact?: boolean }) {
  if (loading) return <ListSkeleton rows={compact ? 3 : 6} />;
  if (!calls.length) return <EmptyState icon={<Phone className="size-5" />} title="No calls yet" description="Your calls show up here." />;
  return (
    <ul className="divide-y divide-slate-100">
      {calls.map((c) => {
        const Icon = c.direction === 'out' ? ArrowUpRight : c.direction === 'in' ? ArrowDownLeft : PhoneMissed;
        return (
          <li key={c.id}>
            <button type="button" disabled={!onCall} onClick={() => onCall?.(c.number)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition enabled:hover:bg-slate-50 sm:px-5">
              <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-full', c.direction === 'missed' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600')}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate text-[14.5px] font-medium tabular-nums', c.direction === 'missed' ? 'text-rose-600' : 'text-slate-950')}>{formatNumber(c.number)}</span>
                <span className="block text-[12.5px] text-slate-500">
                  {formatDateTime(c.at)}
                  {c.duration ? ` · ${formatDuration(c.duration)}` : c.direction === 'missed' ? ' · Missed' : ''}
                </span>
              </span>
              {c.direction === 'out' && <span className={clsx('shrink-0 text-[12.5px] font-medium tabular-nums', c.free || !c.cost ? 'text-emerald-600' : 'text-slate-500')}>{c.free || !c.cost ? 'Free' : formatBdt(c.cost)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function CallsPage({ me }: { me: PhoneMe }) {
  const calls = usePhoneCalls();
  const phone = usePhone();
  return (
    <div className="space-y-5">
      <h1 className="text-[26px] font-semibold tracking-tight text-slate-950">Calls</h1>
      <Card>
        <CallList calls={calls.data ?? []} loading={calls.isLoading} onCall={me.stage === 'active' ? (n) => phone.dial(n) : undefined} />
      </Card>
    </div>
  );
}

export function BalancePage({ me }: { me: PhoneMe }) {
  const balance = useBalance();
  const config = usePhoneConfig();
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      <div className="space-y-6">
        <div>
          <p className="text-[14px] font-medium text-slate-500">Calling balance</p>
          <p className="mt-1 text-[44px] leading-none font-semibold tracking-tight text-slate-950 tabular-nums">{formatBdt(balance.data?.balance ?? me.balance)}</p>
          {config.data && (
            <p className="mt-3 text-[14px] text-slate-500">
              Calls to any number in Bangladesh cost {formatBdt(config.data.rate_per_min)} a minute{config.data.free_onnet ? '; calls to other Envo numbers are free' : ''}.
            </p>
          )}
        </div>
        <Card className="p-5 sm:p-6">
          <h2 className="mb-5 text-[17px] font-semibold text-slate-950">Recharge</h2>
          <RechargePanel />
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Recharges" />
          <div className="px-4 sm:px-5">
            <RechargeHistory />
            {!balance.isLoading && <p className="py-3 text-[13px] text-slate-400">Paid recharges show here and on your balance.</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Activity" description="What added to or used your balance" />
          {balance.isLoading ? (
            <ListSkeleton rows={4} />
          ) : !balance.data?.entries.length ? (
            <p className="px-5 py-6 text-[13.5px] text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {balance.data.entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-slate-900">{e.note || (e.kind === 'topup' ? 'Recharge' : e.kind === 'call' ? 'Call' : 'Correction')}</span>
                    <span className="block text-[12.5px] text-slate-500">{formatDateTime(e.created_at)}</span>
                  </span>
                  <span className={clsx('shrink-0 text-[14px] font-semibold tabular-nums', Number(e.amount) >= 0 ? 'text-emerald-600' : 'text-slate-900')}>
                    {Number(e.amount) > 0 ? '+' : Number(e.amount) < 0 ? '−' : ''}
                    {formatBdt(Math.abs(Number(e.amount)))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function AccountPage({ me }: { me: PhoneMe }) {
  const config = usePhoneConfig();
  const { logout, user } = useAuth();
  const confirm = useConfirm();
  const [pw, setPw] = useState({ current: '', next: '' });
  const change = useMutation({
    mutationFn: () => api.post('/api/phone/password', pw),
    onSuccess: () => {
      setPw({ current: '', next: '' });
      toast.success('Password changed. Other phones and browsers are signed out.');
    },
  });
  const close = useMutation({
    mutationFn: () => api.post<{ closed: boolean; requested?: boolean }>('/api/phone/close'),
    onSuccess: async (r) => {
      if (r.closed) {
        toast.success('Your account is deleted');
        await logout();
      } else toast.success("We've got your request and will be in touch");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const s = config.data?.support;
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <h1 className="text-[26px] font-semibold tracking-tight text-slate-950">Account</h1>
      <Card>
        <CardHeader title="Your details" description="As registered for your number. To change them, contact support." />
        <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
          <Detail label="Name">{me.name}</Detail>
          <Detail label="Number">{formatNumber(me.number) || '—'}</Detail>
          <Detail label="Email">{me.email}</Detail>
          <Detail label="Mobile">{me.mobile}</Detail>
        </dl>
      </Card>

      {config.data?.update_url && (
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-ink-950 text-white">
            <Download className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-950">Envo Phone for Android</p>
            <p className="text-[13.5px] text-slate-500">Take calls on your phone, with your contacts and your own ringtone.</p>
          </div>
          <a href={config.data.update_url} className="inline-flex h-9 items-center rounded-full bg-ink-950 px-4 text-[13.5px] font-medium text-white hover:bg-ink-800">
            Get the app
          </a>
        </Card>
      )}

      <Card>
        <CardHeader title="Password" />
        <form
          className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <Field label="Current password">
            <Input type="password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} autoComplete="new-password" minLength={8} required />
          </Field>
          <Button type="submit" variant="primary" loading={change.isPending} disabled={!!user?.impersonator}>
            Change
          </Button>
          {change.error && <Notice tone="danger" className="sm:col-span-3">{errorMessage(change.error)}</Notice>}
        </form>
      </Card>

      {(s?.phone || s?.email) && (
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <LifeBuoy className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-950">Help and support</p>
            <p className="text-[13.5px] text-slate-500">
              {s.phone && <a href={`tel:${s.phone}`} className="font-medium text-slate-900 underline underline-offset-4">{s.phone}</a>}
              {s.phone && s.email && ' · '}
              {s.email && <a href={`mailto:${s.email}`} className="font-medium text-slate-900 underline underline-offset-4">{s.email}</a>}
            </p>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-950">Close my account</p>
            <p className="text-[13.5px] text-slate-500">{me.close_requested ? "We have your request and will be in touch." : 'We release your number and settle any balance left.'}</p>
          </div>
          <Button
            variant="ghost"
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={me.close_requested || !!user?.impersonator}
            loading={close.isPending}
            onClick={async () => {
              if (await confirm({ title: 'Close your Envo Phone account?', message: 'Your number stops working and is given back. This cannot be undone.', confirmLabel: 'Close my account', danger: true })) close.mutate();
            }}
          >
            {me.close_requested ? 'Requested' : 'Close account'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-[14.5px] text-slate-950">{children}</dd>
    </div>
  );
}
