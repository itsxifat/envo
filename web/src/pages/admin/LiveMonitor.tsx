import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Activity, PhoneOff } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import { useLive } from '../../state/live';
import type { AsteriskInfo } from '../../lib/types';
import { Badge, Card, CardHeader, EmptyState, ErrorBlock, IconButton, LiveBars, Notice, PageHeader, Stat, TableSkeleton, useConfirm } from '../../components/ui';

interface LiveCall {
  linkedid: string;
  tenant_id: number | null;
  tenant_name: string | null;
  account_id: number | null;
  account_name: string | null;
  started_at: number;
  answered: boolean;
  channels: { name: string; state: string; endpoint: string; caller: string; connected: string; exten: string; application: string }[];
}

interface LiveData {
  asterisk: AsteriskInfo;
  calls: LiveCall[];
  accounts: { account_id: number; account_name: string; calls: number; channels_in_use: number; max_channels: number | null }[];
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** Who is talking to whom, from the first leg (caller) and the number or person on the other end. */
function parties(call: LiveCall): { from: string; to: string } {
  const first = call.channels[0];
  if (!first) return { from: '—', to: '—' };
  const other = call.channels.find((c) => c !== first);
  const to = first.connected || other?.caller || (first.exten && first.exten !== 's' ? first.exten : '') || '—';
  return { from: first.caller || first.endpoint || '—', to };
}

export function LiveMonitorPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const live = useLive();
  const now = useNow();
  const q = useQuery({ queryKey: ['admin', 'live'], queryFn: () => api.get<LiveData>('/api/admin/live'), refetchInterval: 5000 });
  // The live feed tells us the moment a call starts or ends; fetch the named view right away.
  const signature = useMemo(() => live.channels.map((c) => `${c.name}:${c.state}`).join('|'), [live.channels]);
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['admin', 'live'] });
  }, [signature, qc]);

  const d = q.data;
  const talking = d?.calls.filter((c) => c.answered).length ?? 0;

  const hangup = async (call: LiveCall) => {
    const ch = call.channels[0];
    if (!ch) return;
    const ok = await confirm({
      title: 'Hang up this call?',
      message: `${call.account_name ?? 'Unknown customer'}: both sides are disconnected right away.`,
      confirmLabel: 'Hang up',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post('/api/live/hangup', { channel: ch.name });
      toast.success('Call ended');
      void qc.invalidateQueries({ queryKey: ['admin', 'live'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader title="Live monitor" icon={<Activity />} description="Every call on Envo right now, across all customers" />
      {d && !d.asterisk.connected && (
        <Notice tone="danger" title="The PBX is not responding" className="mb-4">
          No customer can make or receive calls until Asterisk is back. Check System health.
        </Notice>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 sm:gap-4 xl:grid-cols-4">
        <Stat label="Calls now" value={d?.calls.length ?? '—'} sub={`${talking} talking · ${(d?.calls.length ?? 0) - talking} ringing or in a menu`} icon={<Activity className="size-5" />} />
        <Stat label="Customers on a call" value={d?.accounts.length ?? '—'} sub="Accounts with at least one call" tone="violet" />
        <Stat label="Channels" value={live.channels.length} sub="Call legs through the PBX" tone="blue" />
        <Stat label="PBX" value={d?.asterisk.connected ? 'Online' : d ? 'Offline' : '—'} sub={d?.asterisk.version || 'Asterisk'} tone="amber" />
      </div>

      <div className="grid gap-4 sm:gap-6 xl:grid-cols-3">
        <Card className="min-w-0 overflow-hidden xl:col-span-2">
          <CardHeader title="Calls" description="Oldest first. Durations update every second." />
          {q.isLoading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : q.error ? (
            <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
          ) : !d?.calls.length ? (
            <EmptyState icon={<Activity className="size-5" />} title="No calls right now" description="Calls appear here the moment they start, with the customer they belong to." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>From</th>
                    <th>To</th>
                    <th>State</th>
                    <th>Duration</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {d.calls.map((c) => {
                    const p = parties(c);
                    return (
                      <tr key={c.linkedid}>
                        <td>
                          {c.account_id ? (
                            <Link to={`/admin/customers/${c.account_id}`} className="block min-w-0 hover:text-brand-700">
                              <div className="truncate text-sm font-medium text-slate-900">{c.account_name}</div>
                              <div className="truncate text-xs text-slate-500">{c.tenant_name}</div>
                            </Link>
                          ) : (
                            <span className="text-sm text-slate-400">Unknown</span>
                          )}
                        </td>
                        <td className="font-mono text-[13px] text-slate-700">{p.from}</td>
                        <td className="font-mono text-[13px] text-slate-700">{p.to}</td>
                        <td>
                          {c.answered ? (
                            <Badge tone="green" dot>
                              Talking
                            </Badge>
                          ) : (
                            <Badge tone="amber" dot>
                              Ringing
                            </Badge>
                          )}
                        </td>
                        <td className="text-sm whitespace-nowrap text-slate-700 tabular-nums">{formatDuration((now - c.started_at) / 1000)}</td>
                        <td>
                          <IconButton label="Hang up" tone="danger" onClick={() => void hangup(c)}>
                            <PhoneOff className="size-4" />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Channels by customer" description="Calls in use against each package's channel limit" />
          {!d?.accounts.length ? (
            <p className="px-5 py-6 text-sm text-slate-500">Nobody is on a call.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.accounts.map((a) => {
                const pct = a.max_channels ? Math.min(100, Math.round((a.channels_in_use / a.max_channels) * 100)) : 0;
                const full = a.max_channels !== null && a.channels_in_use >= a.max_channels;
                return (
                  <li key={a.account_id} className="px-4 py-3 sm:px-5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <Link to={`/admin/customers/${a.account_id}`} className="flex min-w-0 items-center gap-2 font-medium text-slate-900 hover:text-brand-700">
                        <LiveBars className="shrink-0 text-emerald-600" />
                        <span className="truncate">{a.account_name}</span>
                      </Link>
                      <span className={clsx('shrink-0 text-xs tabular-nums', full ? 'font-semibold text-amber-700' : 'text-slate-500')}>
                        {a.channels_in_use} / {a.max_channels ?? '∞'}
                        {full ? ' · full' : ''}
                      </span>
                    </div>
                    {a.max_channels !== null && a.max_channels > 0 && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={clsx('h-full rounded-full', full ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${Math.max(pct, 4)}%` }} />
                      </div>
                    )}
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
