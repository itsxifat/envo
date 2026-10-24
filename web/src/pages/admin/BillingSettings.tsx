import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Clock, CreditCard, Landmark, Play, XCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { BillingSettings } from '../../lib/types';
import { Badge, Button, Card, CardHeader, CopyField, ErrorBlock, Field, Input, LoadingBlock, Notice, NumberInput, PageHeader, Textarea, Toggle } from '../../components/ui';

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
  const check = useMutation({
    mutationFn: (secret_key: string) => api.post<{ ok: boolean; message: string; mode: 'test' | 'live' | null }>('/api/admin/billing/settings/enfinito-pay/check', { secret_key }),
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
  const e = form.enfinito_pay;
  const setE = (patch: Partial<BillingSettings['enfinito_pay']>) => setForm({ ...form, enfinito_pay: { ...e, ...patch } });
  const typedMode = e.secret_key.startsWith('sk_live_') ? 'live' : e.secret_key.startsWith('sk_test_') ? 'test' : null;
  const mode = typedMode ?? (e.has_secret_key ? e.key_mode : null);

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
          <CardHeader
            title="Enfinito Pay"
            description="The only way customers pay, in the app and on the website: bKash, Nagad, Rocket, cards and internet banking on pay.enfinito.com"
            actions={mode && <Badge tone={mode === 'live' ? 'green' : 'amber'}>{mode === 'live' ? 'Live' : 'Test mode'}</Badge>}
          />
          <div className="space-y-4 p-4 sm:p-5">
            <Toggle checked={e.enabled} onChange={(v) => setE({ enabled: v })} label="Take payments through Enfinito Pay" description="Cash you receive can still be marked paid in Sales" />
            {(!e.enabled || (!e.has_secret_key && !e.secret_key)) && <Notice tone="warn">Customers cannot pay until this is on and its secret key is saved.</Notice>}
            {e.enabled && mode === 'live' && <Notice tone="warn">Live key: customers are charged for real.</Notice>}
            {e.enabled && mode === 'test' && <Notice tone="info">Test key: payments run against the sandbox and no real money moves.</Notice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Secret key" hint={e.has_secret_key ? 'Saved; leave empty to keep it' : 'From the Enfinito Pay admin: sk_test_… or sk_live_…'}>
                <Input type="password" value={e.secret_key} onChange={(ev) => setE({ secret_key: ev.target.value.trim() })} placeholder={e.has_secret_key ? '••••••••' : 'sk_live_…'} autoComplete="new-password" />
              </Field>
              <Field label="Webhook signing secret" hint={e.has_webhook_secret ? 'Saved; leave empty to keep it' : 'whsec_…, shown with the webhook settings'}>
                <Input type="password" value={e.webhook_secret} onChange={(ev) => setE({ webhook_secret: ev.target.value.trim() })} placeholder={e.has_webhook_secret ? '••••••••' : 'whsec_…'} autoComplete="new-password" />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" loading={check.isPending} disabled={!e.secret_key && !e.has_secret_key} onClick={() => check.mutate(e.secret_key)}>
                Check the key
              </Button>
              {check.data && (
                <span className={check.data.ok ? 'flex items-center gap-1.5 text-[13px] text-emerald-700' : 'flex items-center gap-1.5 text-[13px] text-rose-700'}>
                  {check.data.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                  {check.data.ok ? `The key works (${check.data.mode === 'live' ? 'live' : 'test mode'})` : check.data.message}
                </span>
              )}
            </div>
            <div className="space-y-3 rounded-xl bg-slate-50 p-3.5">
              <p className="text-[13px] text-slate-600">In the Enfinito Pay admin, give the Envo product these two:</p>
              <CopyField label="Webhook URL" value={e.webhook_url ?? `${window.location.origin}/api/public/enfinito-pay/webhook`} />
              <CopyField label="Return domain" value={e.return_domain ?? window.location.host} />
            </div>
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
