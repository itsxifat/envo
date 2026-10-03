import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  Code2,
  Hash,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  Server,
  ServerCrash,
  TriangleAlert,
  UserPlus,
  Users,
  WifiOff,
} from 'lucide-react';
import { api, scoped } from '../lib/api';
import { useTenant } from '../state/tenant';
import { useAuth, useIsAdmin } from '../state/auth';
import { useLive } from '../state/live';
import { usePhone } from '../phone/PhoneProvider';
import { formatDuration, parseCallerId, timeAgo } from '../lib/format';
import type { CallRow, Trunk } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, ListSkeleton, PageHeader, Stat, StatSkeleton, StatusDot, Trend } from '../components/ui';
import { HourlyChart, type HourPoint } from '../components/HourlyChart';

interface Summary {
  extensions: { total: number; online: number };
  trunks: { total: number; registering: number; registered: number };
  numbers: number;
  activeCalls: number;
}

interface DayPoint {
  day: string;
  total: number;
  answered: number;
  missed: number;
  talkSec: number;
}

interface Stats {
  today: { total: number; answered: number; missed: number; inbound: number; outbound: number; internal: number; avgTalkSec: number; talkSec: number };
  yesterday: { total: number; answered: number; missed: number; talkSec: number; avgTalkSec: number };
  hourly: HourPoint[];
  daily: DayPoint[];
}

interface WebhookRow {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  last_status: number | null;
  last_delivery_at: string | null;
  deliveries: number;
}

export function trunkState(t: Trunk): { tone: 'green' | 'red' | 'amber' | 'gray'; label: string } {
  if (!t.enabled) return { tone: 'gray', label: 'Disabled' };
  if (t.auth_mode === 'register') {
    const s = t.registration?.status;
    if (s === 'Registered') return { tone: 'green', label: 'Registered' };
    if (!s) return { tone: 'amber', label: 'Starting' };
    if (s === 'Rejected') return { tone: 'red', label: 'Rejected' };
    return { tone: 'amber', label: s };
  }
  if (t.qualify) {
    const r = t.reachability?.status;
    if (r === 'Reachable') return { tone: 'green', label: `Reachable${t.reachability?.rttMs ? ` · ${t.reachability.rttMs} ms` : ''}` };
    if (r === 'Unreachable') return { tone: 'red', label: 'Unreachable' };
    return { tone: 'amber', label: 'Checking' };
  }
  return { tone: 'green', label: t.auth_mode === 'ip' ? 'IP trunk' : 'Ready' };
}

interface Issue {
  key: string;
  tone: 'danger' | 'warn';
  title: string;
  detail: string;
  to?: string;
  action?: string;
  onAction?: () => void;
}

export function DashboardPage() {
  const { tenantId, tenant } = useTenant();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const live = useLive();
  const phone = usePhone();

  const summary = useQuery({
    queryKey: ['dashboard', 'summary', tenantId],
    queryFn: () => api.get<Summary>(scoped('/api/dashboard', tenantId)),
    enabled: !!tenantId,
    refetchInterval: 20_000,
  });
  const stats = useQuery({
    queryKey: ['dashboard', 'stats', tenantId],
    queryFn: () => api.get<Stats>(scoped('/api/calls/stats', tenantId)),
    enabled: !!tenantId,
    refetchInterval: 60_000,
  });
  const recent = useQuery({
    queryKey: ['dashboard', 'recent', tenantId],
    queryFn: () => api.get<{ rows: CallRow[] }>(scoped('/api/calls', tenantId, { limit: 8 })),
    enabled: !!tenantId,
    refetchInterval: 30_000,
  });
  const trunks = useQuery({
    queryKey: ['list', 'trunks', tenantId],
    queryFn: () => api.get<Trunk[]>(scoped('/api/trunks', tenantId)),
    enabled: !!tenantId && isAdmin,
  });
  const webhooks = useQuery({
    queryKey: ['list', 'webhooks', tenantId],
    queryFn: () => api.get<WebhookRow[]>(scoped('/api/integrations/webhooks', tenantId)),
    enabled: !!tenantId && isAdmin,
    refetchInterval: 120_000,
  });

  const activeCalls = useMemo(() => new Set(live.channels.filter((c) => c.tenantId === tenantId).map((c) => c.linkedid)).size, [live.channels, tenantId]);
  const s = summary.data;
  const today = stats.data?.today;
  const yest = stats.data?.yesterday;
  const daily = stats.data?.daily ?? [];
  const answerRate = today && today.total ? Math.round((today.answered / today.total) * 100) : null;

  const steps = [
    { done: (s?.trunks.total ?? 0) > 0, label: 'Connect a SIP trunk (your IP phone provider)', to: '/trunks' },
    { done: (s?.numbers ?? 0) > 0, label: 'Add a phone number and choose where it rings', to: '/numbers' },
    { done: (s?.extensions.online ?? 0) > 0, label: 'Register an IP phone or softphone to an extension', to: '/extensions' },
    { done: phone.reg === 'registered', label: 'Open the web phone and dial *43 to test audio', to: null },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  const showSetup = isAdmin && doneCount < steps.length;

  const issues = useMemo<Issue[]>(() => {
    const out: Issue[] = [];
    if (live.connected && live.asterisk && !live.asterisk.connected) {
      out.push(
        user?.role === 'superadmin'
          ? { key: 'pbx', tone: 'danger', title: 'The PBX is not responding', detail: 'Calls cannot be placed or received until Asterisk is back.', to: '/system', action: 'Open system health' }
          : { key: 'pbx', tone: 'danger', title: 'The phone service is briefly unavailable', detail: 'Calls cannot be placed or received right now. We are on it; there is nothing you need to do.' },
      );
    }
    if (!live.connected) {
      out.push({ key: 'ws', tone: 'warn', title: 'Live updates disconnected', detail: 'Reconnecting to the server. Numbers on this page may be stale.' });
    }
    if (live.apply?.state === 'error') {
      out.push({ key: 'apply', tone: 'danger', title: 'Configuration did not apply', detail: live.apply.error || 'Asterisk rejected the last change.', to: '/system', action: 'Review' });
    }
    for (const w of live.apply?.warnings ?? []) {
      out.push({ key: `warn:${w}`, tone: 'warn', title: 'Configuration warning', detail: w });
    }
    for (const t of trunks.data ?? []) {
      const st = trunkState(t);
      if (st.tone === 'red') {
        out.push({
          key: `trunk:${t.id}`,
          tone: 'danger',
          title: `Trunk “${t.name}” is ${st.label.toLowerCase()}`,
          detail: `${t.host} is not accepting this SIP server. Outside calls over this trunk will fail.`,
          to: '/trunks',
          action: 'Check trunk',
        });
      } else if (st.tone === 'amber' && t.enabled) {
        out.push({ key: `trunk:${t.id}`, tone: 'warn', title: `Trunk “${t.name}” is ${st.label.toLowerCase()}`, detail: `Waiting for ${t.host} to respond.`, to: '/trunks', action: 'Check trunk' });
      }
    }
    if (isAdmin && s && s.extensions.total > 0 && s.extensions.online === 0) {
      out.push({ key: 'ext', tone: 'warn', title: 'No phones are registered', detail: 'Nobody can answer a call right now. Register a device or open the web phone.', to: '/extensions', action: 'Extensions' });
    }
    for (const w of webhooks.data ?? []) {
      if (w.enabled && w.last_status !== null && w.last_status >= 400) {
        out.push({
          key: `hook:${w.id}`,
          tone: 'warn',
          title: `Webhook returned ${w.last_status}`,
          detail: `${w.name || w.url} rejected the last call event${w.last_delivery_at ? ` ${timeAgo(w.last_delivery_at)}` : ''}.`,
          to: '/developers',
          action: 'Open developers',
        });
      }
    }
    return out;
  }, [live.connected, live.asterisk, live.apply, trunks.data, webhooks.data, s, isAdmin, user?.role]);

  return (
    <div>
      <PageHeader
        title={`Good ${greeting()}, ${user?.name.split(' ')[0] ?? ''}`}
        description={tenant ? `${tenant.name} · live overview` : 'Live overview'}
        actions={
          <>
            {isAdmin && (
              <Link to="/developers">
                <Button icon={<Code2 className="size-4" />}>Connect a website</Button>
              </Link>
            )}
            <Button variant="primary" icon={<PhoneCall className="size-4" />} onClick={() => phone.setPanelOpen(true)}>
              Open web phone
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {stats.isLoading && !stats.data ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <Stat
              label="Active calls"
              value={activeCalls}
              sub={live.asterisk?.connected ? 'Updated live' : 'PBX offline'}
              icon={<Activity className="size-5" />}
              footer={
                activeCalls > 0 ? (
                  <Link to="/live" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                    Watch live <ArrowRight className="size-3" />
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">Nothing in progress</span>
                )
              }
            />
            <Stat
              label="Extensions online"
              value={s ? `${s.extensions.online} / ${s.extensions.total}` : '—'}
              sub="Registered devices"
              icon={<Users className="size-5" />}
              tone="blue"
              footer={
                s && s.extensions.total > 0 ? (
                  <div className="w-24">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${(s.extensions.online / s.extensions.total) * 100}%` }} />
                    </div>
                  </div>
                ) : null
              }
            />
            <Stat
              label="Calls today"
              value={today?.total ?? '—'}
              sub={answerRate === null ? 'No calls yet today' : `${answerRate}% answered · ${today?.missed ?? 0} missed`}
              icon={<PhoneCall className="size-5" />}
              tone="violet"
              series={daily.map((d) => d.total)}
              footer={today && yest ? <Trend value={today.total} previous={yest.total} /> : null}
            />
            <Stat
              label="Avg. talk time"
              value={today ? formatDuration(today.avgTalkSec) : '—'}
              sub={today ? `${formatDuration(today.talkSec)} total today` : undefined}
              icon={<Clock className="size-5" />}
              tone="amber"
              series={daily.map((d) => d.talkSec)}
              footer={today && yest ? <Trend value={today.avgTalkSec} previous={yest.avgTalkSec} /> : null}
            />
          </>
        )}
      </div>

      {issues.length > 0 && (
        <Card className="mt-4 overflow-hidden sm:mt-6">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <TriangleAlert className="size-4 text-amber-500" />
                Needs attention
              </span>
            }
            description={`${issues.length} thing${issues.length === 1 ? '' : 's'} to look at`}
          />
          <ul className="divide-y divide-slate-100">
            {issues.slice(0, 5).map((i) => (
              <li key={i.key} className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5">
                <span className={clsx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', i.tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600')}>
                  {i.tone === 'danger' ? <ServerCrash className="size-4" /> : <WifiOff className="size-4" />}
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-medium text-slate-900">{i.title}</p>
                  <p className="mt-0.5 text-[13px] text-slate-500">{i.detail}</p>
                </div>
                {i.to && (
                  <Link to={i.to} className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:text-brand-800">
                    {i.action ?? 'Open'} <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {showSetup && (
        <Card className="mt-4 overflow-hidden sm:mt-6">
          <div className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-4 py-5 text-white sm:px-6">
            <div>
              <h3 className="font-semibold">Get this SIP server taking calls</h3>
              <p className="mt-0.5 text-sm text-brand-100">
                {doneCount} of {steps.length} steps done
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2 w-40 overflow-hidden rounded-full bg-white/15 sm:w-48">
                <div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
              <span className="text-sm font-semibold tabular-nums text-white">{Math.round((doneCount / steps.length) * 100)}%</span>
            </div>
          </div>
          <ul className="divide-y divide-slate-100">
            {steps.map((st) => (
              <li key={st.label} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-6">
                {st.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> : <Circle className="size-5 shrink-0 text-slate-300" />}
                <span className={clsx('flex-1', st.done ? 'text-slate-400 line-through' : 'text-slate-700')}>{st.label}</span>
                {!st.done &&
                  (st.to ? (
                    <Link to={st.to} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
                      Open <ArrowRight className="size-3.5" />
                    </Link>
                  ) : (
                    <button type="button" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800" onClick={() => phone.setPanelOpen(true)}>
                      Open phone <ArrowRight className="size-3.5" />
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader title="Calls per hour" description="Last 24 hours, answered and missed" />
          <div className={clsx('px-5 pt-4 pb-5 transition-opacity', stats.isFetching && stats.data && 'opacity-60')}>
            {stats.data ? <HourlyChart data={stats.data.hourly} /> : <div className="h-[250px]" />}
          </div>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Today by direction" description="Distinct calls since midnight" />
          <div className="px-5 py-5">
            <DirectionBars today={today} />
            <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-600">
                  <PhoneMissed className="size-4 text-slate-400" /> Missed today
                </dt>
                <dd className="font-semibold tabular-nums text-slate-900">{today?.missed ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-600">
                  <Hash className="size-4 text-slate-400" /> Phone numbers
                </dt>
                <dd className="font-semibold tabular-nums text-slate-900">{s?.numbers ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-600">
                  <Server className="size-4 text-slate-400" /> Trunks registered
                </dt>
                <dd className="font-semibold tabular-nums text-slate-900">{s ? `${s.trunks.registered} / ${s.trunks.total}` : '—'}</dd>
              </div>
            </dl>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader
            title="Recent calls"
            description={recent.data?.rows.length ? 'Newest first' : undefined}
            actions={
              <Link to="/calls" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
                View all <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {recent.isLoading && !recent.data ? (
            <ListSkeleton rows={5} />
          ) : recent.data?.rows.length ? (
            <ul className="divide-y divide-slate-100">
              {recent.data.rows.map((c) => {
                const from = parseCallerId(c.clid);
                const Icon = c.direction === 'inbound' ? (c.answered ? PhoneIncoming : PhoneMissed) : c.direction === 'outbound' ? PhoneOutgoing : PhoneCall;
                return (
                  <li key={c.linkedid} className="group/row flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50/70">
                    <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', c.answered ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-500')}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-800">
                        <span className="font-medium">{from.name || from.number || c.src}</span>
                        <span className="text-slate-400"> → </span>
                        {c.did || c.dst}
                      </div>
                      <div className="text-xs text-slate-500">{timeAgo(c.calldate)}</div>
                    </div>
                    <span className="hidden text-sm text-slate-600 tabular-nums sm:block">{c.answered ? formatDuration(c.billsec) : ''}</span>
                    <Badge tone={c.answered ? 'green' : 'red'}>{c.answered ? 'Answered' : c.disposition === 'BUSY' ? 'Busy' : 'Missed'}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<PhoneCall className="size-5" />}
              title="No calls yet"
              description="Calls appear here as soon as they finish. Dial *43 from the web phone to make the first one."
              action={
                <Button variant="primary" size="sm" icon={<PhoneCall className="size-4" />} onClick={() => phone.dial('*43')}>
                  Run echo test
                </Button>
              }
            />
          )}
        </Card>

        {isAdmin && (
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader
                title="SIP trunks"
                actions={
                  <Link to="/trunks" className="text-sm font-medium text-brand-700 hover:text-brand-800">
                    Manage
                  </Link>
                }
              />
              {trunks.isLoading && !trunks.data ? (
                <ListSkeleton rows={2} />
              ) : trunks.data?.length ? (
                <ul className="divide-y divide-slate-100">
                  {trunks.data.map((t) => {
                    const st = trunkState(t);
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                        <StatusDot tone={st.tone} pulse={st.tone === 'green'} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800">{t.name}</div>
                          <div className="truncate font-mono text-xs text-slate-500">{t.host}</div>
                        </div>
                        <span className={clsx('shrink-0 text-xs', st.tone === 'red' ? 'text-rose-600' : st.tone === 'amber' ? 'text-amber-600' : 'text-slate-500')}>{st.label}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  icon={<Server className="size-5" />}
                  title="No trunks yet"
                  description="Connect your SIP provider to make and receive outside calls."
                  action={
                    <Link to="/trunks">
                      <Button size="sm" variant="primary" icon={<Plus className="size-4" />}>
                        Add a trunk
                      </Button>
                    </Link>
                  }
                />
              )}
            </Card>

            <Card>
              <CardHeader title="Quick actions" />
              <div className="grid grid-cols-2 gap-2 p-3">
                {[
                  { to: '/extensions', label: 'Add extension', icon: UserPlus },
                  { to: '/numbers', label: 'Add number', icon: Hash },
                  { to: '/ivrs', label: 'Build an IVR', icon: PhoneIncoming },
                  { to: '/developers', label: 'API & embed', icon: Code2 },
                ].map((a) => (
                  <Link
                    key={a.to}
                    to={a.to}
                    className="flex flex-col gap-2 rounded-xl border border-slate-200 px-3 py-3 transition hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <a.icon className="size-4 text-brand-600" />
                    <span className="text-[13px] font-medium text-slate-700">{a.label}</span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// Categorical slots 1-3, validated against the white card surface for CVD separation.
const DIRECTION_SERIES = [
  { key: 'inbound', label: 'Inbound', color: '#2a78d6', icon: PhoneIncoming },
  { key: 'outbound', label: 'Outbound', color: '#eb6834', icon: PhoneOutgoing },
  { key: 'internal', label: 'Internal', color: '#7d5bbe', icon: PhoneCall },
] as const;

/** Horizontal bars with the category name as its own label, so colour is never the only cue. */
function DirectionBars({ today }: { today: Stats['today'] | undefined }) {
  const rows = DIRECTION_SERIES.map((sv) => ({ ...sv, value: today?.[sv.key] ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="space-y-3.5">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="mb-1.5 flex items-center gap-2 text-sm">
            <r.icon className="size-3.5 shrink-0" style={{ color: r.color }} />
            <span className="flex-1 text-slate-600">{r.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{r.value}</span>
            {total > 0 && <span className="w-9 text-right text-xs tabular-nums text-slate-400">{Math.round((r.value / total) * 100)}%</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-r-[4px] transition-all duration-500"
              style={{ width: `${(r.value / max) * 100}%`, background: r.color, minWidth: r.value > 0 ? '0.5rem' : 0 }}
            />
          </div>
        </div>
      ))}
      {total === 0 && <p className="pt-1 text-xs text-slate-400">No calls today yet.</p>}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
