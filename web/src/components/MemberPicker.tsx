import { useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useList } from '../lib/hooks';
import type { Extension } from '../lib/types';
import { IconButton } from './ui';

/** Ordered selection of extension numbers. */
export function MemberPicker({ value, onChange, ordered = false }: { value: string[]; onChange: (v: string[]) => void; ordered?: boolean }) {
  const { data = [] } = useList<Extension>('extensions');
  const [q, setQ] = useState('');
  const byNumber = new Map(data.map((e) => [e.number, e]));
  const available = data.filter((e) => !value.includes(e.number) && (!q || `${e.number} ${e.name}`.toLowerCase().includes(q.toLowerCase())));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Members ({value.length})
        </div>
        <div className="max-h-56 overflow-y-auto p-1.5">
          {value.map((n, i) => (
            <div key={n} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
              {ordered && <span className="w-4 text-xs text-slate-400">{i + 1}</span>}
              <span className="font-mono font-medium text-slate-900">{n}</span>
              <span className={clsx('flex-1 truncate', byNumber.has(n) ? 'text-slate-500' : 'text-rose-600')}>{byNumber.get(n)?.name ?? 'missing'}</span>
              {ordered && (
                <>
                  <IconButton label="Up" onClick={() => move(i, -1)} disabled={i === 0} className="size-6">
                    <ArrowUp className="size-3.5" />
                  </IconButton>
                  <IconButton label="Down" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="size-6">
                    <ArrowDown className="size-3.5" />
                  </IconButton>
                </>
              )}
              <IconButton label="Remove" tone="danger" className="size-6" onClick={() => onChange(value.filter((x) => x !== n))}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
          {!value.length && <p className="px-2 py-6 text-center text-xs text-slate-400">Pick extensions on the right</p>}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search extensions…" className="w-full border-b border-slate-100 px-3 py-2 text-sm focus:outline-none" />
        <div className="max-h-56 overflow-y-auto p-1.5">
          {available.map((e) => (
            <button key={e.id} type="button" onClick={() => onChange([...value, e.number])} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-brand-50">
              <Plus className="size-3.5 text-brand-600" />
              <span className="font-mono font-medium text-slate-900">{e.number}</span>
              <span className="truncate text-slate-500">{e.name}</span>
            </button>
          ))}
          {!available.length && <p className="px-2 py-6 text-center text-xs text-slate-400">No more extensions</p>}
        </div>
      </div>
    </div>
  );
}
