import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Clock, CreditCard, Landmark, Play } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { BillingSettings } from '../../lib/types';
import { Button, Card, CardHeader, ErrorBlock, Field, Input, LoadingBlock, Notice, NumberInput, PageHeader, Textarea, Toggle } from '../../components/ui';

export function BillingSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'billing', 'settings'], queryFn: () => api.get<BillingSettings>('/api/admin/billing/settings') });
  const [form, setForm] = useState<BillingSettings | null>(null);
  useEffect(() => {
    if (q.data && !form) setForm(q.data);
  }, [q.data, form]);
  const save = useMutation({
    mutationFn: (data: BillingSettings) => api.put<BillingSettings>('/api/admin/billing/settings', data),
    onSuccess: (saved) => {
      setForm(saved);
      void qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
      toast.success('Payment settings saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const clock = useMutation({
    mutationFn: () => api.post<Record<string, number>>('/api/admin/billing/run-clock'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success(`Done: ${r.invoiced} renewal invoice(s), ${r.suspended} suspended, ${r.reconciled} payment(s) settled`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isLoading || !form) return q.error ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  const s = form.sslcommerz;
  const setS = (patch: Partial<BillingSettings['sslcommerz']>) => setForm({ ...form, sslcommerz: { ...s, ...patch } });

  return (
    <>
      <Link to="/admin/sales" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Sales
      </Link>
      <PageHeader
        title="Payment settings"
        description="How customers pay, and when unpaid accounts stop"
        icon={<CreditCard />}
        actions={
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>
            Save settings
          </Button>
        }
      />
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="SSLCommerz" description="Cards, bKash, Nagad, Rocket and internet banking on one payment page" />
          <div className="space-y-4 p-4 sm:p-5">
            <Toggle checked={s.enabled} onChange={(v) => setS({ enabled: v })} label="Accept online payments" />
            <Toggle checked={s.sandbox} onChange={(v) => setS({ sandbox: v })} label="Sandbox (test mode)" description="No real money moves. Turn off with your live store ID." />
            {s.sandbox && s.store_id === 'testbox' && <Notice tone="info">You are using SSLCommerz's public test store. Test card: 4111 1111 1111 1111, 12/26, CVV 111, OTP 111111.</Notice>}
            {!s.sandbox && s.enabled && <Notice tone="warn">Live mode: customers are charged for real.</Notice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Store ID">
                <Input value={s.store_id} onChange={(e) => setS({ store_id: e.target.value.trim() })} placeholder="yourstore0live" autoComplete="off" />
              </Field>
              <Field label="Store password" hint={s.has_passwd ? 'Saved; leave empty to keep it' : 'From your SSLCommerz merchant panel'}>
                <Input type="password" value={s.store_passwd} onChange={(e) => setS({ store_passwd: e.target.value })} placeholder={s.has_passwd ? '••••••••' : ''} autoComplete="new-password" />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              Payments are confirmed directly with SSLCommerz (never trusted from the browser). If your merchant panel asks for an IPN address, use your dashboard address followed by <span className="font-mono">/api/public/sslcommerz/ipn</span>.
            </p>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Manual payments" description="bKash, Nagad or bank transfers you confirm yourself" />
          <div className="space-y-4 p-4 sm:p-5">
            <Toggle checked={form.manual.enabled} onChange={(v) => setForm({ ...form, manual: { ...form.manual, enabled: v } })} label="Accept manual payments" />
            <Field label="Instructions shown to customers" hint="Your bKash/Nagad merchant numbers or bank account, and what to write as reference">
              <Textarea rows={5} value={form.manual.instructions} onChange={(e) => setForm({ ...form, manual: { ...form.manual, instructions: e.target.value } })} />
            </Field>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Renewals and unpaid accounts" />
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Issue renewal invoices (days before)" hint="Customers see them in Billing">
                <NumberInput value={form.renewal_notice_days} onChange={(v) => setForm({ ...form, renewal_notice_days: Math.min(60, Math.max(1, v)) })} min={1} max={60} />
              </Field>
              <Field label="Grace period (days after)" hint="Then the account is suspended">
                <NumberInput value={form.grace_days} onChange={(v) => setForm({ ...form, grace_days: Math.min(60, Math.max(0, v)) })} min={0} max={60} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3.5">
              <Clock className="size-4 text-slate-400" />
              <span className="min-w-0 flex-1 text-[13px] text-slate-600">This runs every hour by itself.</span>
              <Button size="sm" icon={<Play className="size-3.5" />} loading={clock.isPending} onClick={() => clock.mutate()}>
                Run now
              </Button>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Your business on invoices" />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <Field label="Business name">
              <Input value={form.business.name} onChange={(e) => setForm({ ...form, business: { ...form.business, name: e.target.value } })} />
            </Field>
            <Field label="Phone">
              <Input value={form.business.phone} onChange={(e) => setForm({ ...form, business: { ...form.business, phone: e.target.value } })} />
            </Field>
            <Field label="Email" className="sm:col-span-2">
              <Input value={form.business.email} onChange={(e) => setForm({ ...form, business: { ...form.business, email: e.target.value } })} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea rows={2} value={form.business.address} onChange={(e) => setForm({ ...form, business: { ...form.business, address: e.target.value } })} />
            </Field>
          </div>
        </Card>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
        <Landmark className="size-3.5" /> Currency: Bangladeshi taka (BDT).
      </p>
    </>
  );
}
