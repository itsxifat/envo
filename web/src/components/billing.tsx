import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CreditCard, Landmark, Minus, Smartphone, Star } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../state/auth';
import { IVR_TIER_LABELS, formatBdt, limitLabel } from '../lib/format';
import type { CheckoutResult, Invoice, Package, PaymentOptions } from '../lib/types';
import { Badge, Button, Field, Input, Modal, Notice, Select, Tabs } from './ui';

const MONTHS = [1, 3, 6, 12] as const;

function Row({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={clsx('flex items-start gap-2 text-[13px]', on ? 'text-slate-700' : 'text-slate-400')}>
      {on ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <Minus className="mt-0.5 size-3.5 shrink-0" />}
      <span>{children}</span>
    </li>
  );
}

/** Package cards with the right action for this customer: choose, renew, upgrade or switch at renewal. */
export function PlanPicker({ onInvoice, onDone }: { onInvoice: (inv: Invoice) => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const { plan, refresh } = useAuth();
  const packages = useQuery({ queryKey: ['account', 'packages'], queryFn: () => api.get<Package[]>('/api/account/packages') });
  const [months, setMonths] = useState<(typeof MONTHS)[number]>(1);
  const [busy, setBusy] = useState<number | null>(null);
  const sub = plan?.subscription ?? null;
  const currentId = sub ? plan?.package?.id : null;
  const currentPrice = sub?.price ?? 0;

  const choose = async (p: Package) => {
    setBusy(p.id);
    try {
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
  return (
    <div>
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
          return (
            <div key={p.id} className={clsx('relative flex flex-col rounded-2xl border bg-white p-5', current ? 'border-brand-500 ring-4 ring-brand-500/10' : p.highlight ? 'border-brand-300' : 'border-slate-200')}>
              {p.highlight && !current && (
                <span className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-medium text-white">
                  <Star className="size-3" /> Most popular
                </span>
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
              <ul className="mt-4 space-y-1.5">
                <Row on>{limitLabel(p.max_extensions)} extensions</Row>
                <Row on>{limitLabel(p.max_channels)} concurrent calls</Row>
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
                  variant={current || p.highlight || (sub && price > currentPrice) ? 'primary' : 'secondary'}
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

const CHANNELS = [
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

/** Pay one invoice: online through SSLCommerz, or report a bKash / bank transfer. */
export function PayDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: ['account', 'billing', 'options'], queryFn: () => api.get<PaymentOptions>('/api/account/billing/options') });
  const [mode, setMode] = useState<'choose' | 'manual'>('choose');
  const [manual, setManual] = useState({ channel: 'bkash', reference: '', note: '' });
  const online = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/api/account/billing/invoices/${invoice.id}/pay-online`),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const report = useMutation({
    mutationFn: () => api.post(`/api/account/billing/invoices/${invoice.id}/pay-manual`, manual),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account'] });
      toast.success('Thanks! We confirm your payment shortly.');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const o = options.data;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Pay ${formatBdt(invoice.amount)}`}
      description={`${invoice.number} · ${invoice.description}`}
      footer={
        mode === 'manual' ? (
          <>
            <Button onClick={() => setMode('choose')}>Back</Button>
            <Button variant="primary" loading={report.isPending} disabled={manual.reference.trim().length < 3} onClick={() => report.mutate()}>
              Submit payment
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Not now</Button>
        )
      }
    >
      {mode === 'choose' ? (
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
                <span className="block text-[13px] text-slate-500">bKash, Nagad, Rocket, cards or internet banking through SSLCommerz</span>
              </span>
            </button>
          )}
          {o?.manual && (
            <button
              type="button"
              onClick={() => setMode('manual')}
              className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <Landmark className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-900">I paid by bKash or bank transfer</span>
                <span className="block text-[13px] text-slate-500">Send us the transaction ID and we confirm it</span>
              </span>
            </button>
          )}
          {o && !o.online && !o.manual && <Notice tone="warn">Payments are not set up yet. Please contact Enfinito.</Notice>}
        </div>
      ) : (
        <div className="space-y-4">
          {o?.manualInstructions && (
            <Notice tone="info" title="How to pay">
              <p className="whitespace-pre-line">{o.manualInstructions}</p>
              <p className="mt-1">
                Amount: <strong>{formatBdt(invoice.amount)}</strong> · Reference: <strong>{invoice.number}</strong>
              </p>
            </Notice>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid with">
              <Select value={manual.channel} onChange={(e) => setManual({ ...manual, channel: e.target.value })}>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Transaction ID">
              <div className="relative">
                <Smartphone className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} className="pl-9" placeholder="e.g. 9JH4KL2M8N" autoFocus />
              </div>
            </Field>
            <Field label="Note (optional)" className="sm:col-span-2">
              <Input value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} placeholder="Sender number or bank name" />
            </Field>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Message after coming back from the payment page (?payment=...). */
export function PaymentResult({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, [tone: 'success' | 'warn' | 'danger' | 'info', title: string, text: string]> = {
    paid: ['success', 'Payment received', 'Thank you! Your package is active.'],
    review: ['info', 'Payment received, being checked', 'Your bank flagged this payment for a quick review. We confirm it shortly.'],
    failed: ['danger', 'The payment did not go through', 'Nothing was charged. Try again or use another method.'],
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
