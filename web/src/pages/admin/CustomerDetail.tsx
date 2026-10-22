import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, ArrowLeft, Building2, Clock, Crown, Disc3, Hash, KeyRound, ListTree, LogIn, MailCheck, MoreHorizontal, Pause, PhoneCall, Play, UserCheck, UserX, Users, XCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { InviteDone, type InviteResult } from '../../components/people';
import { describeAction } from './Activity';
import { ACCOUNT_STATUS, IVR_TIER_LABELS, formatBdt, formatDate, formatDuration, timeAgo } from '../../lib/format';
import type { AccountStatus, Invoice, IvrTier, Package, Plan, PlanLimits, Usage } from '../../lib/types';
import { Badge, Button, Card, CardHeader, ErrorBlock, Field, Input, ListSkeleton, LoadingBlock, Menu, Meter, Modal, NumberInput, Select, Stat, StatusDot, Textarea, Toggle, useConfirm } from '../../components/ui';

interface Detail {
  account: { id: number; name: string; email: string; phone: string; address: string; notes: string; status: AccountStatus; internal: boolean; created_at: string };
  plan: Plan;
  usage: Usage;
  servers: {
    id: number;
    name: string;
    slug: string;
    enabled: boolean;
    extensions: number;
    numbers: number;
    devices: { total: number; online: number };
    lines: { id: number; name: string; host: string; health: 'ok' | 'failing' | 'waiting' | 'off'; label: string }[];
    number_list: { id: number; number: string; label: string; dest_type: string }[];
    live_calls: number;
  }[];
  users: { id: number; email: string; name: string; role: string; is_owner: boolean; enabled: boolean; last_login_at: string | null; email_verified_at: string | null }[];
  subscriptions: { id: number; package_name: string; status: string; price: string; current_period_start: string; current_period_end: string; overrides: Partial<PlanLimits> }[];
  live: { calls: number; channels_in_use: number; max_channels: number | null };
  today: { calls: number; answered: number; talk_sec: number };
}

const OVERRIDABLE: { key: keyof PlanLimits; label: string }[] = [
  { key: 'max_servers', label: 'SIP servers' },
  { key: 'max_dids', label: 'Numbers' },
  { key: 'max_extensions', label: 'Extensions' },
  { key: 'max_channels', label: 'Channels' },
  { key: 'max_ivrs', label: 'IVR menus' },
  { key: 'recording_days', label: 'Recording days' },
  { key: 'recording_mb', label: 'Recording MB' },
];

function SubscriptionCard({ detail }: { detail: Detail }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const packages = useQuery({ queryKey: ['admin', 'packages'], queryFn: () => api.get<Package[]>('/api/admin/packages') });
  const live = detail.subscriptions.find((s) => s.status !== 'cancelled');
  const [packageId, setPackageId] = useState<string>(detail.plan.package ? String(detail.plan.package.id) : '');
  const [price, setPrice] = useState<number | null>(live ? Number(live.price) : null);
  const [periodEnd, setPeriodEnd] = useState(() => (live ? live.current_period_end.slice(0, 10) : new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)));
  const [overrides, setOverrides] = useState<Partial<PlanLimits>>(live?.overrides ?? {});
  const [custom, setCustom] = useState(Object.keys(live?.overrides ?? {}).length > 0);
  const pkg = packages.data?.find((p) => String(p.id) === packageId);

  useEffect(() => {
    if (pkg && (price === null || !live)) setPrice(pkg.price_monthly === null ? 0 : Number(pkg.price_monthly));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId, pkg?.id]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });
  const save = useMutation({
    mutationFn: () =>
      api.put(`/api/admin/accounts/${detail.account.id}/subscription`, {
        package_id: Number(packageId),
        price,
        current_period_end: new Date(`${periodEnd}T23:59:59`).toISOString(),
        overrides: custom ? overrides : {},
      }),
    onSuccess: () => {
      refresh();
      toast.success('Package saved; limits apply immediately');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.del(`/api/admin/accounts/${detail.account.id}/subscription`),
    onSuccess: () => {
      refresh();
      toast.success('Package removed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (detail.account.internal) {
    return (
      <Card className="p-5">
        <p className="text-sm text-slate-600">Enfinito's own account has no package: it is never billed and never limited.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Package"
        description={live ? `Since ${formatDate(live.current_period_start)} · renews ${formatDate(live.current_period_end)}` : 'No package: the customer cannot use the phone system yet'}
        actions={
          live && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (await confirm({ title: 'Remove the package?', message: 'The customer keeps their data but can no longer add or use anything until a new package is active.', confirmLabel: 'Remove package', danger: true }))
                  cancel.mutate();
              }}
            >
              Remove
            </Button>
          )
        }
      />
      <div className="space-y-5 p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Package">
            <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">Choose…</option>
              {packages.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {!p.active ? ' (not available)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Price per month (BDT)">
            <NumberInput value={price ?? NaN} onChange={(v) => setPrice(Math.max(0, v))} min={0} />
          </Field>
          <Field label="Paid until">
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
        </div>
        <Toggle checked={custom} onChange={setCustom} label="Custom limits for this customer" description="Override the package for an Enterprise or special deal" />
        {custom && pkg && (
          <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {OVERRIDABLE.map(({ key, label }) => {
              const value = overrides[key] as number | null | undefined;
              const base = pkg[key] as number | null;
              return (
                <Field key={key} label={label} hint={`Package: ${base === null ? 'unlimited' : base}`}>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      value={value === undefined || value === null ? NaN : value}
                      onChange={(v) => setOverrides((o) => ({ ...o, [key]: Math.max(0, v) }))}
                      placeholder={value === null ? 'Unlimited' : 'As package'}
                      disabled={value === null}
                      className="min-w-0 flex-1"
                    />
                    <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-brand-600"
                        checked={value === null}
                        onChange={(e) =>
                          setOverrides((o) => {
                            const next = { ...o };
                            if (e.target.checked) (next as Record<string, unknown>)[key] = null;
                            else delete next[key];
                            return next;
                          })
                        }
                      />
                      ∞
                    </label>
                  </div>
                </Field>
              );
            })}
            <Field label="IVR level">
              <Select value={overrides.ivr_tier ?? ''} onChange={(e) => setOverrides((o) => ({ ...o, ivr_tier: (e.target.value || undefined) as IvrTier | undefined }))}>
                <option value="">As package ({IVR_TIER_LABELS[pkg.ivr_tier]})</option>
                {Object.entries(IVR_TIER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Toggle checked={overrides.call_monitoring ?? pkg.call_monitoring} onChange={(v) => setOverrides((o) => ({ ...o, call_monitoring: v }))} label="Call monitoring" />
            <Toggle checked={overrides.api_access ?? pkg.api_access} onChange={(v) => setOverrides((o) => ({ ...o, api_access: v }))} label="API access" />
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="primary" loading={save.isPending} disabled={!packageId} onClick={() => save.mutate()}>
            {live ? 'Save package' : 'Activate package'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ContactCard({ detail }: { detail: Detail }) {
  const qc = useQueryClient();
  const a = detail.account;
  const [form, setForm] = useState({ name: a.name, email: a.email, phone: a.phone, address: a.address, notes: a.notes });
  const save = useMutation({
    mutationFn: () => api.put(`/api/admin/accounts/${a.id}`, { ...form, status: a.status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Company" description={`Customer since ${formatDate(a.created_at)}`} />
      <div className="space-y-4 p-4 sm:p-5">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Billing email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Address">
          <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} />
        </Field>
        <Field label="Internal notes" hint="Only platform admins see these">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
        </Field>
        <Button className="w-full" loading={save.isPending} onClick={() => save.mutate()}>
          Save details
        </Button>
      </div>
    </Card>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { openCustomerPortal } = useAuth();
  const [opening, setOpening] = useState(false);
  const q = useQuery({ queryKey: ['admin', 'account', id], queryFn: () => api.get<Detail>(`/api/admin/accounts/${id}`), refetchInterval: 20_000 });
  const setStatus = useMutation({
    mutationFn: (status: AccountStatus) => api.put(`/api/admin/accounts/${id}`, { ...q.data!.account, status }),
    onSuccess: (_d, status) => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success(status === 'active' ? 'Customer reactivated' : status === 'suspended' ? 'Customer suspended: their phones stop working' : 'Account closed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isLoading) return <LoadingBlock />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const st = ACCOUNT_STATUS[d.account.status]!;
  const l = d.plan.limits;
  const canOpen = d.account.status !== 'closed' && d.users.some((u) => u.enabled);

  const open = async () => {
    setOpening(true);
    try {
      await openCustomerPortal(d.account.id);
    } catch (err) {
      toast.error(errorMessage(err));
      setOpening(false);
    }
  };

  return (
    <>
      <Link to="/admin/customers" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[26px] leading-tight font-semibold tracking-[-0.03em] text-slate-950">{d.account.name}</h1>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {d.plan.package?.name ?? (d.account.internal ? 'Internal, unlimited' : 'No package')}
            {d.plan.subscription && ` · ${formatBdt(d.plan.subscription.price)}/mo · renews ${formatDate(d.plan.subscription.currentPeriodEnd)}`}
          </p>
        </div>
        <div className="page-actions flex flex-wrap gap-2">
          <Button
            variant="brand"
            icon={<LogIn className="size-4" />}
            loading={opening}
            disabled={!canOpen}
            title={canOpen ? 'See and change their phone system exactly as they do' : 'This customer has no active login'}
            onClick={open}
          >
            Open their portal
          </Button>
          {!d.account.internal && d.account.status === 'active' && (
            <Button
              icon={<Pause className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: `Suspend ${d.account.name}?`, message: 'Their phones and numbers stop working right away. They can still sign in and pay.', confirmLabel: 'Suspend', danger: true }))
                  setStatus.mutate('suspended');
              }}
            >
              Suspend
            </Button>
          )}
          {!d.account.internal && (d.account.status === 'pending' || d.account.status === 'suspended') && (
            <Button variant="success" icon={<Play className="size-4" />} onClick={() => setStatus.mutate('active')}>
              Reactivate
            </Button>
          )}
          {!d.account.internal && d.account.status !== 'closed' && (
            <Button
              variant="ghost"
              icon={<XCircle className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: `Close ${d.account.name}?`, message: 'Nobody from this customer can sign in any more and their SIP servers stop. Data is kept.', confirmLabel: 'Close account', danger: true }))
                  setStatus.mutate('closed');
              }}
            >
              Close
            </Button>
          )}
          {!d.account.internal && d.account.status === 'closed' && (
            <Button variant="success" icon={<Play className="size-4" />} onClick={() => setStatus.mutate('active')}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 sm:gap-4 xl:grid-cols-4">
        <Stat
          label="Calls right now"
          value={d.live.calls}
          sub={d.live.max_channels === null ? 'No channel limit' : `${d.live.channels_in_use} of ${d.live.max_channels} channels in use`}
          icon={<Activity className="size-5" />}
        />
        <Stat label="Calls today" value={d.today.calls} sub={d.today.calls ? `${d.today.answered} answered` : 'None yet today'} icon={<PhoneCall className="size-5" />} tone="violet" />
        <Stat label="Talk time today" value={formatDuration(d.today.talk_sec)} sub="Answered calls" icon={<Clock className="size-5" />} tone="amber" />
        <Stat
          label="Phones online"
          value={`${d.servers.reduce((n, s) => n + s.devices.online, 0)} / ${d.servers.reduce((n, s) => n + s.devices.total, 0)}`}
          sub="Registered extensions"
          icon={<Users className="size-5" />}
          tone="blue"
        />
      </div>

      <div className="grid gap-4 sm:gap-6 xl:grid-cols-3">
        <div className="space-y-4 sm:space-y-6 xl:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader title="Phone system" description="Live health of each SIP server: phones, provider lines and numbers" />
            {d.servers.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">No SIP server yet. One is created automatically when their first package goes live.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {d.servers.map((s) => (
                  <li key={s.id} className="space-y-3 px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-600 uppercase">{s.name.slice(0, 2)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900">
                          {s.name}
                          {!s.enabled && <Badge>Off</Badge>}
                          {s.live_calls > 0 && (
                            <Badge tone="green" dot>
                              {s.live_calls} on a call
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {s.slug} · {s.devices.online} of {s.devices.total} phones online · {s.numbers} number{s.numbers === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    {(s.lines.length > 0 || s.number_list.length > 0) && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                          <div className="eyebrow mb-1.5 text-slate-500">Provider lines</div>
                          {s.lines.length === 0 ? (
                            <p className="text-xs text-slate-500">None of their own (numbers on a shared line)</p>
                          ) : (
                            <ul className="space-y-1">
                              {s.lines.map((line) => (
                                <li key={line.id} className="flex items-center gap-2 text-[13px]">
                                  <StatusDot tone={HEALTH_TONE[line.health]} pulse={line.health === 'ok'} />
                                  <span className="min-w-0 flex-1 truncate text-slate-700">{line.name}</span>
                                  <span className={clsx('shrink-0 text-xs', line.health === 'failing' ? 'text-rose-600' : 'text-slate-500')}>{line.label}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                          <div className="eyebrow mb-1.5 text-slate-500">Numbers</div>
                          {s.number_list.length === 0 ? (
                            <p className="text-xs text-slate-500">No numbers yet</p>
                          ) : (
                            <ul className="flex flex-wrap gap-1.5">
                              {s.number_list.map((n) => (
                                <li key={n.id} className="rounded-md bg-white px-2 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-black/[0.06]" title={n.label || undefined}>
                                  {n.number}
                                  {n.dest_type === 'hangup' && <span className="ml-1 font-sans text-[11px] text-amber-700">· not routed</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <SubscriptionCard key={`${d.plan.package?.id}-${d.plan.subscription?.currentPeriodEnd}`} detail={d} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Meter label="SIP servers" icon={<Building2 />} used={d.usage.servers} limit={l.max_servers} />
            <Meter label="Numbers" icon={<Hash />} used={d.usage.dids} limit={l.max_dids} />
            <Meter label="Extensions" icon={<Users />} used={d.usage.extensions} limit={l.max_extensions} />
            <Meter label="IVR menus" icon={<ListTree />} used={d.usage.ivrs} limit={l.max_ivrs} />
            <Meter label="Recordings" icon={<Disc3 />} used={d.usage.recordingMb} limit={l.recording_days === 0 ? 0 : l.recording_mb} unit="MB" />
            <Meter label="Team members" icon={<Users />} used={d.usage.users} limit={null} />
          </div>
          <TeamCard detail={d} />
        </div>
        <div className="space-y-4 sm:space-y-6">
          <ContactCard key={d.account.id} detail={d} />
          <CustomerInvoices accountId={d.account.id} />
          <Card className="overflow-hidden">
            <CardHeader
              title="Activity"
              description="Changes in their portal, including by support"
              actions={
                <Link to={`/admin/activity?account=${d.account.id}`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
                  View all
                </Link>
              }
            />
            <RecentActivity accountId={d.account.id} />
          </Card>
          {d.subscriptions.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Package history" />
              <ul className="divide-y divide-slate-100 text-sm">
                {d.subscriptions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <span className="text-slate-700">{s.package_name}</span>
                    <span className="text-xs text-slate-500">
                      {formatDate(s.current_period_start)} → {formatDate(s.current_period_end)} · {s.status}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const HEALTH_TONE = { ok: 'green', failing: 'red', waiting: 'amber', off: 'gray' } as const;

/** The customer's logins with the support actions: confirm email, send a password link, turn off. */
function TeamCard({ detail }: { detail: Detail }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [link, setLink] = useState<{ name: string; email: string; result: InviteResult } | null>(null);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Team" description="People who can sign in for this customer" />
      {detail.users.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">No logins yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {detail.users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900">
                  <span className="truncate">{u.name}</span>
                  {u.is_owner && <Crown className="size-3.5 text-amber-500" aria-label="Owner" />}
                  {!u.enabled && <Badge tone="red">Login off</Badge>}
                  {!u.email_verified_at && <Badge tone="amber">Email not confirmed</Badge>}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {u.email} · {u.is_owner ? 'Owner' : u.role === 'admin' ? 'Admin' : 'Agent'} · signed in {timeAgo(u.last_login_at)}
                </div>
              </div>
              <Menu
                items={[
                  ...(!u.email_verified_at
                    ? [{ label: 'Confirm their email', icon: <MailCheck className="size-4" />, onSelect: () => void act(() => api.post(`/api/admin/users/${u.id}/verify-email`), 'Email confirmed; they can sign in now') }]
                    : []),
                  {
                    label: 'Send a password link',
                    icon: <KeyRound className="size-4" />,
                    onSelect: () =>
                      void api
                        .post<{ invite_url?: string; invite_status?: InviteResult['invite_status'] }>(`/api/users/${u.id}/invite`)
                        .then((r) => setLink({ name: u.name, email: u.email, result: { ...r, id: u.id, extension: null } }))
                        .catch((err) => toast.error(errorMessage(err))),
                  },
                  u.enabled
                    ? {
                        label: 'Turn off this login',
                        icon: <UserX className="size-4" />,
                        danger: true,
                        separatorBefore: true,
                        onSelect: async () => {
                          if (
                            await confirm({
                              title: `Turn off ${u.name}'s login?`,
                              message: 'They are signed out and cannot sign in until you turn it back on. Their extension keeps working.',
                              confirmLabel: 'Turn off',
                              danger: true,
                            })
                          )
                            void act(() => api.post(`/api/admin/users/${u.id}/enabled`, { enabled: false }), 'Login turned off');
                        },
                      }
                    : {
                        label: 'Turn this login back on',
                        icon: <UserCheck className="size-4" />,
                        separatorBefore: true,
                        onSelect: () => void act(() => api.post(`/api/admin/users/${u.id}/enabled`, { enabled: true }), 'Login turned on'),
                      },
                ]}
                trigger={({ onClick, ref }) => (
                  <button
                    ref={ref as never}
                    type="button"
                    onClick={onClick}
                    aria-label={`Actions for ${u.name}`}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.05] hover:text-slate-800"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                )}
              />
            </li>
          ))}
        </ul>
      )}
      {link && (
        <Modal open onClose={() => setLink(null)} title="Password link" size="sm" footer={<Button onClick={() => setLink(null)}>Done</Button>}>
          <InviteDone name={link.name} email={link.email} result={link.result} />
        </Modal>
      )}
    </Card>
  );
}

interface ActivityRow {
  id: number;
  created_at: string;
  action: string;
  entity: string;
  summary: string;
  user_name: string | null;
}

function RecentActivity({ accountId }: { accountId: number }) {
  const q = useQuery({ queryKey: ['admin', 'audit', 'account', accountId], queryFn: () => api.get<ActivityRow[]>(`/api/admin/audit?account_id=${accountId}&limit=10`) });
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (!q.data?.length) return <p className="px-5 py-5 text-sm text-slate-500">Nothing changed yet.</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {q.data.slice(0, 6).map((r) => (
        <li key={r.id} className="px-4 py-2.5 sm:px-5">
          <div className="truncate text-slate-700">
            <span className="font-medium">{r.user_name ?? 'System'}</span> {describeAction(r.action, r.entity)}
          </div>
          <div className="truncate text-xs text-slate-500">
            {r.summary ? `${r.summary} · ` : ''}
            {timeAgo(r.created_at)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function CustomerInvoices({ accountId }: { accountId: number }) {
  const q = useQuery({ queryKey: ['admin', 'billing', 'invoices', 'account', accountId], queryFn: () => api.get<Invoice[]>(`/api/admin/billing/invoices?account_id=${accountId}`) });
  if (!q.data?.length) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Invoices" actions={<Link to="/admin/sales" className="text-sm font-medium text-brand-700 hover:text-brand-800">Sales</Link>} />
      <ul className="divide-y divide-slate-100 text-sm">
        {q.data.slice(0, 8).map((inv) => (
          <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
            <span className="min-w-0">
              <span className="block truncate text-slate-700">{inv.description}</span>
              <span className="font-mono text-xs text-slate-400">{inv.number}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums">{formatBdt(inv.amount)}</span>
              <Badge tone={inv.status === 'paid' ? 'green' : inv.status === 'void' ? 'gray' : 'amber'}>{inv.status === 'paid' ? 'Paid' : inv.status === 'void' ? 'Cancelled' : 'Unpaid'}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
