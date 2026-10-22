import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, FlaskConical, Pencil, Plus, Route, Trash2, X } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import type { OutboundRoute, Trunk } from '../lib/types';
import { PATTERN_PRESETS, patternToRegex, specificity } from '../lib/patterns';
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

type Form = Omit<OutboundRoute, 'id'>;
const EMPTY: Form = { name: '', priority: 10, patterns: [], strip: 0, prepend: '', callerid: '', trunk_ids: [], enabled: true };

export function RoutesPage() {
  const list = useList<OutboundRoute>('routes');
  const trunks = useList<Trunk>('trunks');
  const remove = useRemove('routes', 'Route deleted');
  const confirm = useConfirm();
  const [editing, setEditing] = useState<OutboundRoute | 'new' | null>(null);
  const [test, setTest] = useState('');
  const trunkName = (id: number) => trunks.data?.find((t) => t.id === id)?.name ?? `#${id}`;

  const match = useMemo(() => {
    const num = test.replace(/[^\d+*#]/g, '');
    if (!num || !list.data) return null;
    const candidates = list.data
      .filter((r) => r.enabled)
      .flatMap((r) => r.patterns.map((p) => ({ route: r, pattern: p, re: patternToRegex(p) })))
      .filter((c) => c.re?.test(num))
      .sort((a, b) => specificity(a.pattern) - specificity(b.pattern) || a.route.priority - b.route.priority);
    return { num, hit: candidates[0] ?? null };
  }, [test, list.data]);

  return (
    <div>
      <PageHeader
        title="Calling rules"
        icon={<Route className="size-5" />}
        description="Which line each outside call goes out on, with a backup line if one fails"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add route
          </Button>
        }
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <FlaskConical className="size-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Test a number</span>
          <Input value={test} onChange={(e) => setTest(e.target.value)} placeholder="01712345678" className="max-w-56" />
          {match &&
            (match.hit ? (
              <span className="text-sm text-slate-600">
                Goes out via <b>{match.hit.route.name}</b> (pattern <span className="kbd">{match.hit.pattern}</span>) as{' '}
                <span className="kbd">{match.hit.route.prepend + match.num.slice(match.hit.route.strip)}</span> on{' '}
                {match.hit.route.trunk_ids.map(trunkName).join(' → ')}
              </span>
            ) : (
              <span className="text-sm text-rose-600">No route matches — this call would be rejected</span>
            ))}
        </div>
      </Card>

      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState
            icon={<Route className="size-5" />}
            title="No outbound routes"
            description="Without a route, extensions can only call each other. Add one to reach mobiles and landlines through a trunk."
            action={<Button variant="primary" onClick={() => setEditing('new')}>Add route</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-16">Prio</th>
                  <th>Route</th>
                  <th>Dial patterns</th>
                  <th>Trunks (failover order)</th>
                  <th>Caller ID</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((r) => (
                  <tr key={r.id} className={clsx(!r.enabled && 'opacity-55')}>
                    <td className="font-mono text-sm text-slate-500">{r.priority}</td>
                    <td>
                      <div className="font-medium text-slate-900">{r.name}</div>
                      {(r.strip > 0 || r.prepend) && (
                        <div className="text-xs text-slate-500">
                          {r.strip > 0 && `strip ${r.strip}`} {r.prepend && `prepend ${r.prepend}`}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.patterns.map((p) => (
                          <span key={p} className="kbd">
                            {p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-sm text-slate-700">{r.trunk_ids.map(trunkName).join(' → ') || <Badge tone="red">No trunk</Badge>}</td>
                    <td className="font-mono text-sm text-slate-600">{r.callerid || <span className="font-sans text-slate-400">Default</span>}</td>
                    <td>
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Edit" onClick={() => setEditing(r)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Delete"
                          tone="danger"
                          onClick={async () => {
                            if (await confirm({ title: `Delete route "${r.name}"?`, confirmLabel: 'Delete', danger: true })) remove.mutate(r.id);
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
      {editing && <RouteModal route={editing === 'new' ? null : editing} trunks={trunks.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RouteModal({ route, trunks, onClose }: { route: OutboundRoute | null; trunks: Trunk[]; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => (route ? { ...EMPTY, ...route } : { ...EMPTY, trunk_ids: trunks[0] ? [trunks[0].id] : [] }));
  const [draft, setDraft] = useState('');
  const save = useSave('routes', { created: 'Route added', updated: 'Route saved' });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const addPattern = (p: string) => {
    const v = p.trim();
    if (v && !form.patterns.includes(v)) set('patterns', [...form.patterns, v]);
  };
  const move = (i: number, d: -1 | 1) => {
    const ids = [...form.trunk_ids];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    set('trunk_ids', ids);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={route ? `Edit route · ${route.name}` : 'New outbound route'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name || !form.patterns.length || !form.trunk_ids.length}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: route?.id, data: form }).catch(() => null);
              if (ok) onClose();
            }}
          >
            Save route
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Name" className="sm:col-span-3">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Mobile calls" autoFocus />
        </Field>
        <Field label="Priority" hint="Lower wins on identical patterns">
          <NumberInput value={form.priority} onChange={(v) => set('priority', v)} min={0} max={1000} />
        </Field>

        <Field
          label="Dial patterns"
          className="sm:col-span-4"
          hint={
            <>
              <span className="kbd">X</span> any digit · <span className="kbd">Z</span> 1-9 · <span className="kbd">N</span> 2-9 · <span className="kbd">[1-5]</span> range ·{' '}
              <span className="kbd">.</span> one or more · <span className="kbd">!</span> zero or more
            </>
          }
        >
          <div className="rounded-lg border border-slate-300 bg-white p-2 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15">
            <div className="flex flex-wrap gap-1.5">
              {form.patterns.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded-md bg-slate-100 py-0.5 pr-1 pl-2 font-mono text-sm text-slate-700">
                  {p}
                  <button type="button" onClick={() => set('patterns', form.patterns.filter((x) => x !== p))} className="rounded p-0.5 hover:bg-slate-200" aria-label={`Remove ${p}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9XZNxzn[\]\-.!+*#]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                    e.preventDefault();
                    addPattern(draft);
                    setDraft('');
                  } else if (e.key === 'Backspace' && !draft && form.patterns.length) {
                    set('patterns', form.patterns.slice(0, -1));
                  }
                }}
                onBlur={() => {
                  addPattern(draft);
                  setDraft('');
                }}
                placeholder={form.patterns.length ? '' : 'Type a pattern and press Enter'}
                className="min-w-32 flex-1 bg-transparent px-1 py-0.5 font-mono text-sm focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PATTERN_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => p.patterns.forEach(addPattern)}
                className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                + {p.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Strip digits" hint="Removed from the front">
          <NumberInput value={form.strip} onChange={(v) => set('strip', v)} min={0} max={20} />
        </Field>
        <Field label="Prepend" hint="Added in front">
          <Input value={form.prepend} onChange={(e) => set('prepend', e.target.value.replace(/[^\d+]/g, ''))} placeholder="none" />
        </Field>
        <Field label="Caller ID" className="sm:col-span-2" hint="Number shown to the called party (default: SIP server)">
          <Input value={form.callerid} onChange={(e) => set('callerid', e.target.value.replace(/[^\d+]/g, ''))} placeholder="Default" />
        </Field>

        <Field label="Trunks" className="sm:col-span-4" hint="Tried in order when a trunk is down or full">
          <div className="space-y-1.5">
            {form.trunk_ids.map((id, i) => (
              <div key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                <span className="w-5 text-xs font-semibold text-slate-400">{i + 1}.</span>
                <span className="flex-1 font-medium text-slate-800">{trunks.find((t) => t.id === id)?.name ?? `Trunk #${id}`}</span>
                <IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === form.trunk_ids.length - 1}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton label="Remove" tone="danger" onClick={() => set('trunk_ids', form.trunk_ids.filter((x) => x !== id))}>
                  <X className="size-4" />
                </IconButton>
              </div>
            ))}
            {trunks.some((t) => !form.trunk_ids.includes(t.id)) && (
              <Select value="" onChange={(e) => e.target.value && set('trunk_ids', [...form.trunk_ids, Number(e.target.value)])}>
                <option value="">+ Add a trunk…</option>
                {trunks
                  .filter((t) => !form.trunk_ids.includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            )}
            {!trunks.length && <p className="text-sm text-amber-700">Add a SIP trunk first.</p>}
          </div>
        </Field>
        <div className="sm:col-span-4">
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enabled" />
        </div>
      </div>
    </Modal>
  );
}
