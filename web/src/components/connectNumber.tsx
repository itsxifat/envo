import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, LoaderCircle, XCircle } from 'lucide-react';
import { api, errorMessage, scoped } from '../lib/api';
import { useTenant } from '../state/tenant';
import { useDestinations } from '../lib/hooks';
import type { DestType, Settings } from '../lib/types';
import { Button, Field, Input, Modal, NumberInput, Select } from './ui';

export interface LineState {
  id: number;
  name: string;
  host: string;
  shared: boolean;
  health: 'ok' | 'failing' | 'waiting' | 'off';
  label: string;
}

export interface SetupStatus {
  extensions: number;
  named: number;
  people: number;
  online: number;
  numbers: { id: number; number: string; label: string; trunk_id: number | null; dest_type: DestType; dest_target: string; line: LineState | null }[];
  lines: LineState[];
  outbound_routes: number;
  routed: boolean;
  /** Where numbers ring, chosen in the guided setup (also before the first number arrives). */
  default_dest: { dest_type: DestType; dest_target: string } | null;
  has_calls: boolean;
}

/** How far the current SIP server is from taking calls (GET /api/setup/status). poll: false only reads it. */
export function useSetupStatus(opts: { fast?: boolean; enabled?: boolean; poll?: boolean } = {}) {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['setup', tenantId],
    queryFn: () => api.get<SetupStatus>(scoped('/api/setup/status', tenantId)),
    enabled: !!tenantId && (opts.enabled ?? true),
    refetchInterval: opts.poll === false ? false : opts.fast ? 3000 : 15_000,
  });
}

function usePublicIp(): string {
  const q = useQuery({ queryKey: ['system', 'settings'], queryFn: () => api.get<Settings>('/api/system/settings'), staleTime: 300_000 });
  return q.data?.public_ip ?? '';
}

const AUTH_MODES = [
  { value: 'register', label: 'Sign in with username and password (most providers)' },
  { value: 'outbound', label: 'Password for outgoing calls only' },
  { value: 'ip', label: 'No password: the provider allows this server by IP' },
] as const;

interface Form {
  number: string;
  label: string;
  host: string;
  username: string;
  password: string;
  port: number;
  transport: 'udp' | 'tcp' | 'tls';
  auth_mode: 'register' | 'outbound' | 'ip';
}

/**
 * Connects a phone number in one go: the provider account it arrives on (or one of the SIP server's
 * existing lines), where its calls ring at first, and outgoing calls over it.
 */
export function ConnectNumberForm({ onDone }: { onDone: (number: string) => void }) {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const status = useSetupStatus();
  const dest = useDestinations();
  const publicIp = usePublicIp();
  const ownLines = status.data?.lines ?? [];
  const [useExisting, setUseExisting] = useState(false);
  const [trunkId, setTrunkId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>({ number: '', label: '', host: '', username: '', password: '', port: 5060, transport: 'udp', auth_mode: 'register' });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const existingLine = useExisting && ownLines.length > 0;
  const lineId = trunkId ?? ownLines[0]?.id ?? null;
  const validNumber = /^\+?[0-9]{3,20}$/.test(form.number);
  const ready = validNumber && (existingLine ? !!lineId : !!form.host.trim() && (form.auth_mode === 'ip' || !!form.password));

  // New numbers ring where the guided setup said, else where the others already do, else the first extension.
  const chosen = status.data?.default_dest ?? null;
  const routed = chosen ?? status.data?.numbers.find((n) => n.dest_type !== 'hangup');
  const firstExt = dest.data?.extension[0]?.value;
  const initial = routed ? { dest_type: routed.dest_type, dest_target: routed.dest_target } : firstExt ? { dest_type: 'extension', dest_target: firstExt } : { dest_type: 'hangup', dest_target: '' };
  const ringText =
    initial.dest_type === 'hangup'
      ? 'nowhere yet; choose where in the next step'
      : chosen
        ? 'where you chose for your calls; you can change it any time'
        : routed
          ? 'where your other calls do; you can change it any time'
          : `extension ${initial.dest_target} for now; you can change it any time`;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(scoped('/api/setup/line', tenantId), {
        number: form.number,
        label: form.label,
        trunk_id: existingLine ? lineId : null,
        provider: existingLine
          ? undefined
          : { host: form.host.trim(), port: form.port, transport: form.transport, auth_mode: form.auth_mode, username: form.username.trim(), password: form.password },
        ...initial,
      });
      for (const key of [['setup'], ['list', 'numbers'], ['list', 'trunks'], ['list', 'routes'], ['list', 'tenants'], ['dashboard'], ['account']]) void qc.invalidateQueries({ queryKey: key });
      toast.success(`${form.number} connected`);
      onDone(form.number);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone number" hint="As your provider wrote it, e.g. 09612345678">
          <Input value={form.number} onChange={(e) => set('number', e.target.value.replace(/[^\d+]/g, ''))} placeholder="09612345678" inputMode="tel" autoFocus />
        </Field>
        <Field label="Name (optional)" hint="Helps you tell numbers apart">
          <Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Hotline" maxLength={60} />
        </Field>
      </div>

      {ownLines.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { value: false, title: 'A new provider account', desc: 'The number has its own username and password' },
            { value: true, title: 'One of my lines', desc: 'Same provider account as a number I already have' },
          ].map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => setUseExisting(o.value)}
              className={clsx(
                'rounded-xl border p-3 text-left transition',
                useExisting === o.value ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <div className="text-sm font-medium text-slate-900">{o.title}</div>
              <div className="mt-0.5 text-xs text-slate-500">{o.desc}</div>
            </button>
          ))}
        </div>
      )}

      {existingLine ? (
        <Field label="Line">
          <Select value={lineId ?? ''} onChange={(e) => setTrunkId(Number(e.target.value))}>
            {ownLines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.host})
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
            Your provider (IPTSP) sent you these details when you bought the number: a server address, a username and a password.
          </div>
          <Field label="Provider server" hint="Like sip.provider.com or 123.45.67.89">
            <Input value={form.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="sip.provider.com" autoComplete="off" />
          </Field>
          {form.auth_mode !== 'ip' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username" hint="Usually the phone number itself">
                <Input value={form.username} onChange={(e) => set('username', e.target.value.trim())} placeholder={form.number || 'Same as the number'} autoComplete="off" />
              </Field>
              <Field label="Password">
                <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
          )}
          <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
            <ChevronDown className={clsx('size-4 transition', advanced && 'rotate-180')} /> More options
          </button>
          {advanced && (
            <div className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-6">
              <Field label="How it connects" className="sm:col-span-6">
                <Select value={form.auth_mode} onChange={(e) => set('auth_mode', e.target.value as Form['auth_mode'])}>
                  {AUTH_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Port" className="sm:col-span-2">
                <NumberInput value={form.port} onChange={(v) => set('port', v)} min={1} max={65535} />
              </Field>
              <Field label="Transport" className="sm:col-span-4">
                <Select value={form.transport} onChange={(e) => set('transport', e.target.value as Form['transport'])}>
                  <option value="udp">UDP (most providers)</option>
                  <option value="tcp">TCP</option>
                  <option value="tls">TLS (encrypted)</option>
                </Select>
              </Field>
            </div>
          )}
          {publicIp && (
            <p className="text-xs text-slate-500">
              If your provider asks for this server's IP address, give them <span className="font-mono font-medium text-slate-700">{publicIp}</span>.
            </p>
          )}
        </>
      )}

      <p className="text-xs text-slate-500">Calls to this number ring {ringText}. Outgoing calls to Bangladesh numbers are switched on.</p>
      <div className="flex justify-end">
        <Button variant="primary" loading={busy} disabled={!ready} onClick={submit}>
          Connect number
        </Button>
      </div>
    </div>
  );
}

/** Live state of a just-connected number's line, with plain fixes when the provider refuses it. */
export function LineProgress({ number }: { number: string }) {
  const status = useSetupStatus({ fast: true });
  const publicIp = usePublicIp();
  const n = status.data?.numbers.find((x) => x.number === number);
  const line = n?.line;
  const health = !line ? 'waiting' : line.shared ? 'ok' : line.health;
  if (health === 'ok') {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-600/15">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
        <div>
          <p className="font-semibold">{number} is connected</p>
          <p className="mt-0.5 text-emerald-800/90">The provider accepted this server. Calls to the number can come in now.</p>
        </div>
      </div>
    );
  }
  if (health === 'failing' || health === 'off') {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-600/15">
        <XCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
        <div>
          <p className="font-semibold">The provider did not accept the line ({line?.label.toLowerCase()})</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-rose-800/90">
            <li>Check the username and password on the Phone lines page.</li>
            <li>Make sure the number is active with your provider.</li>
            {publicIp && (
              <li>
                Ask the provider to allow this server: <span className="font-mono">{publicIp}</span>.
              </li>
            )}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-black/[0.05]">
      <LoaderCircle className="size-5 shrink-0 animate-spin text-brand-600" />
      Connecting to your provider… this usually takes a few seconds.
    </div>
  );
}

/** "Connect a number" as a dialog, for the Phone numbers page. */
export function ConnectNumberModal({ onClose }: { onClose: () => void }) {
  const [connected, setConnected] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={connected ? 'Number connected' : 'Connect a phone number'}
      description={connected ? undefined : 'Bring the number you bought from your IP phone provider'}
      footer={connected ? <Button variant="primary" onClick={onClose}>Done</Button> : undefined}
    >
      {connected ? <LineProgress number={connected} /> : <ConnectNumberForm onDone={setConnected} />}
    </Modal>
  );
}
