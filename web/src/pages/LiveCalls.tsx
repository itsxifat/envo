import { useEffect, useMemo, useState } from 'react';
import { Activity, PhoneOff, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useLive } from '../state/live';
import { useTenant } from '../state/tenant';
import { useAuth } from '../state/auth';
import { formatDuration } from '../lib/format';
import type { LiveChannel } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatusDot, useConfirm } from '../components/ui';

const APP_LABEL: Record<string, string> = {
  Dial: 'Connected / ringing',
  Queue: 'Waiting in queue',
  VoiceMail: 'Leaving voicemail',
  VoiceMailMain: 'Checking voicemail',
  BackGround: 'In IVR menu',
  Background: 'In IVR menu',
  WaitExten: 'In IVR menu',
  Playback: 'Hearing announcement',
  Echo: 'Echo test',
  AppDial: 'Callee leg',
  AppQueue: 'Agent leg',
  Wait: 'Waiting',
};

function who(c: LiveChannel): string {
  const m = /^PJSIP\/(.+)-[0-9a-f]{8}$/.exec(c.name);
  if (m?.[1]?.startsWith('trunk_')) return c.callerNum ? `${c.callerName || c.callerNum} (outside)` : 'Trunk';
  return `${c.callerName || c.callerNum || 'Unknown'}${c.callerName && c.callerNum ? ` <${c.callerNum}>` : ''}`;
}

export function LiveCallsPage() {
  const live = useLive();
  const { tenantId, tenant } = useTenant();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const calls = useMemo(() => {
    const scoped = live.channels.filter((c) => user?.role === 'superadmin' ? c.tenantId === tenantId || c.tenantId === null : c.tenantId === tenantId);
    const byCall = new Map<string, LiveChannel[]>();
    for (const c of scoped) byCall.set(c.linkedid, [...(byCall.get(c.linkedid) ?? []), c]);
    return [...byCall.entries()]
      .map(([id, chans]) => ({ id, chans: chans.sort((a, b) => a.startedAt - b.startedAt), started: Math.min(...chans.map((c) => c.startedAt)) }))
      .sort((a, b) => a.started - b.started);
  }, [live.channels, tenantId, user]);

  const used = tenantId ? (live.groups[`envo_tenant/t${tenantId}`] ?? 0) : 0;

  const hangup = async (chans: LiveChannel[]) => {
    if (!(await confirm({ title: 'Hang up this call?', message: 'All parties will be disconnected.', confirmLabel: 'Hang up', danger: true }))) return;
    try {
      for (const c of chans) await api.post('/api/live/hangup', { channel: c.name }).catch(() => undefined);
      toast.success('Call ended');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Live calls"
        icon={<Activity className="size-5" />}
        description={`${calls.length} active call${calls.length === 1 ? '' : 's'} · ${used} external channel${used === 1 ? '' : 's'} in use${tenant?.max_channels ? ` of ${tenant.max_channels}` : ''}`}
        actions={
          <span className="inline-flex items-center gap-2 text-sm text-slate-500">
            <StatusDot tone={live.connected && live.asterisk?.connected ? 'green' : 'red'} pulse={live.connected} /> Live
          </span>
        }
      />
      {calls.length === 0 ? (
        <Card>
          <EmptyState icon={<Radio className="size-5" />} title="No active calls" description="Calls appear here the moment they start ringing." />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {calls.map((call) => {
            const answered = call.chans.some((c) => c.state === 'Up' && c.bridgeId);
            const main = call.chans[0]!;
            return (
              <Card key={call.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <StatusDot tone={answered ? 'green' : 'amber'} pulse />
                      {who(main)}
                      <span className="text-slate-400">→</span>
                      <span className="font-mono">{main.exten}</span>
                    </span>
                  }
                  description={`${formatDuration((now - call.started) / 1000)} · ${answered ? 'Talking' : APP_LABEL[main.application] ?? main.application}`}
                  actions={
                    <Button size="sm" variant="danger" icon={<PhoneOff className="size-4" />} onClick={() => hangup(call.chans)}>
                      Hang up
                    </Button>
                  }
                />
                <ul className="divide-y divide-slate-100">
                  {call.chans.map((c) => (
                    <li key={c.uniqueid} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600" title={c.name}>
                        {c.name}
                      </span>
                      <span className="text-slate-700">{c.connectedName || c.connectedNum || '—'}</span>
                      <Badge tone={c.state === 'Up' ? 'green' : c.state === 'Ring' || c.state === 'Ringing' ? 'amber' : 'gray'}>{c.state}</Badge>
                      <span className="w-28 truncate text-xs text-slate-500">{APP_LABEL[c.application] ?? c.application}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
