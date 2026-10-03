import { useState } from 'react';
import { Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import type { RingGroup } from '../lib/types';
import { DestLabel, DestinationPicker } from '../components/DestinationPicker';
import { MemberPicker } from '../components/MemberPicker';
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
  Tabs,
  useConfirm,
} from '../components/ui';

type Form = Omit<RingGroup, 'id'>;
const EMPTY: Form = { name: '', number: '', strategy: 'ringall', members: [], ring_time: 20, cid_prefix: '', failover_dest_type: 'hangup', failover_dest_target: '' };

export function RingGroupsPage() {
  const list = useList<RingGroup>('ring-groups');
  const remove = useRemove('ring-groups', 'Ring group deleted');
  const confirm = useConfirm();
  const [editing, setEditing] = useState<RingGroup | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="Ring groups"
        icon={<Network className="size-5" />}
        description="Ring several extensions at once or one after another"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New ring group
          </Button>
        }
      />
      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState icon={<Network className="size-5" />} title="No ring groups" description="Group extensions like Sales or Support and send calls to all of them." action={<Button variant="primary" onClick={() => setEditing('new')}>New ring group</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Strategy</th>
                  <th>Members</th>
                  <th>If nobody answers</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <div className="font-medium text-slate-900">{g.name}</div>
                      {g.number && <div className="font-mono text-xs text-slate-500">Ext {g.number}</div>}
                    </td>
                    <td>
                      <Badge tone={g.strategy === 'ringall' ? 'brand' : 'blue'}>{g.strategy === 'ringall' ? 'Ring all' : 'One by one'}</Badge>
                      <div className="mt-0.5 text-xs text-slate-500">{g.ring_time}s{g.strategy === 'hunt' ? ' each' : ''}</div>
                    </td>
                    <td className="max-w-72">
                      <div className="flex flex-wrap gap-1">
                        {g.members.map((m) => (
                          <span key={m} className="kbd">
                            {m}
                          </span>
                        ))}
                        {!g.members.length && <span className="text-xs text-slate-400">None</span>}
                      </div>
                    </td>
                    <td className="text-sm">
                      <DestLabel type={g.failover_dest_type} target={g.failover_dest_target} />
                    </td>
                    <td>
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Edit" onClick={() => setEditing(g)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Delete"
                          tone="danger"
                          onClick={async () => {
                            if (await confirm({ title: `Delete ring group "${g.name}"?`, confirmLabel: 'Delete', danger: true })) remove.mutate(g.id);
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
      {editing && <RingGroupModal group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RingGroupModal({ group, onClose }: { group: RingGroup | null; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => (group ? { ...EMPTY, ...group } : { ...EMPTY }));
  const save = useSave('ring-groups', { created: 'Ring group created', updated: 'Ring group saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={group ? `Edit ring group · ${group.name}` : 'New ring group'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: group?.id, data: form }).catch(() => null);
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
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Sales" autoFocus />
        </Field>
        <Field label="Number (optional)">
          <Input value={form.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} placeholder="600" />
        </Field>
        <Field label="Strategy" className="sm:col-span-2">
          <Tabs
            value={form.strategy}
            onChange={(v) => set('strategy', v)}
            tabs={[
              { value: 'ringall', label: 'Ring all at once' },
              { value: 'hunt', label: 'One by one' },
            ]}
          />
        </Field>
        <Field label={form.strategy === 'hunt' ? 'Ring each for (s)' : 'Ring for (s)'}>
          <NumberInput value={form.ring_time} onChange={(v) => set('ring_time', v)} min={5} max={300} />
        </Field>
        <Field label="Members" className="sm:col-span-3">
          <MemberPicker value={form.members} onChange={(v) => set('members', v)} ordered={form.strategy === 'hunt'} />
        </Field>
        <Field label="Caller name prefix" hint="e.g. Sales — so agents know the call came via this group">
          <Input value={form.cid_prefix} onChange={(e) => set('cid_prefix', e.target.value)} maxLength={20} />
        </Field>
        <Field label="If nobody answers" className="sm:col-span-2">
          <DestinationPicker type={form.failover_dest_type} target={form.failover_dest_target} onChange={(t, v) => setForm((f) => ({ ...f, failover_dest_type: t, failover_dest_target: v }))} />
        </Field>
      </div>
    </Modal>
  );
}
