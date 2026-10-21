import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, AudioLines, CalendarClock, Download, HardDrive, Hourglass, Link2, Pause, PhoneCall, PhoneIncoming, PhoneOutgoing, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, scoped } from '../lib/api';
import { useTenant } from '../state/tenant';
import { useAuth, useIsAdmin } from '../state/auth';
import { useList } from '../lib/hooks';
import { endpointLabel, formatBytes, formatDate, formatDateTime, formatDuration, formatTotalTime, parseCallerId, plural } from '../lib/format';
import type { Extension, Recording, RecordingItem, RecordingSummary } from '../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBlock, IconButton, LoadingBlock, Notice, PageHeader, SearchInput, Select, Stat, Tabs, Tooltip, useConfirm } from '../components/ui';
import { CallsNav } from '../components/CallsNav';
import { RecordingPlayer, type PlayerHandle, type PlayerTrack } from '../components/RecordingPlayer';

const DAY_MS = 86400_000;
const PAGE_SIZE = 25;

const RANGES = { today: 'Today', '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All' } as const;
type Range = keyof typeof RANGES;
type Sort = 'newest' | 'oldest' | 'longest';

function rangeStart(r: Range): string | undefined {
  if (r === 'all') return undefined;
  const d = new Date();
  if (r === 'today') d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - Number(r.slice(0, -1)));
  return d.toISOString();
}

const DIRECTIONS = {
  inbound: { label: 'Incoming', icon: PhoneIncoming, tone: 'bg-sky-50 text-sky-600' },
  outbound: { label: 'Outgoing', icon: PhoneOutgoing, tone: 'bg-violet-50 text-violet-600' },
  internal: { label: 'Internal', icon: PhoneCall, tone: 'bg-slate-100 text-slate-600' },
} as const;

/** Why an extension or number is not recorded like the rest of the server. */
const OVERRIDE_LABELS: Record<string, string> = {
  off: 'never recorded',
  inbound: 'only calls it receives',
  outbound: 'only calls it makes',
};

function parties(r: RecordingItem) {
  const caller = parseCallerId(r.clid);
  const fromNumber = caller.number || r.src;
  const fromName = caller.name && caller.name !== fromNumber ? caller.name : '';
  const to = (r.direction === 'inbound' ? r.did || r.dst : r.dst) || '—';
  // Outgoing calls are answered by a trunk, which says nothing new.
  const answered = r.direction !== 'outbound' && r.answered_channel ? endpointLabel(r.answered_channel) : '';
  return { from: fromName || fromNumber || 'Unknown', fromName, fromNumber, to, answeredBy: answered && answered !== to ? answered : '' };
}

function keptText(r: RecordingItem): string {
  if (!r.available) return 'No audio';
  if (r.kept_until_deleted || !r.expires_at) return 'Kept until deleted';
  const ms = new Date(r.expires_at).getTime() - Date.now();
  if (ms <= 0) return 'Being removed';
  const days = Math.ceil(ms / DAY_MS);
  return days === 1 ? 'Last day on the server' : `${days} days left on the server`;
}

function trackOf(r: RecordingItem, tenantId: number | null): PlayerTrack {
  const p = parties(r);
  return {
    id: r.id,
    url: scoped(`/api/recordings/${r.id}/audio`, tenantId),
    downloadUrl: scoped(`/api/recordings/${r.id}/audio`, tenantId, { download: 1 }),
    title: `${p.from} → ${p.to}`,
    subtitle: [formatDateTime(r.calldate), r.direction && DIRECTIONS[r.direction].label, p.answeredBy && `answered by ${p.answeredBy}`, keptText(r)]
      .filter(Boolean)
      .join(' · '),
    size: r.size,
    duration: r.billsec,
  };
}

export function RecordingsPage() {
  const { tenantId } = useTenant();
  const isAdmin = useIsAdmin();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<Range>('30d');
  const [direction, setDirection] = useState('');
  const [extension, setExtension] = useState('');
  const [minSec, setMinSec] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [current, setCurrent] = useState<RecordingItem | null>(null);
  const [playing, setPlaying] = useState(false);
  const [autoNext, setAutoNext] = useState(() => {
    try {
      return localStorage.getItem('envo.player.autonext') !== '0';
    } catch {
      return true;
    }
  });
  const player = useRef<PlayerHandle>(null);
  // Set when "next"/"previous" crosses a page: play the first/last recording once it loads.
  const pendingPlay = useRef<'first' | 'last' | null>(null);

  const filtered = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
    setSelected(new Set());
  };

  const summary = useQuery({
    queryKey: ['recordings-summary', tenantId],
    queryFn: () => api.get<RecordingSummary>(scoped('/api/recordings/summary', tenantId)),
    enabled: !!tenantId,
    refetchInterval: 60_000,
  });
  const list = useQuery({
    queryKey: ['recordings', tenantId, range, direction, extension, minSec, sort, q, page],
    queryFn: () =>
      api.get<{ rows: RecordingItem[]; total: number; seconds: number }>(
        scoped('/api/recordings', tenantId, { from: rangeStart(range), direction, extension, min_sec: minSec, sort, q, page, limit: PAGE_SIZE }),
      ),
    enabled: !!tenantId,
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });
  const extensions = useList<Extension>('extensions', { enabled: isAdmin });

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const playable = useMemo(() => rows.filter((r) => r.available), [rows]);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const play = (r: RecordingItem) => {
    if (current?.id === r.id) {
      player.current?.toggle();
      return;
    }
    setCurrent(r);
    setParams(
      (p) => {
        p.set('play', String(r.id));
        return p;
      },
      { replace: true },
    );
  };
  const close = () => {
    setCurrent(null);
    setPlaying(false);
    setParams(
      (p) => {
        p.delete('play');
        return p;
      },
      { replace: true },
    );
  };

  // Shared links: /recordings?play=<id> opens the player on that recording.
  const playParam = Number(params.get('play')) || 0;
  const linked = useQuery({
    queryKey: ['recording', tenantId, playParam],
    queryFn: () => api.get<RecordingItem>(scoped(`/api/recordings/${playParam}`, tenantId)),
    enabled: !!tenantId && playParam > 0 && !current,
    retry: false,
  });
  useEffect(() => {
    if (linked.data && !current) setCurrent(linked.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked.data]);
  useEffect(() => {
    if (!linked.error) return;
    toast.error('That recording is no longer available');
    setParams(
      (p) => {
        p.delete('play');
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked.error]);

  useEffect(() => {
    if (!pendingPlay.current || list.isFetching || !list.data) return;
    const target = pendingPlay.current === 'first' ? playable[0] : playable[playable.length - 1];
    pendingPlay.current = null;
    if (target) play(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, list.isFetching]);

  const idx = current ? playable.findIndex((r) => r.id === current.id) : -1;
  const goNext =
    idx >= 0 && idx < playable.length - 1
      ? () => play(playable[idx + 1]!)
      : idx >= 0 && page < pages
        ? () => {
            pendingPlay.current = 'first';
            setPage(page + 1);
          }
        : undefined;
  const goPrev =
    idx > 0
      ? () => play(playable[idx - 1]!)
      : idx === 0 && page > 1
        ? () => {
            pendingPlay.current = 'last';
            setPage(page - 1);
          }
        : undefined;

  const track = useMemo(() => (current ? trackOf(current, tenantId) : null), [current, tenantId]);

  const toggleSelected = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const remove = async (ids: number[]) => {
    const ok = await confirm({
      title: ids.length === 1 ? 'Delete this recording?' : `Delete ${ids.length} recordings?`,
      message: 'The audio is removed from the server for good. The calls stay in the call log.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.post<{ deleted: number; failed: number }>(scoped('/api/recordings/delete', tenantId), { ids });
      toast.success(`${plural(res.deleted, 'recording')} deleted${res.failed ? `, ${res.failed} could not be removed` : ''}`);
      if (current && ids.includes(current.id)) close();
      setSelected(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['recordings'] }),
        qc.invalidateQueries({ queryKey: ['recordings-summary'] }),
        qc.invalidateQueries({ queryKey: ['calls'] }),
      ]);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copyLink = async (r: RecordingItem) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/recordings?play=${r.id}`);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const s = summary.data;
  const notRecording = !!s?.tenant && (!s.included || s.policy === 'off');

  return (
    <div>
      <PageHeader
        title="Recordings"
        icon={<AudioLines className="size-5" />}
        description="Listen back to recorded calls and see how long each one stays on the server"
        actions={<CallsNav />}
      />

      {s?.tenant && <RecordingStatus summary={s} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={range} onChange={filtered(setRange)} tabs={Object.entries(RANGES).map(([value, label]) => ({ value: value as Range, label }))} />
        <Select value={direction} onChange={(e) => filtered(setDirection)(e.target.value)} className="w-36" aria-label="Direction">
          <option value="">All calls</option>
          <option value="inbound">Incoming</option>
          <option value="outbound">Outgoing</option>
          <option value="internal">Internal</option>
        </Select>
        {isAdmin && (
          <Select value={extension} onChange={(e) => filtered(setExtension)(e.target.value)} className="w-44" aria-label="Extension">
            <option value="">Any extension</option>
            {extensions.data?.map((e) => (
              <option key={e.id} value={e.number}>
                {e.number} · {e.name}
              </option>
            ))}
          </Select>
        )}
        <Select value={minSec} onChange={(e) => filtered(setMinSec)(e.target.value)} className="w-40" aria-label="Length">
          <option value="">Any length</option>
          <option value="30">30 s or longer</option>
          <option value="60">1 min or longer</option>
          <option value="300">5 min or longer</option>
          <option value="900">15 min or longer</option>
        </Select>
        <Select value={sort} onChange={(e) => filtered(setSort)(e.target.value as Sort)} className="w-36" aria-label="Order">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="longest">Longest first</option>
        </Select>
        <SearchInput value={q} onChange={filtered(setQ)} placeholder="Search number or name" />
      </div>

      <Card className={clsx('transition-opacity', list.isFetching && list.data && 'opacity-70')}>
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] bg-brand-50/60 px-4 py-2.5">
            <span className="text-sm font-medium text-brand-900">{plural(selected.size, 'recording')} selected</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => void remove([...selected])}>
                Delete
              </Button>
            </div>
          </div>
        ) : (
          total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-2.5">
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-slate-900 tabular-nums">{total.toLocaleString()}</span> {total === 1 ? 'recording' : 'recordings'}
                <span className="text-slate-400"> · </span>
                {formatTotalTime(list.data?.seconds ?? 0)} of talk
              </p>
              <Button
                size="sm"
                icon={<Play className="size-3.5 fill-current" />}
                disabled={!playable.length}
                onClick={() => {
                  setAutoNext(true);
                  if (playable[0]) play(playable[0]);
                }}
              >
                Play all
              </Button>
            </div>
          )
        )}

        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={<AudioLines className="size-5" />}
            title="No recordings found"
            description={
              notRecording
                ? 'Calls on this SIP server are not being recorded right now.'
                : 'A recording shows up here as soon as a recorded call ends. Try a longer date range or clear the filters.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-24">
                    {isAdmin && (
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                        aria-label="Select all on this page"
                        className="size-4 cursor-pointer rounded accent-brand-600"
                      />
                    )}
                  </th>
                  <th>Call</th>
                  <th>When</th>
                  <th>Length</th>
                  <th>Size</th>
                  <th>On the server</th>
                  <th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = parties(r);
                  const dir = r.direction ? DIRECTIONS[r.direction] : DIRECTIONS.internal;
                  const isCurrent = current?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      className={clsx(r.available ? 'cursor-pointer' : 'text-slate-400', isCurrent && 'bg-brand-50/60 hover:bg-brand-50/80')}
                      onClick={() => r.available && play(r)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                          {isAdmin && (
                            <input
                              type="checkbox"
                              checked={selected.has(r.id)}
                              onChange={() => toggleSelected(r.id)}
                              aria-label="Select recording"
                              className="size-4 cursor-pointer rounded accent-brand-600"
                            />
                          )}
                          <button
                            type="button"
                            disabled={!r.available}
                            onClick={() => play(r)}
                            aria-label={isCurrent && playing ? 'Pause' : 'Play recording'}
                            className={clsx(
                              'flex size-9 shrink-0 items-center justify-center rounded-full transition focus-visible:ring-4 focus-visible:ring-brand-500/25 focus-visible:outline-none disabled:opacity-40',
                              isCurrent ? 'bg-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(31_87_235/0.7)]' : 'bg-slate-100 text-slate-700 hover:bg-brand-50 hover:text-brand-700',
                            )}
                          >
                            {isCurrent && playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-full max-md:hidden', dir.tone)}>
                            <dir.icon className="size-4" />
                          </span>
                          {/* Phones: the whole card plays; this shows that it does. */}
                          {r.available && (
                            <span
                              className={clsx(
                                'flex size-8 shrink-0 items-center justify-center rounded-full md:hidden',
                                isCurrent ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700',
                              )}
                            >
                              {isCurrent && playing ? <Pause className="size-3.5 fill-current" /> : <Play className="ml-0.5 size-3.5 fill-current" />}
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-slate-900 md:flex-nowrap">
                              <span className="md:truncate">{p.from}</span>
                              <ArrowRight className="size-3.5 shrink-0 text-slate-400" />
                              <span className="font-mono md:truncate">{p.to}</span>
                            </div>
                            <div className="truncate text-xs font-normal text-slate-500">
                              {[dir.label, p.fromName && p.fromNumber, p.answeredBy && `answered by ${p.answeredBy}`].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm whitespace-nowrap text-slate-600">{formatDateTime(r.calldate)}</td>
                      <td className="text-sm text-slate-700 tabular-nums">{formatDuration(r.billsec)}</td>
                      <td className="text-sm text-slate-500 tabular-nums">{r.available ? formatBytes(r.size) : '—'}</td>
                      <td>
                        <Kept r={r} retentionDays={s?.retentionDays} soonDays={s?.soonDays ?? 3} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-0.5">
                          {r.available && (
                            <Tooltip label="Download">
                              <a
                                href={scoped(`/api/recordings/${r.id}/audio`, tenantId, { download: 1 })}
                                aria-label="Download recording"
                                className="inline-flex size-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.05] hover:text-slate-800 sm:size-8"
                              >
                                <Download className="size-4" />
                              </a>
                            </Tooltip>
                          )}
                          <IconButton label="Copy link" onClick={() => void copyLink(r)}>
                            <Link2 className="size-4" />
                          </IconButton>
                          {isAdmin && (
                            <IconButton label="Delete recording" tone="danger" onClick={() => void remove([r.id])}>
                              <Trash2 className="size-4" />
                            </IconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages}
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

      {current && track && (
        <RecordingPlayer
          ref={player}
          track={track}
          onClose={close}
          onPrev={goPrev}
          onNext={goNext}
          autoNext={autoNext}
          onAutoNextChange={(on) => {
            setAutoNext(on);
            try {
              localStorage.setItem('envo.player.autonext', on ? '1' : '0');
            } catch {
              /* private mode */
            }
          }}
          onPlayingChange={setPlaying}
        />
      )}
    </div>
  );
}

/** How long a recording still stays on the server. */
function Kept({ r, retentionDays, soonDays }: { r: RecordingItem; retentionDays: number | null | undefined; soonDays: number }) {
  if (!r.available) {
    return (
      <Tooltip label="No audio was saved for this call, or the file was removed">
        <span className="inline-flex">
          <Badge tone="gray">No audio</Badge>
        </span>
      </Tooltip>
    );
  }
  if (r.kept_until_deleted || !r.expires_at) return <Badge tone="blue">Until deleted</Badge>;
  const ms = new Date(r.expires_at).getTime() - Date.now();
  const days = Math.ceil(ms / DAY_MS);
  const tone = ms <= DAY_MS ? 'red' : days <= soonDays ? 'amber' : 'green';
  const label = ms <= 0 ? 'Being removed' : days === 1 ? 'Last day' : `${days} days left`;
  const left = retentionDays ? Math.min(1, Math.max(0, ms / (retentionDays * DAY_MS))) : null;
  return (
    <Tooltip label={`Removed automatically on ${formatDate(r.expires_at)}`}>
      <span className="inline-flex flex-col items-start gap-1.5 max-md:items-end">
        <Badge tone={tone} dot>
          {label}
        </Badge>
        {left !== null && (
          <span className="block h-1 w-20 overflow-hidden rounded-full bg-slate-100">
            <span
              className={clsx('block h-full rounded-full', tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-rose-500')}
              style={{ width: `${Math.max(4, left * 100)}%` }}
            />
          </span>
        )}
      </span>
    </Tooltip>
  );
}

/** What this SIP server records, how long recordings stay, and the storage they use. */
function RecordingStatus({ summary }: { summary: RecordingSummary }) {
  const { tenantId } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const admin = user?.role !== 'agent';
  const platform = user?.role === 'superadmin';
  const server = summary.tenant?.name ?? 'this SIP server';
  const days = summary.retentionDays ?? null;
  const policy = summary.policy ?? 'off';

  const update = async (body: { recording?: Recording; reset_overrides?: boolean }, done: string) => {
    setBusy(true);
    try {
      await api.put(scoped('/api/recordings/policy', tenantId), body);
      toast.success(done);
      await qc.invalidateQueries({ queryKey: ['recordings-summary'] });
      void qc.invalidateQueries({ queryKey: ['list'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const recordAll = (
    <Button size="sm" variant="primary" loading={busy} onClick={() => void update({ recording: 'all' }, 'Every call is recorded from now on')}>
      Record all calls
    </Button>
  );

  let tone: 'success' | 'warn' | 'info';
  let title: string;
  let body: ReactNode;
  let action: ReactNode = null;
  if (!summary.included) {
    tone = 'warn';
    title = 'Call recording is not included in this package';
    body = `Calls on ${server} are not recorded.`;
    if (admin) {
      action = platform ? (
        <Link to={`/admin/customers/${summary.accountId}`} className="font-medium underline underline-offset-2">
          Change the customer's package
        </Link>
      ) : (
        <Link to="/account" className="font-medium underline underline-offset-2">
          See packages with recording
        </Link>
      );
    }
  } else if (policy === 'off') {
    tone = 'warn';
    title = 'Recording is off';
    body = `Calls on ${server} are not recorded.`;
    if (admin) action = recordAll;
  } else if (policy !== 'all') {
    tone = 'info';
    title = policy === 'inbound' ? 'Only incoming calls are recorded' : 'Only outgoing calls are recorded';
    body = `Record every call to also keep ${policy === 'inbound' ? 'outgoing calls' : 'incoming calls'} and calls between extensions.`;
    if (admin) action = recordAll;
  } else {
    tone = 'success';
    title = 'Every call is recorded';
    body = `Incoming and outgoing calls and calls between extensions on ${server} are recorded. A recording appears here when the call ends.`;
  }

  const ex = summary.exceptions;
  const exceptions = [
    ...(ex?.extensions.map((e) => `${e.number}${e.name ? ` ${e.name}` : ''} (${OVERRIDE_LABELS[e.recording] ?? e.recording})`) ?? []),
    ...(ex?.numbers.map((n) => `${n.number} (${OVERRIDE_LABELS[n.recording] ?? n.recording})`) ?? []),
  ];
  const stored = summary.stored;
  const storage = summary.storage;
  const quota = storage?.quotaBytes ?? null;
  const used = storage?.usedBytes ?? 0;

  return (
    <div className="mb-5 space-y-3">
      <Notice tone={tone} title={title}>
        <p>
          {body}{' '}
          {days === null
            ? 'Recordings are kept until someone deletes them.'
            : summary.included
              ? `Each recording is kept for ${plural(days, 'day')}, then removed automatically.`
              : `Recordings already stored are removed after ${plural(days, 'day')}.`}
        </p>
        {admin && summary.included && policy !== 'off' && exceptions.length > 0 && (
          <p className="mt-1.5">
            Set differently: {exceptions.join(', ')}.{' '}
            <button
              type="button"
              disabled={busy}
              onClick={() => void update({ reset_overrides: true }, 'Every extension and number now follows the server setting')}
              className="font-medium underline underline-offset-2 disabled:opacity-50"
            >
              Record these too
            </button>
          </p>
        )}
        {action && <div className="mt-2.5">{action}</div>}
      </Notice>

      {admin && stored && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Stored"
            value={stored.files.toLocaleString()}
            sub={`${formatBytes(stored.bytes)}${stored.oldest ? ` · since ${formatDate(stored.oldest)}` : ''}`}
            icon={<AudioLines />}
          />
          <Stat
            label="Kept for"
            value={days === null ? 'No limit' : plural(days, 'day')}
            sub={days === null ? 'Until someone deletes them' : 'Then removed automatically'}
            icon={<CalendarClock />}
            tone="blue"
          />
          <Stat
            label="Expiring"
            value={stored.expiringSoon.toLocaleString()}
            sub={days === null ? 'Nothing is removed automatically' : `Within the next ${plural(summary.soonDays ?? 3, 'day')}`}
            icon={<Hourglass />}
            tone="amber"
          />
          <Stat
            label="Storage"
            value={formatBytes(used)}
            sub={quota === null ? 'No storage limit' : `of ${formatBytes(quota)}${used >= quota * 0.8 ? ' · oldest go first when full' : ''}`}
            icon={<HardDrive />}
            tone="violet"
            footer={
              quota !== null && quota > 0 ? (
                <span className="block h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className={clsx('block h-full rounded-full', used / quota >= 0.8 ? 'bg-amber-500' : 'bg-brand-500')}
                    style={{ width: `${Math.min(100, Math.max(3, (used / quota) * 100))}%` }}
                  />
                </span>
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
