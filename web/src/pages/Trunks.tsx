import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useLive } from '../state/live';
import type { Trunk } from '../lib/types';
import { trunkState } from './Dashboard';
import { DestinationPicker } from '../components/DestinationPicker';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  NumberInput,
  PageHeader,
  Select,
  StatusDot,
  Toggle,
  useConfirm,
} from '../components/ui';

type Form = Omit<Trunk, 'id' | 'tenant_id' | 'endpoint' | 'registration' | 'reachability' | 'has_password'> & { shared: boolean };

const EMPTY: Form = {
  name: '',
  shared: false,
  host: '',
  port: 5060,
  transport: 'udp',
  auth_mode: 'register',
  username: '',
  auth_username: '',
  password: '',
  from_user: '',
  from_domain: '',
  contact_user: '',
  register_expiry: 300,
  match_ips: '',
  codecs: 'alaw,ulaw,g722',
  dtmf_mode: 'rfc4733',
  max_channels: 0,
  qualify: false,
  send_pai: false,
  outbound_proxy: '',
  default_dest_type: 'hangup',
  default_dest_target: '',
  enabled: true,
};

const MODE_LABEL = { register: 'Registration', outbound: 'Credentials', ip: 'IP authenticated' } as const;

export function TrunksPage() {
  const list = useList<Trunk>('trunks');
  const remove = useRemove('trunks', 'Trunk deleted');
  const confirm = useConfirm();
  const { user } = useAuth();
  const { groups } = useLive();
  const [editing, setEditing] = useState<Trunk | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="Phone lines"
        icon={<Server className="size-5" />}
        description="Your accounts with IP phone providers: calls to your numbers arrive on them"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add trunk
          </Button>
        }
      />
      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState
            icon={<Server className="size-5" />}
            title="No trunks yet"
            description="Add the SIP account your provider gave you (server, username, password). Envo registers to it and routes calls both ways."
            action={<Button variant="primary" onClick={() => setEditing('new')}>Add trunk</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Trunk</th>
                  <th>Server</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Channels</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((t) => {
                  const st = trunkState(t);
                  const canEdit = user?.role === 'superadmin' || t.tenant_id !== null;
                  return (
                    <tr key={t.id} className={clsx(!t.enabled && 'opacity-55')}>
                      <td>
                        <div className="font-medium text-slate-900">{t.name}</div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <span className="font-mono">{t.endpoint}</span>
                          {t.tenant_id === null && <Badge tone="violet">Shared</Badge>}
                        </div>
                      </td>
                      <td>
                        <div className="font-mono text-sm text-slate-700">
                          {t.host}:{t.port}
                        </div>
                        <div className="text-xs text-slate-500 uppercase">{t.transport}</div>
                      </td>
                      <td>
                        <div className="text-sm text-slate-700">{MODE_LABEL[t.auth_mode]}</div>
                        {t.username && <div className="font-mono text-xs text-slate-500">{t.username}</div>}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-2 text-sm">
                          <StatusDot tone={st.tone} pulse={st.tone === 'green'} />
                          {st.label}
                        </span>
                      </td>
                      <td className="text-sm text-slate-700">
                        <span className="tabular-nums">{groups[`envo_trunk/trunk${t.id}`] ?? 0}</span>
                        <span className="text-slate-400"> / {t.max_channels || '∞'}</span>
                      </td>
                      <td>
                        {canEdit && (
                          <div className="flex justify-end gap-0.5">
                            <IconButton label="Edit" onClick={() => setEditing(t)}>
                              <Pencil className="size-4" />
                            </IconButton>
                            <IconButton
                              label="Delete"
                              tone="danger"
                              onClick={async () => {
                                if (await confirm({ title: `Delete line "${t.name}"?`, message: 'Calls through this provider stop immediately. Calling rules that use it are updated.', confirmLabel: 'Delete', danger: true })) remove.mutate(t.id);
                              }}
                            >
                              <Trash2 className="size-4" />
                            </IconButton>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <TrunkModal trunk={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TrunkModal({ trunk, onClose }: { trunk: Trunk | null; onClose: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState<Form>(() => (trunk ? { ...EMPTY, ...trunk, password: '', shared: trunk.tenant_id === null } : { ...EMPTY }));
  const [advanced, setAdvanced] = useState(false);
  const save = useSave('trunks', { created: 'Trunk added', updated: 'Trunk saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const needsAuth = form.auth_mode !== 'ip';

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={trunk ? `Edit trunk · ${trunk.name}` : 'Add SIP trunk'}
      description="Use the SIP details from your provider"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name || !form.host}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: trunk?.id, data: form }).catch(() => null);
              if (ok) onClose();
            }}
          >
            {trunk ? 'Save trunk' : 'Add trunk'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Name" className="sm:col-span-6">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. IPTSP line 09612…" autoFocus />
        </Field>
        <Field label="SIP server (host or IP)" className="sm:col-span-3">
          <Input value={form.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="sip.provider.com" />
        </Field>
        <Field label="Port" className="sm:col-span-1">
          <NumberInput value={form.port} onChange={(v) => set('port', v)} min={1} max={65535} />
        </Field>
        <Field label="Transport" className="sm:col-span-2">
          <Select value={form.transport} onChange={(e) => set('transport', e.target.value as Form['transport'])}>
            <option value="udp">UDP</option>
            <option value="tcp">TCP</option>
            <option value="tls">TLS</option>
          </Select>
        </Field>
        <Field label="Authentication" className="sm:col-span-6">
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ['register', 'Register', 'Username + password, provider sends calls to our registration'],
                ['outbound', 'Credentials only', 'Password for outgoing calls, inbound by IP'],
                ['ip', 'IP based', 'No password; provider whitelists our IP'],
              ] as const
            ).map(([value, title, desc]) => (
              <button
                key={value}
                type="button"
                onClick={() => set('auth_mode', value)}
                className={clsx(
                  'rounded-xl border p-3 text-left transition',
                  form.auth_mode === value ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <div className="text-sm font-medium text-slate-900">{title}</div>
                <div className="mt-0.5 text-xs text-slate-500">{desc}</div>
              </button>
            ))}
          </div>
        </Field>
        {needsAuth && (
          <>
            <Field label="Username" className="sm:col-span-3" hint="Often your IP phone number">
              <Input value={form.username} onChange={(e) => set('username', e.target.value.trim())} autoComplete="off" />
            </Field>
            <Field label="Password" className="sm:col-span-3" hint={trunk?.has_password ? 'Leave empty to keep the saved password' : undefined}>
              <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" placeholder={trunk?.has_password ? '••••••••' : ''} />
            </Field>
          </>
        )}
        <Field label="Channels" className="sm:col-span-2" hint="Max simultaneous calls, 0 = unlimited">
          <NumberInput value={form.max_channels} onChange={(v) => set('max_channels', v)} min={0} />
        </Field>
        <Field label="Codecs" className="sm:col-span-4" hint="Most carriers: alaw,ulaw">
          <Input value={form.codecs} onChange={(e) => set('codecs', e.target.value)} />
        </Field>

        {form.shared === false && (
          <Field label="Calls that match no phone number go to" className="sm:col-span-6">
            <DestinationPicker type={form.default_dest_type} target={form.default_dest_target} onChange={(t, v) => setForm((f) => ({ ...f, default_dest_type: t, default_dest_target: v }))} />
          </Field>
        )}

        <div className="space-y-3 sm:col-span-6">
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enabled" />
          {user?.role === 'superadmin' && (
            <Toggle
              checked={form.shared}
              onChange={(v) => setForm((f) => ({ ...f, shared: v, default_dest_type: v ? 'hangup' : f.default_dest_type }))}
              label="Shared trunk"
              description="Owned by the platform and usable by every SIP server's outbound routes and numbers"
              disabled={!!trunk}
            />
          )}
        </div>

        <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 sm:col-span-6">
          <ChevronDown className={clsx('size-4 transition', advanced && 'rotate-180')} /> Advanced SIP settings
        </button>
        {advanced && (
          <>
            {needsAuth && (
              <Field label="Auth username" className="sm:col-span-3" hint="Only if different from username">
                <Input value={form.auth_username} onChange={(e) => set('auth_username', e.target.value.trim())} />
              </Field>
            )}
            <Field label="From user" className="sm:col-span-3" hint="Forces the From header user (caller ID)">
              <Input value={form.from_user} onChange={(e) => set('from_user', e.target.value.trim())} />
            </Field>
            <Field label="From domain" className="sm:col-span-3">
              <Input value={form.from_domain} onChange={(e) => set('from_domain', e.target.value.trim())} placeholder={form.auth_mode === 'register' ? form.host : ''} />
            </Field>
            {form.auth_mode === 'register' && (
              <>
                <Field label="Contact user" className="sm:col-span-3" hint="User in our Contact; inbound calls arrive to it">
                  <Input value={form.contact_user} onChange={(e) => set('contact_user', e.target.value.trim())} placeholder={form.username} />
                </Field>
                <Field label="Registration expiry (s)" className="sm:col-span-3">
                  <NumberInput value={form.register_expiry} onChange={(v) => set('register_expiry', v)} min={60} max={7200} />
                </Field>
              </>
            )}
            <Field label="Extra provider IPs" className="sm:col-span-6" hint="Other signalling IPs / CIDRs the provider sends calls from, comma separated">
              <Input value={form.match_ips} onChange={(e) => set('match_ips', e.target.value)} placeholder="203.0.113.10, 198.51.100.0/24" />
            </Field>
            <Field label="Outbound proxy" className="sm:col-span-3">
              <Input value={form.outbound_proxy} onChange={(e) => set('outbound_proxy', e.target.value.trim())} placeholder="proxy.provider.com:5060" />
            </Field>
            <Field label="DTMF mode" className="sm:col-span-3">
              <Select value={form.dtmf_mode} onChange={(e) => set('dtmf_mode', e.target.value as Form['dtmf_mode'])}>
                <option value="rfc4733">RFC 4733 (RTP events)</option>
                <option value="inband">In-band audio</option>
                <option value="info">SIP INFO</option>
                <option value="auto">Auto</option>
              </Select>
            </Field>
            <div className="space-y-3 sm:col-span-6">
              <Toggle checked={form.qualify} onChange={(v) => set('qualify', v)} label="Monitor with OPTIONS" description="Mark the trunk unreachable when the provider stops answering keep-alives" />
              <Toggle checked={form.send_pai} onChange={(v) => set('send_pai', v)} label="Send P-Asserted-Identity" description="Some carriers require it to accept your caller ID" />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
