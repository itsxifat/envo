import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeDollarSign, EyeOff, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { IVR_TIER_LABELS, formatBdt, limitLabel } from '../../lib/format';
import type { IvrTier, Package } from '../../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBlock, Field, IconButton, Input, LoadingBlock, Modal, NumberInput, PageHeader, Select, Toggle, useConfirm } from '../../components/ui';

type Form = Omit<Package, 'id' | 'subscribers'>;

const EMPTY: Form = {
  name: '',
  slug: '',
  tagline: '',
  price_monthly: '0',
  public: true,
  highlight: false,
  sort_order: 100,
  active: true,
  max_servers: 1,
  max_dids: 1,
  max_extensions: 5,
  max_channels: 1,
  max_ivrs: 1,
  recording_days: 0,
  recording_mb: 0,
  ivr_tier: 'basic',
  call_monitoring: false,
  api_access: false,
  display_rows: [],
};

/** Number field with an "Unlimited" switch (null). */
function LimitField({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: string }) {
  const unlimited = value === null;
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <NumberInput value={unlimited ? NaN : value} onChange={(v) => onChange(Math.max(0, v))} min={0} disabled={unlimited} placeholder={unlimited ? 'Unlimited' : undefined} className="min-w-0 flex-1" />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[13px] text-slate-600 select-none">
          <input type="checkbox" className="size-4 accent-brand-600" checked={unlimited} onChange={(e) => onChange(e.target.checked ? null : 0)} />
          Unlimited
        </label>
      </div>
    </Field>
  );
}

function PackageEditor({ pkg, onClose }: { pkg: Package | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => (pkg ? { ...pkg } : EMPTY));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, price_monthly: form.price_monthly === null || form.price_monthly === '' ? null : Number(form.price_monthly) };
      return pkg ? api.put(`/api/admin/packages/${pkg.id}`, body) : api.post('/api/admin/packages', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'packages'] });
      toast.success(pkg ? 'Package saved' : 'Package created');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const custom = form.price_monthly === null;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={pkg ? `Edit ${pkg.name}` : 'New package'}
      description={pkg && (pkg.subscribers ?? 0) > 0 ? `${pkg.subscribers} customer(s) are on this package: changes apply to them right away.` : 'Limits are enforced as customers add things; their SIP servers follow the channel cap live.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!form.name || !form.slug} onClick={() => save.mutate()}>
            {pkg ? 'Save package' : 'Create package'}
          </Button>
        </>
      }
    >
      <div className="space-y-7">
        <section className="grid gap-4 sm:grid-cols-6">
          <Field label="Name" className="sm:col-span-3">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Business PBX" />
          </Field>
          <Field label="Short name" hint="Used in links; letters, digits, dashes" className="sm:col-span-3">
            <Input value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="business" />
          </Field>
          <Field label="Ideal for" className="sm:col-span-3">
            <Input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Growing teams" />
          </Field>
          <Field label="Price per month (BDT)" className="sm:col-span-3">
            <div className="flex items-center gap-3">
              <NumberInput value={custom ? NaN : Number(form.price_monthly)} onChange={(v) => set('price_monthly', String(Math.max(0, v)))} disabled={custom} placeholder={custom ? 'Custom' : undefined} className="min-w-0 flex-1" />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[13px] text-slate-600 select-none">
                <input type="checkbox" className="size-4 accent-brand-600" checked={custom} onChange={(e) => set('price_monthly', e.target.checked ? null : '0')} />
                Custom ("Contact us")
              </label>
            </div>
          </Field>
        </section>

        <section>
          <h4 className="mb-3 text-[13px] font-semibold text-slate-900">Limits</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <LimitField label="SIP servers" value={form.max_servers} onChange={(v) => set('max_servers', v)} />
            <LimitField label="IP numbers (DIDs)" value={form.max_dids} onChange={(v) => set('max_dids', v)} />
            <LimitField label="Extensions" value={form.max_extensions} onChange={(v) => set('max_extensions', v)} />
            <LimitField label="Concurrent call channels" value={form.max_channels} onChange={(v) => set('max_channels', v)} hint="Across all SIP servers of the customer" />
            <LimitField label="IVR menus" value={form.max_ivrs} onChange={(v) => set('max_ivrs', v)} />
            <Field label="IVR level" hint="Shown on the pricing page">
              <Select value={form.ivr_tier} onChange={(e) => set('ivr_tier', e.target.value as IvrTier)}>
                {Object.entries(IVR_TIER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-[13px] font-semibold text-slate-900">Call recording</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Keep recordings for (days)" hint="0 = recording not included">
              <NumberInput value={form.recording_days} onChange={(v) => set('recording_days', Math.max(0, v))} min={0} max={3650} />
            </Field>
            <LimitField label="Storage (MB)" value={form.recording_mb} onChange={(v) => set('recording_mb', v)} hint="Oldest recordings are removed when full" />
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <Toggle checked={form.call_monitoring} onChange={(v) => set('call_monitoring', v)} label="Live call monitoring" description="Live calls page and hang-up control" />
          <Toggle checked={form.api_access} onChange={(v) => set('api_access', v)} label="Developer API access" description="API keys, webhooks and the embeddable phone" />
          <Toggle checked={form.public} onChange={(v) => set('public', v)} label="Show on the pricing page" description="Off for private or custom deals" />
          <Toggle checked={form.highlight} onChange={(v) => set('highlight', v)} label='"Most popular" badge' />
          <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Available" description="Off: no new customers; existing ones keep it" />
          <Field label="Order on the pricing page">
            <NumberInput value={form.sort_order} onChange={(v) => set('sort_order', v)} min={0} />
          </Field>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-[13px] font-semibold text-slate-900">Extra pricing-table rows</h4>
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set('display_rows', [...form.display_rows, { label: '', value: '' }])} disabled={form.display_rows.length >= 12}>
              Add row
            </Button>
          </div>
          {form.display_rows.length === 0 && <p className="text-sm text-slate-500">For things the package says but the system does not enforce, like "Call charge · BDT 0.40 / min".</p>}
          <div className="space-y-2">
            {form.display_rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={r.label} placeholder="Call charge" onChange={(e) => set('display_rows', form.display_rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input value={r.value} placeholder="BDT 0.40 / min" onChange={(e) => set('display_rows', form.display_rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <IconButton label="Remove row" tone="danger" onClick={() => set('display_rows', form.display_rows.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </IconButton>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function LimitLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 tabular-nums">{value}</span>
    </div>
  );
}

export function PackagesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ['admin', 'packages'], queryFn: () => api.get<Package[]>('/api/admin/packages') });
  const [editing, setEditing] = useState<Package | null | 'new'>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/packages/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'packages'] });
      toast.success('Package deleted');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <>
      <PageHeader
        title="Packages"
        description="What customers can buy and what each package allows"
        icon={<BadgeDollarSign />}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New package
          </Button>
        }
      />
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState icon={<BadgeDollarSign className="size-5" />} title="No packages yet" description="Create the packages customers can sign up for." action={<Button variant="primary" onClick={() => setEditing('new')}>New package</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.data.map((p) => (
            <Card key={p.id} className={clsx('flex flex-col p-5', p.highlight && 'ring-2 ring-brand-500/40', !p.active && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{p.name}</h3>
                    {p.highlight && (
                      <Badge tone="brand">
                        <Star className="size-3" /> Popular
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{p.tagline || '—'}</p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <IconButton label="Edit" onClick={() => setEditing(p)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Delete"
                    tone="danger"
                    onClick={async () => {
                      if (await confirm({ title: `Delete ${p.name}?`, message: 'Only packages nobody uses can be deleted.', confirmLabel: 'Delete package', danger: true })) remove.mutate(p.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-semibold tracking-tight text-slate-900">{p.price_monthly === null ? 'Custom' : formatBdt(p.price_monthly)}</span>
                {p.price_monthly !== null && <span className="text-sm text-slate-500">/ month</span>}
              </div>
              <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                <LimitLine label="Extensions" value={limitLabel(p.max_extensions)} />
                <LimitLine label="Channels" value={limitLabel(p.max_channels)} />
                <LimitLine label="Numbers · servers" value={`${limitLabel(p.max_dids)} · ${limitLabel(p.max_servers)}`} />
                <LimitLine label="Recording" value={p.recording_days ? `${p.recording_days} d · ${limitLabel(p.recording_mb, 'MB')}` : 'Not included'} />
                <LimitLine label="IVR" value={`${IVR_TIER_LABELS[p.ivr_tier]} · ${limitLabel(p.max_ivrs)}`} />
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
                <Badge tone={p.subscribers ? 'green' : 'gray'}>{p.subscribers ?? 0} customers</Badge>
                {!p.public && (
                  <Badge>
                    <EyeOff className="size-3" /> Hidden
                  </Badge>
                )}
                {!p.active && <Badge tone="amber">Not available</Badge>}
                {p.call_monitoring && <Badge tone="blue">Monitoring</Badge>}
                {p.api_access && <Badge tone="violet">API</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <PackageEditor pkg={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
