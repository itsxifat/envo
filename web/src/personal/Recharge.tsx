import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Check, CreditCard, Smartphone } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatBdt, formatDateTime } from '../lib/format';
import { Badge, Button, Field, Input, Notice, Select } from '../components/ui';
import { usePhoneConfig, useRecharges, type Recharge } from './api';

type Method = 'online' | 'manual';

/**
 * Choosing an amount and paying it: online (card, bKash, Nagad through the payment page) or by sending
 * bKash / Nagad yourself and entering the transaction ID. `first` is the recharge that activates the number.
 * `inReview`: a payment waits for support's check (PhoneMe.payment_in_review), so nothing is paid twice.
 */
export function RechargePanel({ first, inReview, onDone }: { first?: boolean; inReview?: boolean; onDone?: () => void }) {
  const config = usePhoneConfig();
  const qc = useQueryClient();
  const c = config.data;
  const min = c ? (first ? c.activation_min : c.recharge.min) : 0;
  const presets = (c?.recharge.presets ?? []).filter((p) => p >= min);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState<Method | null>(null);
  const [manual, setManual] = useState({ channel: 'bkash', reference: '' });
  const [sent, setSent] = useState(false);
  // Support confirmed the payment that was sent from here: recharging is open again.
  useEffect(() => {
    if (!inReview) setSent(false);
  }, [inReview]);
  const chosen = custom ? Number(custom) : (amount ?? presets[0] ?? min);
  const how: Method | null = method ?? (c?.payment.online ? 'online' : c?.payment.manual ? 'manual' : null);
  const tooSmall = !!c && chosen < min;
  const tooBig = !!c && chosen > c.recharge.max;

  const pay = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ id: number }>('/api/phone/recharges', { amount: chosen });
      if (how === 'online') {
        const { url } = await api.post<{ url: string }>(`/api/phone/recharges/${r.id}/pay-online`, { from: 'web' });
        window.location.assign(url);
        return 'redirect';
      }
      await api.post(`/api/phone/recharges/${r.id}/pay-manual`, manual);
      return 'manual';
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['phone'] });
      if (r === 'manual') {
        setSent(true);
        onDone?.();
      }
    },
  });

  if (!c) return <div className="skeleton h-64 rounded-2xl" />;
  if (sent || inReview) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-600/15">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check className="size-5" />
          </span>
          <div>
            <p className="font-semibold text-emerald-950">{sent ? "Thank you! We're checking your payment." : "We're checking your payment."}</p>
            <p className="text-[13.5px] text-emerald-900/80">This usually takes a few hours. {first ? 'Your number is activated as soon as it is confirmed.' : 'The amount goes on your balance once it is confirmed.'}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!c.payment.online && !c.payment.manual) {
    return <Notice tone="warn" title="Recharging is paused">Payments are not open right now. Please try again a little later.</Notice>;
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate();
      }}
    >
      <div>
        <p className="mb-2 text-[13px] font-medium text-slate-700">Amount</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setAmount(p);
                setCustom('');
              }}
              className={clsx(
                'h-12 rounded-xl text-[15px] font-semibold tabular-nums ring-1 transition',
                !custom && chosen === p ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-600' : 'bg-white text-slate-900 ring-slate-200 hover:ring-slate-300',
              )}
            >
              {formatBdt(p)}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <Input
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={`Another amount, ${formatBdt(min)} to ${formatBdt(c.recharge.max)}`}
            invalid={!!custom && (tooSmall || tooBig)}
            aria-label="Another amount"
          />
        </div>
        {first && <p className="mt-2 text-[13px] text-slate-500">The first recharge is at least {formatBdt(c.activation_min)}. All of it becomes your calling balance.</p>}
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium text-slate-700">Pay with</p>
        <div className="space-y-2">
          {c.payment.online && (
            <MethodOption on={how === 'online'} onSelect={() => setMethod('online')} icon={<CreditCard className="size-5" />} title="Card, bKash or Nagad" text="On a secure payment page; your balance updates right after." />
          )}
          {c.payment.manual && (
            <MethodOption
              on={how === 'manual'}
              onSelect={() => setMethod('manual')}
              icon={<Smartphone className="size-5" />}
              title="Send money yourself"
              text="Send by bKash or Nagad, then enter the transaction ID. We check it within a few hours."
            />
          )}
        </div>
      </div>

      {how === 'manual' && (
        <div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-[13.5px] whitespace-pre-line text-slate-700">{c.payment.manual_instructions}</p>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Sent by">
              <Select value={manual.channel} onChange={(e) => setManual((m) => ({ ...m, channel: e.target.value }))}>
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="rocket">Rocket</option>
                <option value="bank">Bank transfer</option>
              </Select>
            </Field>
            <Field label="Transaction ID">
              <Input value={manual.reference} onChange={(e) => setManual((m) => ({ ...m, reference: e.target.value.trim() }))} placeholder="e.g. 9JH4K2L8PQ" required minLength={3} maxLength={80} />
            </Field>
          </div>
        </div>
      )}

      {pay.error && <Notice tone="danger">{errorMessage(pay.error)}</Notice>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pay.isPending} disabled={tooSmall || tooBig || !how || (how === 'manual' && manual.reference.length < 3)}>
        {how === 'online' ? `Pay ${formatBdt(chosen)}` : `I've sent ${formatBdt(chosen)}`}
      </Button>
    </form>
  );
}

function MethodOption({ on, onSelect, icon, title, text }: { on: boolean; onSelect: () => void; icon: React.ReactNode; title: string; text: string }) {
  return (
    <label className={clsx('flex cursor-pointer items-center gap-3.5 rounded-xl px-4 py-3 ring-1 transition', on ? 'bg-brand-50/60 ring-2 ring-brand-600' : 'bg-white ring-slate-200 hover:ring-slate-300')}>
      <input type="radio" name="pay-method" checked={on} onChange={onSelect} className="sr-only" />
      <span className={clsx('flex size-10 shrink-0 items-center justify-center rounded-xl', on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold text-slate-950">{title}</span>
        <span className="block text-[13px] text-slate-500">{text}</span>
      </span>
    </label>
  );
}

const STATUS: Record<Recharge['status'], { label: string; tone: 'green' | 'amber' | 'gray' }> = {
  awaiting_payment: { label: 'Waiting for payment', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  applied: { label: 'Paid', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

/** Recharges, newest first; an unpaid one can be paid online or dropped (not while a payment is being checked). */
export function RechargeHistory({ inReview }: { inReview?: boolean }) {
  const list = useRecharges();
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: 'pay' | 'cancel' }) => {
      if (action === 'pay') {
        const { url } = await api.post<{ url: string }>(`/api/phone/recharges/${id}/pay-online`, { from: 'web' });
        window.location.assign(url);
      } else {
        await api.post(`/api/phone/recharges/${id}/cancel`);
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['phone'] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const config = usePhoneConfig();
  const rows = (list.data ?? []).filter((r) => r.status !== 'cancelled');
  if (!rows.length) return null;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => {
        const s = r.in_review ? { label: 'Checking your payment', tone: 'amber' as const } : STATUS[r.status];
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold tabular-nums text-slate-950">{formatBdt(r.amount)}</p>
              <p className="text-[12.5px] text-slate-500">
                {formatDateTime(r.created_at)} · {r.invoice_number}
              </p>
            </div>
            <Badge tone={s.tone}>{s.label}</Badge>
            {r.status === 'awaiting_payment' && !r.in_review && !inReview && (
              <div className="flex gap-1.5">
                {config.data?.payment.online && (
                  <Button size="sm" variant="primary" loading={act.isPending && act.variables?.id === r.id && act.variables.action === 'pay'} onClick={() => act.mutate({ id: r.id, action: 'pay' })}>
                    Pay
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, action: 'cancel' })}>
                  Cancel
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
