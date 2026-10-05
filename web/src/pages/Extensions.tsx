import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Globe, KeyRound, Mail, Monitor, Pencil, Phone, Plus, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import { api, errorMessage, scoped } from '../lib/api';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useTenant } from '../state/tenant';
import { useContactsByEndpoint, useExtStates } from '../state/live';
import { usePhone } from '../phone/PhoneProvider';
import type { Extension, LiveContact } from '../lib/types';
import { ExtensionPeople, MyPhoneSetup, useNextExtensionNumber } from '../components/people';
import {
  Badge,
  Button,
  Card,
  CopyField,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  Notice,
  NumberInput,
  PageHeader,
  SearchInput,
  SectionTitle,
  Select,
  Tabs,
  Toggle,
  useConfirm,
} from '../components/ui';

type Form = Omit<Extension, 'id' | 'tenant_id' | 'sip_username' | 'sip_password' | 'provisioning'> & { sip_username?: string };

const EMPTY: Form = {
  number: '',
  name: '',
  webrtc: true,
  max_contacts: 3,
  codecs: 'g722,ulaw,alaw,opus',
  outbound_cid: '',
  allow_outbound: true,
  voicemail: true,
  voicemail_pin: '',
  email: '',
  recording: 'inherit',
  ring_timeout: 25,
  dnd: false,
  forward_always: '',
  forward_busy: '',
  forward_noanswer: '',
  enabled: true,
};

const STATE_BADGE: Record<string, { tone: 'green' | 'red' | 'amber' | 'violet' | 'gray'; label: string }> = {
  idle: { tone: 'green', label: 'Available' },
  inuse: { tone: 'red', label: 'On a call' },
  busy: { tone: 'red', label: 'Busy' },
  ringing: { tone: 'amber', label: 'Ringing' },
  onhold: { tone: 'violet', label: 'On hold' },
};

function deviceLabel(c: LiveContact): string {
  const ua = c.userAgent || 'SIP device';
  const ip = c.via.split(':')[0] || (/@([^:;>]+)/.exec(c.uri)?.[1] ?? '');
  return `${ua}${ip ? ` · ${ip}` : ''}${c.rttMs ? ` · ${c.rttMs} ms` : ''}`;
}

export function ExtensionsPage() {
  const { tenantId, tenant } = useTenant();
  const list = useList<Extension>('extensions');
  const contacts = useContactsByEndpoint();
  const states = useExtStates(tenantId);
  const phone = usePhone();
  const remove = useRemove('extensions', 'Extension deleted');
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Extension | 'new' | null>(null);
  const [setup, setSetup] = useState<{ ext: Extension; tab: SetupTab } | null>(null);
  const [bulk, setBulk] = useState(false);

  const rows = useMemo(
    () => (list.data ?? []).filter((e) => !q || `${e.number} ${e.name} ${e.sip_username}`.toLowerCase().includes(q.toLowerCase())),
    [list.data, q],
  );
  const online = (list.data ?? []).filter((e) => contacts.has(e.sip_username) || contacts.has(`${e.sip_username}_web`)).length;

  return (
    <div>
      <PageHeader
        title="Extensions"
        icon={<Users className="size-5" />}
        description={list.data ? `${list.data.length} extensions · ${online} online${tenant ? ` · ${tenant.name}` : ''}` : 'SIP accounts for IP phones, softphones and the web phone'}
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setBulk(true)}>
              Bulk add
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add extension
            </Button>
          </>
        }
      />

      <MyPhoneSetup className="mb-4 sm:mb-6" />

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search number, name or username" />
        </div>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={q ? 'No matching extensions' : 'No extensions yet'}
            description="Each extension is a SIP account a desk phone, softphone or the web phone can register with."
            action={!q && <Button variant="primary" onClick={() => setEditing('new')}>Add extension</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-24">Ext</th>
                  <th>Name</th>
                  <th>Used by</th>
                  <th>Devices</th>
                  <th>Status</th>
                  <th>Features</th>
                  <th className="w-48" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const devices = [...(contacts.get(e.sip_username) ?? []), ...(contacts.get(`${e.sip_username}_web`) ?? [])];
                  const st = states.get(e.number);
                  const badge = devices.length ? STATE_BADGE[st ?? 'idle'] ?? STATE_BADGE.idle! : null;
                  return (
                    <tr key={e.id} className={clsx(!e.enabled && 'opacity-50')}>
                      <td>
                        <span className="font-mono text-[15px] font-semibold text-slate-900">{e.number}</span>
                      </td>
                      <td>
                        <div className="font-medium text-slate-900">{e.name}</div>
                        <div className="font-mono text-xs text-slate-500">{e.sip_username}</div>
                      </td>
                      <td>
                        {e.users?.length ? (
                          <button type="button" onClick={() => setSetup({ ext: e, tab: 'people' })} className="flex max-w-56 items-center gap-2 text-left" title="Who uses this extension">
                            <span className="flex -space-x-1.5">
                              {e.users.slice(0, 3).map((u) => (
                                <span key={u.id} className="flex size-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white ring-2 ring-white">
                                  {u.name.slice(0, 1).toUpperCase()}
                                </span>
                              ))}
                            </span>
                            <span className="truncate text-sm text-slate-700">{e.users.map((u) => u.name).join(', ')}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSetup({ ext: e, tab: 'people' })}
                            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-brand-400 hover:text-brand-700"
                          >
                            <UserPlus className="size-3.5" /> Assign
                          </button>
                        )}
                      </td>
                      <td className="max-w-80">
                        {devices.length ? (
                          <div className="space-y-1">
                            {devices.map((d) => (
                              <div key={d.uri} className="flex items-center gap-1.5 text-xs text-slate-600" title={d.uri}>
                                {d.endpoint.endsWith('_web') ? <Globe className="size-3.5 shrink-0 text-brand-600" /> : <Monitor className="size-3.5 shrink-0 text-slate-400" />}
                                <span className="truncate">{d.endpoint.endsWith('_web') ? `Web phone · ${d.userAgent.includes('Envo') ? 'browser' : d.userAgent}` : deviceLabel(d)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No device registered</span>
                        )}
                      </td>
                      <td>{!e.enabled ? <Badge>Disabled</Badge> : badge ? <Badge tone={badge.tone} dot>{badge.label}</Badge> : <Badge dot>Offline</Badge>}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {e.dnd && <Badge tone="red">DND</Badge>}
                          {e.forward_always && <Badge tone="amber">Fwd → {e.forward_always}</Badge>}
                          {e.webrtc && <Badge tone="brand">Web</Badge>}
                          {e.voicemail && <Badge tone="blue">VM</Badge>}
                          {(e.recording === 'all' || e.recording === 'inbound' || e.recording === 'outbound') && <Badge tone="violet">Rec</Badge>}
                          {!e.allow_outbound && <Badge>No outbound</Badge>}
                        </div>
                      </td>
                      <td>
                        <div className="flex justify-end gap-0.5">
                          <IconButton label={`Call ${e.number}`} tone="brand" onClick={() => phone.dial(e.number)}>
                            <Phone className="size-4" />
                          </IconButton>
                          <IconButton label="People" onClick={() => setSetup({ ext: e, tab: 'people' })}>
                            <UserPlus className="size-4" />
                          </IconButton>
                          <IconButton label="Phone setup (SIP details)" onClick={() => setSetup({ ext: e, tab: 'device' })}>
                            <KeyRound className="size-4" />
                          </IconButton>
                          <IconButton label="Edit" onClick={() => setEditing(e)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton
                            label="Delete"
                            tone="danger"
                            onClick={async () => {
                              if (await confirm({ title: `Delete extension ${e.number}?`, message: 'Phones registered with this account stop working immediately.', confirmLabel: 'Delete', danger: true })) {
                                remove.mutate(e.id);
                              }
                            }}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <ExtensionModal ext={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onCreated={(e) => setSetup({ ext: e, tab: 'people' })} />}
      {setup && <SetupModal ext={setup.ext} initialTab={setup.tab} onClose={() => setSetup(null)} />}
      {bulk && tenantId && <BulkModal tenantId={tenantId} onClose={() => setBulk(false)} />}
    </div>
  );
}

function ExtensionModal({ ext, onClose, onCreated }: { ext: Extension | null; onClose: () => void; onCreated: (e: Extension) => void }) {
  const { tenantId } = useTenant();
  const [form, setForm] = useState<Form>(() => (ext ? { ...EMPTY, ...ext, voicemail_pin: '' } : { ...EMPTY }));
  // Suggest the next free number for a new extension (until the admin types their own).
  const next = useNextExtensionNumber(ext ? null : tenantId);
  const [suggested, setSuggested] = useState(false);
  if (!ext && !suggested && next.data && !form.number) {
    setSuggested(true);
    setForm((f) => ({ ...f, number: next.data.number }));
  }
  const [tab, setTab] = useState<'general' | 'calls' | 'voicemail' | 'forwarding'>('general');
  const save = useSave<Extension>('extensions', { created: 'Extension created', updated: 'Extension saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const { sip_username, ...rest } = form;
    const data = ext ? rest : { ...rest, ...(sip_username ? { sip_username } : {}) };
    const saved = await save.mutateAsync({ id: ext?.id, data }).catch(() => null);
    if (!saved) return;
    onClose();
    if (!ext) onCreated(saved);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={ext ? `Extension ${ext.number}` : 'New extension'}
      description={ext ? `SIP username ${ext.sip_username}` : 'A SIP account for an IP phone, softphone or the web phone'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit} disabled={!form.number || !form.name}>
            {ext ? 'Save changes' : 'Create extension'}
          </Button>
        </>
      }
    >
      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'general', label: 'General' },
            { value: 'calls', label: 'Calling' },
            { value: 'voicemail', label: 'Voicemail' },
            { value: 'forwarding', label: 'Forwarding & DND' },
          ]}
        />
      </div>

      {tab === 'general' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Extension number" hint="2-8 digits, dialed internally">
            <Input value={form.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} placeholder="101" />
          </Field>
          <Field label="Name" hint="Shown as caller ID on internal calls">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Front desk" autoFocus={!ext} />
          </Field>
          {!ext && (
            <Field label="SIP username (optional)" hint="Leave empty to use number_servername">
              <Input value={form.sip_username ?? ''} onChange={(e) => set('sip_username', e.target.value)} placeholder="auto" />
            </Field>
          )}
          <Field label="Max devices" hint="Phones that may register at the same time">
            <NumberInput value={form.max_contacts} onChange={(v) => set('max_contacts', v)} min={1} max={20} />
          </Field>
          <Field label="Codecs (priority order)" className="sm:col-span-2" hint="g722 = HD voice; ulaw/alaw for carriers; opus for softphones">
            <Input value={form.codecs} onChange={(e) => set('codecs', e.target.value)} />
          </Field>
          <div className="space-y-4 sm:col-span-2">
            <Toggle checked={form.webrtc} onChange={(v) => set('webrtc', v)} label="Web phone" description="Allow this extension to make and take calls in the browser" />
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enabled" description="Disabled extensions cannot register or receive calls" />
          </div>
        </div>
      )}

      {tab === 'calls' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Toggle checked={form.allow_outbound} onChange={(v) => set('allow_outbound', v)} label="Outside calls" description="Allow calls to external numbers through the outbound routes" />
          </div>
          <Field label="Outbound caller ID" hint="Number shown to people you call (optional)">
            <Input value={form.outbound_cid} onChange={(e) => set('outbound_cid', e.target.value.replace(/[^\d+]/g, ''))} placeholder="Uses SIP server default" />
          </Field>
          <Field label="Ring time (seconds)" hint="Before voicemail / no-answer forwarding">
            <NumberInput value={form.ring_timeout} onChange={(v) => set('ring_timeout', v)} min={5} max={300} />
          </Field>
          <Field label="Call recording" className="sm:col-span-2">
            <Select value={form.recording} onChange={(e) => set('recording', e.target.value as Form['recording'])}>
              <option value="inherit">Use SIP server default</option>
              <option value="off">Never record</option>
              <option value="inbound">Record calls this extension receives</option>
              <option value="outbound">Record calls this extension makes</option>
              <option value="all">Record all calls</option>
            </Select>
          </Field>
        </div>
      )}

      {tab === 'voicemail' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Toggle checked={form.voicemail} onChange={(v) => set('voicemail', v)} label="Voicemail" description="Unanswered calls go to a voicemail box. Dial *97 to listen." />
          </div>
          <Field label="Voicemail PIN" hint={ext ? 'Leave empty to keep the current PIN' : 'Leave empty to generate one'}>
            <Input value={form.voicemail_pin ?? ''} onChange={(e) => set('voicemail_pin', e.target.value.replace(/\D/g, ''))} placeholder="••••" inputMode="numeric" />
          </Field>
          <Field label="Email" hint="For voicemail notifications (optional)">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>
      )}

      {tab === 'forwarding' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Toggle checked={form.dnd} onChange={(v) => set('dnd', v)} label="Do not disturb" description="Callers get voicemail or busy. Phones can toggle with *78 / *79." />
          </div>
          <Field label="Forward all calls to" hint="Extension or external number. *72 on a phone.">
            <Input value={form.forward_always} onChange={(e) => set('forward_always', e.target.value.replace(/[^\d+*#]/g, ''))} placeholder="Off" />
          </Field>
          <Field label="Forward when busy">
            <Input value={form.forward_busy} onChange={(e) => set('forward_busy', e.target.value.replace(/[^\d+*#]/g, ''))} placeholder="Off" />
          </Field>
          <Field label="Forward when not answered / offline">
            <Input value={form.forward_noanswer} onChange={(e) => set('forward_noanswer', e.target.value.replace(/[^\d+*#]/g, ''))} placeholder="Off" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

type SetupTab = 'people' | 'device';

/** Everything needed to put an extension to use: who calls from it, and the settings for a desk phone or app. */
function SetupModal({ ext, initialTab, onClose }: { ext: Extension; initialTab: SetupTab; onClose: () => void }) {
  const [tab, setTab] = useState<SetupTab>(initialTab);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={ext.name === `Extension ${ext.number}` ? ext.name : `Extension ${ext.number} · ${ext.name}`}
      description={tab === 'people' ? 'People who call from it with the web phone' : 'Settings for an IP phone or softphone app'}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'people', label: 'People' },
            { value: 'device', label: 'Desk phone or app' },
          ]}
        />
      </div>
      {tab === 'people' ? <ExtensionPeople ext={ext} /> : <DeviceSetup ext={ext} />}
    </Modal>
  );
}

function DeviceSetup({ ext }: { ext: Extension }) {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [resetting, setResetting] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [sending, setSending] = useState(false);
  const detail = useQuery({
    queryKey: ['extension', ext.id],
    queryFn: () => api.get<Extension>(scoped(`/api/extensions/${ext.id}`, tenantId)),
  });
  const p = detail.data?.provisioning;
  if (!p) return <LoadingBlock />;
  const defaultTo = ext.email || ext.users?.find((u) => u.email)?.email || '';
  const summary = [
    `Extension ${ext.number} (${ext.name})`,
    `SIP server / domain: ${p.domain}`,
    `Username / auth ID: ${p.username}`,
    `Password: ${p.password}`,
    `Port: ${p.udp_port} UDP or TCP, ${p.tls_port} TLS`,
    `Test: dial *43 for an echo test, *97 for voicemail${p.voicemail_pin ? ` (PIN ${p.voicemail_pin})` : ''}`,
  ].join('\n');
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionTitle className="mb-0">Account</SectionTitle>
          <Button
            size="sm"
            icon={<Copy className="size-3.5" />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(summary);
                toast.success('All settings copied');
              } catch {
                toast.error('Could not copy');
              }
            }}
          >
            Copy all
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="SIP server / domain" value={p.domain} />
          <CopyField label="Server IP" value={p.server_ip} />
          <CopyField label="Username / Auth ID" value={p.username} />
          <CopyField label="Password" value={p.password} secret />
        </div>
      </div>
      <div>
        <SectionTitle>Transport</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <CopyField label="UDP port" value={String(p.udp_port)} />
          <CopyField label="TCP port" value={String(p.tcp_port)} />
          <CopyField label="TLS port" value={String(p.tls_port)} />
        </div>
      </div>
      <div>
        <SectionTitle>Send to the person setting it up</SectionTitle>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setSending(true);
            try {
              const r = await api.post<{ status: 'sent' | 'skipped'; to: string }>(scoped(`/api/extensions/${ext.id}/send-setup`, tenantId), { to: emailTo || defaultTo });
              if (r.status === 'sent') toast.success(`Phone settings sent to ${r.to}`);
              else toast.warning('Email is not set up yet, so nothing was sent. Use "Copy all" instead.');
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setSending(false);
            }
          }}
        >
          <Input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder={defaultTo || 'name@company.com'} aria-label="Email address" className="sm:flex-1" />
          <Button type="submit" icon={<Mail className="size-4" />} loading={sending} disabled={!emailTo && !defaultTo}>
            Email settings
          </Button>
        </form>
      </div>
      <Notice tone="info" title="Quick test">
        After the phone shows <em>Registered</em>, dial <span className="kbd">*43</span> for an echo test, <span className="kbd">*97</span> for voicemail
        {p.voicemail_pin && (
          <>
            {' '}(PIN <span className="kbd">{p.voicemail_pin}</span>)
          </>
        )}
        , or any other extension number.
      </Notice>
      <div className="flex justify-end border-t border-slate-100 pt-4">
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="size-4" />}
          loading={resetting}
          onClick={async () => {
            if (!(await confirm({ title: 'Generate a new SIP password?', message: 'Devices using the old password will stop registering until updated.', confirmLabel: 'Reset password', danger: true }))) return;
            setResetting(true);
            try {
              await api.post(scoped(`/api/extensions/${ext.id}/reset-password`, tenantId));
              await qc.invalidateQueries({ queryKey: ['extension', ext.id] });
              toast.success('New password generated');
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setResetting(false);
            }
          }}
        >
          Reset SIP password
        </Button>
      </div>
    </div>
  );
}

function BulkModal({ tenantId, onClose }: { tenantId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [start, setStart] = useState('2001');
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState('Extension');
  const [webrtc, setWebrtc] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Bulk add extensions"
      description="Create a range of numbered extensions with random strong passwords"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!start || count < 1}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ created: number }>(scoped('/api/extensions/bulk', tenantId), { start, count, name_prefix: prefix, webrtc });
                toast.success(`${r.created} extensions created`);
                await qc.invalidateQueries({ queryKey: ['list', 'extensions'] });
                onClose();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create {count} extensions
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First number">
          <Input value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="How many" hint="Up to 200 at once">
          <NumberInput value={count} onChange={setCount} min={1} max={200} />
        </Field>
        <Field label="Name prefix" className="sm:col-span-2" hint={`Creates "${prefix} ${start}", "${prefix} ${Number(start) + 1}"…`}>
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={webrtc} onChange={setWebrtc} label="Enable web phone" />
        </div>
      </div>
    </Modal>
  );
}
