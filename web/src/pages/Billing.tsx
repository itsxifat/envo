import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, CreditCard, FileText, Receipt } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../state/auth';
import { ACCOUNT_STATUS, formatBdt, formatDate } from '../lib/format';
import type { CheckoutResult, Invoice, Package } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Notice, PageHeader, Textarea, useConfirm } from '../components/ui';
import { PaymentResult, PayDialog, PlanPicker } from '../components/billing';
import { BalanceCard } from '../components/numberSupply';
import { SETUP_STEPS, useSetupProgress } from './GetStarted';

const KIND: Record<string, string> = { subscription: 'Package', renewal: 'Renewal', upgrade: 'Upgrade', manual: 'Other', topup: 'Top-up' };

export function BillingPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { plan, user, refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const result = params.get('payment');
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [picking, setPicking] = useState(false);
  const invoices = useQuery({ queryKey: ['account', 'invoices'], queryFn: () => api.get<Invoice[]>('/api/account/billing/invoices') });
  const packages = useQuery({ queryKey: ['account', 'packages'], queryFn: () => api.get<Package[]>('/api/account/packages') });
  // Just paid for the first package: the setup is the next thing to do.
  const setup = useSetupProgress({ enabled: result === 'paid' && plan?.status === 'active', poll: false });
  const setupLeft = result === 'paid' && !!setup.done && setup.count < SETUP_STEPS.length;

  // Straight from sign-up: start paying for the package picked on the website.
  const chose = useRef(false);
  const choose = params.get('choose');
  useEffect(() => {
    if (!choose || chose.current || !user?.isOwner || plan?.subscription) return;
    chose.current = true;
    setParams({}, { replace: true });
    void api
      .post<CheckoutResult>('/api/account/billing/checkout', { package_id: Number(choose), months: 1 })
      .then((r) => {
        void qc.invalidateQueries({ queryKey: ['account'] });
        if (r.action === 'invoice') setPaying(r.invoice);
      })
      .catch((err) => toast.error(errorMessage(err)));
  }, [choose, user, plan, qc, setParams]);

  // Back from the payment page: the package may have changed.
  useEffect(() => {
    if (result) void refresh().then(() => qc.invalidateQueries({ queryKey: ['account'] }));
  }, [result, refresh, qc]);

  const cancel = useMutation({
    mutationFn: (value: boolean) => api.post('/api/account/billing/cancel', { cancel: value }),
    onSuccess: async (_d, value) => {
      await refresh();
      toast.success(value ? 'Your package ends with the current period' : 'Your package continues');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!user?.isOwner) {
    return (
      <>
        <PageHeader title="Billing & top-ups" icon={<CreditCard />} />
        <Notice tone="info">Only the account owner can see invoices, pay and top up. Ask them to renew or change the package.</Notice>
      </>
    );
  }

  const sub = plan?.subscription ?? null;
  const open = (invoices.data ?? []).filter((i) => i.status === 'unpaid');
  const status = plan ? ACCOUNT_STATUS[plan.status] : null;
  const nextName = sub?.nextPackageId ? packages.data?.find((p) => p.id === sub.nextPackageId)?.name : null;

  return (
    <>
      <PageHeader
        title="Billing & top-ups"
        description="Your package, invoices, payments and calling balance"
        icon={<CreditCard />}
        actions={
          sub && (
            <Button variant="primary" onClick={() => setPicking(true)}>
              Change package
            </Button>
          )
        }
      />
      <PaymentResult status={result} />
      {result && (
        <div className="-mt-3 mb-5">
          <button type="button" className="text-sm text-slate-500 underline-offset-2 hover:underline" onClick={() => setParams({})}>
            Dismiss
          </button>
        </div>
      )}
      {setupLeft && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-4 border-brand-200 p-4 sm:p-5">
          <div>
            <p className="font-semibold tracking-tight text-slate-950">Next: set up your phone system</p>
            <p className="mt-0.5 text-sm text-slate-500">Choose your number and add your team. It takes a few minutes.</p>
          </div>
          <Link to="/get-started">
            <Button variant="primary">
              Set it up <ArrowRight className="size-4" />
            </Button>
          </Link>
        </Card>
      )}

      {open.length > 0 && (
        <Card className="mb-5 overflow-hidden border-amber-200">
          <CardHeader title="To pay" description={plan?.status === 'suspended' ? 'Your phone system is paused until this is paid.' : 'Pay before the due date to keep everything running.'} />
          <ul className="divide-y divide-slate-100">
            {open.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">{inv.description}</div>
                  <div className="text-xs text-slate-500">
                    {inv.number} · due {formatDate(inv.due_at)}
                  </div>
                </div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{formatBdt(inv.amount)}</div>
                <Button variant="primary" onClick={() => setPaying(inv)}>
                  Pay now
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {sub ? (
        <Card className="mb-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Current package</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">{plan?.package?.name}</h2>
                {status && <Badge tone={status.tone}>{status.label}</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {formatBdt(sub.price)} per month · {sub.cancelAtPeriodEnd ? 'ends' : 'renews'} {formatDate(sub.currentPeriodEnd)}
              </p>
              {nextName && <p className="mt-1 text-sm text-slate-600">Moves to {nextName} at renewal.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/account">
                <Button>
                  Usage <ArrowRight className="size-3.5" />
                </Button>
              </Link>
              {sub.cancelAtPeriodEnd ? (
                <Button variant="success" loading={cancel.isPending} onClick={() => cancel.mutate(false)}>
                  Keep my package
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  loading={cancel.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Cancel your package?',
                        message: `Everything keeps working until ${formatDate(sub.currentPeriodEnd)}. After that your phone system stops; your settings are kept.`,
                        confirmLabel: 'Cancel at period end',
                        danger: true,
                      })
                    )
                      cancel.mutate(true);
                  }}
                >
                  Cancel package
                </Button>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mb-5 p-4 sm:p-5">
          <h2 className="mb-1 text-lg font-semibold tracking-tight text-slate-900">Choose your package</h2>
          <p className="mb-5 text-sm text-slate-500">Pick what fits your team. You can change it any time.</p>
          <PlanPicker onInvoice={setPaying} />
        </Card>
      )}

      {sub && <BalanceCard />}

      <Card className="overflow-hidden">
        <CardHeader title="Invoices" />
        {!invoices.data?.length ? (
          <EmptyState icon={<Receipt className="size-5" />} title="No invoices yet" description="Invoices for your package and renewals appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>For</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.data.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-mono text-[13px] text-slate-700">{inv.number}</td>
                    <td>
                      <div className="text-slate-800">{inv.description}</div>
                      <div className="text-xs text-slate-500">{KIND[inv.kind]}</div>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{formatDate(inv.created_at)}</td>
                    <td className="font-medium whitespace-nowrap text-slate-900 tabular-nums">{formatBdt(inv.amount)}</td>
                    <td>{inv.status === 'paid' ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">Unpaid</Badge>}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {inv.status === 'unpaid' && (
                          <Button size="sm" variant="primary" onClick={() => setPaying(inv)}>
                            Pay
                          </Button>
                        )}
                        <Link to={`/billing/invoices/${inv.id}`} className="inline-flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Open ${inv.number}`}>
                          <FileText className="size-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BillingDetails />

      {picking && (
        <Modal open onClose={() => setPicking(false)} size="xl" title="Change package" description="Upgrades start now; smaller packages start at your next renewal.">
          <PlanPicker
            onInvoice={(inv) => {
              setPicking(false);
              setPaying(inv);
            }}
            onDone={() => setPicking(false)}
          />
        </Modal>
      )}
      {paying && <PayDialog invoice={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

/** Company details printed on invoices; the email also receives billing messages. */
function BillingDetails() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['account'], queryFn: () => api.get<{ account: { name: string; email: string; phone: string; address: string } }>('/api/account') });
  const [form, setForm] = useState<{ name: string; email: string; phone: string; address: string } | null>(null);
  useEffect(() => {
    if (q.data && !form) setForm({ name: q.data.account.name, email: q.data.account.email, phone: q.data.account.phone, address: q.data.account.address });
  }, [q.data, form]);
  const save = useMutation({
    mutationFn: () => api.put('/api/account', form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account'] });
      toast.success('Billing details saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!form) return null;
  return (
    <Card className="mt-5 overflow-hidden">
      <CardHeader title="Billing details" description="Printed on your invoices. Billing emails go to this address." />
      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
        <Field label="Company name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Billing email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Address">
          <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <div className="sm:col-span-2 sm:flex sm:justify-end">
          <Button className="w-full sm:w-auto" loading={save.isPending} onClick={() => save.mutate()}>
            Save details
          </Button>
        </div>
      </div>
    </Card>
  );
}
