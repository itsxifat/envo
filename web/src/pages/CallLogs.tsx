import { Fragment, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { Ban, ChevronRight, Download, History, Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, scoped } from '../lib/api';
import { useTenant } from '../state/tenant';
import { useIsAdmin } from '../state/auth';
import { usePhone } from '../phone/PhoneProvider';
import { endpointLabel, formatDateTime, formatDuration, parseCallerId } from '../lib/format';
import type { CallRow } from '../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBlock, IconButton, LoadingBlock, PageHeader, SearchInput, Select, Tabs, useConfirm } from '../components/ui';
import { CallsNav } from '../components/CallsNav';

const RANGES = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
} as const;
type Range = keyof typeof RANGES;

function rangeStart(r: Range): string {
  const d = new Date();
  if (r === 'today') d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - Number(r.slice(0, -1)));
  return d.toISOString();
}

interface Leg {
  id: number;
  calldate: string;
  clid: string;
  src: string;
  dst: string;
  channel: string;
  dstchannel: string;
  lastapp: string;
  duration: number;
  billsec: number;
  disposition: string;
  has_recording: boolean;
}

export function CallLogsPage() {
  const { tenantId } = useTenant();
  const phone = usePhone();
  const isAdmin = useIsAdmin();
  const confirm = useConfirm();
  const [range, setRange] = useState<Range>('7d');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const limit = 50;

  const list = useQuery({
    queryKey: ['calls', tenantId, range, direction, status, q, page],
    queryFn: () =>
      api.get<{ rows: CallRow[]; total: number }>(scoped('/api/calls', tenantId, { from: rangeStart(range), direction, status, q, page, limit })),
    enabled: !!tenantId,
    placeholderData: (prev) => prev,
  });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / limit));

  return (
    <div>
      <PageHeader title="Call logs" icon={<History className="size-5" />} description="Every call, with recordings when enabled" actions={<CallsNav />} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={range} onChange={(v) => { setRange(v); setPage(1); }} tabs={Object.entries(RANGES).map(([value, label]) => ({ value: value as Range, label }))} />
        <Select value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1); }} className="w-40">
          <option value="">All directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-36">
          <option value="">Any status</option>
          <option value="answered">Answered</option>
          <option value="missed">Missed</option>
        </Select>
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search number or name" />
      </div>

      <Card className={clsx('transition-opacity', list.isFetching && list.data && 'opacity-60')}>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.rows.length ? (
          <EmptyState icon={<History className="size-5" />} title="No calls found" description="Try a longer date range or clear the filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Time</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Talk time</th>
                  <th>Status</th>
                  <th className="w-40" />
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((c) => {
                  const from = parseCallerId(c.clid);
                  const Icon = c.direction === 'inbound' ? (c.answered ? PhoneIncoming : PhoneMissed) : c.direction === 'outbound' ? PhoneOutgoing : PhoneCall;
                  const callbackNumber = c.direction === 'outbound' ? c.dst : from.number || c.src;
                  return (
                    <Fragment key={c.linkedid}>
                      <tr className="cursor-pointer" onClick={() => setOpen(open === c.linkedid ? null : c.linkedid)}>
                        <td>
                          <ChevronRight className={clsx('size-4 text-slate-400 transition', open === c.linkedid && 'rotate-90')} />
                        </td>
                        <td className="text-sm whitespace-nowrap text-slate-600">{formatDateTime(c.calldate)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Icon className={clsx('size-4 shrink-0', c.answered ? 'text-slate-400' : 'text-rose-500')} />
                            <div>
                              <div className="text-sm font-medium text-slate-900">{from.name || from.number || c.src || 'Unknown'}</div>
                              {from.name && <div className="font-mono text-xs text-slate-500">{from.number}</div>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="font-mono text-sm text-slate-800">{c.did || c.dst}</div>
                          {c.answered && c.answered_channel && <div className="text-xs text-slate-500">answered by {endpointLabel(c.answered_channel)}</div>}
                        </td>
                        <td className="text-sm text-slate-700 tabular-nums">{c.answered ? formatDuration(c.billsec) : '—'}</td>
                        <td>
                          <Badge tone={c.answered ? 'green' : c.disposition === 'BUSY' ? 'amber' : 'red'}>
                            {c.answered ? 'Answered' : c.disposition === 'BUSY' ? 'Busy' : c.disposition === 'FAILED' ? 'Failed' : 'Missed'}
                          </Badge>
                          {c.direction && <span className="ml-2 text-xs text-slate-400 capitalize">{c.direction}</span>}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-0.5">
                            {c.has_recording && (
                              <>
                                <IconButton label="Play recording" tone="brand" onClick={() => setPlaying(playing === c.record_id ? null : c.record_id)}>
                                  <Play className="size-4" />
                                </IconButton>
                                <a
                                  href={scoped(`/api/calls/${c.record_id}/recording`, tenantId, { download: 1 })}
                                  className="inline-flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  title="Download recording"
                                >
                                  <Download className="size-4" />
                                </a>
                              </>
                            )}
                            {callbackNumber && (
                              <IconButton label={`Call ${callbackNumber}`} onClick={() => phone.dial(callbackNumber)}>
                                <Phone className="size-4" />
                              </IconButton>
                            )}
                            {isAdmin && c.direction === 'inbound' && from.number && (
                              <IconButton
                                label={`Block ${from.number}`}
                                tone="danger"
                                onClick={async () => {
                                  if (!(await confirm({ title: `Block ${from.number}?`, message: 'Future calls from this number are rejected before they ring anyone.', confirmLabel: 'Block caller', danger: true }))) return;
                                  try {
                                    await api.post(scoped('/api/blocked', tenantId), { match: 'exact', number: from.number, note: 'Blocked from call log' });
                                    toast.success('Caller blocked');
                                  } catch (err) {
                                    toast.error(errorMessage(err));
                                  }
                                }}
                              >
                                <Ban className="size-4" />
                              </IconButton>
                            )}
                          </div>
                        </td>
                      </tr>
                      {playing === c.record_id && (
                        <tr>
                          <td colSpan={7} className="bg-slate-50">
                            <audio autoPlay controls src={scoped(`/api/calls/${c.record_id}/recording`, tenantId)} className="h-9 w-full" />
                          </td>
                        </tr>
                      )}
                      {open === c.linkedid && (
                        <tr>
                          <td colSpan={7} className="bg-slate-50/70">
                            <CallLegs linkedid={c.linkedid} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > limit && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              {list.data.total.toLocaleString()} calls · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function CallLegs({ linkedid }: { linkedid: string }) {
  const { tenantId } = useTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['call', linkedid, tenantId],
    queryFn: () => api.get<Leg[]>(scoped(`/api/calls/call/${linkedid}`, tenantId)),
  });
  if (isLoading) return <LoadingBlock />;
  return (
    <div className="py-1">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Call path</div>
      <ol className="space-y-1.5">
        {data?.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="w-16 text-slate-400 tabular-nums">{new Date(l.calldate).toLocaleTimeString()}</span>
            <span className="font-medium text-slate-800">{endpointLabel(l.channel)}</span>
            <ChevronRight className="size-3 text-slate-400" />
            <span className="font-medium text-slate-800">{l.dstchannel ? endpointLabel(l.dstchannel) : l.dst}</span>
            <span className="text-slate-400">via {l.lastapp || '—'}</span>
            <Badge tone={l.disposition === 'ANSWERED' ? 'green' : 'gray'}>{l.disposition.toLowerCase()}</Badge>
            {l.billsec > 0 && <span className="tabular-nums">{formatDuration(l.billsec)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
