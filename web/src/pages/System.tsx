import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Settings, SquareTerminal } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../lib/api';
import { useLive } from '../state/live';
import { formatDateTime, timeAgo } from '../lib/format';
import type { ApplyStatus, AsteriskInfo, Settings as SettingsT } from '../lib/types';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, StatusDot } from '../components/ui';

interface Status {
  asterisk: AsteriskInfo;
  amiConnected: boolean;
  apply: ApplyStatus;
  counts: Record<string, number>;
  app: { version: string; uptimeSec: number; node: string };
}

const QUICK = [
  'pjsip show endpoints',
  'pjsip show contacts',
  'pjsip show registrations',
  'core show channels',
  'core show calls',
  'queue show',
  'core show translation',
  'group show channels',
  'database show envo',
  'core show uptime',
];

export function SystemPage() {
  const live = useLive();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['system', 'status'], queryFn: () => api.get<Status>('/api/system/status'), refetchInterval: 15_000 });
  const settings = useQuery({ queryKey: ['system', 'settings'], queryFn: () => api.get<SettingsT>('/api/system/settings') });
  const [form, setForm] = useState<SettingsT | null>(null);
  const [saving, setSaving] = useState(false);
  const [cmd, setCmd] = useState('pjsip show endpoints');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState('');

  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  const run = async (command: string) => {
    setCmd(command);
    setRunning(true);
    try {
      const r = await api.post<{ output: string }>('/api/system/cli', { command });
      setOutput(r.output || '(no output)');
    } catch (err) {
      setOutput(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const ast = live.asterisk ?? status.data?.asterisk;
  const apply = live.apply ?? status.data?.apply;

  return (
    <div>
      <PageHeader title="System" icon={<Settings className="size-5" />} description="PBX engine, network settings and diagnostics" />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Asterisk engine" />
          <dl className="space-y-3 px-5 py-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Status</dt>
              <dd className="flex items-center gap-2 font-medium">
                <StatusDot tone={ast?.connected ? 'green' : 'red'} pulse={!!ast?.connected} />
                {ast?.connected ? 'Running' : 'Not connected'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Version</dt>
              <dd className="text-right font-medium">{ast?.version || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Started</dt>
              <dd className="font-medium">{formatDateTime(ast?.startedAt ?? null)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Last reload</dt>
              <dd className="font-medium">{timeAgo(ast?.reloadedAt ?? null)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Active calls</dt>
              <dd className="font-medium">{ast?.currentCalls ?? 0}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Configuration sync"
            actions={
              <Button
                size="sm"
                icon={<RefreshCw className="size-4" />}
                onClick={async () => {
                  try {
                    await api.post('/api/system/apply');
                    toast.success('Configuration re-applied');
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                Re-apply
              </Button>
            }
          />
          <dl className="space-y-3 px-5 py-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">State</dt>
              <dd>
                <Badge tone={apply?.state === 'error' ? 'red' : apply?.state === 'applying' ? 'amber' : 'green'}>{apply?.state ?? '—'}</Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Last applied</dt>
              <dd className="font-medium">{timeAgo(apply?.lastAppliedAt ?? null)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Endpoints loaded</dt>
              <dd className="font-medium">
                {apply?.endpointsLoaded ?? '—'} / {apply?.endpointsExpected ?? '—'}
              </dd>
            </div>
            {apply?.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{apply.error}</p>}
            {apply?.warnings.map((w) => (
              <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {w}
              </p>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Platform" />
          <dl className="space-y-3 px-5 py-4 text-sm">
            {status.data &&
              Object.entries(status.data.counts).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-slate-500 capitalize">{k.replace('_', ' ')}</dt>
                  <dd className="font-medium tabular-nums">{Number(v).toLocaleString()}</dd>
                </div>
              ))}
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Envo uptime</dt>
              <dd className="font-medium">{status.data ? `${Math.round(status.data.app.uptimeSec / 60)} min` : '—'}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader title="Network & numbering" description="How phones reach this server and how numbers are matched" />
          {form && (
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="SIP domain" hint="Hostname phones and the web phone connect to" className="sm:col-span-2">
                <Input value={form.sip_domain} onChange={(e) => setForm({ ...form, sip_domain: e.target.value.trim() })} />
              </Field>
              <Field label="Public IP">
                <Input value={form.public_ip} onChange={(e) => setForm({ ...form, public_ip: e.target.value.trim() })} />
              </Field>
              <Field label="Office address for desk phones" hint="Server's LAN IP, for phones in the same office (e.g. 192.168.20.237)">
                <Input value={form.office_sip_host ?? ''} onChange={(e) => setForm({ ...form, office_sip_host: e.target.value.trim() })} placeholder="Not set" />
              </Field>
              <Field label="STUN server" hint="For browsers behind NAT">
                <Input value={form.stun_server} onChange={(e) => setForm({ ...form, stun_server: e.target.value.trim() })} />
              </Field>
              <Field label="Country code" hint="880 for Bangladesh">
                <Input value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="National prefix" hint="0 for Bangladesh">
                <Input value={form.national_prefix} onChange={(e) => setForm({ ...form, national_prefix: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="Company name" className="sm:col-span-2">
                <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      const saved = await api.put<SettingsT>('/api/system/settings', form);
                      setForm(saved);
                      await qc.invalidateQueries({ queryKey: ['webphone'] });
                      toast.success('Settings saved');
                    } catch (err) {
                      toast.error(errorMessage(err));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save settings
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Diagnostics console" description="Read-only Asterisk CLI" />
          <div className="p-5">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(cmd);
              }}
            >
              <div className="relative flex-1">
                <SquareTerminal className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input value={cmd} onChange={(e) => setCmd(e.target.value)} className="pl-9 font-mono" />
              </div>
              <Button type="submit" variant="dark" loading={running}>
                Run
              </Button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => void run(q)} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-slate-200">
                  {q}
                </button>
              ))}
            </div>
            <pre className="mt-3 h-80 overflow-auto rounded-xl bg-ink-950 p-4 font-mono text-[12px] leading-relaxed text-slate-200">{output || 'Output appears here.'}</pre>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-slate-500">Asterisk messages log</span>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const r = await api.get<{ lines: string }>('/api/system/logs?lines=300');
                    setLogs(r.lines || '(empty)');
                  } catch (err) {
                    setLogs(errorMessage(err));
                  }
                }}
              >
                Load recent log
              </Button>
            </div>
            {logs && <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-300">{logs}</pre>}
          </div>
        </Card>
      </div>
    </div>
  );
}
