import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, FileText, Inbox, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { formatBdt, formatDateTime, timeAgo } from '../../lib/format';
import type { NumberRequestStatus, SubscriberDetails, SupplyCounts, SupplyProvider, SupplySettings, TopupStatus } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CopyButton,
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
  Select,
  TableSkeleton,
  Tabs,
  Textarea,
  Toggle,
  useConfirm,
} from '../../components/ui';

/*
 * Support's side of numbers from Enfinito: requests to register and connect, paid top-ups to add at
 * the operator, the pool of numbers customers choose from, and the settings.
 */

interface RequestRow {
  id: number;
  status: NumberRequestStatus;
  /** The provider the number comes from (its id in the settings). */
  provider: string;
  requested_number: string;
  /** A special number the customer applied for; '' for an ordinary request. */
  special: string;
  reason: string;
  created_at: string;
  updated_at: string;
  subscriber_name: string | null;
  account_id: number;
  account_name: string;
  /** Envo Phone requests come from one person (the app or the website's personal side). */
  account_kind: 'business' | 'personal';
  /** Envo Phone: the first recharge is not paid yet, so the number is not registered yet. */
  awaiting_payment: boolean;
  tenant_id: number | null;
  tenant_name: string | null;
  connected_number: string | null;
}

interface RequestDetail extends RequestRow {
  details: Partial<SubscriberDetails>;
  pool_id: number | null;
  consent_at: string;
  account_email: string;
  account_phone: string;
  created_by_name: string | null;
  decided_by_name: string | null;
  has_photo: boolean;
  id_type: 'image' | 'pdf' | null;
  lines: { id: number; name: string; host: string; username: string }[];
}

interface PoolRow {
  id: number;
  number: string;
  status: 'available' | 'reserved' | 'assigned';
  note: string;
  updated_at: string;
  request_id: number | null;
  account_id: number | null;
  account_name: string | null;
}

interface TopupRow {
  id: number;
  number: string;
  amount: string;
  status: TopupStatus;
  note: string;
  created_at: string;
  applied_at: string | null;
  invoice_number: string;
  paid_at: string | null;
  account_id: number;
  account_name: string;
  applied_by_name: string | null;
}

const STATUS: Record<NumberRequestStatus, { tone: 'blue' | 'amber' | 'green' | 'red' | 'gray'; label: string }> = {
  submitted: { tone: 'blue', label: 'New' },
  in_review: { tone: 'amber', label: 'In progress' },
  connected: { tone: 'green', label: 'Connected' },
  rejected: { tone: 'red', label: 'Rejected' },
  cancelled: { tone: 'gray', label: 'Cancelled by customer' },
};

const OCCUPATION: Record<string, string> = {
  government_service: 'Government service',
  private_service: 'Private service',
  business: 'Business',
  student: 'Student',
  other: 'Other',
};

const KEY = ['admin', 'number-supply'];
const base = '/api/admin/number-supply';

type Tab = 'requests' | 'topups' | 'pool' | 'settings';

export function NumberRequestsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = raw === 'topups' || raw === 'pool' || raw === 'settings' ? raw : 'requests';
  const summary = useQuery({ queryKey: [...KEY, 'summary'], queryFn: () => api.get<SupplyCounts>(`${base}/summary`), refetchInterval: 30_000 });
  const s = summary.data;
  return (
    <>
      <PageHeader title="Number requests" icon={<Inbox />} description="Numbers customers asked for, their top-ups, and the numbers you can give out" />
      <Tabs
        className="mb-4 sm:mb-6"
        value={tab}
        onChange={(v) => setParams(v === 'requests' ? {} : { tab: v }, { replace: true })}
        tabs={[
          { value: 'requests', label: 'Requests', count: s ? s.new_requests + s.in_review : undefined },
          { value: 'topups', label: 'Top-ups to add', count: s?.topups_to_add },
          { value: 'pool', label: 'Number pool', count: s?.available },
          { value: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'requests' && <RequestsTab />}
      {tab === 'topups' && <TopupsTab />}
      {tab === 'pool' && <PoolTab counts={s} />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}

// ------------------------------------------------------------------ requests
function RequestsTab() {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery({ queryKey: [...KEY, 'requests', filter], queryFn: () => api.get<RequestRow[]>(`${base}/requests?status=${filter}`), refetchInterval: 30_000 });
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-black/[0.06] px-4 py-3">
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'open', label: 'Waiting' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {list.isLoading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<Inbox className="size-5" />}
          title={filter === 'open' ? 'Nothing waiting' : 'No requests yet'}
          description="When a customer asks for a new number, it shows up here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Subscriber</th>
                <th>Number</th>
                <th>Status</th>
                <th>Sent</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={r.account_kind === 'personal' ? '/admin/phone' : `/admin/customers/${r.account_id}`} className="block min-w-0 hover:text-brand-700">
                      <div className="truncate text-sm font-medium text-slate-900">{r.account_name}</div>
                      <div className="truncate text-xs text-slate-500">{r.account_kind === 'personal' ? 'Envo Phone' : (r.tenant_name ?? 'SIP server removed')}</div>
                    </Link>
                  </td>
                  <td className="text-sm text-slate-700">{r.subscriber_name ?? '—'}</td>
                  <td className="font-mono text-sm font-semibold text-slate-900">
                    {r.connected_number || r.requested_number || (r.special ? <SpecialWish text={r.special} /> : <span className="font-sans font-normal text-slate-500">Any free number</span>)}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={STATUS[r.status].tone} dot>
                        {STATUS[r.status].label}
                      </Badge>
                      {r.awaiting_payment && (r.status === 'submitted' || r.status === 'in_review') && <Badge tone="gray">Not paid yet</Badge>}
                    </div>
                  </td>
                  <td className="text-sm text-slate-600">{timeAgo(r.created_at)}</td>
                  <td>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => setOpenId(r.id)}>
                        Open
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId !== null && <RequestModal id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

/** A special number application: the number the customer asked for. */
function SpecialWish({ text }: { text: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-sans">
      <Badge tone="violet">Special</Badge>
      <span className={/^\d+$/.test(text) ? 'font-mono text-sm font-semibold text-slate-900' : 'text-sm font-medium text-slate-800'}>{text}</span>
    </span>
  );
}

const address = (a?: { street: string; city: string; postcode: string; country: string }) => (a ? [a.street, a.city, a.postcode, a.country].filter(Boolean).join(', ') : '');

/** The subscriber's details as label/value pairs, in the order of the operator's form. */
function detailRows(d: Partial<SubscriberDetails>): [string, string][] {
  const rows: [string, string | undefined][] = [
    ['Subscriber type', d.subscriber_type === 'organization' ? 'Organization' : d.subscriber_type === 'individual' ? 'Individual' : undefined],
    [d.subscriber_type === 'organization' ? 'Organization name' : 'Name', d.name],
    ['Authorized person', d.subscriber_type === 'organization' ? d.authorized_person : undefined],
    ['NID number', d.nid],
    ['Passport number', d.passport],
    ['Date of birth', d.birth_date],
    ['Gender', d.gender === 'male' ? 'Male' : d.gender === 'female' ? 'Female' : undefined],
    ['Occupation', d.occupation ? OCCUPATION[d.occupation] : undefined],
    ['Mobile', d.phone],
    ['Email', d.email],
    ['Present address', address(d.present_address)],
    ['Permanent address', address(d.permanent_address)],
    ['Billing address', d.billing_address === 'permanent' ? 'Permanent' : d.billing_address === 'present' ? 'Present' : undefined],
    ["Father's name", d.father_name],
    ["Mother's name", d.mother_name],
    ["Spouse's name", d.spouse_name],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

function RequestModal({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEY, 'request', id], queryFn: () => api.get<RequestDetail>(`${base}/requests/${id}`) });
  const settings = useQuery({ queryKey: [...KEY, 'settings'], queryFn: () => api.get<SupplySettings>(`${base}/settings`) });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({ number: '', label: '', mode: 'own' as 'own' | 'existing', trunk_id: 0, username: '', password: '' });
  const d = q.data;
  const provider = settings.data?.providers.find((p) => p.id === d?.provider) ?? null;
  // The number to connect: the one chosen, the special one asked for, or the provider's prefix to finish.
  useEffect(() => {
    if (!d) return;
    const start = d.requested_number || (/^\d+$/.test(d.special) ? d.special : '') || provider?.prefix || '';
    setForm((f) => (f.number ? f : { ...f, number: start, username: start.length >= 10 ? start.replace(/^\+/, '') : '', trunk_id: d.lines[0]?.id ?? 0 }));
  }, [d, provider]);

  const done = (message: string) => {
    void qc.invalidateQueries({ queryKey: KEY });
    toast.success(message);
  };
  const review = useMutation({ mutationFn: () => api.post(`${base}/requests/${id}/review`), onSuccess: () => done('Marked as in progress'), onError: (e) => toast.error(errorMessage(e)) });
  const reject = useMutation({
    mutationFn: () => api.post(`${base}/requests/${id}/reject`, { reason }),
    onSuccess: () => {
      done('Request rejected');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const connect = useMutation({
    mutationFn: () =>
      api.post(`${base}/requests/${id}/connect`, {
        number: form.number,
        label: form.label,
        trunk_id: form.mode === 'existing' ? form.trunk_id : null,
        username: form.username,
        password: form.password,
      }),
    onSuccess: () => {
      done(`${form.number} is connected for the customer`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const open = d && (d.status === 'submitted' || d.status === 'in_review');
  const rows = d ? detailRows(d.details) : [];
  const operator = provider?.name ?? 'the provider';
  const asText = d
    ? [`Provider: ${operator}`, `Number: ${d.special ? `special, wants ${d.special}` : d.requested_number || 'any free number'}`, ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n')
    : '';
  const line = provider?.line;
  const canConnect = !!form.number && (form.mode === 'existing' ? !!form.trunk_id : !!line?.host && !!form.password);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={d ? d.details.name || d.subscriber_name || 'Number request' : 'Number request'}
      description={d ? `${d.account_name} · ${d.tenant_name ?? 'SIP server removed'} · sent ${formatDateTime(d.created_at)}` : undefined}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {q.isLoading || !d ? (
        q.error ? <ErrorBlock error={q.error} /> : <LoadingBlock />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[d.status].tone} dot>
              {STATUS[d.status].label}
            </Badge>
            {d.connected_number || d.requested_number || !d.special ? (
              <span className="font-mono text-sm font-semibold text-slate-900">{d.connected_number || d.requested_number || 'Any free number'}</span>
            ) : (
              <SpecialWish text={d.special} />
            )}
            <span className="text-xs text-slate-500">from {operator}</span>
            {d.decided_by_name && <span className="text-xs text-slate-500">· handled by {d.decided_by_name}</span>}
          </div>
          {d.status === 'rejected' && d.reason && <Notice tone="danger" title="Rejected">{d.reason}</Notice>}
          {open && d.account_kind === 'personal' && (
            <Notice tone={d.awaiting_payment ? 'warn' : 'info'} title={d.awaiting_payment ? 'Envo Phone · first recharge not paid yet' : 'Envo Phone · paid, ready to register'}>
              {d.awaiting_payment
                ? 'This person is registering for a personal number. Register it at the operator once their first recharge is paid; connecting before that is refused.'
                : 'Register the number at the operator, connect it here (it rings their phone right away), then add their paid recharge under Top-ups.'}
            </Notice>
          )}
          {open && d.special && (
            <Notice title={`Special number wanted: ${d.special}`}>
              Check with {operator} that it is free. If it costs extra, send the customer an invoice under Sales & invoices first. If it is taken, reject the request and say so;
              they can apply again.
            </Notice>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Subscriber details</p>
                {rows.length > 1 && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    Copy as text <CopyButton value={asText} label="Copy all details" />
                  </span>
                )}
              </div>
              {rows.length > 1 ? (
                <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex flex-wrap gap-x-3 px-3.5 py-2 text-sm">
                      <dt className="w-40 shrink-0 text-slate-500">{k}</dt>
                      <dd className="min-w-0 flex-1 font-medium break-words text-slate-900">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">This request is closed, so only the name was kept.</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Sent by {d.created_by_name ?? 'the customer'}, who agreed to share these with {operator} ({formatDateTime(d.consent_at)}).
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">Documents</p>
              {d.has_photo ? (
                <a href={`${base}/requests/${id}/files/photo`} target="_blank" rel="noreferrer" className="block">
                  <img src={`${base}/requests/${id}/files/photo`} alt="Subscriber photo" className="max-h-56 rounded-xl object-contain ring-1 ring-black/[0.08]" />
                </a>
              ) : null}
              {d.id_type === 'image' && (
                <a href={`${base}/requests/${id}/files/id`} target="_blank" rel="noreferrer" className="block">
                  <img src={`${base}/requests/${id}/files/id`} alt="NID or passport" className="max-h-56 rounded-xl object-contain ring-1 ring-black/[0.08]" />
                </a>
              )}
              {d.id_type === 'pdf' && (
                <a href={`${base}/requests/${id}/files/id`} target="_blank" rel="noreferrer">
                  <Button size="sm" icon={<FileText className="size-4" />}>
                    Open the NID / passport PDF <ExternalLink className="size-3.5" />
                  </Button>
                </a>
              )}
              {!d.has_photo && !d.id_type && <p className="text-sm text-slate-500">No documents (deleted when a request is closed).</p>}
            </div>
          </div>

          {open && (
            <div className="space-y-5 border-t border-black/[0.06] pt-5">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>Register the number with {operator}: copy the details above into their subscriber form, with the photo and ID.</li>
                <li>When {operator} has created it, enter its password below and connect it. The customer's calls start working right away.</li>
              </ol>
              {d.status === 'submitted' && (
                <Button loading={review.isPending} onClick={() => review.mutate()}>
                  Mark as in progress
                </Button>
              )}

              <Card className="p-4">
                <p className="mb-3 text-sm font-semibold text-slate-900">Connect the number</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Number">
                    <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value.replace(/[^\d+]/g, '') })} inputMode="tel" />
                  </Field>
                  <Field label="Name (optional)" hint="Shown on the customer's Phone numbers page">
                    <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} maxLength={60} />
                  </Field>
                  {d.lines.length > 0 && (
                    <Field label="Line" className="sm:col-span-2">
                      <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as 'own' | 'existing' })}>
                        <option value="own">Its own registration at {operator}</option>
                        <option value="existing">One of the customer's existing lines</option>
                      </Select>
                    </Field>
                  )}
                  {form.mode === 'existing' ? (
                    <Field label="Existing line" className="sm:col-span-2">
                      <Select value={form.trunk_id} onChange={(e) => setForm({ ...form, trunk_id: Number(e.target.value) })}>
                        {d.lines.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.host})
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : (
                    <>
                      <Field label="Username" hint="Usually the number itself">
                        <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} autoComplete="off" />
                      </Field>
                      <Field label="Password" hint={`From ${operator}`}>
                        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
                      </Field>
                      <p className="text-xs text-slate-500 sm:col-span-2">
                        {line?.host ? (
                          <>
                            Registers to <span className="font-mono">{line.host}:{line.port}</span> ({line.transport.toUpperCase()}). Calls ring where the customer's other numbers do.
                          </>
                        ) : (
                          <span className="text-rose-700">Add {operator}'s SIP server under Settings → Providers first.</span>
                        )}
                      </p>
                    </>
                  )}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button variant="primary" loading={connect.isPending} disabled={!canConnect} onClick={() => connect.mutate()}>
                    Connect number
                  </Button>
                </div>
              </Card>

              {rejecting ? (
                <div className="space-y-3 rounded-xl border border-rose-200 p-4">
                  <Field label="Why can't this number be given?" hint="The customer sees this">
                    <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The NID photo is not readable. Please send a clearer one." maxLength={300} />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => setRejecting(false)}>Back</Button>
                    <Button variant="danger" loading={reject.isPending} disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>
                      Reject request
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setRejecting(true)}>
                  Reject…
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ top-ups
function TopupsTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<TopupStatus>('paid');
  const [marking, setMarking] = useState<TopupRow | null>(null);
  const [note, setNote] = useState('');
  const list = useQuery({ queryKey: [...KEY, 'topups', filter], queryFn: () => api.get<TopupRow[]>(`${base}/topups?status=${filter}`), refetchInterval: 30_000 });
  const apply = useMutation({
    mutationFn: () => api.post(`${base}/topups/${marking!.id}/applied`, { note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success('Marked as added');
      setMarking(null);
      setNote('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-black/[0.06] px-4 py-3">
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'paid', label: 'To add' },
            { value: 'applied', label: 'Added' },
            { value: 'awaiting_payment', label: 'Not paid yet' },
          ]}
        />
      </div>
      {filter === 'paid' && (
        <p className="border-b border-black/[0.06] bg-slate-50/70 px-4 py-2.5 text-[13px] text-slate-600">
          These customers paid. Add the amount to their number at the operator, then mark it as added.
        </p>
      )}
      {list.isLoading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : !list.data?.length ? (
        <EmptyState icon={<Inbox className="size-5" />} title={filter === 'paid' ? 'Nothing to add' : 'None'} description="Top-ups customers pay for show up here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Number</th>
                <th>Amount</th>
                <th>{filter === 'applied' ? 'Added' : filter === 'paid' ? 'Paid' : 'Asked'}</th>
                <th>Invoice</th>
                <th className="w-36" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/admin/customers/${t.account_id}`} className="text-sm font-medium text-slate-900 hover:text-brand-700">
                      {t.account_name}
                    </Link>
                  </td>
                  <td className="font-mono text-sm font-semibold text-slate-900">{t.number}</td>
                  <td className="text-sm font-semibold text-slate-900 tabular-nums">{formatBdt(t.amount)}</td>
                  <td className="text-sm text-slate-600">
                    {filter === 'applied' ? `${timeAgo(t.applied_at)}${t.applied_by_name ? ` · ${t.applied_by_name}` : ''}` : timeAgo(filter === 'paid' ? t.paid_at : t.created_at)}
                    {t.note && <div className="text-xs text-slate-500">{t.note}</div>}
                  </td>
                  <td className="font-mono text-xs text-slate-500">{t.invoice_number}</td>
                  <td>
                    {t.status === 'paid' && (
                      <div className="flex justify-end">
                        <Button size="sm" variant="primary" onClick={() => setMarking(t)}>
                          Mark as added
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {marking && (
        <Modal
          open
          onClose={() => setMarking(null)}
          size="sm"
          title={`${formatBdt(marking.amount)} to ${marking.number}`}
          description={marking.account_name}
          footer={
            <>
              <Button onClick={() => setMarking(null)}>Cancel</Button>
              <Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>
                Mark as added
              </Button>
            </>
          }
        >
          <Field label="Note (optional)" hint="For example the operator's recharge reference">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
        </Modal>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ pool
function PoolTab({ counts }: { counts: SupplyCounts | undefined }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<'available' | 'reserved' | 'assigned' | 'all'>('available');
  const [mode, setMode] = useState<'range' | 'list'>('range');
  const [range, setRange] = useState({ from: '', to: '' });
  const [pasted, setPasted] = useState('');
  const list = useQuery({ queryKey: [...KEY, 'pool', filter], queryFn: () => api.get<PoolRow[]>(`${base}/pool${filter === 'all' ? '' : `?status=${filter}`}`) });
  const listNumbers = pasted.split(/[\s,;]+/).map((n) => n.replace(/[^\d+]/g, '')).filter(Boolean);
  const rangeSize = /^\d{6,15}$/.test(range.from) && /^\d{6,15}$/.test(range.to) && range.from.length === range.to.length ? Number(range.to) - Number(range.from) + 1 : 0;
  const add = useMutation({
    mutationFn: () => api.post<{ added: number; skipped: number }>(`${base}/pool`, mode === 'range' ? range : { numbers: listNumbers }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(`${r.added.toLocaleString()} added${r.skipped ? `, ${r.skipped.toLocaleString()} were already in the pool` : ''}`);
      setRange({ from: '', to: '' });
      setPasted('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`${base}/pool/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Free', value: counts?.available },
          { label: 'Held by a request', value: counts?.reserved },
          { label: 'Given out', value: counts?.assigned },
        ].map((c) => (
          <Card key={c.label} className="p-4">
            <p className="eyebrow text-slate-500">{c.label}</p>
            <p className="font-display mt-1 text-2xl font-semibold text-slate-950 tabular-nums">{c.value?.toLocaleString() ?? '—'}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Add numbers" description="The numbers the operator allocated to you, so customers can choose one" />
        <div className="space-y-4 p-4 sm:p-5">
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: 'range', label: 'A range' },
              { value: 'list', label: 'A list' },
            ]}
          />
          {mode === 'range' ? (
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="From">
                <Input value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value.replace(/\D/g, '') })} placeholder="09639437000" inputMode="numeric" />
              </Field>
              <Field label="To">
                <Input value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value.replace(/\D/g, '') })} placeholder="09639437999" inputMode="numeric" />
              </Field>
              <Button variant="primary" icon={<Plus className="size-4" />} loading={add.isPending} disabled={rangeSize < 1 || rangeSize > 5000} onClick={() => add.mutate()}>
                {rangeSize > 0 ? `Add ${rangeSize.toLocaleString()}` : 'Add'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Numbers" hint="One per line, or separated by commas (from the operator's sheet)">
                <Textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'09639437001\n09639437002'} />
              </Field>
              <div className="flex justify-end">
                <Button variant="primary" icon={<Plus className="size-4" />} loading={add.isPending} disabled={!listNumbers.length} onClick={() => add.mutate()}>
                  {listNumbers.length ? `Add ${listNumbers.length.toLocaleString()}` : 'Add'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-black/[0.06] px-4 py-3">
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'available', label: 'Free' },
              { value: 'reserved', label: 'Held' },
              { value: 'assigned', label: 'Given out' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        {list.isLoading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState title="No numbers here" description={filter === 'available' ? 'Add the numbers the operator gave you above.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Status</th>
                  <th>Customer</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-sm font-semibold text-slate-900">{p.number}</td>
                    <td>
                      <Badge tone={p.status === 'available' ? 'green' : p.status === 'reserved' ? 'amber' : 'gray'}>
                        {p.status === 'available' ? 'Free' : p.status === 'reserved' ? 'Held by a request' : 'Given out'}
                      </Badge>
                    </td>
                    <td className="text-sm">
                      {p.account_id ? (
                        <Link to={`/admin/customers/${p.account_id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {p.account_name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td>
                      {p.status === 'available' && (
                        <div className="flex justify-end">
                          <IconButton
                            label="Remove from the pool"
                            tone="danger"
                            onClick={async () => {
                              if (await confirm({ title: `Remove ${p.number}?`, message: 'Customers can no longer choose it.', confirmLabel: 'Remove', danger: true })) remove.mutate(p.id);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ settings
function SettingsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEY, 'settings'], queryFn: () => api.get<SupplySettings>(`${base}/settings`) });
  const [form, setForm] = useState<SupplySettings | null>(null);
  const [presets, setPresets] = useState('');
  useEffect(() => {
    if (q.data && !form) {
      setForm(q.data);
      setPresets(q.data.topup.presets.join(', '));
    }
  }, [q.data, form]);
  const save = useMutation({
    mutationFn: (data: Pick<SupplySettings, 'enabled' | 'topup'>) => api.put<SupplySettings>(`${base}/settings`, data),
    onSuccess: (saved) => {
      setForm(saved);
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success('Settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!form) return q.error ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  const submit = () =>
    save.mutate({
      enabled: form.enabled,
      topup: {
        ...form.topup,
        presets: presets
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => n > 0)
          .slice(0, 6),
      },
    });
  return (
    <div className="space-y-4 sm:space-y-6">
      <ProvidersCard />
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Offer numbers to customers" />
          <div className="space-y-4 p-4 sm:p-5">
            <Toggle
              checked={form.enabled}
              onChange={(v) => setForm({ ...form, enabled: v })}
              label="Customers can ask for a new number"
              description="Shows “Buy a number” in their menu, on their Phone numbers page and in their setup guide"
            />
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Top-ups" description="Customers add calling balance to numbers they got from you" />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <div className="sm:col-span-2">
              <Toggle checked={form.topup.enabled} onChange={(v) => setForm({ ...form, topup: { ...form.topup, enabled: v } })} label="Customers can top up" />
            </div>
            <Field label="Smallest (BDT)">
              <NumberInput value={form.topup.min} onChange={(v) => setForm({ ...form, topup: { ...form.topup, min: v } })} min={1} />
            </Field>
            <Field label="Largest (BDT)">
              <NumberInput value={form.topup.max} onChange={(v) => setForm({ ...form, topup: { ...form.topup, max: v } })} min={1} />
            </Field>
            <Field label="Quick amounts (BDT)" hint="Up to 6, separated by commas" className="sm:col-span-2">
              <Input value={presets} onChange={(e) => setPresets(e.target.value)} placeholder="100, 200, 500, 1000" />
            </Field>
          </div>
        </Card>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ providers
/** An id for a new provider from its name: "Banglalink IP" → "banglalink-ip" (made unique). */
function providerId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'provider';
  let id = base.length >= 2 ? base : `${base}-1`;
  for (let i = 2; taken.includes(id); i++) id = `${base.slice(0, 24)}-${i}`;
  return id;
}

/**
 * Where numbers come from (today ICC): each provider's name, number prefix, digits and SIP server.
 * Customers buying or applying for a special number see the prefix fixed and type only the rest.
 */
function ProvidersCard() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: [...KEY, 'settings'], queryFn: () => api.get<SupplySettings>(`${base}/settings`) });
  const [editing, setEditing] = useState<SupplyProvider | 'new' | null>(null);
  const providers = q.data?.providers ?? [];
  const save = useMutation({
    mutationFn: (list: SupplyProvider[]) => api.put<SupplySettings>(`${base}/providers`, { providers: list }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['number-supply'] });
      toast.success('Providers saved');
      setEditing(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Providers"
        description="Where your numbers come from. Customers see the provider's prefix fixed and choose the rest of the number."
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add a provider
          </Button>
        }
      />
      {q.isLoading ? (
        <TableSkeleton rows={1} cols={3} />
      ) : q.error ? (
        <ErrorBlock error={q.error} />
      ) : providers.length ? (
        <ul className="divide-y divide-slate-100">
          {providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
              <div className="min-w-0 flex-1 basis-60">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {p.name}
                  {!p.enabled && <Badge>Off</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Numbers{' '}
                  <span className="font-mono font-medium text-slate-700">
                    {p.prefix}
                    {'•'.repeat(p.length - p.prefix.length)}
                  </span>{' '}
                  ·{' '}
                  {p.line.host ? (
                    <>
                      SIP server <span className="font-mono">{p.line.host}:{p.line.port}</span>
                    </>
                  ) : (
                    <span className="text-amber-700">SIP server not set yet</span>
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setEditing(p)}>
                  Edit
                </Button>
                <IconButton
                  label={`Remove ${p.name}`}
                  tone="danger"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Remove ${p.name}?`,
                        message: 'Customers can no longer get numbers from it. To pause it instead, edit it and turn it off.',
                        confirmLabel: 'Remove',
                        danger: true,
                      })
                    )
                      save.mutate(providers.filter((x) => x.id !== p.id));
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No providers yet" description="Add the operator you resell numbers from, such as ICC." />
      )}
      {editing && (
        <ProviderModal
          provider={editing === 'new' ? null : editing}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(saved) =>
            save.mutate(
              editing === 'new'
                ? [...providers, { ...saved, id: providerId(saved.name, providers.map((x) => x.id)) }]
                : providers.map((x) => (x.id === editing.id ? { ...saved, id: editing.id } : x)),
            )
          }
        />
      )}
    </Card>
  );
}

function ProviderModal({ provider, saving, onSave, onClose }: { provider: SupplyProvider | null; saving: boolean; onSave: (p: SupplyProvider) => void; onClose: () => void }) {
  const [form, setForm] = useState<SupplyProvider>(
    () => provider ?? { id: '', name: '', prefix: '', length: 11, enabled: true, line: { host: '', port: 5060, transport: 'udp' } },
  );
  const rest = form.length - form.prefix.length;
  const valid = form.name.trim().length >= 2 && /^\d{2,10}$/.test(form.prefix) && rest >= 1;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={provider ? `Edit ${provider.name}` : 'Add a provider'}
      description="An operator you resell numbers from"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!valid} onClick={() => onSave({ ...form, name: form.name.trim(), line: { ...form.line, host: form.line.host.trim() } })}>
            {provider ? 'Save' : 'Add provider'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Name" hint="Customers see it, and agree to share their details with it" className="sm:col-span-6">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ICC Communication Ltd." maxLength={80} autoFocus />
        </Field>
        <Field label="Number prefix" hint="How every number from them starts" className="sm:col-span-3">
          <Input value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="09639" inputMode="numeric" className="font-mono" />
        </Field>
        <Field label="Digits in a whole number" hint={rest >= 1 && form.prefix ? `Customers type the last ${rest}` : 'Prefix included; 11 in Bangladesh'} className="sm:col-span-3">
          <NumberInput value={form.length} onChange={(v) => setForm({ ...form, length: v })} min={4} max={15} />
        </Field>
        {form.prefix && rest >= 1 && (
          <p className="text-sm text-slate-600 sm:col-span-6">
            Customers will see <span className="font-mono font-semibold text-slate-900">{form.prefix}</span>
            <span className="font-mono text-slate-400">{'•'.repeat(rest)}</span> and choose the last {rest} digits.
          </p>
        )}
        <Field label="SIP server" hint="Where each new number registers, with its own username and password. ICC's panel lists 103.15.140.151." className="sm:col-span-6">
          <Input value={form.line.host} onChange={(e) => setForm({ ...form, line: { ...form.line, host: e.target.value } })} placeholder="sip.provider.com" />
        </Field>
        <Field label="Port" className="sm:col-span-2">
          <NumberInput value={form.line.port} onChange={(v) => setForm({ ...form, line: { ...form.line, port: v } })} min={1} max={65535} />
        </Field>
        <Field label="Transport" className="sm:col-span-4">
          <Select value={form.line.transport} onChange={(e) => setForm({ ...form, line: { ...form.line, transport: e.target.value as SupplyProvider['line']['transport'] } })}>
            <option value="udp">UDP (most providers)</option>
            <option value="tcp">TCP</option>
            <option value="tls">TLS (encrypted)</option>
          </Select>
        </Field>
        <div className="sm:col-span-6">
          <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Customers can get numbers from it" description="Turn it off to pause it without losing its settings" />
        </div>
      </div>
    </Modal>
  );
}
