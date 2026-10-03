import { useState } from 'react';
import { Gauge, Pencil, Plus, Trash2 } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import type { Queue, Sound } from '../lib/types';
import { DestLabel, DestinationPicker } from '../components/DestinationPicker';
import { MemberPicker } from '../components/MemberPicker';
import { useLive } from '../state/live';
import { useTenant } from '../state/tenant';
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

type Form = Omit<Queue, 'id'>;
const EMPTY: Form = {
  name: '',
  number: '',
  strategy: 'rrmemory',
  members: [],
  agent_timeout: 15,
  max_wait: 300,
  wrapup: 5,
  announce_position: true,
  join_sound_id: null,
  failover_dest_type: 'hangup',
  failover_dest_target: '',
};

const STRATEGIES: Record<Queue['strategy'], string> = {
  ringall: 'Ring all available agents',
  rrmemory: 'Round robin (remembers last agent)',
  leastrecent: 'Agent idle the longest',
  fewestcalls: 'Agent with fewest calls',
  random: 'Random agent',
  linear: 'In member order',
};

export function QueuesPage() {
  const list = useList<Queue>('queues');
  const remove = useRemove('queues', 'Queue deleted');
  const confirm = useConfirm();
  const { channels } = useLive();
  const { tenantId } = useTenant();
  const [editing, setEditing] = useState<Queue | 'new' | null>(null);
  const waiting = (q: Queue) => channels.filter((c) => c.tenantId === tenantId && c.application === 'Queue' && c.appData.startsWith(`t${tenantId}-q${q.id},`)).length;

  return (
    <div>
      <PageHeader
        title="Call queues"
        icon={<Gauge className="size-5" />}
        description="Callers wait with music until an agent is free"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New queue
          </Button>
        }
      />
      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState icon={<Gauge className="size-5" />} title="No queues" description="Use a queue when more callers arrive than agents can take at once." action={<Button variant="primary" onClick={() => setEditing('new')}>New queue</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Strategy</th>
                  <th>Agents</th>
                  <th>Waiting now</th>
                  <th>Overflow</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <div className="font-medium text-slate-900">{q.name}</div>
                      {q.number && <div className="font-mono text-xs text-slate-500">Ext {q.number}</div>}
                    </td>
                    <td className="text-sm text-slate-600">{STRATEGIES[q.strategy]}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {q.members.map((m) => (
                          <span key={m} className="kbd">
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{waiting(q) ? <Badge tone="amber">{waiting(q)} waiting</Badge> : <span className="text-sm text-slate-400">0</span>}</td>
                    <td className="text-sm">
                      <DestLabel type={q.failover_dest_type} target={q.failover_dest_target} />
                    </td>
                    <td>
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Edit" onClick={() => setEditing(q)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Delete"
                          tone="danger"
                          onClick={async () => {
                            if (await confirm({ title: `Delete queue "${q.name}"?`, confirmLabel: 'Delete', danger: true })) remove.mutate(q.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <QueueModal queue={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function QueueModal({ queue, onClose }: { queue: Queue | null; onClose: () => void }) {
  const sounds = useList<Sound>('sounds');
  const [form, setForm] = useState<Form>(() => (queue ? { ...EMPTY, ...queue } : { ...EMPTY }));
  const save = useSave('queues', { created: 'Queue created', updated: 'Queue saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={queue ? `Edit queue · ${queue.name}` : 'New queue'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: queue?.id, data: form }).catch(() => null);
              if (ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Support" autoFocus />
        </Field>
        <Field label="Number (optional)">
          <Input value={form.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} placeholder="650" />
        </Field>
        <Field label="Which agent rings" className="sm:col-span-3">
          <Select value={form.strategy} onChange={(e) => set('strategy', e.target.value as Queue['strategy'])}>
            {Object.entries(STRATEGIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Agents" className="sm:col-span-3">
          <MemberPicker value={form.members} onChange={(v) => set('members', v)} ordered={form.strategy === 'linear'} />
        </Field>
        <Field label="Ring agent for (s)">
          <NumberInput value={form.agent_timeout} onChange={(v) => set('agent_timeout', v)} min={5} max={120} />
        </Field>
        <Field label="Max wait (s)" hint="0 = wait forever">
          <NumberInput value={form.max_wait} onChange={(v) => set('max_wait', v)} min={0} max={7200} />
        </Field>
        <Field label="Wrap-up time (s)" hint="Pause after each call">
          <NumberInput value={form.wrapup} onChange={(v) => set('wrapup', v)} min={0} max={600} />
        </Field>
        <Field label="Welcome message" className="sm:col-span-2">
          <Select value={form.join_sound_id ?? ''} onChange={(e) => set('join_sound_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">None</option>
            {sounds.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <Toggle checked={form.announce_position} onChange={(v) => set('announce_position', v)} label="Announce position" />
        </div>
        <Field label="When nobody is available or the wait is too long" className="sm:col-span-3">
          <DestinationPicker type={form.failover_dest_type} target={form.failover_dest_target} onChange={(t, v) => setForm((f) => ({ ...f, failover_dest_type: t, failover_dest_target: v }))} />
        </Field>
      </div>
    </Modal>
  );
}
