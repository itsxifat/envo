import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Badge, Card, EmptyState, ErrorBlock, PageHeader, SearchInput, TableSkeleton } from '../../components/ui';

interface AuditRow {
  id: number;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string;
  summary: string;
  tenant_id: number | null;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
  tenant_name: string | null;
  account_id: number | null;
  account_name: string | null;
}

const ACTIONS: Record<string, string> = {
  create: 'added',
  update: 'changed',
  delete: 'removed',
  impersonate: 'opened a customer portal',
  impersonate_end: 'left a customer portal',
  invite: 'sent an invitation to',
  verify_email: 'confirmed the email of',
  link_extension: 'linked a phone for',
  enable: 'turned on the login of',
  disable: 'turned off the login of',
  apply: 're-applied the configuration',
};

const ENTITIES: Record<string, string> = {
  ivr: 'an IVR menu',
  ring_group: 'a ring group',
  time_condition: 'business hours',
  outbound_route: 'a calling rule',
  blocked_number: 'a blocked caller',
  trunk: 'a phone line',
  number: 'a phone number',
  extension: 'an extension',
  tenant: 'a SIP server',
  user: 'a login',
  sound: 'a sound',
  queue: 'a call queue',
  conference: 'a conference room',
  package: 'a package',
  account: 'a customer',
  subscription: 'a package subscription',
  settings: 'platform settings',
  email_settings: 'email settings',
};

/** "changed a phone line", "opened a customer portal": an audit entry in words. */
export function describeAction(action: string, entity: string): string {
  if (action === 'impersonate' || action === 'impersonate_end' || action === 'apply') return ACTIONS[action]!;
  const verb = ACTIONS[action] ?? action.replace(/_/g, ' ');
  const what = ENTITIES[entity] ?? entity.replace(/_/g, ' ');
  return `${verb} ${what}`;
}

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);
  const q = useQuery({
    queryKey: ['admin', 'audit', debounced, accountId],
    queryFn: () => api.get<AuditRow[]>(`/api/admin/audit?limit=300&search=${encodeURIComponent(debounced)}${accountId ? `&account_id=${accountId}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const filteredName = accountId ? q.data?.find((r) => String(r.account_id) === accountId)?.account_name : null;

  return (
    <div>
      <PageHeader title="Activity log" icon={<ScrollText />} description="Who changed what, in every customer's portal and here. Support access is marked." />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search people, customers or changes" />
          {accountId && (
            <button
              type="button"
              onClick={() => setParams({})}
              className="inline-flex items-center gap-1.5 self-start rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-600/15 hover:bg-brand-100 sm:self-auto"
            >
              Only {filteredName ?? 'this customer'} <X className="size-3.5" />
            </button>
          )}
        </div>
        {q.isLoading ? (
          <TableSkeleton rows={8} cols={4} />
        ) : q.error ? (
          <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon={<ScrollText className="size-5" />} title="Nothing found" description={debounced ? 'No change matches your search.' : 'Changes appear here as people make them.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Customer</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => {
                  const support = r.action === 'impersonate' || r.action === 'impersonate_end' || r.summary.includes('[support, as ');
                  return (
                    <tr key={r.id}>
                      <td className="text-sm whitespace-nowrap text-slate-600">{formatDateTime(r.created_at)}</td>
                      <td>
                        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                          {r.user_name ?? 'System'}
                          {r.user_role === 'superadmin' && <Badge tone={support ? 'amber' : 'violet'}>{support ? 'Support' : 'Platform'}</Badge>}
                        </div>
                        <div className="text-xs text-slate-500">{r.user_email}</div>
                      </td>
                      <td className="max-w-md">
                        <div className="text-sm text-slate-800">{describeAction(r.action, r.entity)}</div>
                        {r.summary && <div className="truncate text-xs text-slate-500">{r.summary}</div>}
                      </td>
                      <td className="text-sm">
                        {r.account_id ? (
                          <Link to={`/admin/customers/${r.account_id}`} className="text-slate-800 hover:text-brand-700">
                            {r.account_name}
                            {r.tenant_name && <span className="block text-xs text-slate-500">{r.tenant_name}</span>}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
