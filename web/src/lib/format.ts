export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  const yesterday = new Date(today.getTime() - 86400_000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

export function timeAgo(value: string | number | null | undefined): string {
  if (!value) return 'never';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

/** '"Alice" <1001>' -> { name: 'Alice', number: '1001' } */
export function parseCallerId(clid: string): { name: string; number: string } {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]*)>\s*$/.exec(clid);
  if (m) return { name: m[1]!.trim(), number: m[2]!.trim() };
  return { name: '', number: clid.trim() };
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export const DEST_LABELS: Record<string, string> = {
  extension: 'Extension',
  voicemail: 'Voicemail',
  ring_group: 'Ring group',
  queue: 'Queue',
  ivr: 'IVR menu',
  time_condition: 'Time condition',
  conference: 'Conference room',
  external: 'External number',
  hangup: 'Hang up',
};

/** "BDT 1,999" (whole taka) or "BDT 0.40" (fractions kept); null = custom price. */
export function formatBdt(value: string | number | null | undefined, opts: { custom?: string } = {}): string {
  if (value === null || value === undefined || value === '') return opts.custom ?? 'Custom';
  const n = Number(value);
  const fraction = Math.round(n * 100) % 100 !== 0;
  return `BDT ${n.toLocaleString('en-US', { minimumFractionDigits: fraction ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Package limit as shown to people: null = unlimited, 0 = not included. */
export function limitLabel(value: number | null, unit = ''): string {
  if (value === null) return 'Unlimited';
  if (value === 0) return 'Not included';
  return unit ? `${value.toLocaleString()} ${unit}` : value.toLocaleString();
}

export const IVR_TIER_LABELS: Record<string, string> = {
  basic: 'Basic',
  basic_ai: 'Basic AI',
  multi_ai: 'Multi AI',
  advanced_ai: 'Advanced AI',
  unlimited: 'Unlimited',
};

export const ACCOUNT_STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  active: { label: 'Active', tone: 'green' },
  pending: { label: 'Awaiting payment', tone: 'amber' },
  suspended: { label: 'Suspended', tone: 'red' },
  closed: { label: 'Closed', tone: 'gray' },
};

/** 1536 -> "1.5 KB", 5242880 -> "5 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Total talk time for summaries: "45 min", "3 h 20 min". */
export function formatTotalTime(totalSec: number): string {
  const min = Math.round(totalSec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** Who a channel belongs to: "101", "101 (web)", "Trunk #3"; ring group legs show the member. */
export function endpointLabel(channel: string): string {
  // Ring group / queue member legs: Local/<ext>@t<id>-qm-xxxx;1
  const local = /^Local\/([^@]+)@/.exec(channel);
  if (local) return local[1]!;
  const m = /^PJSIP\/(.+)-[0-9a-f]{8}$/.exec(channel);
  if (!m) return channel.split('-')[0] ?? channel;
  const ep = m[1]!;
  if (ep.startsWith('trunk_')) return `Trunk #${ep.slice(6)}`;
  return ep.endsWith('_web') ? `${ep.slice(0, -4).split('_')[0]} (web)` : ep.split('_')[0]!;
}
