import { useState } from 'react';
import clsx from 'clsx';
import { Building2, Hash, Pencil, Plus, Server, Trash2, Users } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../state/auth';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useTenant } from '../state/tenant';
import { useLive } from '../state/live';
import type { AccountRow, Tenant } from '../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBlock, Field, IconButton, Input, LoadingBlock, Modal, NumberInput, PageHeader, Select, Textarea, Toggle, useConfirm } from '../components/ui';

type Form = Omit<Tenant, 'id' | 'extension_count' | 'number_count' | 'trunk_count'> & { quick: boolean; quick_start: string; quick_count: number; account_id?: number };
const EMPTY: Form = {
  name: '',
  slug: '',
  description: '',
  enabled: true,
  max_channels: 0,
  max_extensions: 0,
  outbound_cid: '',
  recording: 'all',
  timezone: 'Asia/Dhaka',
  language: 'en',
  quick: true,
  quick_start: '1001',
  quick_count: 5,
};

const TIMEZONES = ['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

export function ServersPage() {
  const list = useList<Tenant>('tenants', { global: true });
  const remove = useRemove('tenants', 'SIP server deleted');
  const confirm = useConfirm();
  const { setTenantId, tenantId } = useTenant();
  const { groups } = useLive();
  const { user, plan } = useAuth();
  const platform = user?.role === 'superadmin';
  const [editing, setEditing] = useState<Tenant | 'new' | null>(null);
  const atLimit = !!plan && plan.limits.max_servers !== null && (list.data?.length ?? 0) >= plan.limits.max_servers;

  return (
    <div>
      <PageHeader
        title="SIP servers"
        icon={<Building2 className="size-5" />}
        description={
          platform
            ? 'Each SIP server is an isolated PBX with its own extensions, numbers, routing and channel limit'
            : `Separate phone systems for your offices or brands${plan?.limits.max_servers != null ? ` · ${list.data?.length ?? 0} of ${plan.limits.max_servers} in your package` : ''}`
        }
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} disabled={atLimit} title={atLimit ? 'Your package limit is reached' : undefined}>
            New SIP server
          </Button>
        }
      />
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState icon={<Server className="size-5" />} title="No SIP servers" action={<Button variant="primary" onClick={() => setEditing('new')}>Create one</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((t) => {
            const used = groups[`envo_tenant/t${t.id}`] ?? 0;
            return (
              <Card key={t.id} className={clsx('flex flex-col p-5', !t.enabled && 'opacity-60', t.id === tenantId && 'ring-2 ring-brand-500/40')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-semibold text-white">
                      {t.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-slate-900">
                        {t.name}
                        {!t.enabled && <Badge>Disabled</Badge>}
                      </div>
                      <div className="font-mono text-xs text-slate-500">
                        {t.slug}
                        {platform && t.account_name && <span className="font-sans"> · {t.account_name}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    <IconButton label="Edit" onClick={() => setEditing(t)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    {(platform || user?.isOwner) && (
                    <IconButton
                      label="Delete"
                      tone="danger"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Delete SIP server "${t.name}"?`,
                            message: 'This permanently deletes its extensions, numbers, IVRs, queues, routes and users. Call history is kept.',
                            confirmLabel: 'Delete everything',
                            danger: true,
                          })
                        )
                          remove.mutate(t.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                    )}
                  </div>
                </div>
                {t.description && <p className="mt-3 text-sm text-slate-500">{t.description}</p>}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 py-2">
                    <Users className="mx-auto size-4 text-slate-400" />
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {t.extension_count}
                      {t.max_extensions ? <span className="text-slate-400">/{t.max_extensions}</span> : null}
                    </div>
                    <div className="text-[11px] text-slate-500">Extensions</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-2">
                    <Hash className="mx-auto size-4 text-slate-400" />
                    <div className="mt-1 text-sm font-semibold text-slate-900">{t.number_count}</div>
                    <div className="text-[11px] text-slate-500">Numbers</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-2">
                    <Server className="mx-auto size-4 text-slate-400" />
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {used}
                      <span className="text-slate-400">/{t.max_channels || (plan?.limits.max_channels ?? '∞')}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">Channels</div>
                  </div>
                </div>
                <div className="mt-auto pt-4">
                  <Button size="sm" className="w-full" variant={t.id === tenantId ? 'secondary' : 'dark'} disabled={t.id === tenantId} onClick={() => setTenantId(t.id)}>
                    {t.id === tenantId ? 'Currently managing' : 'Manage this server'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <ServerModal tenant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ServerModal({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => (tenant ? { ...EMPTY, ...tenant, quick: false } : { ...EMPTY }));
  const save = useSave<Tenant>('tenants', { created: 'SIP server created', updated: 'SIP server saved' });
  const qc = useQueryClient();
  const { setTenantId } = useTenant();
  const { user, plan } = useAuth();
  const platform = user?.role === 'superadmin';
  const noRecording = !!plan && plan.limits.recording_days === 0;
  const accounts = useQuery({ queryKey: ['admin', 'accounts', '', ''], queryFn: () => api.get<AccountRow[]>('/api/admin/accounts'), enabled: platform && !tenant });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={tenant ? `Edit · ${tenant.name}` : 'New SIP server'}
      description={tenant ? `Short name ${tenant.slug} (used in SIP usernames)` : 'A separate PBX: its own extensions, numbers, IVRs and limits'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name}
            onClick={async () => {
              const { quick, quick_start, quick_count, ...rest } = form;
              const data = { ...rest, slug: rest.slug || undefined, ...(!tenant && quick ? { quick_extensions: { start: quick_start, count: quick_count } } : {}) };
              const saved = await save.mutateAsync({ id: tenant?.id, data }).catch(() => null);
              if (!saved) return;
              await qc.invalidateQueries({ queryKey: ['list', 'tenants'] });
              if (!tenant) setTenantId(saved.id);
              onClose();
            }}
          >
            {tenant ? 'Save' : 'Create SIP server'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Acme Ltd" autoFocus />
        </Field>
        <Field label="Short name" hint="a-z and 0-9; part of every SIP username (1001_acme)">
          <Input value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} placeholder="auto from name" disabled={!!tenant} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} />
        </Field>
        {platform && !tenant && (
          <Field label="Customer" className="sm:col-span-2" hint="The account this SIP server belongs to">
            <Select value={form.account_id ?? ''} onChange={(e) => set('account_id', e.target.value ? Number(e.target.value) : undefined)}>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.internal ? ' (Enfinito)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {platform && (
          <>
            <Field label="Channels" hint="Max simultaneous outside calls, 0 = unlimited">
              <NumberInput value={form.max_channels} onChange={(v) => set('max_channels', v)} min={0} />
            </Field>
            <Field label="Max extensions" hint="0 = unlimited">
              <NumberInput value={form.max_extensions} onChange={(v) => set('max_extensions', v)} min={0} />
            </Field>
          </>
        )}
        <Field label="Default outbound caller ID" hint="Number shown when extensions call out">
          <Input value={form.outbound_cid} onChange={(e) => set('outbound_cid', e.target.value.replace(/[^\d+]/g, ''))} placeholder="09612345678" />
        </Field>
        <Field label="Call recording default" hint={noRecording ? 'Not included in your package' : undefined}>
          <Select value={noRecording ? 'off' : form.recording} disabled={noRecording} onChange={(e) => set('recording', e.target.value as Form['recording'])}>
            <option value="off">Off</option>
            <option value="inbound">Incoming calls</option>
            <option value="outbound">Outgoing calls</option>
            <option value="all">All calls (incoming, outgoing and internal)</option>
          </Select>
        </Field>
        <Field label="Timezone" hint="Used by time conditions and reports">
          <Select value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
            {[...new Set([form.timezone, ...TIMEZONES])].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prompt language">
          <Select value={form.language} onChange={(e) => set('language', e.target.value)}>
            <option value="en">English</option>
          </Select>
        </Field>
        <div className="space-y-3 sm:col-span-2">
          {platform && <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enabled" description="A disabled SIP server stops registering phones and taking calls" />}
          {!tenant && (
            <>
              <Toggle checked={form.quick} onChange={(v) => set('quick', v)} label="Create extensions now" description="Start with a block of ready-to-use extensions" />
              {form.quick && (
                <div className="grid grid-cols-2 gap-3 pl-12">
                  <Field label="First number">
                    <Input value={form.quick_start} onChange={(e) => set('quick_start', e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <Field label="How many">
                    <NumberInput value={form.quick_count} onChange={(v) => set('quick_count', v)} min={1} max={200} />
                  </Field>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
