import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
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
  Wallet,
} from 'lucide-react';
import { api, scoped } from '../lib/api';
import { useTenant } from '../state/tenant';
import { useAuth, useFeature, useIsAdmin } from '../state/auth';
import { useLive } from '../state/live';
import { usePhone } from '../phone/PhoneProvider';
import { formatDuration, parseCallerId, timeAgo } from '../lib/format';
import type { CallRow, Trunk } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, ListSkeleton, PageHeader, Stat, StatSkeleton, StatusDot, Trend } from '../components/ui';
import { HourlyChart, type HourPoint } from '../components/HourlyChart';
import { MyPhoneSetup } from '../components/people';
import { useSupplyOptions, useTopupNumbers } from '../components/numberSupply';
import type { LineState } from '../components/connectNumber';
import { SETUP_STEPS, useSetupProgress } from './GetStarted';

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
  // Webhooks and the website embed come with the developer API, which not every package includes.
  const apiAccess = useFeature('api_access');
  // Owners with numbers from Enfinito get "Top up balance" among the quick actions.
  const topupNumbers = useTopupNumbers();
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
    enabled: !!tenantId && isAdmin && apiAccess,
    refetchInterval: 120_000,
  });

  const activeCalls = useMemo(() => new Set(live.channels.filter((c) => c.tenantId === tenantId).map((c) => c.linkedid)).size, [live.channels, tenantId]);
  const s = summary.data;
  const today = stats.data?.today;
  const yest = stats.data?.yesterday;
  const daily = stats.data?.daily ?? [];
  const answerRate = today && today.total ? Math.round((today.answered / today.total) * 100) : null;

  const setup = useSetupProgress({ enabled: isAdmin });
  // Shown to admins until every step of the guide is done.
  const setupDone = isAdmin && setup.count < SETUP_STEPS.length ? setup.done : null;
  const setupPct = Math.round((setup.count / SETUP_STEPS.length) * 100);

  const support = user?.role === 'superadmin' || !!user?.impersonator;
  const supply = useSupplyOptions();
  const offer = supply.data?.enabled !== false;
  const numbers = setup.status.data?.numbers ?? [];
  // The things customers come back for, first: a number, calling credit, a person, where calls go.
  const quickActions = [
    { to: '/numbers?add=1', label: offer ? 'Buy a number' : 'Add a number', desc: offer ? 'Pick one from us' : 'Connect your own', icon: Hash },
    ...(topupNumbers.data?.length ? [{ to: '/billing#balance', label: 'Top up balance', desc: 'Add calling credit', icon: Wallet }] : []),
    { to: '/users?add=1', label: 'Add a person', desc: 'Give someone a phone', icon: UserPlus },
    { to: '/get-started#calls', label: 'Where calls go', desc: 'Everyone, one person or a menu', icon: PhoneIncoming },
    apiAccess ? { to: '/developers', label: 'API & embed', desc: 'Connect your website', icon: Code2 } : { to: '/time-conditions', label: 'Business hours', desc: 'Open and closed times', icon: Clock },
  ].slice(0, 4);

  const [allIssues, setAllIssues] = useState(false);
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
    // Configuration problems are for support to fix; customers could do nothing about them.
    if (support && live.apply?.state === 'error') {
      out.push({ key: 'apply', tone: 'danger', title: 'Configuration did not apply', detail: live.apply.error || 'Asterisk rejected the last change.', to: '/system', action: 'Review' });
    }
    for (const w of support ? (live.apply?.warnings ?? []) : []) {
      out.push({ key: `warn:${w}`, tone: 'warn', title: 'Configuration warning', detail: w });
    }
    for (const t of trunks.data ?? []) {
      const st = trunkState(t);
      if (st.tone === 'red') {
        out.push({
          key: `trunk:${t.id}`,
          tone: 'danger',
          title: `Phone line “${t.name}” is ${st.label.toLowerCase()}`,
          detail: `Your provider${support ? ` (${t.host})` : ''} is not accepting this phone system, so outside calls on this line fail.`,
          to: '/trunks',
          action: 'Check the line',
        });
      } else if (st.tone === 'amber' && t.enabled) {
        out.push({
          key: `trunk:${t.id}`,
          tone: 'warn',
          title: `Phone line “${t.name}” is ${st.label.toLowerCase()}`,
          detail: `Waiting for your provider${support ? ` (${t.host})` : ''} to answer.`,
          to: '/trunks',
          action: 'Check the line',
        });
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
    // The most serious first.
    return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1));
  }, [live.connected, live.asterisk, live.apply, trunks.data, webhooks.data, s, isAdmin, user?.role, support]);

  return (
    <div>
      <PageHeader
        title={`Good ${greeting()}, ${user?.name.split(' ')[0] ?? ''}`}
        description={tenant ? `${tenant.name} · live overview` : 'Live overview'}
        actions={
          <>
            {isAdmin && apiAccess && (
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

      {issues.length > 0 && (
        <Card className={clsx('mb-4 overflow-hidden sm:mb-6', issues[0]!.tone === 'danger' ? 'border-rose-200' : 'border-amber-200')}>
          <ul className="divide-y divide-slate-100">
            {(allIssues ? issues : issues.slice(0, 1)).map((i) => (
              <li key={i.key} className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5">
                <span className={clsx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', i.tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600')}>
                  {i.tone === 'danger' ? <ServerCrash className="size-4" /> : <TriangleAlert className="size-4" />}
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
          {issues.length > 1 && (
            <button
              type="button"
              onClick={() => setAllIssues(!allIssues)}
              aria-expanded={allIssues}
              className="flex w-full items-center justify-center gap-1 border-t border-slate-100 px-4 py-2 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              {allIssues ? 'Show less' : `${issues.length - 1} more to look at`}
              <ChevronDown className={clsx('size-4 transition', allIssues && 'rotate-180')} />
            </button>
          )}
        </Card>
      )}

      {setupDone && (
        <Card className="mb-4 overflow-hidden sm:mb-6">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 pt-4 sm:px-6 sm:pt-5">
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold tracking-tight text-slate-950">Finish setting up your phone system</h3>
              <p className="mt-0.5 text-sm text-slate-500">
                {setup.count} of {SETUP_STEPS.length} steps done · a few minutes left
              </p>
            </div>
            <Link to={`/get-started${setup.next ? `#${setup.next}` : ''}`}>
              <Button variant="primary">
                Continue <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
          <div
            className="mx-4 mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100 sm:mx-6"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={setupPct}
          >
            <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${setupPct}%` }} />
          </div>
          <ol className="grid gap-2 p-4 sm:grid-cols-2 sm:px-6 sm:pb-5 xl:grid-cols-4">
            {SETUP_STEPS.map((st, i) => {
              const done = setupDone[st.key];
              const next = st.key === setup.next;
              return (
                <li key={st.key}>
                  <Link
                    to={`/get-started#${st.key}`}
                    className={clsx(
                      'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition',
                      done
                        ? 'border-transparent bg-slate-50 text-slate-400'
                        : next
                          ? 'border-brand-200 bg-brand-50/60 font-medium text-slate-900 hover:border-brand-300'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300',
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                    ) : (
                      <span
                        className={clsx(
                          'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                          next ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {i + 1}
                      </span>
                    )}
                    <span className={clsx('truncate', done && 'line-through')}>{st.title}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {isAdmin && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 xl:grid-cols-4">
          {quickActions.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="group flex flex-col items-start gap-2.5 rounded-2xl border border-black/[0.07] bg-white p-3.5 shadow-[var(--shadow-card)] transition hover:-translate-y-px hover:border-brand-200 hover:shadow-[var(--shadow-raise)] sm:flex-row sm:items-center sm:gap-3 sm:p-4"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition group-hover:bg-brand-600 group-hover:text-white group-hover:ring-brand-600">
                <a.icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900 sm:truncate">{a.label}</span>
                <span className="hidden truncate text-xs text-slate-500 sm:block">{a.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <MyPhoneSetup className="mb-4 sm:mb-6" />

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
              sub={live.asterisk?.connected ? 'Updated live' : 'Phone service offline'}
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
              label="Phones online"
              value={s ? `${s.extensions.online} / ${s.extensions.total}` : '—'}
              sub="Ready to take calls"
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
                  <Server className="size-4 text-slate-400" /> Lines connected
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
          <Card className="min-w-0">
            <CardHeader
              title="Your numbers"
              actions={
                <Link to="/numbers" className="text-sm font-medium text-brand-700 hover:text-brand-800">
                  Manage
                </Link>
              }
            />
            {setup.status.isLoading && !setup.status.data ? (
              <ListSkeleton rows={2} />
            ) : numbers.length ? (
              <ul className="divide-y divide-slate-100">
                {numbers.map((n) => {
                  const st = lineState(n.line);
                  return (
                    <li key={n.id} className="flex items-center gap-3 px-5 py-3">
                      <StatusDot tone={st.tone} pulse={st.tone === 'green'} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-sm font-semibold text-slate-900">{n.number}</div>
                        <div className="truncate text-xs text-slate-500">{n.label || 'No label'}</div>
                      </div>
                      <span className={clsx('shrink-0 text-xs', st.tone === 'red' ? 'text-rose-600' : st.tone === 'amber' ? 'text-amber-600' : 'text-slate-500')}>{st.label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={<Hash className="size-5" />}
                title="No numbers yet"
                description="Get the number your customers will dial to reach you."
                action={
                  <Link to="/numbers?add=1">
                    <Button size="sm" variant="primary" icon={<Plus className="size-4" />}>
                      {offer ? 'Buy a number' : 'Add a number'}
                    </Button>
                  </Link>
                }
              />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/** A number's line, in plain words. */
function lineState(line: LineState | null): { tone: 'green' | 'red' | 'amber' | 'gray'; label: string } {
  if (!line) return { tone: 'gray', label: 'No line' };
  if (line.shared || line.health === 'ok') return { tone: 'green', label: 'Working' };
  if (line.health === 'failing') return { tone: 'red', label: 'Not accepted' };
  if (line.health === 'waiting') return { tone: 'amber', label: 'Connecting' };
  return { tone: 'gray', label: 'Turned off' };
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
