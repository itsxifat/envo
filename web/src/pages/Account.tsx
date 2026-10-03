import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../state/auth';
import clsx from 'clsx';
import { Activity, Building2, Check, Code2, Disc3, Gem, Hash, ListTree, Minus, PhoneCall, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useLive } from '../state/live';
import { ACCOUNT_STATUS, IVR_TIER_LABELS, formatBdt, formatDate, limitLabel } from '../lib/format';
import type { AccountStatus, Package, Plan, Usage } from '../lib/types';
import { Badge, Button, Card, CardHeader, ErrorBlock, LoadingBlock, Meter, Notice, PageHeader } from '../components/ui';

interface AccountInfo {
  account: { id: number; name: string; email: string; phone: string; status: AccountStatus; internal: boolean; created_at: string };
  plan: Plan;
  usage: Usage;
}

function Feature({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={clsx('flex items-center gap-2.5 text-sm', on ? 'text-slate-700' : 'text-slate-400')}>
      <span className={clsx('flex size-5 shrink-0 items-center justify-center rounded-full', on ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
        {on ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
      </span>
      {children}
    </li>
  );
}

export function AccountPage() {
  const info = useQuery({ queryKey: ['account'], queryFn: () => api.get<AccountInfo>('/api/account') });
  const packages = useQuery({ queryKey: ['account', 'packages'], queryFn: () => api.get<Package[]>('/api/account/packages') });
  const live = useLive();
  const { user } = useAuth();

  if (info.isLoading) return <LoadingBlock />;
  if (info.error || !info.data) return <ErrorBlock error={info.error} onRetry={() => info.refetch()} />;
  const { account, plan, usage } = info.data;
  const l = plan.limits;
  const status = ACCOUNT_STATUS[account.status] ?? ACCOUNT_STATUS.active!;
  const channelsNow = live.groups[`envo_account/a${account.id}`] ?? 0;
  const renews = plan.subscription?.currentPeriodEnd;
  const daysLeft = renews ? Math.ceil((new Date(renews).getTime() - Date.now()) / 86400_000) : null;

  return (
    <>
      <PageHeader title="Plan & usage" description={`${account.name} · what your package includes and how much of it you use`} icon={<Gem />} />

      {account.status === 'suspended' && (
        <Notice tone="danger" title="Your phone system is paused" className="mb-5">
          Calls and phone registrations are stopped until the package is renewed. Your settings and recordings are kept.
        </Notice>
      )}
      {account.status === 'pending' && (
        <Notice tone="warn" title="Choose a package to get started" className="mb-5">
          Your account is ready. Once a package is active you can add SIP servers, numbers and extensions.
        </Notice>
      )}

      <Card className="overflow-hidden">
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-5 py-6 text-white sm:px-7">
          <div className="absolute -top-24 -right-16 size-64 rounded-full bg-white/10 blur-3xl" aria-hidden />
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-sm text-brand-100">{plan.internal ? 'Platform account' : 'Current package'}</p>
              <h2 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">{plan.internal ? 'Enfinito internal' : (plan.package?.name ?? 'No package yet')}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[12px] font-medium ring-1 ring-white/20">{status.label}</span>
                {plan.subscription && !plan.internal && (
                  <span className="text-brand-100">
                    {plan.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {formatDate(renews)}
                    {daysLeft !== null && daysLeft >= 0 && ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
                  </span>
                )}
              </div>
            </div>
            {plan.subscription && !plan.internal && (
              <div className="text-right">
                <div className="text-[28px] leading-none font-semibold tabular-nums">{formatBdt(plan.subscription.price)}</div>
                <div className="mt-1 text-sm text-brand-100">per month</div>
              </div>
            )}
          </div>
        </div>
        <div className="grid gap-x-8 gap-y-2.5 px-5 py-5 sm:grid-cols-2 sm:px-7 lg:grid-cols-3">
          <ul className="space-y-2.5">
            <Feature on={l.recording_days > 0}>
              Call recording{l.recording_days > 0 ? ` · kept ${l.recording_days} days${l.recording_mb !== null ? `, up to ${l.recording_mb >= 1024 ? `${l.recording_mb / 1024} GB` : `${l.recording_mb} MB`}` : ''}` : ''}
            </Feature>
            <Feature on>IVR · {IVR_TIER_LABELS[l.ivr_tier]}</Feature>
          </ul>
          <ul className="space-y-2.5">
            <Feature on={l.call_monitoring}>Live call monitoring</Feature>
            <Feature on={l.api_access}>Developer API & webhooks</Feature>
          </ul>
          <ul className="space-y-2.5">
            <Feature on>Web phone, transfers & forwarding</Feature>
            <Feature on>Free internal calls</Feature>
          </ul>
        </div>
      </Card>

      <h3 className="mt-8 mb-3 text-[15px] font-semibold tracking-tight text-slate-900">Usage</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Meter label="SIP servers" icon={<Building2 />} used={usage.servers} limit={l.max_servers} />
        <Meter label="Phone numbers" icon={<Hash />} used={usage.dids} limit={l.max_dids} />
        <Meter label="Extensions" icon={<Users />} used={usage.extensions} limit={l.max_extensions} />
        <Meter label="Concurrent calls right now" icon={<PhoneCall />} used={channelsNow} limit={l.max_channels} hint="Outside calls in progress across all your SIP servers." />
        <Meter label="IVR menus" icon={<ListTree />} used={usage.ivrs} limit={l.max_ivrs} />
        <Meter
          label="Recording storage"
          icon={<Disc3 />}
          used={usage.recordingMb}
          limit={l.recording_days === 0 ? 0 : l.recording_mb}
          unit="MB"
          hint={l.recording_days > 0 ? `Recordings older than ${l.recording_days} days are removed automatically.` : undefined}
        />
      </div>

      {!plan.internal && packages.data && packages.data.length > 0 && (
        <Card className="mt-8 overflow-hidden">
          <CardHeader
            title="Compare packages"
            description="Need more extensions, channels or recording? Upgrades start right away."
            actions={
              user?.isOwner && (
                <Link to="/billing">
                  <Button size="sm" variant="primary">
                    Change package
                  </Button>
                </Link>
              )
            }
          />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Price</th>
                  <th>Extensions</th>
                  <th>Channels</th>
                  <th>Numbers</th>
                  <th>Recording</th>
                  <th>Monitoring</th>
                  <th>API</th>
                </tr>
              </thead>
              <tbody>
                {packages.data.map((p) => {
                  const current = p.id === plan.package?.id;
                  return (
                    <tr key={p.id} className={clsx(current && 'bg-brand-50/50')}>
                      <td>
                        <span className="font-medium text-slate-900">{p.name}</span>
                        {current && <Badge tone="brand" className="ml-2">Current</Badge>}
                        {!current && p.highlight && <Badge tone="violet" className="ml-2">Popular</Badge>}
                      </td>
                      <td className="tabular-nums">{p.price_monthly === null ? 'Custom' : `${formatBdt(p.price_monthly)}/mo`}</td>
                      <td className="tabular-nums">{limitLabel(p.max_extensions)}</td>
                      <td className="tabular-nums">{limitLabel(p.max_channels)}</td>
                      <td className="tabular-nums">{limitLabel(p.max_dids)}</td>
                      <td>{p.recording_days ? `${p.recording_days} days` : 'Not included'}</td>
                      <td>{p.call_monitoring ? <Activity className="size-4 text-emerald-600" aria-label="Included" /> : '—'}</td>
                      <td>{p.api_access ? <Code2 className="size-4 text-emerald-600" aria-label="Included" /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
