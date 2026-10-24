import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Check, CreditCard } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatBdt, formatDateTime } from '../lib/format';
import { Badge, Button, Input, Notice } from '../components/ui';
import { usePhoneConfig, useRecharges, type Recharge } from './api';

/**
 * Choosing an amount and paying it on Enfinito Pay's page (bKash, Nagad, Rocket, cards and more).
 * `first` is the recharge that activates the number. `inReview`: a payment waits for support's check
 * (PhoneMe.payment_in_review), so nothing is paid twice.
 */
export function RechargePanel({ first, inReview }: { first?: boolean; inReview?: boolean }) {
  const config = usePhoneConfig();
  const qc = useQueryClient();
  const c = config.data;
  const min = c ? (first ? c.activation_min : c.recharge.min) : 0;
  const offered = (c?.recharge.presets ?? []).filter((p) => p >= min);
  // The first recharge offers its least amount first, keeping the number of amounts.
  const presets = first && c && !offered.includes(min) ? [min, ...offered].slice(0, Math.max(offered.length, 1)) : offered;
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const chosen = custom ? Number(custom) : (amount ?? presets[0] ?? min);
  const tooSmall = !!c && chosen < min;
  const tooBig = !!c && chosen > c.recharge.max;

  const pay = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ id: number }>('/api/phone/recharges', { amount: chosen });
      const { url } = await api.post<{ url: string }>(`/api/phone/recharges/${r.id}/pay-online`, { from: 'web' });
      window.location.assign(url);
    },
    // The payment page didn't open: the recharge was made, so it shows in the list to pay later.
    onError: () => void qc.invalidateQueries({ queryKey: ['phone'] }),
  });

  if (!c) return <div className="skeleton h-64 rounded-2xl" />;
  if (inReview) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-600/15">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check className="size-5" />
          </span>
          <div>
            <p className="font-semibold text-emerald-950">We're checking your payment.</p>
            <p className="text-[13.5px] text-emerald-900/80">This usually takes a few hours. {first ? 'Your number is activated as soon as it is confirmed.' : 'The amount goes on your balance once it is confirmed.'}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!c.payment.online) {
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

      <div className="flex items-center gap-3.5 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200">
          <CreditCard className="size-5" />
        </span>
        <p className="text-[13px] text-slate-600">You pay on Enfinito Pay's secure page: bKash, Nagad, Rocket, cards and more. Your balance updates right after.</p>
      </div>

      {pay.error && <Notice tone="danger">{errorMessage(pay.error)}</Notice>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pay.isPending} disabled={tooSmall || tooBig}>
        Pay {formatBdt(chosen)}
      </Button>
    </form>
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
