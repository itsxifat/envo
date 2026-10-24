import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogIn, Smartphone } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { formatBdt, formatDate, formatDateTime } from '../../lib/format';
import { formatNumber, type PhoneStage } from '../../personal/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  Modal,
  Notice,
  NumberInput,
  PageHeader,
  SearchInput,
  Select,
  TableSkeleton,
  Tabs,
  Toggle,
} from '../../components/ui';

interface Person {
  id: number;
  name: string;
  email: string;
  mobile: string;
  status: string;
  stage: PhoneStage;
  verified: boolean;
  number: string | null;
  balance: number;
  created_at: string;
  close_requested_at: string | null;
}

interface PersonDetail {
  stage: PhoneStage;
  name: string;
  email: string;
  mobile: string;
  number: string | null;
  balance: number;
  ledger: { id: number; kind: string; amount: string; note: string; created_at: string; created_by_name: string | null }[];
  recharges: { id: number; amount: string; status: string; created_at: string; invoice_number: string; invoice_status: string }[];
  requests: { id: number; status: string; requested_number: string; reason: string; created_at: string }[];
}

interface PhoneSettings {
  signups: boolean;
  provider: string;
  activation_min: number;
  recharge: { min: number; max: number; presets: number[] };
  rate_per_min: number;
  free_onnet: boolean;
  selfie_check: boolean;
  support: { phone: string; email: string };
  min_app_version: string;
  update_url: string;
}

/** What each stage means for support, in a word or two. */
const STAGE: Record<PhoneStage, { label: string; tone: 'gray' | 'amber' | 'green' | 'red' | 'blue' }> = {
  verify: { label: 'Confirming email', tone: 'gray' },
  kyc: { label: 'Registration not sent', tone: 'gray' },
  activate: { label: 'Waiting for first recharge', tone: 'blue' },
  registering: { label: 'To register', tone: 'amber' },
  active: { label: 'Active', tone: 'green' },
  suspended: { label: 'Paused', tone: 'red' },
};

const REQUEST_LABEL: Record<string, string> = { submitted: 'New', in_review: 'In progress', connected: 'Connected', rejected: 'Rejected', cancelled: 'Withdrawn' };
const RECHARGE_LABEL: Record<string, string> = { awaiting_payment: 'Waiting for payment', paid: 'Paid · add at operator', applied: 'Added at operator', cancelled: 'Cancelled' };

const FILTERS = [
  { value: '', label: 'Everyone' },
  { value: 'registering', label: 'To register' },
  { value: 'activate', label: 'Waiting for payment' },
  { value: 'active', label: 'Active' },
  { value: 'new', label: 'Not finished' },
] as const;

export function PhoneAppPage() {
  const [tab, setTab] = useState<'people' | 'settings'>('people');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Envo Phone"
        icon={<Smartphone className="size-5" />}
        description="People with a personal number, from the app or the website. Their registrations and recharges also appear under Number requests and Sales."
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'people', label: 'People' }, { value: 'settings', label: 'Settings' }]} />}
      />
      {tab === 'people' ? <People /> : <SettingsForm />}
    </div>
  );
}

function People() {
  const list = useQuery({ queryKey: ['admin', 'phone', 'people'], queryFn: () => api.get<Person[]>('/api/admin/phone/people'), refetchInterval: 30_000 });
  const { openCustomerPortal } = useAuth();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('');
  const [open, setOpen] = useState<Person | null>(null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data ?? []).filter(
      (p) =>
        (!filter || (filter === 'new' ? p.stage === 'verify' || p.stage === 'kyc' : p.stage === filter)) &&
        (!needle || [p.name, p.email, p.mobile, p.number ?? ''].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [list.data, q, filter]);
  const count = (s: PhoneStage) => (list.data ?? []).filter((p) => p.stage === s).length;

  if (list.error) return <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Active numbers" value={count('active')} />
        <Tile label="To register at the operator" value={count('registering')} tone={count('registering') ? 'amber' : undefined} hint={count('registering') ? <Link to="/admin/number-requests" className="font-medium text-brand-600">Open number requests</Link> : 'Nothing waiting'} />
        <Tile label="Waiting for first recharge" value={count('activate')} />
        <Tile label="Signed up, not finished" value={count('verify') + count('kyc')} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
          <Tabs value={filter} onChange={setFilter} tabs={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
          <SearchInput value={q} onChange={setQ} placeholder="Name, email, mobile or number" className="ml-auto w-full sm:w-72" />
        </div>
        {list.isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : !rows.length ? (
          <EmptyState icon={<Smartphone className="size-5" />} title={list.data?.length ? 'Nobody matches that' : 'Nobody has signed up yet'} description="People who sign up in the app or on the website's personal page show up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Number</th>
                  <th>Stage</th>
                  <th className="text-right">Balance</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="cursor-pointer" onClick={() => setOpen(p)}>
                    <td>
                      <div className="font-medium text-slate-950">{p.name}</div>
                      <div className="text-[12.5px] text-slate-500">
                        {p.email} · {p.mobile}
                      </div>
                    </td>
                    <td className="tabular-nums">{p.number ? formatNumber(p.number) : <span className="text-slate-400">—</span>}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={STAGE[p.stage].tone}>{STAGE[p.stage].label}</Badge>
                        {p.close_requested_at && <Badge tone="red">Wants to close</Badge>}
                      </div>
                    </td>
                    <td className="text-right font-medium tabular-nums">{formatBdt(p.balance)}</td>
                    <td className="text-slate-500">{formatDate(p.created_at)}</td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <IconButton label="Open their phone (support access)" onClick={() => void openCustomerPortal(p.id).catch((err) => toast.error(errorMessage(err)))}>
                        <LogIn className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <PersonModal person={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number; hint?: React.ReactNode; tone?: 'amber' }) {
  return (
    <Card className={tone === 'amber' ? 'p-4 ring-1 ring-amber-300' : 'p-4'}>
      <p className="text-[12.5px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-[26px] font-semibold tracking-tight text-slate-950 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[12.5px] text-slate-400">{hint}</p>}
    </Card>
  );
}

function PersonModal({ person, onClose }: { person: Person; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['admin', 'phone', 'person', person.id], queryFn: () => api.get<PersonDetail>(`/api/admin/phone/people/${person.id}`) });
  // The amount stays text while typing, so "-50" is a deduction and not 50.
  const [adjust, setAdjust] = useState({ amount: '', note: '' });
  const amount = Number(adjust.amount);
  const amountOk = adjust.amount !== '' && Number.isFinite(amount) && amount !== 0;
  const save = useMutation({
    mutationFn: () => api.post<{ balance: number }>(`/api/admin/phone/people/${person.id}/adjust`, { amount, note: adjust.note }),
    onSuccess: (r) => {
      toast.success(`Balance is now ${formatBdt(r.balance)}`);
      setAdjust({ amount: '', note: '' });
      void qc.invalidateQueries({ queryKey: ['admin', 'phone'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const d = detail.data;
  return (
    <Modal open onClose={onClose} title={person.name} description={`${person.email} · ${person.mobile}`} size="lg">
      {!d ? (
        <TableSkeleton rows={4} cols={3} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Info label="Stage">
              <Badge tone={STAGE[d.stage].tone}>{STAGE[d.stage].label}</Badge>
            </Info>
            <Info label="Number">{d.number ? formatNumber(d.number) : '—'}</Info>
            <Info label="Balance">{formatBdt(d.balance)}</Info>
          </div>

          <form
            className="grid gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (amountOk && adjust.note.trim().length >= 3) save.mutate();
            }}
          >
            <Field
              label="Correct by (BDT)"
              hint={amountOk ? (amount < 0 ? `Takes ${formatBdt(-amount)} away` : `Adds ${formatBdt(amount)}`) : adjust.amount && adjust.amount !== '-' ? 'Write an amount like 50 or -50' : 'Minus takes away'}
            >
              <Input inputMode="decimal" value={adjust.amount} onChange={(e) => setAdjust((a) => ({ ...a, amount: e.target.value.replace(/[^\d.-]/g, '').slice(0, 12) }))} placeholder="e.g. 50 or -50" />
            </Field>
            <Field label="Why">
              <Input value={adjust.note} onChange={(e) => setAdjust((a) => ({ ...a, note: e.target.value }))} placeholder="e.g. Refund for a dropped call" maxLength={200} />
            </Field>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!amountOk || adjust.note.trim().length < 3}>
              Save
            </Button>
          </form>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-slate-950">Registrations</h3>
              {d.requests.length ? (
                <ul className="space-y-1.5 text-[13.5px]">
                  {d.requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2">
                      <Link to="/admin/number-requests" className="font-medium text-brand-600">
                        #{r.id}
                      </Link>
                      <span className="tabular-nums">{r.requested_number ? formatNumber(r.requested_number) : 'number to choose'}</span>
                      <Badge tone={r.status === 'connected' ? 'green' : r.status === 'rejected' || r.status === 'cancelled' ? 'gray' : 'amber'}>{REQUEST_LABEL[r.status] ?? r.status}</Badge>
                      {r.reason && <span className="text-slate-500">· {r.reason}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-slate-500">Not sent yet.</p>
              )}
              <h3 className="mt-5 mb-2 text-[13px] font-semibold text-slate-950">Recharges</h3>
              {d.recharges.length ? (
                <ul className="space-y-1.5 text-[13.5px]">
                  {d.recharges.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">{formatBdt(r.amount)}</span>
                      <span className="text-slate-500">{formatDate(r.created_at)}</span>
                      <Badge tone={r.status === 'applied' ? 'green' : r.status === 'paid' ? 'amber' : 'gray'}>{RECHARGE_LABEL[r.status] ?? r.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-slate-500">None yet.</p>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-slate-950">Balance activity</h3>
              {d.ledger.length ? (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto text-[13.5px]">
                  {d.ledger.map((l) => (
                    <li key={l.id} className="flex items-baseline gap-2">
                      <span className={Number(l.amount) >= 0 ? 'w-20 shrink-0 font-medium text-emerald-600 tabular-nums' : 'w-20 shrink-0 font-medium tabular-nums'}>
                        {Number(l.amount) > 0 ? '+' : ''}
                        {Number(l.amount).toFixed(2)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{l.note}</span>
                      <span className="shrink-0 text-[12px] text-slate-400">{formatDateTime(l.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-slate-500">Nothing yet.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <p className="text-[12px] font-medium text-slate-500">{label}</p>
      <div className="mt-1 text-[15px] font-semibold text-slate-950 tabular-nums">{children}</div>
    </div>
  );
}

function SettingsForm() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin', 'phone', 'settings'], queryFn: () => api.get<PhoneSettings>('/api/admin/phone/settings') });
  const supply = useQuery({ queryKey: ['admin', 'supply', 'settings'], queryFn: () => api.get<{ providers: { id: string; name: string; prefix: string }[] }>('/api/admin/number-supply/settings') });
  const [form, setForm] = useState<PhoneSettings | null>(null);
  const [presets, setPresets] = useState('');
  const [presetsError, setPresetsError] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && !form) {
      setForm(settings.data);
      setPresets(settings.data.recharge.presets.join(', '));
    }
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (list: number[]) => api.put<PhoneSettings>('/api/admin/phone/settings', { ...form, recharge: { ...form!.recharge, presets: list } }),
    onSuccess: (s) => {
      qc.setQueryData(['admin', 'phone', 'settings'], s);
      setForm(s);
      setPresets(s.recharge.presets.join(', '));
      toast.success('Saved. The app and the website use these right away.');
    },
  });
  if (settings.error) return <ErrorBlock error={settings.error} />;
  if (!form) return <TableSkeleton rows={6} cols={2} />;
  const set = <K extends keyof PhoneSettings>(k: K, v: PhoneSettings[K]) => setForm((f) => ({ ...f!, [k]: v }));
  /** The amounts to tap, or why they can't be saved ("1,000" would split into 1 and 000). */
  const readPresets = (): number[] | string => {
    const smallest = Math.min(form.activation_min, form.recharge.min);
    const parts = presets.split(/[\s,]+/).filter(Boolean);
    const list = parts.map(Number);
    if (list.some((n) => !Number.isFinite(n) || n <= 0 || n < smallest)) {
      return `Write each amount as one number of at least ${formatBdt(smallest)}, without commas inside it, e.g. 100, 200, 1000.`;
    }
    if (list.length > 6) return 'Up to six amounts.';
    return list;
  };
  return (
    <form
      className="grid gap-6 lg:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const list = readPresets();
        if (typeof list === 'string') {
          setPresetsError(list);
          toast.error(list);
          return;
        }
        setPresetsError(null);
        save.mutate(list);
      }}
    >
      <Card>
        <CardHeader title="Signing up and activating" />
        <div className="space-y-5 p-5">
          <Toggle checked={form.signups} onChange={(v) => set('signups', v)} label="New people can sign up" description="People who already have an account can always sign in." />
          <Field label="Numbers come from" hint="A random free number of this provider's pool is reserved at registration.">
            <Select value={form.provider} onChange={(e) => set('provider', e.target.value)}>
              {(supply.data?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.prefix}…)
                </option>
              ))}
            </Select>
          </Field>
          <Toggle
            checked={form.selfie_check}
            onChange={(v) => set('selfie_check', v)}
            label="Check selfies automatically"
            description="A live selfie (looking at the camera, then turning the head) is checked here and matched with the NID photo, like banking apps do. Off: any photo, and you compare by eye."
          />
          <Field label="First recharge, at least (BDT)" hint="It activates the number; all of it becomes calling balance.">
            <NumberInput value={form.activation_min} onChange={(v) => set('activation_min', v)} min={0} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Later recharges from (BDT)">
              <NumberInput value={form.recharge.min} onChange={(v) => set('recharge', { ...form.recharge, min: v })} min={1} />
            </Field>
            <Field label="Up to (BDT)">
              <NumberInput value={form.recharge.max} onChange={(v) => set('recharge', { ...form.recharge, max: v })} min={1} />
            </Field>
          </div>
          <Field label="Amounts to tap" hint="Up to six, separated by commas, with no commas inside an amount: e.g. 100, 200, 1000." error={presetsError}>
            <Input
              value={presets}
              onChange={(e) => {
                setPresets(e.target.value);
                setPresetsError(null);
              }}
              placeholder="100, 200, 1000"
              invalid={!!presetsError}
            />
          </Field>
        </div>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Calls" />
          <div className="space-y-5 p-5">
            <Field label="Price per minute to other networks (BDT)" hint="Charged per started minute of an answered call.">
              <NumberInput value={form.rate_per_min} onChange={(v) => set('rate_per_min', v)} min={0} step="0.01" />
            </Field>
            <Toggle checked={form.free_onnet} onChange={(v) => set('free_onnet', v)} label="Calls between Envo numbers are free" />
          </div>
        </Card>
        <Card>
          <CardHeader title="The app" />
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Support phone">
                <Input value={form.support.phone} onChange={(e) => set('support', { ...form.support, phone: e.target.value })} placeholder="09639…" />
              </Field>
              <Field label="Support email">
                <Input type="email" value={form.support.email} onChange={(e) => set('support', { ...form.support, email: e.target.value })} placeholder="support@enfinito.com" />
              </Field>
            </div>
            <Field label="Oldest app version that still works" hint="Older apps ask people to update before they continue.">
              <Input value={form.min_app_version} onChange={(e) => set('min_app_version', e.target.value)} placeholder="1.0.0" />
            </Field>
            <Field label="Where to get the app" hint="Leave empty to use the APK on Envo's website (uploaded by each deploy). Or a Play Store link, once the app is there.">
              <Input value={form.update_url} onChange={(e) => set('update_url', e.target.value)} placeholder="https://…" />
            </Field>
          </div>
        </Card>
        {save.error && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save settings
          </Button>
        </div>
      </div>
    </form>
  );
}
