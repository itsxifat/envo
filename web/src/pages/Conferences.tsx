import { useState } from 'react';
import { Lock, Pencil, Phone, Plus, Presentation, Trash2, Users } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useLive } from '../state/live';
import { useTenant } from '../state/tenant';
import { usePhone } from '../phone/PhoneProvider';
import type { Conference } from '../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBlock, Field, IconButton, Input, LoadingBlock, Modal, NumberInput, PageHeader, Toggle, useConfirm } from '../components/ui';

type Form = Omit<Conference, 'id'>;
const EMPTY: Form = { name: '', number: '', pin: '', max_members: 20, announce_join: true };

export function ConferencesPage() {
  const list = useList<Conference>('conferences');
  const remove = useRemove('conferences', 'Conference room deleted');
  const confirm = useConfirm();
  const { channels } = useLive();
  const { tenantId } = useTenant();
  const phone = usePhone();
  const [editing, setEditing] = useState<Conference | 'new' | null>(null);
  const inRoom = (c: Conference) =>
    channels.filter((ch) => ch.tenantId === tenantId && ch.application === 'ConfBridge' && ch.appData.startsWith(`t${tenantId}-conf${c.id}`)).length;

  return (
    <div>
      <PageHeader
        title="Conference rooms"
        icon={<Presentation className="size-5" />}
        description="Dial-in meeting rooms for your team and callers"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New room
          </Button>
        }
      />
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState
            icon={<Presentation className="size-5" />}
            title="No conference rooms"
            description="Create a room, give it a number and an optional PIN, then dial in from any phone or point a phone number at it."
            action={<Button variant="primary" onClick={() => setEditing('new')}>New room</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((c) => {
            const count = inRoom(c);
            return (
              <Card key={c.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{c.name}</h3>
                      {count > 0 && <Badge tone="green">{count} in call</Badge>}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-sm text-slate-500">
                      <span className="font-mono text-slate-800">{c.number}</span>
                      {c.pin ? (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="size-3.5" /> PIN protected
                        </span>
                      ) : (
                        <span>Open room</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    <IconButton label={`Join ${c.number}`} tone="brand" onClick={() => phone.dial(c.number)}>
                      <Phone className="size-4" />
                    </IconButton>
                    <IconButton label="Edit" onClick={() => setEditing(c)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      tone="danger"
                      onClick={async () => {
                        if (await confirm({ title: `Delete "${c.name}"?`, confirmLabel: 'Delete', danger: true })) remove.mutate(c.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <Users className="size-3.5" /> Up to {c.max_members} participants
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <ConferenceModal room={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ConferenceModal({ room, onClose }: { room: Conference | null; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => (room ? { ...EMPTY, ...room } : { ...EMPTY }));
  const save = useSave('conferences', { created: 'Conference room created', updated: 'Conference room saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal
      open
      onClose={onClose}
      title={room ? `Edit · ${room.name}` : 'New conference room'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name || !form.number}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: room?.id, data: form }).catch(() => null);
              if (ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Weekly team call" autoFocus />
        </Field>
        <Field label="Room number" hint="Dial it from any extension">
          <Input value={form.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} placeholder="800" />
        </Field>
        <Field label="PIN (optional)" hint="3-10 digits, asked on entry">
          <Input value={form.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </Field>
        <Field label="Max participants">
          <NumberInput value={form.max_members} onChange={(v) => set('max_members', v)} min={2} max={200} />
        </Field>
        <div className="flex items-end pb-2">
          <Toggle checked={form.announce_join} onChange={(v) => set('announce_join', v)} label="Announce participant count" />
        </div>
      </div>
    </Modal>
  );
}
