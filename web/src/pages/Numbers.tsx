import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Hash, Pencil, Plus, Sparkles, Trash2, Wallet } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useLive } from '../state/live';
import type { PhoneNumber, Trunk } from '../lib/types';
import { DestLabel, DestinationPicker } from '../components/DestinationPicker';
import { ConnectNumberModal } from '../components/connectNumber';
import { GetNumberModal, NumberRequestsCard, TopupDialog, useNumberRequests, useSupplyOptions } from '../components/numberSupply';
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
  Toggle,
  useConfirm,
} from '../components/ui';

type Form = Omit<PhoneNumber, 'id' | 'tenant_id' | 'trunk_name'>;
const EMPTY: Form = {
  number: '',
  label: '',
  trunk_id: null,
  max_channels: 0,
  dest_type: 'extension',
  dest_target: '',
  cid_prefix: '',
  recording: 'inherit',
  enabled: true,
};

export function NumbersPage() {
  const list = useList<PhoneNumber>('numbers');
  const trunks = useList<Trunk>('trunks');
  const remove = useRemove('numbers', 'Number removed');
  const confirm = useConfirm();
  const { user } = useAuth();
  const { groups } = useLive();
  const [editing, setEditing] = useState<PhoneNumber | 'new' | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [getting, setGetting] = useState(false);
  const [topup, setTopup] = useState<PhoneNumber | null>(null);
  const supply = useSupplyOptions();
  const requests = useNumberRequests();
  const offer = !!supply.data?.enabled;
  const isSuper = user?.role === 'superadmin';
  // Numbers Enfinito provided (through a request) can be topped up here by the account owner.
  const fromEnfinito = useMemo(() => new Set((requests.data ?? []).filter((r) => r.status === 'connected' && r.number_id).map((r) => r.number_id)), [requests.data]);
  const canTopUp = (n: PhoneNumber) => !!user?.isOwner && !!supply.data?.topup.enabled && fromEnfinito.has(n.id);
  // Customers may remove numbers on their own lines; numbers on lines Envo provides stay with support.
  const ownLines = useMemo(() => new Set((trunks.data ?? []).filter((t) => t.tenant_id !== null).map((t) => t.id)), [trunks.data]);
  const canRemove = (n: PhoneNumber) => isSuper || (n.trunk_id !== null && ownLines.has(n.trunk_id));

  const liveByDid = (n: PhoneNumber) => groups[`envo_did/did${n.id}`] ?? 0;

  return (
    <div>
      <PageHeader
        title="Phone numbers"
        icon={<Hash className="size-5" />}
        description="Your phone numbers and where each one rings"
        actions={
          <>
            {isSuper && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Add number
              </Button>
            )}
            <Button variant={offer ? 'secondary' : 'primary'} icon={<Plus className="size-4" />} onClick={() => setConnecting(true)}>
              {offer ? 'Connect my own number' : 'Connect a number'}
            </Button>
            {offer && (
              <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => setGetting(true)}>
                Get a new number
              </Button>
            )}
          </>
        }
      />
      {requests.data && <NumberRequestsCard requests={requests.data} />}
      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState
            icon={<Hash className="size-5" />}
            title="No phone numbers yet"
            description={offer ? 'Get a new number from Enfinito, or connect one you bought from an IP phone provider.' : 'Connect the number you bought from your IP phone provider, then choose where its calls ring.'}
            action={offer ? <Button variant="primary" onClick={() => setGetting(true)}>Get a new number</Button> : <Button variant="primary" onClick={() => setConnecting(true)}>Connect a number</Button>}
            secondary={offer && <Button onClick={() => setConnecting(true)}>Connect my own number</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Line</th>
                  <th>Incoming calls go to</th>
                  <th>Channels</th>
                  <th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((n) => (
                  <tr key={n.id} className={clsx(!n.enabled && 'opacity-55')}>
                    <td>
                      <div className="font-mono text-[15px] font-semibold text-slate-900">{n.number}</div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        {n.label || 'No label'}
                        {!n.enabled && <Badge>Disabled</Badge>}
                        {n.recording === 'on' && <Badge tone="violet">Rec</Badge>}
                      </div>
                    </td>
                    <td className="text-sm text-slate-600">{n.trunk_name ?? <span className="text-slate-400">Any line</span>}</td>
                    <td className="text-sm">
                      <DestLabel type={n.dest_type} target={n.dest_target} />
                    </td>
                    <td className="text-sm text-slate-700">
                      <span className="tabular-nums">{liveByDid(n)}</span>
                      <span className="text-slate-400"> / {n.max_channels || '∞'}</span>
                    </td>
                    <td>
                      <div className="flex justify-end gap-0.5">
                        {canTopUp(n) && (
                          <IconButton label="Top up" tone="brand" onClick={() => setTopup(n)}>
                            <Wallet className="size-4" />
                          </IconButton>
                        )}
                        <IconButton label="Edit" onClick={() => setEditing(n)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        {canRemove(n) && (
                          <IconButton
                            label="Remove"
                            tone="danger"
                            onClick={async () => {
                              if (await confirm({ title: `Remove ${n.number}?`, message: 'Incoming calls to this number will be rejected.', confirmLabel: 'Remove', danger: true })) remove.mutate(n.id);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <NumberModal number={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {connecting && <ConnectNumberModal onClose={() => setConnecting(false)} />}
      {getting && <GetNumberModal onClose={() => setGetting(false)} />}
      {topup && <TopupDialog numberId={topup.id} number={topup.number} onClose={() => setTopup(null)} />}
    </div>
  );
}

function NumberModal({ number, onClose }: { number: PhoneNumber | null; onClose: () => void }) {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const trunks = useList<Trunk>('trunks');
  const [form, setForm] = useState<Form>(() => (number ? { ...EMPTY, ...number } : { ...EMPTY }));
  const save = useSave('numbers', { created: 'Number added', updated: 'Number saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={number ? `Number ${number.number}` : 'Add phone number'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.number}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: number?.id, data: form }).catch(() => null);
              if (ok) onClose();
            }}
          >
            {number ? 'Save' : 'Add number'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone number" hint="As the provider delivers it; national and +international forms both match">
          <Input value={form.number} onChange={(e) => set('number', e.target.value.replace(/[^\d+]/g, ''))} placeholder="09612345678" disabled={!isSuper} autoFocus={!number} />
        </Field>
        <Field label="Label">
          <Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Hotline" />
        </Field>
        {isSuper && (
          <>
            <Field label="Line" hint="The provider line this number arrives on">
              <Select value={form.trunk_id ?? ''} onChange={(e) => set('trunk_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Any line</option>
                {trunks.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Channels" hint="Simultaneous calls on this number, 0 = unlimited">
              <NumberInput value={form.max_channels} onChange={(v) => set('max_channels', v)} min={0} />
            </Field>
          </>
        )}
        <Field label="Incoming calls go to" className="sm:col-span-2">
          <DestinationPicker type={form.dest_type} target={form.dest_target} onChange={(t, v) => setForm((f) => ({ ...f, dest_type: t, dest_target: v }))} />
        </Field>
        <Field label="Caller name prefix" hint="Shown before the caller's name, e.g. Sales">
          <Input value={form.cid_prefix} onChange={(e) => set('cid_prefix', e.target.value)} maxLength={20} />
        </Field>
        <Field label="Record calls">
          <Select value={form.recording} onChange={(e) => set('recording', e.target.value as Form['recording'])}>
            <option value="inherit">Use SIP server default</option>
            <option value="on">Always record</option>
            <option value="off">Never</option>
          </Select>
        </Field>
        {isSuper && (
          <div className="sm:col-span-2">
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enabled" />
          </div>
        )}
      </div>
    </Modal>
  );
}
