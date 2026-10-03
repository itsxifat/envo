import { useState } from 'react';
import clsx from 'clsx';
import { CalendarDays, Clock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useTenant } from '../state/tenant';
import type { TimeCondition, TimeRule } from '../lib/types';
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
  PageHeader,
  SectionTitle,
  Tabs,
  useConfirm,
} from '../components/ui';

type Form = Omit<TimeCondition, 'id'>;
const DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
const DAY_LABEL: Record<string, string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
const EMPTY: Form = {
  name: '',
  mode: 'auto',
  rules: [{ days: ['sun', 'mon', 'tue', 'wed', 'thu'], start: '09:00', end: '18:00' }],
  holidays: [],
  match_dest_type: 'hangup',
  match_dest_target: '',
  nomatch_dest_type: 'hangup',
  nomatch_dest_target: '',
};

/** Evaluates a time condition right now in the SIP server's timezone (mirrors the dialplan). */
export function isOpenNow(tc: Pick<TimeCondition, 'mode' | 'rules' | 'holidays'>, timeZone: string): boolean {
  if (tc.mode !== 'auto') return tc.mode === 'open';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  } catch {
    return false;
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = get('weekday').toLowerCase().slice(0, 3);
  const md = `${get('month')}-${get('day')}`;
  const hm = `${get('hour')}:${get('minute')}`;
  if (tc.holidays.some((h) => h.date.slice(5) === md)) return false;
  return tc.rules.some((r) => r.days.includes(day) && hm >= r.start && (hm < r.end || r.end === '24:00'));
}

export function TimeConditionsPage() {
  const list = useList<TimeCondition>('time-conditions');
  const remove = useRemove('time-conditions', 'Time condition deleted');
  const save = useSave('time-conditions', { updated: 'Mode changed' });
  const confirm = useConfirm();
  const { tenant } = useTenant();
  const tz = tenant?.timezone ?? 'Asia/Dhaka';
  const [editing, setEditing] = useState<TimeCondition | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="Time conditions"
        icon={<Clock className="size-5" />}
        description={`Route calls by business hours and holidays · ${tz}`}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            New time condition
          </Button>
        }
      />
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState icon={<Clock className="size-5" />} title="No time conditions" description="Send calls to your team during office hours and to voicemail or an IVR after hours." action={<Button variant="primary" onClick={() => setEditing('new')}>New time condition</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data.map((tc) => {
            const open = isOpenNow(tc, tz);
            return (
              <Card key={tc.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{tc.name}</h3>
                      <Badge tone={open ? 'green' : 'gray'}>{open ? 'Open now' : 'Closed now'}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {tc.rules.length} schedule rule{tc.rules.length === 1 ? '' : 's'} · {tc.holidays.length} holiday{tc.holidays.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex gap-0.5">
                    <IconButton label="Edit" onClick={() => setEditing(tc)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      tone="danger"
                      onClick={async () => {
                        if (await confirm({ title: `Delete "${tc.name}"?`, confirmLabel: 'Delete', danger: true })) remove.mutate(tc.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-4">
                  <Tabs
                    value={tc.mode}
                    onChange={(mode) => {
                      const { id, ...rest } = tc;
                      save.mutate({ id, data: { ...rest, mode } });
                    }}
                    tabs={[
                      { value: 'auto', label: 'Follow schedule' },
                      { value: 'open', label: 'Force open' },
                      { value: 'closed', label: 'Force closed' },
                    ]}
                  />
                </div>
                <div className="mt-4 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-xs font-medium text-emerald-700">Open</span>
                    <DestLabel type={tc.match_dest_type} target={tc.match_dest_target} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-xs font-medium text-slate-500">Closed</span>
                    <DestLabel type={tc.nomatch_dest_type} target={tc.nomatch_dest_target} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <TimeConditionModal tc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TimeConditionModal({ tc, onClose }: { tc: TimeCondition | null; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => (tc ? { ...EMPTY, ...tc } : { ...EMPTY }));
  const save = useSave('time-conditions', { created: 'Time condition created', updated: 'Time condition saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setRule = (i: number, patch: Partial<TimeRule>) => set('rules', form.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={tc ? `Edit · ${tc.name}` : 'New time condition'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: tc?.id, data: form }).catch(() => null);
              if (ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Office hours" autoFocus />
          </Field>
          <div>
            <SectionTitle>Open hours</SectionTitle>
            <div className="space-y-2">
              {form.rules.map((r, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {DAYS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setRule(i, { days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] })}
                        className={clsx(
                          'rounded-md px-2 py-1 text-xs font-medium transition',
                          r.days.includes(d) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                        )}
                      >
                        {DAY_LABEL[d]}
                      </button>
                    ))}
                    <IconButton label="Remove rule" tone="danger" className="ml-auto" onClick={() => set('rules', form.rules.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </IconButton>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <Input type="time" value={r.start} onChange={(e) => setRule(i, { start: e.target.value })} className="w-32" />
                    <span className="text-slate-400">to</span>
                    <Input type="time" value={r.end === '24:00' ? '23:59' : r.end} onChange={(e) => setRule(i, { end: e.target.value })} className="w-32" />
                  </div>
                </div>
              ))}
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => set('rules', [...form.rules, { days: ['sat'], start: '10:00', end: '14:00' }])}>
                Add hours
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-5">
          <div>
            <SectionTitle>Holidays (closed all day, every year)</SectionTitle>
            <div className="space-y-2">
              {form.holidays.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-slate-400" />
                  <Input type="date" value={h.date} onChange={(e) => set('holidays', form.holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} className="w-40" />
                  <Input value={h.name} onChange={(e) => set('holidays', form.holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" />
                  <IconButton label="Remove" tone="danger" onClick={() => set('holidays', form.holidays.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              ))}
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => set('holidays', [...form.holidays, { date: new Date().toISOString().slice(0, 10), name: '' }])}>
                Add holiday
              </Button>
            </div>
          </div>
          <Field label="During open hours send calls to">
            <DestinationPicker type={form.match_dest_type} target={form.match_dest_target} onChange={(t, v) => setForm((f) => ({ ...f, match_dest_type: t, match_dest_target: v }))} exclude={['time_condition']} />
          </Field>
          <Field label="When closed send calls to">
            <DestinationPicker type={form.nomatch_dest_type} target={form.nomatch_dest_target} onChange={(t, v) => setForm((f) => ({ ...f, nomatch_dest_type: t, nomatch_dest_target: v }))} exclude={['time_condition']} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
