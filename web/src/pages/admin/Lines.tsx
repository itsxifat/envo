import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Hash, Server } from 'lucide-react';
import { api } from '../../lib/api';
import { DEST_LABELS } from '../../lib/format';
import { Badge, Card, EmptyState, ErrorBlock, PageHeader, SearchInput, StatusDot, TableSkeleton, Tabs } from '../../components/ui';

type Health = 'ok' | 'failing' | 'waiting' | 'off';

interface LineRow {
  id: number;
  name: string;
  host: string;
  port: number;
  auth_mode: 'register' | 'outbound' | 'ip';
  username: string;
  enabled: boolean;
  tenant_id: number | null;
  max_channels: number;
  health: Health;
  label: string;
  tenant_name: string | null;
  account_id: number | null;
  account_name: string | null;
  in_use: number;
  numbers: string[];
}

interface NumberRow {
  id: number;
  number: string;
  label: string;
  trunk_id: number | null;
  trunk_name: string | null;
  tenant_id: number;
  dest_type: string;
  enabled: boolean;
  tenant_name: string | null;
  account_id: number | null;
  account_name: string | null;
}

const TONE = { ok: 'green', failing: 'red', waiting: 'amber', off: 'gray' } as const;
const MODE = { register: 'Registers', outbound: 'Password only', ip: 'IP based' } as const;

function Owner({ accountId, account, tenant }: { accountId: number | null; account: string | null; tenant: string | null }) {
  if (!accountId) return <Badge tone="violet">Shared (platform)</Badge>;
  return (
    <Link to={`/admin/customers/${accountId}`} className="block min-w-0 hover:text-brand-700">
      <div className="truncate text-sm font-medium text-slate-900">{account}</div>
      <div className="truncate text-xs text-slate-500">{tenant}</div>
    </Link>
  );
}

export function LinesPage() {
  const [tab, setTab] = useState<'lines' | 'numbers'>('lines');
  const [search, setSearch] = useState('');
  const [problems, setProblems] = useState(false);
  const q = useQuery({ queryKey: ['admin', 'lines'], queryFn: () => api.get<{ lines: LineRow[]; numbers: NumberRow[] }>('/api/admin/lines'), refetchInterval: 15_000 });

  const needle = search.trim().toLowerCase();
  const lines = useMemo(
    () =>
      (q.data?.lines ?? []).filter(
        (l) =>
          (!problems || l.health === 'failing' || l.health === 'waiting') &&
          (!needle || [l.name, l.host, l.username, l.account_name ?? '', ...l.numbers].some((v) => v.toLowerCase().includes(needle))),
      ),
    [q.data, problems, needle],
  );
  const numbers = useMemo(
    () =>
      (q.data?.numbers ?? []).filter(
        (n) => (!problems || n.dest_type === 'hangup' || !n.enabled) && (!needle || [n.number, n.label, n.account_name ?? '', n.trunk_name ?? ''].some((v) => v.toLowerCase().includes(needle))),
      ),
    [q.data, problems, needle],
  );
  const failing = q.data?.lines.filter((l) => l.health === 'failing').length ?? 0;

  return (
    <div>
      <PageHeader title="Lines & numbers" icon={<Server />} description="Every provider line and phone number on Envo, with who owns it and whether it works" />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'lines', label: 'Lines', count: q.data?.lines.length },
                { value: 'numbers', label: 'Numbers', count: q.data?.numbers.length },
              ]}
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="size-4 accent-brand-600" checked={problems} onChange={(e) => setProblems(e.target.checked)} />
              Problems only
              {failing > 0 && <Badge tone="red">{failing} down</Badge>}
            </label>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder={tab === 'lines' ? 'Search line, server or customer' : 'Search number or customer'} />
        </div>
        {q.isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : q.error ? (
          <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
        ) : tab === 'lines' ? (
          lines.length === 0 ? (
            <EmptyState icon={<Server className="size-5" />} title={problems ? 'Every line is working' : 'No lines'} description={problems ? 'Nothing is down or still connecting.' : 'Lines appear when customers connect a phone number.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Line</th>
                    <th>Status</th>
                    <th>Calls</th>
                    <th>Numbers</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className={clsx(!l.enabled && 'opacity-55')}>
                      <td>
                        <Owner accountId={l.account_id} account={l.account_name} tenant={l.tenant_name} />
                      </td>
                      <td>
                        <div className="text-sm font-medium text-slate-900">{l.name}</div>
                        <div className="font-mono text-xs text-slate-500">
                          {l.host}:{l.port} · {MODE[l.auth_mode]}
                          {l.username ? ` · ${l.username}` : ''}
                        </div>
                      </td>
                      <td>
                        <span className={clsx('inline-flex items-center gap-2 text-sm', l.health === 'failing' && 'font-medium text-rose-700')}>
                          <StatusDot tone={TONE[l.health]} pulse={l.health === 'ok'} />
                          {l.label}
                        </span>
                      </td>
                      <td className="text-sm text-slate-700 tabular-nums">
                        {l.in_use}
                        <span className="text-slate-400"> / {l.max_channels || '∞'}</span>
                      </td>
                      <td className="max-w-56 font-mono text-xs text-slate-600">{l.numbers.length ? l.numbers.join(', ') : <span className="font-sans text-slate-400">None</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : numbers.length === 0 ? (
          <EmptyState icon={<Hash className="size-5" />} title={problems ? 'Every number is routed' : 'No numbers'} description={problems ? 'All numbers are on and send calls somewhere.' : 'Numbers appear when customers connect them.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Customer</th>
                  <th>Line</th>
                  <th>Calls go to</th>
                </tr>
              </thead>
              <tbody>
                {numbers.map((n) => (
                  <tr key={n.id} className={clsx(!n.enabled && 'opacity-55')}>
                    <td>
                      <div className="font-mono text-[15px] font-semibold text-slate-900">{n.number}</div>
                      <div className="text-xs text-slate-500">
                        {n.label || 'No label'}
                        {!n.enabled && ' · off'}
                      </div>
                    </td>
                    <td>
                      <Owner accountId={n.account_id} account={n.account_name} tenant={n.tenant_name} />
                    </td>
                    <td className="text-sm text-slate-600">{n.trunk_name ?? <span className="text-slate-400">Any line</span>}</td>
                    <td className="text-sm">
                      {n.dest_type === 'hangup' ? <Badge tone="amber">Not routed: calls are rejected</Badge> : <span className="text-slate-700">{DEST_LABELS[n.dest_type] ?? n.dest_type}</span>}
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
