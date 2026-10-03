import { useState } from 'react';
import { ListTree, Music, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useTenant } from '../state/tenant';
import { scoped } from '../lib/api';
import type { Ivr, IvrOption, Sound } from '../lib/types';
import { DestLabel, DestinationPicker } from '../components/DestinationPicker';
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
  SectionTitle,
  Select,
  Toggle,
  useConfirm,
} from '../components/ui';

type Form = Omit<Ivr, 'id'>;
const EMPTY: Form = {
  name: '',
  number: '',
  greeting_sound_id: null,
  timeout: 5,
  max_retries: 3,
  direct_dial: true,
  options: [],
  timeout_dest_type: 'hangup',
  timeout_dest_target: '',
  invalid_dest_type: 'hangup',
  invalid_dest_target: '',
};
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];

export function IvrsPage() {
  const list = useList<Ivr>('ivrs');
  const sounds = useList<Sound>('sounds');
  const remove = useRemove('ivrs', 'IVR deleted');
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Ivr | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="IVR menus"
        icon={<ListTree className="size-5" />}
        description='"Press 1 for sales, 2 for support" auto attendants'
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New IVR
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
            icon={<ListTree className="size-5" />}
            title="No IVR menus yet"
            description="Play a greeting and let callers pick a department with the keypad. Point a phone number at it to use it."
            action={<Button variant="primary" onClick={() => setEditing('new')}>Create an IVR</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data.map((ivr) => {
            const greeting = sounds.data?.find((s) => s.id === ivr.greeting_sound_id);
            return (
              <Card key={ivr.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{ivr.name}</h3>
                      {ivr.number && <Badge tone="brand">Ext {ivr.number}</Badge>}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Music className="size-3.5" /> {greeting ? greeting.name : 'No greeting'} · {ivr.timeout}s timeout · {ivr.max_retries} tries
                    </p>
                  </div>
                  <div className="flex gap-0.5">
                    <IconButton label="Edit" onClick={() => setEditing(ivr)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      tone="danger"
                      onClick={async () => {
                        if (await confirm({ title: `Delete IVR "${ivr.name}"?`, message: 'Numbers pointing to it will stop working.', confirmLabel: 'Delete', danger: true })) remove.mutate(ivr.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <ul className="mt-4 space-y-1.5">
                  {ivr.options.map((o) => (
                    <li key={o.digit} className="flex items-center gap-3 text-sm">
                      <span className="flex size-7 items-center justify-center rounded-lg bg-slate-900 font-mono text-sm font-semibold text-white">{o.digit}</span>
                      <DestLabel type={o.dest_type} target={o.dest_target} />
                    </li>
                  ))}
                  {!ivr.options.length && <li className="text-sm text-slate-400">No key options</li>}
                  <li className="flex items-center gap-3 pt-1 text-xs text-slate-500">
                    <span className="w-7 text-center">⏱</span> No input: <DestLabel type={ivr.timeout_dest_type} target={ivr.timeout_dest_target} />
                  </li>
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <IvrModal ivr={editing === 'new' ? null : editing} sounds={sounds.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function IvrModal({ ivr, sounds, onClose }: { ivr: Ivr | null; sounds: Sound[]; onClose: () => void }) {
  const { tenantId } = useTenant();
  const [form, setForm] = useState<Form>(() => (ivr ? { ...EMPTY, ...ivr } : { ...EMPTY, options: [{ digit: '1', dest_type: 'extension', dest_target: '' }] }));
  const save = useSave('ivrs', { created: 'IVR created', updated: 'IVR saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setOption = (i: number, patch: Partial<IvrOption>) => set('options', form.options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const unused = DIGITS.filter((d) => !form.options.some((o) => o.digit === d));
  const greeting = sounds.find((s) => s.id === form.greeting_sound_id);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={ivr ? `Edit IVR · ${ivr.name}` : 'New IVR menu'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: ivr?.id, data: form }).catch(() => null);
              if (ok) onClose();
            }}
          >
            Save IVR
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-4">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Main menu" autoFocus />
          </Field>
          <Field label="Internal number (optional)" hint="Dial it from any extension to test the menu">
            <Input value={form.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} placeholder="700" />
          </Field>
          <Field label="Greeting" hint="Upload recordings on the Sounds page">
            <Select value={form.greeting_sound_id ?? ''} onChange={(e) => set('greeting_sound_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">No greeting (silence)</option>
              {sounds.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {greeting && <audio controls preload="none" src={scoped(`/api/sounds/${greeting.id}/audio`, tenantId)} className="mt-2 h-9 w-full" />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Wait for input (s)">
              <NumberInput value={form.timeout} onChange={(v) => set('timeout', v)} min={1} max={60} />
            </Field>
            <Field label="Replays">
              <NumberInput value={form.max_retries} onChange={(v) => set('max_retries', v)} min={1} max={10} />
            </Field>
          </div>
          <Toggle checked={form.direct_dial} onChange={(v) => set('direct_dial', v)} label="Allow dialing extensions" description="Callers who know an extension number can dial it directly" />
        </div>

        <div className="space-y-5">
          <div>
            <SectionTitle>Key options</SectionTitle>
            <div className="space-y-2">
              {form.options.map((o, i) => (
                <div key={i} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                  <Select value={o.digit} onChange={(e) => setOption(i, { digit: e.target.value })} className="w-16 font-mono font-semibold">
                    {[o.digit, ...unused].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                  <div className="min-w-0 flex-1">
                    <DestinationPicker type={o.dest_type} target={o.dest_target} onChange={(t, v) => setOption(i, { dest_type: t, dest_target: v })} />
                  </div>
                  <IconButton label="Remove option" tone="danger" onClick={() => set('options', form.options.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              ))}
              {unused.length > 0 && (
                <Button
                  size="sm"
                  icon={<Plus className="size-4" />}
                  onClick={() => set('options', [...form.options, { digit: unused[0]!, dest_type: 'extension', dest_target: '' }])}
                >
                  Add key
                </Button>
              )}
            </div>
          </div>
          <Field label="When the caller presses nothing">
            <DestinationPicker type={form.timeout_dest_type} target={form.timeout_dest_target} onChange={(t, v) => setForm((f) => ({ ...f, timeout_dest_type: t, timeout_dest_target: v }))} />
          </Field>
          <Field label="After too many invalid keys">
            <DestinationPicker type={form.invalid_dest_type} target={form.invalid_dest_target} onChange={(t, v) => setForm((f) => ({ ...f, invalid_dest_type: t, invalid_dest_target: v }))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
