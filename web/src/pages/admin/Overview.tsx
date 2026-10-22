import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Activity, ArrowRight, Briefcase, CheckCircle2, CreditCard, Plus, Server, ServerCrash, TriangleAlert, Wallet } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { ACCOUNT_STATUS, formatBdt, timeAgo } from '../../lib/format';
import type { AccountStatus, AsteriskInfo } from '../../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBlock, ListSkeleton, PageHeader, Stat, StatSkeleton } from '../../components/ui';

interface Overview {
  accounts: { total: number; active: number; pending: number; suspended: number; closed: number; new_week: number };
  money: { mrr: string; outstanding: string; overdue: number; reviews: number };
  live: { calls: number; channels: number; devices: { total: number; online: number }; lines: { total: number; ok: number; failing: number } };
  asterisk: AsteriskInfo;
  recent: { id: number; name: string; status: AccountStatus; created_at: string; package_name: string | null }[];
  attention: { key: string; tone: 'danger' | 'warn'; title: string; detail: string; to?: string }[];
}

export function AdminOverviewPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/api/admin/overview'), refetchInterval: 15_000 });
  const d = q.data;

  return (
    <div>
      <PageHeader
        title={`Good ${greeting()}, ${user?.name.split(' ')[0] ?? ''}`}
        description="Every customer on Envo, right now"
        actions={
          <Link to="/admin/customers?new=1">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              New customer
            </Button>
          </Link>
        }
      />

      {q.error && <ErrorBlock error={q.error} onRetry={() => q.refetch()} />}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {!d ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <Stat
              label="Active customers"
              value={d.accounts.active}
              sub={`${d.accounts.pending} awaiting payment · ${d.accounts.suspended} suspended`}
              icon={<Briefcase className="size-5" />}
              footer={<span className="text-xs text-slate-500">{d.accounts.new_week} new this week</span>}
            />
            <Stat
              label="Monthly revenue"
              value={formatBdt(d.money.mrr)}
              sub={Number(d.money.outstanding) > 0 ? `${formatBdt(d.money.outstanding)} unpaid` : 'Nothing unpaid'}
              icon={<Wallet className="size-5" />}
              tone="violet"
              footer={
                d.money.reviews > 0 ? (
                  <Link to="/admin/sales" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                    {d.money.reviews} payment{d.money.reviews === 1 ? '' : 's'} to review <ArrowRight className="size-3" />
                  </Link>
                ) : null
              }
            />
            <Stat
              label="Calls right now"
              value={d.live.calls}
              sub={d.asterisk.connected ? `${d.live.devices.online} of ${d.live.devices.total} phones online` : 'PBX offline'}
              icon={<Activity className="size-5" />}
              tone="blue"
              footer={
                <Link to="/admin/live" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                  Live monitor <ArrowRight className="size-3" />
                </Link>
              }
            />
            <Stat
              label="Provider lines"
              value={`${d.live.lines.ok} / ${d.live.lines.total}`}
              sub={d.live.lines.failing ? `${d.live.lines.failing} down` : 'All lines working'}
              icon={<Server className="size-5" />}
              tone="amber"
              footer={
                <Link to="/admin/lines" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                  Lines & numbers <ArrowRight className="size-3" />
                </Link>
              }
            />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 xl:grid-cols-3">
        <Card className="min-w-0 overflow-hidden xl:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <TriangleAlert className="size-4 text-amber-500" />
                Needs attention
              </span>
            }
            description={d ? (d.attention.length ? `${d.attention.length} thing${d.attention.length === 1 ? '' : 's'} to look at` : 'Nothing right now') : undefined}
          />
          {!d ? (
            <ListSkeleton rows={3} />
          ) : d.attention.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="size-5" />} title="All clear" description="The PBX is up, every provider line is working and no payment is waiting for review." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.attention.map((i) => (
                <li key={i.key} className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5">
                  <span className={clsx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', i.tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600')}>
                    {i.tone === 'danger' ? <ServerCrash className="size-4" /> : <CreditCard className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-sm font-medium text-slate-900">{i.title}</p>
                    <p className="mt-0.5 text-[13px] text-slate-500">{i.detail}</p>
                  </div>
                  {i.to && (
                    <Link to={i.to} className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:text-brand-800">
                      Open <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader
            title="Newest customers"
            actions={
              <Link to="/admin/customers" className="text-sm font-medium text-brand-700 hover:text-brand-800">
                All customers
              </Link>
            }
          />
          {!d ? (
            <ListSkeleton rows={4} />
          ) : d.recent.length === 0 ? (
            <EmptyState icon={<Briefcase className="size-5" />} title="No customers yet" description="They appear here when they sign up on the website or you add them." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recent.map((a) => {
                const st = ACCOUNT_STATUS[a.status]!;
                return (
                  <li key={a.id}>
                    <Link to={`/admin/customers/${a.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50/70 sm:px-5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-600 uppercase">{a.name.slice(0, 2)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">{a.name}</div>
                        <div className="truncate text-xs text-slate-500">
                          {a.package_name ?? 'No package'} · joined {timeAgo(a.created_at)}
                        </div>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
