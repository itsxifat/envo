import { ArrowRight } from 'lucide-react';
import { useDestinations } from '../lib/hooks';
import { DEST_LABELS } from '../lib/format';
import type { DestType } from '../lib/types';
import { Input, Select } from './ui';

const ORDER: DestType[] = ['extension', 'ring_group', 'queue', 'ivr', 'time_condition', 'conference', 'voicemail', 'external', 'hangup'];

export function DestinationPicker({
  type,
  target,
  onChange,
  exclude = [],
}: {
  type: DestType;
  target: string;
  onChange: (type: DestType, target: string) => void;
  exclude?: DestType[];
}) {
  const { data } = useDestinations();
  const options = type === 'external' || type === 'hangup' ? [] : (data?.[type] ?? []);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Select
        value={type}
        onChange={(e) => {
          const next = e.target.value as DestType;
          const first = next === 'external' || next === 'hangup' ? '' : (data?.[next]?.[0]?.value ?? '');
          onChange(next, first);
        }}
      >
        {ORDER.filter((t) => !exclude.includes(t)).map((t) => (
          <option key={t} value={t}>
            {DEST_LABELS[t]}
          </option>
        ))}
      </Select>
      {type === 'hangup' ? (
        <div className="flex items-center px-1 text-xs text-slate-400">The call is disconnected</div>
      ) : type === 'external' ? (
        <Input value={target} onChange={(e) => onChange(type, e.target.value.replace(/[^\d+]/g, ''))} placeholder="e.g. 01712345678" inputMode="tel" />
      ) : (
        <Select value={target} onChange={(e) => onChange(type, e.target.value)}>
          {!options.some((o) => o.value === target) && <option value={target}>{target ? `Missing (${target})` : 'Select…'}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

/** Compact read-only rendering of a destination. */
export function DestLabel({ type, target }: { type: DestType; target: string }) {
  const { data } = useDestinations();
  if (type === 'hangup') return <span className="text-slate-400">Hang up</span>;
  const label = type === 'external' ? target : (data?.[type]?.find((o) => o.value === target)?.label ?? null);
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-700">
      <ArrowRight className="size-3.5 text-slate-400" />
      <span className="text-slate-500">{DEST_LABELS[type]}</span>
      <span className={label ? 'font-medium' : 'font-medium text-rose-600'}>{label ?? 'missing'}</span>
    </span>
  );
}
