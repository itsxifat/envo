import { Phone, Trash2, Voicemail } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage, scoped } from '../lib/api';
import { useTenant } from '../state/tenant';
import { usePhone } from '../phone/PhoneProvider';
import { formatDateTime, formatDuration, parseCallerId } from '../lib/format';
import type { VoicemailMessage } from '../lib/types';
import { Badge, Card, EmptyState, ErrorBlock, IconButton, LoadingBlock, PageHeader, useConfirm } from '../components/ui';

export function VoicemailPage() {
  const { tenantId } = useTenant();
  const phone = usePhone();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({
    queryKey: ['list', 'voicemail', tenantId],
    queryFn: () => api.get<VoicemailMessage[]>(scoped('/api/voicemail', tenantId)),
    enabled: !!tenantId,
    refetchInterval: 30_000,
  });
  const remove = useMutation({
    mutationFn: (m: VoicemailMessage) => api.del(scoped(`/api/voicemail/${m.mailbox}/${m.folder}/${m.id}`, tenantId)),
    onSuccess: () => {
      toast.success('Message deleted');
      void qc.invalidateQueries({ queryKey: ['list', 'voicemail'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div>
      <PageHeader title="Voicemail" icon={<Voicemail className="size-5" />} description="Messages left for your extensions. Phones can also dial *97." />
      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState icon={<Voicemail className="size-5" />} title="No voicemail" description="New messages show up here as soon as a caller hangs up." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data.map((m) => {
              const from = parseCallerId(m.callerid);
              return (
                <li key={`${m.mailbox}/${m.folder}/${m.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{from.name || from.number || 'Unknown caller'}</span>
                      {m.folder === 'INBOX' && <Badge tone="brand">New</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {from.name && `${from.number} · `}for ext {m.mailbox} · {formatDateTime(m.origtime * 1000)} · {formatDuration(m.duration)}
                    </div>
                  </div>
                  <audio controls preload="none" src={scoped(`/api/voicemail/${m.mailbox}/${m.folder}/${m.id}/audio`, tenantId)} className="h-9 w-72 max-w-full" />
                  <div className="flex gap-0.5">
                    {from.number && (
                      <IconButton label="Call back" tone="brand" onClick={() => phone.dial(from.number)}>
                        <Phone className="size-4" />
                      </IconButton>
                    )}
                    <IconButton
                      label="Delete"
                      tone="danger"
                      onClick={async () => {
                        if (await confirm({ title: 'Delete this message?', confirmLabel: 'Delete', danger: true })) remove.mutate(m);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
