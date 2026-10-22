import { useState } from 'react';
import { Ban, Plus, ShieldBan, Trash2, UserX } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import { formatDateTime } from '../lib/format';
import type { BlockedNumber } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBlock, Field, IconButton, Input, LoadingBlock, PageHeader, Select, useConfirm } from '../components/ui';

const MATCH_LABEL = { exact: 'Number', prefix: 'Starts with', anonymous: 'Hidden caller ID' } as const;

export function BlockedPage() {
  const list = useList<BlockedNumber>('blocked');
  const save = useSave('blocked', { created: 'Caller blocked' });
  const remove = useRemove('blocked', 'Unblocked');
  const confirm = useConfirm();
  const [match, setMatch] = useState<BlockedNumber['match']>('exact');
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const hasAnonymous = list.data?.some((b) => b.match === 'anonymous');

  const add = async () => {
    const ok = await save.mutateAsync({ data: { match, number, note } }).catch(() => null);
    if (ok) {
      setNumber('');
      setNote('');
    }
  };

  return (
    <div>
      <PageHeader title="Blocked callers" icon={<ShieldBan className="size-5" />} description="Calls from these numbers are rejected before they ring anyone" />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="h-fit">
          <CardHeader title="Block a caller" description="Works in national and international format automatically" />
          <div className="space-y-4 p-5">
            <Field label="Rule">
              <Select value={match} onChange={(e) => setMatch(e.target.value as BlockedNumber['match'])}>
                <option value="exact">Exact number</option>
                <option value="prefix">Numbers starting with…</option>
                <option value="anonymous" disabled={hasAnonymous}>
                  Callers hiding their number
                </option>
              </Select>
            </Field>
            {match !== 'anonymous' && (
              <Field label={match === 'prefix' ? 'Prefix' : 'Phone number'}>
                <Input value={number} onChange={(e) => setNumber(e.target.value.replace(/[^\d+]/g, ''))} placeholder={match === 'prefix' ? '0160' : '01712345678'} />
              </Field>
            )}
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spam / robocall" />
            </Field>
            <Button variant="danger" className="w-full" icon={<Ban className="size-4" />} loading={save.isPending} disabled={match !== 'anonymous' && !number} onClick={add}>
              Block
            </Button>
          </div>
        </Card>
        <Card>
          {list.isLoading ? (
            <LoadingBlock />
          ) : list.error ? (
            <ErrorBlock error={list.error} />
          ) : !list.data?.length ? (
            <EmptyState icon={<UserX className="size-5" />} title="Nobody is blocked" description="Block spam callers here or straight from the call log." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Caller</th>
                    <th>Note</th>
                    <th>Added</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Badge tone={b.match === 'anonymous' ? 'violet' : b.match === 'prefix' ? 'amber' : 'red'}>{MATCH_LABEL[b.match]}</Badge>
                          {b.match !== 'anonymous' && <span className="font-mono text-sm text-slate-900">{b.number}{b.match === 'prefix' ? '…' : ''}</span>}
                        </div>
                      </td>
                      <td className="text-sm text-slate-600">{b.note || '—'}</td>
                      <td className="text-sm text-slate-500">{formatDateTime(b.created_at)}</td>
                      <td>
                        <IconButton
                          label="Unblock"
                          tone="danger"
                          onClick={async () => {
                            if (await confirm({ title: 'Unblock this caller?', confirmLabel: 'Unblock' })) remove.mutate(b.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
        <Plus className="size-3.5" /> Tip: use the block button next to any incoming call in Call history.
      </p>
    </div>
  );
}
