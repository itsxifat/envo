import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Briefcase, ChevronRight, LogIn, Plus } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { ACCOUNT_STATUS, formatBdt, formatDate } from '../../lib/format';
import type { AccountRow, Package } from '../../lib/types';
import { Badge, Button, Card, CopyField, EmptyState, ErrorBlock, Field, IconButton, Input, Modal, NumberInput, Notice, PageHeader, SearchInput, Select, TableSkeleton, Tabs } from '../../components/ui';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Awaiting payment' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'closed', label: 'Closed' },
] as const;

function NewCustomer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const packages = useQuery({ queryKey: ['admin', 'packages'], queryFn: () => api.get<Package[]>('/api/admin/packages') });
  const [form, setForm] = useState({ name: '', email: '', phone: '', owner_name: '', owner_password: '', package_id: '', months: 1, server_name: '' });
  const [created, setCreated] = useState<{ id: number; owner_email: string; owner_password?: string } | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: number; owner_email: string; owner_password?: string }>('/api/admin/accounts', {
        name: form.name,
        email: form.email,
        phone: form.phone,
        owner_name: form.owner_name || form.name,
        owner_password: form.owner_password || undefined,
        package_id: form.package_id ? Number(form.package_id) : null,
        months: form.months,
        server_name: form.server_name || undefined,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Customer created');
      setCreated(r);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (created) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Customer created"
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => navigate(`/admin/customers/${created.id}`)}>
              Open customer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Send the owner these sign-in details. The password is shown only now.</p>
          <CopyField label="Sign-in email" value={created.owner_email} mono={false} />
          {created.owner_password && <CopyField label="Password" value={created.owner_password} secret />}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New customer"
      description="For customers you sign up yourself. Customers can also sign up on the website."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!form.name || !form.email} onClick={() => save.mutate()}>
            Create customer
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Acme Ltd" />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="01711-000000" inputMode="tel" />
        </Field>
        <Field label="Owner email (sign-in)" required>
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="owner@acme.com" />
        </Field>
        <Field label="Owner name">
          <Input value={form.owner_name} onChange={(e) => set('owner_name', e.target.value)} placeholder="Defaults to the company name" />
        </Field>
        <Field label="Password" hint="Leave empty to generate one">
          <Input type="text" value={form.owner_password} onChange={(e) => set('owner_password', e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="First SIP server" hint="Optional; the customer can create it later">
          <Input value={form.server_name} onChange={(e) => set('server_name', e.target.value)} placeholder="Acme Office" />
        </Field>
        <Field label="Package" hint="Without one the account waits for payment">
          <Select value={form.package_id} onChange={(e) => set('package_id', e.target.value)}>
            <option value="">No package yet</option>
            {packages.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.price_monthly === null ? 'custom' : `${formatBdt(p.price_monthly)}/mo`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Paid for (months)">
          <NumberInput value={form.months} onChange={(v) => set('months', Math.min(36, Math.max(1, v)))} min={1} max={36} disabled={!form.package_id} />
        </Field>
      </div>
    </Modal>
  );
}

export function CustomersPage() {
  const [params] = useSearchParams();
  const { openCustomerPortal } = useAuth();
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]['value']>('');
  const [creating, setCreating] = useState(() => params.get('new') === '1');
  // The header search box navigates here with ?q=, also while this page is already open.
  useEffect(() => {
    const q = params.get('q');
    if (q !== null) setSearch(q);
  }, [params]);
  const list = useQuery({
    queryKey: ['admin', 'accounts', search, status],
    queryFn: () => api.get<AccountRow[]>(`/api/admin/accounts?search=${encodeURIComponent(search)}&status=${status}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data ?? [];
  const mrr = rows.filter((r) => r.status === 'active' && !r.internal && r.price).reduce((sum, r) => sum + Number(r.price), 0);

  return (
    <>
      <PageHeader
        title="Customers"
        description={list.data ? `${rows.filter((r) => !r.internal).length} customers${status ? '' : ` · ${formatBdt(mrr)} monthly revenue from active ones`}` : 'Accounts that use Envo'}
        icon={<Briefcase />}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New customer
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={status} onChange={setStatus} tabs={STATUS_TABS.map((t) => ({ value: t.value, label: t.label }))} />
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or phone" />
        </div>
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : list.error ? (
          <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Briefcase className="size-5" />} title="No customers here" description={search ? 'Nothing matches your search.' : 'Customers appear here when they sign up or you add them.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Package</th>
                  <th>Status</th>
                  <th>Renews</th>
                  <th>Usage</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const st = ACCOUNT_STATUS[a.status]!;
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/admin/customers/${a.id}`} className="block min-w-0">
                          <div className="font-medium text-slate-900 hover:text-brand-700">
                            {a.name}
                            {a.internal && <Badge tone="brand" className="ml-2">Enfinito</Badge>}
                          </div>
                          <div className="text-xs text-slate-500">{a.owner_email ?? a.email}</div>
                        </Link>
                      </td>
                      <td>
                        {a.internal ? (
                          <span className="text-slate-400">Unlimited</span>
                        ) : a.package_name ? (
                          <div>
                            <div className="text-slate-800">{a.package_name}</div>
                            <div className="text-xs text-slate-500 tabular-nums">{formatBdt(a.price)}/mo</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="text-sm whitespace-nowrap text-slate-600">{a.internal ? '—' : formatDate(a.current_period_end)}</td>
                      <td className="text-sm whitespace-nowrap text-slate-600 tabular-nums">
                        {a.servers} srv · {a.extensions} ext · {a.dids} no.
                      </td>
                      <td>
                        <div className="flex justify-end gap-0.5">
                          {a.status !== 'closed' && (
                            <IconButton label="Open their portal" tone="brand" onClick={() => void openCustomerPortal(a.id).catch((err) => toast.error(errorMessage(err)))}>
                              <LogIn className="size-4" />
                            </IconButton>
                          )}
                          <Link to={`/admin/customers/${a.id}`} className="inline-flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Details of ${a.name}`}>
                            <ChevronRight className="size-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {status === 'pending' && rows.length > 0 && (
        <Notice tone="info" className="mt-4">
          Accounts awaiting payment have signed up but have no active package; assign one on the customer page or wait for their payment.
        </Notice>
      )}
      {creating && <NewCustomer onClose={() => setCreating(false)} />}
    </>
  );
}
