import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CreditCard, Minus, Star } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../state/auth';
import { IVR_TIER_LABELS, formatBdt, limitLabel } from '../lib/format';
import type { CheckoutResult, Invoice, Onboarding, Package, PaymentOptions } from '../lib/types';
import { Badge, Button, Modal, Notice, Stepper, Tabs } from './ui';

const MONTHS = [1, 3, 6, 12] as const;

function Row({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={clsx('flex items-start gap-2 text-[13px]', on ? 'text-slate-700' : 'text-slate-400')}>
      {on ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <Minus className="mt-0.5 size-3.5 shrink-0" />}
      <span>{children}</span>
    </li>
  );
}

/**
 * Package cards with the right action for this customer: choose, renew, upgrade or switch at renewal.
 * Before the first package, two questions (people, calls at the same time) point to the one that fits;
 * the answers also decide how many extensions the new phone system starts with.
 */
export function PlanPicker({ onInvoice, onDone }: { onInvoice: (inv: Invoice) => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const { plan, refresh } = useAuth();
  const packages = useQuery({ queryKey: ['account', 'packages'], queryFn: () => api.get<Package[]>('/api/account/packages') });
  const [months, setMonths] = useState<(typeof MONTHS)[number]>(1);
  const [busy, setBusy] = useState<number | null>(null);
  const sub = plan?.subscription ?? null;
  const currentId = sub ? plan?.package?.id : null;
  const currentPrice = sub?.price ?? 0;
  const first = !sub;
  const answers = useQuery({ queryKey: ['account', 'onboarding'], queryFn: () => api.get<Onboarding>('/api/account/onboarding'), enabled: first });
  const [people, setPeople] = useState<number | null>(null);
  const [calls, setCalls] = useState<number | null>(null);
  const peopleValue = people ?? answers.data?.people ?? 3;
  const callsValue = calls ?? answers.data?.calls ?? 1;

  const choose = async (p: Package) => {
    setBusy(p.id);
    try {
      // The first package sets the phone system up for this many people.
      if (first) await api.put('/api/account/onboarding', { people: peopleValue, calls: callsValue }).catch(() => undefined);
      const r = await api.post<CheckoutResult>('/api/account/billing/checkout', { package_id: p.id, months });
      void qc.invalidateQueries({ queryKey: ['account'] });
      if (r.action === 'invoice') onInvoice(r.invoice);
      else {
        toast.success(r.message);
        await refresh();
        onDone?.();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const list = packages.data ?? [];
  // The cheapest package with room for both answers; one with a custom price when none has.
  const fits = (p: Package) => (p.max_extensions === null || p.max_extensions >= peopleValue) && (p.max_channels === null || p.max_channels >= callsValue);
  const best = first
    ? ([...list].filter((p) => fits(p) && p.price_monthly !== null).sort((a, b) => Number(a.price_monthly) - Number(b.price_monthly))[0] ?? list.find(fits) ?? null)
    : null;
  return (
    <div>
      {first && (
        <div className="mb-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-black/[0.04] sm:p-5">
          <p className="text-sm font-semibold text-slate-900">Find the right package</p>
          <div className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">How many people will make and take calls?</span>
              <Stepper value={peopleValue} onChange={setPeople} min={1} max={1000} label="People who make and take calls" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">How many calls at the same time, at most?</span>
              <Stepper value={callsValue} onChange={setCalls} min={1} max={500} label="Calls at the same time" />
            </div>
          </div>
          {best && (
            <p className="mt-3 text-sm text-slate-600">
              Best fit: <strong className="font-semibold text-slate-900">{best.name}</strong>
              {best.price_monthly !== null ? `, ${formatBdt(best.price_monthly)} a month.` : '. Talk to us and we make a package for you.'} Your phone system starts with an
              extension for each person.
            </p>
          )}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Prices are per month in BDT. Upgrades start right away; you pay only the difference for the rest of this period.</p>
        <Tabs value={String(months)} onChange={(v) => setMonths(Number(v) as (typeof MONTHS)[number])} tabs={MONTHS.map((m) => ({ value: String(m), label: m === 1 ? 'Monthly' : `${m} months` }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => {
          const current = p.id === currentId;
          const custom = p.price_monthly === null;
          const price = Number(p.price_monthly ?? 0);
          const label = custom ? 'Contact us' : current ? `Renew ${months === 1 ? '1 month' : `${months} months`}` : !sub ? 'Choose' : price > currentPrice ? 'Upgrade now' : 'Switch at renewal';
          const isBest = best?.id === p.id;
          return (
            <div
              key={p.id}
              className={clsx(
                'relative flex flex-col rounded-2xl border bg-white p-5',
                current || isBest ? 'border-brand-500 ring-4 ring-brand-500/10' : p.highlight && !best ? 'border-brand-300' : 'border-slate-200',
              )}
            >
              {isBest ? (
                <span className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-medium text-white">
                  <Check className="size-3" /> Best fit for you
                </span>
              ) : (
                p.highlight &&
                !current &&
                !best && (
                  <span className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-medium text-white">
                    <Star className="size-3" /> Most popular
                  </span>
                )
              )}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold tracking-tight text-slate-900">{p.name}</h4>
                  <p className="text-xs text-slate-500">{p.tagline}</p>
                </div>
                {current && <Badge tone="brand">Current</Badge>}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-semibold tracking-tight text-slate-900">{custom ? 'Custom' : formatBdt(price)}</span>
                {!custom && <span className="text-sm text-slate-500">/ month</span>}
              </div>
              {!custom && months > 1 && (current || !sub) && <p className="text-xs text-slate-500">{formatBdt(price * months)} for {months} months</p>}
              {first && !fits(p) && <p className="mt-2 text-xs font-medium text-amber-700">Smaller than what you need</p>}
              <ul className="mt-4 space-y-1.5">
                <Row on>{limitLabel(p.max_extensions)} people (extensions)</Row>
                <Row on>
                  {limitLabel(p.max_channels)} call{p.max_channels === 1 ? '' : 's'} at the same time
                </Row>
                <Row on>
                  {limitLabel(p.max_dids)} number{p.max_dids === 1 ? '' : 's'} · {limitLabel(p.max_servers)} SIP server{p.max_servers === 1 ? '' : 's'}
                </Row>
                <Row on={p.recording_days > 0}>{p.recording_days > 0 ? `Recording, kept ${p.recording_days} days` : 'Call recording'}</Row>
                <Row on>IVR · {IVR_TIER_LABELS[p.ivr_tier]}</Row>
                <Row on={p.call_monitoring}>Live call monitoring</Row>
                <Row on={p.api_access}>Developer API</Row>
              </ul>
              <div className="mt-auto pt-5">
                <Button
                  className="w-full"
                  variant={current || isBest || (p.highlight && !best) || (sub && price > currentPrice) ? 'primary' : 'secondary'}
                  disabled={custom}
                  loading={busy === p.id}
                  onClick={() => void choose(p)}
                >
                  {label}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Pay one invoice on Enfinito Pay's page (bKash, Nagad, Rocket, cards and internet banking). */
export function PayDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const options = useQuery({ queryKey: ['account', 'billing', 'options'], queryFn: () => api.get<PaymentOptions>('/api/account/billing/options') });
  const online = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/api/account/billing/invoices/${invoice.id}/pay-online`),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const o = options.data;

  return (
    <Modal open onClose={onClose} size="md" title={`Pay ${formatBdt(invoice.amount)}`} description={`${invoice.number} · ${invoice.description}`} footer={<Button onClick={onClose}>Not now</Button>}>
      <div className="space-y-3">
        {o?.online && (
          <button
            type="button"
            disabled={online.isPending}
            onClick={() => online.mutate()}
            className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-60"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <CreditCard className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-900">{online.isPending ? 'Opening the secure payment page…' : 'Pay online'}</span>
              <span className="block text-[13px] text-slate-500">You pay on Enfinito Pay's secure page: bKash, Nagad, Rocket, cards or internet banking.</span>
            </span>
          </button>
        )}
        {o && !o.online && <Notice tone="warn">Payments aren't open yet. Please contact Enfinito to pay this invoice.</Notice>}
      </div>
    </Modal>
  );
}

/** Message after coming back from the payment page (?payment=...). */
export function PaymentResult({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, [tone: 'success' | 'warn' | 'danger' | 'info', title: string, text: string]> = {
    paid: ['success', 'Payment received', 'Thank you! Your payment is confirmed.'],
    review: ['info', 'Payment received, being checked', 'We are taking a quick look at this payment and confirm it shortly.'],
    failed: ['danger', 'The payment did not go through', "Nothing was charged. Try again; on Enfinito Pay's page you can also choose another way to pay."],
    cancelled: ['warn', 'Payment cancelled', 'You left the payment page. You can pay any time below.'],
    unknown: ['warn', 'We could not confirm the payment yet', 'If money left your account, it shows up here within a few minutes.'],
  };
  const [tone, title, text] = map[status] ?? map.unknown!;
  return (
    <Notice tone={tone} title={title} className="mb-5">
      {text}
    </Notice>
  );
}
