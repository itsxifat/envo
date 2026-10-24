import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Banknote, Check, Plus, Receipt, Settings2, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { formatBdt, formatDate, formatDateTime, paymentMethodLabel } from '../../lib/format';
import type { AccountRow, BillingOverview, Invoice, PaymentRow } from '../../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, Modal, NumberInput, PageHeader, Select, Stat, TableSkeleton, Tabs, useConfirm } from '../../components/ui';

/** Twelve months of collected revenue as columns; the latest month is emphasised. */
function RevenueChart({ data }: { data: BillingOverview['by_month'] }) {
  const months = useMemo(() => {
    const out: { key: string; label: string; amount: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push({ key, label: d.toLocaleDateString(undefined, { month: 'short' }), amount: Number(data.find((m) => m.month === key)?.amount ?? 0) });
    }
    return out;
  }, [data]);
  const max = Math.max(...months.map((m) => m.amount), 1);
  return (
    <div className="flex h-44 items-end gap-1.5 sm:gap-3" role="img" aria-label="Revenue collected per month for the last 12 months">
      {months.map((m, i) => {
        const last = i === months.length - 1;
        return (
          <div key={m.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="text-[10px] font-medium whitespace-nowrap text-slate-500 tabular-nums max-sm:hidden">{m.amount ? `৳${Math.round(m.amount / 1000) >= 1 ? `${(m.amount / 1000).toFixed(1)}k` : Math.round(m.amount)}` : ''}</div>
            <div className="flex h-32 w-full items-end">
              <div className={`w-full rounded-t-md ${last ? 'bg-brand-600' : 'bg-brand-200'}`} style={{ height: `${Math.max(m.amount ? 4 : 1.5, (m.amount / max) * 100)}%` }} title={`${m.label}: ${formatBdt(m.amount)}`} />
            </div>
            <div className={`text-[11px] ${last ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{m.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function NewInvoice({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['admin', 'accounts', '', ''], queryFn: () => api.get<AccountRow[]>('/api/admin/accounts') });
  const [form, setForm] = useState({ account_id: '', description: '', amount: 0 });
  const save = useMutation({
    mutationFn: () => api.post('/api/admin/billing/invoices', { account_id: Number(form.account_id), description: form.description, amount: form.amount }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
      toast.success('Invoice created; the customer sees it in Billing');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New invoice"
      description="For setup fees, extra numbers or anything outside a package"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!form.account_id || form.description.length < 2} onClick={() => save.mutate()}>
            Create invoice
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Customer">
          <Select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">Choose…</option>
            {accounts.data
              ?.filter((a) => !a.internal)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Setup and phone configuration" />
        </Field>
        <Field label="Amount (BDT)">
          <NumberInput value={form.amount} onChange={(v) => setForm({ ...form, amount: Math.max(0, v) })} min={0} />
        </Field>
      </div>
    </Modal>
  );
}

const PAY_STATUS: Record<string, ['green' | 'amber' | 'red' | 'gray', string]> = {
  succeeded: ['green', 'Paid'],
  pending_review: ['amber', 'To confirm'],
  initiated: ['gray', 'Started'],
  failed: ['red', 'Failed'],
  cancelled: ['gray', 'Cancelled'],
  refunded: ['gray', 'Refunded'],
};

export function SalesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [invoiceFilter, setInvoiceFilter] = useState<'' | 'unpaid' | 'paid'>('');
  const [creating, setCreating] = useState(false);
  const overview = useQuery({ queryKey: ['admin', 'billing', 'overview'], queryFn: () => api.get<BillingOverview>('/api/admin/billing/overview') });
  const toReview = useQuery({ queryKey: ['admin', 'billing', 'payments', 'pending_review'], queryFn: () => api.get<PaymentRow[]>('/api/admin/billing/payments?status=pending_review') });
  const payments = useQuery({ queryKey: ['admin', 'billing', 'payments', 'all'], queryFn: () => api.get<PaymentRow[]>('/api/admin/billing/payments') });
  const invoices = useQuery({
    queryKey: ['admin', 'billing', 'invoices', invoiceFilter],
    queryFn: () => api.get<Invoice[]>(`/api/admin/billing/invoices?status=${invoiceFilter}`),
    placeholderData: (prev) => prev,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(path, body ?? {}),
    onSuccess: (_d, v) => {
      refresh();
      toast.success(v.path.includes('approve') ? 'Payment confirmed; the package is active' : v.path.includes('reject') ? 'Payment rejected' : v.path.includes('void') ? 'Invoice cancelled' : 'Marked as paid');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const o = overview.data;
  const lastMonth = Number(o?.collected_last_month ?? 0);
  const thisMonth = Number(o?.collected_month ?? 0);

  return (
    <>
      <PageHeader
        title="Sales"
        description="Revenue, invoices and payments across all customers"
        icon={<Receipt />}
        actions={
          <>
            <Link to="/admin/billing-settings">
              <Button icon={<Settings2 className="size-4" />}>Payment settings</Button>
            </Link>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New invoice
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Monthly recurring revenue" value={formatBdt(o?.mrr ?? 0)} sub={`${o?.active_customers ?? 0} paying customers`} />
        <Stat label="Collected this month" value={formatBdt(thisMonth)} sub={lastMonth ? `${formatBdt(lastMonth)} last month` : 'Nothing last month'} tone="blue" />
        <Stat label="Outstanding" value={formatBdt(o?.outstanding ?? 0)} sub={`${o?.overdue ?? 0} overdue invoice${o?.overdue === 1 ? '' : 's'}`} tone="amber" />
        <Stat label="Customers" value={`${o?.active_customers ?? 0}`} sub={`${o?.new_this_month ?? 0} new · ${o?.suspended_customers ?? 0} suspended · ${o?.pending_customers ?? 0} awaiting payment`} tone="violet" />
      </div>

      {(toReview.data?.length ?? 0) > 0 && (
        <Card className="mt-4 overflow-hidden border-amber-200 sm:mt-6">
          <CardHeader title={`Payments to confirm (${toReview.data!.length})`} description="Look the payment up in Enfinito Pay's admin by its transaction id, then confirm or reject it. Confirming activates what was bought." />
          <ul className="divide-y divide-slate-100">
            {toReview.data!.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">
                    {p.account_name} · {formatBdt(p.amount)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {paymentMethodLabel(p)}
                    {p.bank_tran_id ? ` · Transaction ${p.bank_tran_id}` : ''}
                    {p.note ? ` · "${p.note}"` : ''} · {p.invoice_number} · {formatDateTime(p.created_at)}
                  </div>
                </div>
                <Button size="sm" variant="success" icon={<Check className="size-3.5" />} onClick={() => act.mutate({ path: `/api/admin/billing/payments/${p.id}/approve` })}>
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<X className="size-3.5" />}
                  onClick={async () => {
                    if (await confirm({ title: 'Reject this payment?', message: 'The invoice stays unpaid and the customer can pay again.', confirmLabel: 'Reject', danger: true }))
                      act.mutate({ path: `/api/admin/billing/payments/${p.id}/reject` });
                  }}
                >
                  Reject
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 xl:grid-cols-5">
        <Card className="p-5 xl:col-span-3">
          <h3 className="mb-4 text-[15px] font-semibold tracking-tight text-slate-900">Collected per month</h3>
          <RevenueChart data={o?.by_month ?? []} />
        </Card>
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title="Latest payments" />
          {!payments.data?.length ? (
            <EmptyState icon={<Banknote className="size-5" />} title="No payments yet" />
          ) : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {payments.data.slice(0, 20).map((p) => {
                const [tone, label] = PAY_STATUS[p.status] ?? ['gray', p.status];
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-800">{p.account_name}</div>
                      <div className="truncate text-xs text-slate-500">
                        {paymentMethodLabel(p)} · {formatDateTime(p.updated_at)}
                      </div>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{formatBdt(p.amount)}</span>
                    <Badge tone={tone}>{label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden sm:mt-6">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">Invoices</h3>
          <Tabs
            value={invoiceFilter}
            onChange={setInvoiceFilter}
            tabs={[
              { value: '', label: 'All' },
              { value: 'unpaid', label: 'Unpaid' },
              { value: 'paid', label: 'Paid' },
            ]}
          />
        </div>
        {invoices.isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : !invoices.data?.length ? (
          <EmptyState icon={<Receipt className="size-5" />} title="No invoices" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>For</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.data.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <div className="font-mono text-[13px] text-slate-700">{inv.number}</div>
                      <div className="text-xs text-slate-400">{formatDate(inv.created_at)}</div>
                    </td>
                    <td>
                      <Link to={`/admin/customers/${inv.account_id}`} className="text-slate-800 hover:text-brand-700">
                        {inv.account_name}
                      </Link>
                    </td>
                    <td className="text-slate-600">{inv.description}</td>
                    <td className="font-medium whitespace-nowrap tabular-nums">{formatBdt(inv.amount)}</td>
                    <td>
                      {inv.status === 'paid' ? (
                        <Badge tone="green">Paid {formatDate(inv.paid_at)}</Badge>
                      ) : inv.status === 'void' ? (
                        <Badge>Cancelled</Badge>
                      ) : new Date(inv.due_at) < new Date() ? (
                        <Badge tone="red">Overdue</Badge>
                      ) : (
                        <Badge tone="amber">Due {formatDate(inv.due_at)}</Badge>
                      )}
                    </td>
                    <td>
                      {inv.status === 'unpaid' && (
                        <div className="row-actions flex justify-end gap-0.5">
                          <IconButton
                            label="Record cash or offline payment"
                            tone="brand"
                            onClick={async () => {
                              if (await confirm({ title: `Mark ${inv.number} as paid?`, message: `Records ${formatBdt(inv.amount)} received outside the system and activates what it bought.`, confirmLabel: 'Mark as paid' }))
                                act.mutate({ path: `/api/admin/billing/invoices/${inv.id}/mark-paid`, body: { channel: 'cash' } });
                            }}
                          >
                            <Banknote className="size-4" />
                          </IconButton>
                          <IconButton
                            label="Cancel invoice"
                            tone="danger"
                            onClick={async () => {
                              if (await confirm({ title: `Cancel ${inv.number}?`, confirmLabel: 'Cancel invoice', danger: true })) act.mutate({ path: `/api/admin/billing/invoices/${inv.id}/void` });
                            }}
                          >
                            <Ban className="size-4" />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <NewInvoice onClose={() => setCreating(false)} />}
    </>
  );
}
