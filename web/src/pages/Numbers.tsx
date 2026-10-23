import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import clsx from 'clsx';
import { Hash, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useLive } from '../state/live';
import type { PhoneNumber, Trunk } from '../lib/types';
import { DestLabel, DestinationPicker } from '../components/DestinationPicker';
import { ConnectNumberModal } from '../components/connectNumber';
import { GetNumberModal, NumberChoice, NumberRequestsCard, TopupDialog, useNumberRequests, useSupplyOptions, useTopupNumbers, type NumberSource } from '../components/numberSupply';
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
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<PhoneNumber | 'new' | null>(null);
  // "Add a number": first the three ways to get one, then that way's form.
  const [adding, setAdding] = useState<NumberSource | 'choose' | null>(null);
  const [topup, setTopup] = useState<PhoneNumber | null>(null);
  const supply = useSupplyOptions();
  const requests = useNumberRequests();
  const topupNumbers = useTopupNumbers();
  const offer = !!supply.data?.enabled;
  const add = () => setAdding(offer ? 'choose' : 'own');

  // Linked from elsewhere (the dashboard) with ?add=1.
  useEffect(() => {
    if (!params.get('add') || supply.isLoading) return;
    setParams({}, { replace: true });
    setAdding(offer ? 'choose' : 'own');
  }, [params, setParams, supply.isLoading, offer]);
  const isSuper = user?.role === 'superadmin';
  // Numbers Enfinito provides can be topped up here by the account owner.
  const fromEnfinito = useMemo(() => new Set((topupNumbers.data ?? []).map((n) => n.id)), [topupNumbers.data]);
  const canTopUp = (n: PhoneNumber) => fromEnfinito.has(n.id);
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
                Add number by hand
              </Button>
            )}
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={add}>
              {offer ? 'Add a number' : 'Connect a number'}
            </Button>
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
          offer ? (
            <div className="p-4 sm:p-6">
              <h2 className="text-base font-semibold tracking-tight text-slate-950">No phone numbers yet</h2>
              <p className="mt-0.5 mb-4 text-sm text-slate-500">How would you like to get one?</p>
              <NumberChoice onChoose={setAdding} />
            </div>
          ) : (
            <EmptyState
              icon={<Hash className="size-5" />}
              title="No phone numbers yet"
              description="Connect the number you bought from your IP phone provider, then choose where its calls ring."
              action={
                <Button variant="primary" onClick={add}>
                  Connect a number
                </Button>
              }
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Line</th>
                  <th>Incoming calls go to</th>
                  <th>Calls now</th>
                  <th className="w-44" />
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
                      <div className="flex items-center justify-end gap-0.5">
                        {canTopUp(n) && (
                          <Button size="sm" className="mr-1" icon={<Wallet className="size-3.5" />} onClick={() => setTopup(n)}>
                            Top up
                          </Button>
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
      {adding === 'choose' && (
        <Modal open onClose={() => setAdding(null)} size="xl" title="Add a phone number" description="Choose how you would like to get it.">
          <NumberChoice onChoose={setAdding} />
        </Modal>
      )}
      {adding === 'own' && <ConnectNumberModal onClose={() => setAdding(null)} />}
      {(adding === 'pool' || adding === 'special') && <GetNumberModal special={adding === 'special'} onClose={() => setAdding(null)} />}
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
