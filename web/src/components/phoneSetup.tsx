import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Copy, Eye, EyeOff, Globe, KeyRound, Laptop, Mail, Phone, Smartphone } from 'lucide-react';
import { api, errorMessage, scoped } from '../lib/api';
import { useTenant } from '../state/tenant';
import type { Extension } from '../lib/types';
import { Button, CopyButton, Field, Input, LoadingBlock, Modal, Notice, SectionTitle } from './ui';

/*
 * Putting an extension on a desk phone or in a softphone app: which value goes into which field,
 * in the words each phone uses, and a desk-phone friendly password.
 */

type Value = 'server' | 'username' | 'password' | 'port' | 'name' | 'number' | 'udp' | 'on' | 'yes' | 'empty';

interface Guide {
  id: string;
  label: string;
  kind: 'desk' | 'app';
  /** Short note under the picker. */
  models: string;
  steps: ReactNode[];
  fields: { label: string; value: Value; note?: string }[];
}

const WEB_TIP = 'Easiest from a computer: type the phone’s IP address into a browser on the same network and paste the values below. No keypad typing.';

const GUIDES: Guide[] = [
  {
    id: 'yealink',
    label: 'Yealink',
    kind: 'desk',
    models: 'T3x, T4x, T5x, W-series',
    steps: [
      'Press OK on the phone (or Menu → Status) to see its IP address.',
      WEB_TIP,
      'Sign in to the phone’s page (usually admin / admin), then open Account → Register → Account 1.',
      'Fill in the fields below and click Confirm. The screen shows the extension when it is registered.',
    ],
    fields: [
      { label: 'Line Active', value: 'on' },
      { label: 'Label', value: 'number', note: 'what the phone screen shows' },
      { label: 'Display Name', value: 'name' },
      { label: 'Register Name', value: 'username' },
      { label: 'User Name', value: 'username' },
      { label: 'Password', value: 'password' },
      { label: 'SIP Server 1 → Server Host', value: 'server' },
      { label: 'SIP Server 1 → Port', value: 'port' },
      { label: 'Transport', value: 'udp' },
    ],
  },
  {
    id: 'grandstream',
    label: 'Grandstream',
    kind: 'desk',
    models: 'GXP, GRP, WP, DP',
    steps: [
      'On the phone open Menu → Status → Network Status to see its IP address.',
      WEB_TIP,
      'Sign in (admin, with the password on the sticker under the phone on newer models), then open Accounts → Account 1 → General Settings.',
      'Fill in the fields below, then Save and Apply.',
    ],
    fields: [
      { label: 'Account Active', value: 'yes' },
      { label: 'Account Name', value: 'number' },
      { label: 'SIP Server', value: 'server', note: 'port 5060 is the default' },
      { label: 'SIP User ID', value: 'username' },
      { label: 'SIP Authentication ID', value: 'username' },
      { label: 'SIP Authentication Password', value: 'password' },
      { label: 'Name', value: 'name' },
      { label: 'Outbound Proxy', value: 'empty' },
    ],
  },
  {
    id: 'fanvil',
    label: 'Fanvil',
    kind: 'desk',
    models: 'X-series, V-series',
    steps: [
      'Press OK on the phone (or Menu → Status) to see its IP address.',
      WEB_TIP,
      'Sign in (usually admin / admin), then open Line → SIP and pick SIP1.',
      'Fill in the fields below and click Apply.',
    ],
    fields: [
      { label: 'Phone Number', value: 'username' },
      { label: 'Display Name', value: 'name' },
      { label: 'Authentication Name', value: 'username' },
      { label: 'Authentication Password', value: 'password' },
      { label: 'SIP Proxy Server Address', value: 'server' },
      { label: 'SIP Proxy Server Port', value: 'port' },
      { label: 'Activate', value: 'on' },
    ],
  },
  {
    id: 'cisco',
    label: 'Cisco / Linksys SPA',
    kind: 'desk',
    models: 'SPA30x, SPA50x, SPA112/122 adapters',
    steps: [
      'Find the IP address: on a phone press the Setup button → Network; on an adapter, pick up the handset and dial **** then 110.',
      WEB_TIP,
      'Click Admin Login, then Advanced → Voice → Ext 1 (Line 1 on adapters).',
      'Fill in the fields below and click Submit All Changes.',
    ],
    fields: [
      { label: 'Proxy', value: 'server' },
      { label: 'Display Name', value: 'name' },
      { label: 'User ID', value: 'username' },
      { label: 'Password', value: 'password' },
      { label: 'Use Auth ID', value: 'yes' },
      { label: 'Auth ID', value: 'username' },
    ],
  },
  {
    id: 'other',
    label: 'Other IP phone',
    kind: 'desk',
    models: 'Snom, Panasonic, Polycom, Alcatel…',
    steps: [
      'Open the phone’s SIP account settings (on its web page if it has one: find its IP address in the phone’s Status menu).',
      'Phones name the same thing differently. Match the names below; the username goes into every user/login/auth field.',
    ],
    fields: [
      { label: 'SIP server · Registrar · Proxy · Host · Domain', value: 'server' },
      { label: 'User · User ID · Phone number · Extension · Account', value: 'username' },
      { label: 'Auth ID · Authentication name · Register name · Login', value: 'username' },
      { label: 'Password · Auth password · Secret', value: 'password' },
      { label: 'Port', value: 'port' },
      { label: 'Transport', value: 'udp' },
      { label: 'Outbound proxy', value: 'empty' },
    ],
  },
  {
    id: 'zoiper',
    label: 'Zoiper',
    kind: 'app',
    models: 'Windows, Mac, Android, iPhone',
    steps: [
      'Install Zoiper (free) and open it. On the first screen choose to add an account (Settings → Accounts → Add later).',
      'Enter the username and password, then the server as the hostname. Skip the authentication / outbound proxy step.',
      'Pick the SIP UDP line it finds and finish.',
    ],
    fields: [
      { label: 'Username / Login', value: 'username' },
      { label: 'Password', value: 'password' },
      { label: 'Hostname or provider', value: 'server' },
    ],
  },
  {
    id: 'microsip',
    label: 'MicroSIP',
    kind: 'app',
    models: 'Windows',
    steps: ['Open MicroSIP, click the menu arrow → Add Account.', 'Fill in the fields below and click Save.'],
    fields: [
      { label: 'Account Name', value: 'number', note: 'any name you like' },
      { label: 'SIP Server', value: 'server' },
      { label: 'SIP Proxy', value: 'empty' },
      { label: 'Username', value: 'username' },
      { label: 'Domain', value: 'server' },
      { label: 'Login', value: 'username' },
      { label: 'Password', value: 'password' },
      { label: 'Display Name', value: 'name' },
      { label: 'Transport', value: 'udp' },
    ],
  },
  {
    id: 'linphone',
    label: 'Linphone',
    kind: 'app',
    models: 'Android, iPhone, desktop',
    steps: ['Open Linphone → Use a SIP account (or Settings → Accounts → Add).', 'Fill in the fields below and log in.'],
    fields: [
      { label: 'Username', value: 'username' },
      { label: 'Password', value: 'password' },
      { label: 'Domain', value: 'server' },
      { label: 'Display name', value: 'name' },
      { label: 'Transport', value: 'udp' },
    ],
  },
];

const FIXED: Partial<Record<Value, string>> = { port: '5060', udp: 'UDP', on: 'Enabled', yes: 'Yes', empty: '(leave empty)' };

/** Digits in groups of four, so a long number is easy to read out and type. */
function readable(v: string): string {
  return /^\d{8,}$/.test(v) ? v.replace(/(\d{4})(?=\d)/g, '$1 ') : v;
}

/** Desk phone or app: pick the model, see exactly what to type where. */
export function DeviceSetup({ ext }: { ext: Extension }) {
  const { tenantId } = useTenant();
  const [guideId, setGuideId] = useState(() => {
    try {
      return localStorage.getItem('envo.phoneGuide') ?? 'yealink';
    } catch {
      return 'yealink';
    }
  });
  const [where, setWhere] = useState<'office' | 'away'>('office');
  const [shown, setShown] = useState(false);
  const [changing, setChanging] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [sending, setSending] = useState(false);
  const detail = useQuery({
    queryKey: ['extension', ext.id],
    queryFn: () => api.get<Extension>(scoped(`/api/extensions/${ext.id}`, tenantId)),
  });
  const p = detail.data?.provisioning;
  if (!p) return <LoadingBlock />;

  const guide = GUIDES.find((g) => g.id === guideId) ?? GUIDES[0]!;
  const pick = (id: string) => {
    setGuideId(id);
    try {
      localStorage.setItem('envo.phoneGuide', id);
    } catch {
      /* storage unavailable */
    }
  };
  const office = !!p.office_host;
  const server = office && where === 'office' ? p.office_host! : p.domain;
  const values: Record<Value, string> = {
    server,
    username: p.username,
    password: p.password,
    name: detail.data?.name ?? ext.name,
    number: ext.number,
    port: FIXED.port!,
    udp: FIXED.udp!,
    on: FIXED.on!,
    yes: FIXED.yes!,
    empty: FIXED.empty!,
  };
  const defaultTo = ext.email || ext.users?.find((u) => u.email)?.email || '';
  const summary = [
    `Extension ${ext.number} (${values.name})`,
    `SIP server: ${server}`,
    `Username (also Auth ID / Register name): ${p.username}`,
    `Password: ${p.password}`,
    'Port: 5060, transport UDP',
    `Test: dial *43 for an echo test, *97 for voicemail${p.voicemail_pin ? ` (PIN ${p.voicemail_pin})` : ''}`,
  ].join('\n');

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>1 · Which phone?</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GUIDES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => pick(g.id)}
              aria-pressed={g.id === guide.id}
              data-autofocus={g.id === guide.id ? 'true' : undefined}
              className={clsx(
                'flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px] font-medium transition',
                g.id === guide.id ? 'border-brand-500 bg-brand-50/60 text-slate-900 ring-3 ring-brand-500/10' : 'border-slate-200 text-slate-700 hover:border-slate-300',
              )}
            >
              {g.kind === 'desk' ? <Phone className="size-4 shrink-0 text-slate-400" /> : g.id === 'microsip' ? <Laptop className="size-4 shrink-0 text-slate-400" /> : <Smartphone className="size-4 shrink-0 text-slate-400" />}
              <span className="truncate">{g.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">{guide.models}</p>
      </div>

      {office && (
        <div>
          <SectionTitle>2 · Where is the phone?</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['office', 'In the office', `Same network as the server: ${p.office_host}`, Building2],
                ['away', 'Anywhere else', `Over the internet: ${p.domain}`, Globe],
              ] as const
            ).map(([v, label, hint, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => setWhere(v)}
                aria-pressed={where === v}
                className={clsx(
                  'flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition',
                  where === v ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <span>
                  <span className="block text-sm font-medium text-slate-900">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>{office ? '3' : '2'} · Set it up</SectionTitle>
        <ol className="mb-4 space-y-1.5 text-[13.5px] text-slate-600">
          {guide.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] border-b border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-[10.5px] tracking-[0.06em] text-slate-500 uppercase">
            <span>On the {guide.kind === 'desk' ? 'phone' : 'app'}</span>
            <span>Enter</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {guide.fields.map((f) => {
              const v = values[f.value];
              const secret = f.value === 'password';
              const fixed = f.value in FIXED;
              return (
                <li key={f.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-center gap-3 px-3.5 py-2">
                  <span className="min-w-0 text-[13px] font-medium text-slate-800">
                    {f.label}
                    {f.note && <span className="block text-[11.5px] font-normal text-slate-400">{f.note}</span>}
                  </span>
                  <span className="flex min-w-0 items-center gap-1">
                    <span className={clsx('min-w-0 flex-1 truncate', fixed ? 'text-[13px] text-slate-500' : 'font-mono text-[14px] font-medium text-slate-900')}>
                      {secret && !shown ? '••••••••••' : secret ? readable(v) : v}
                    </span>
                    {secret && (
                      <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    )}
                    {!fixed && <CopyButton value={v} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={() => setChanging(true)}>
            Change password
          </Button>
          <Button
            size="sm"
            icon={<Copy className="size-3.5" />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(summary);
                toast.success('All settings copied');
              } catch {
                toast.error('Could not copy');
              }
            }}
          >
            Copy all
          </Button>
          {p.password.length > 12 && guide.kind === 'desk' && (
            <span className="text-xs text-slate-500">Typing on the keypad? Change it to a 10-digit password.</span>
          )}
        </div>
      </div>

      <div>
        <SectionTitle>Send the settings by email</SectionTitle>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setSending(true);
            try {
              const r = await api.post<{ status: 'sent' | 'skipped'; to: string }>(scoped(`/api/extensions/${ext.id}/send-setup`, tenantId), { to: emailTo || defaultTo });
              if (r.status === 'sent') toast.success(`Phone settings sent to ${r.to}`);
              else toast.warning('Email is not set up yet, so nothing was sent. Use "Copy all" instead.');
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setSending(false);
            }
          }}
        >
          <Input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder={defaultTo || 'name@company.com'} aria-label="Email address" className="sm:flex-1" />
          <Button type="submit" icon={<Mail className="size-4" />} loading={sending} disabled={!emailTo && !defaultTo}>
            Email settings
          </Button>
        </form>
      </div>

      <Notice tone="info" title="Check it works">
        When the phone shows <em>Registered</em> (or the extension turns online here), dial <span className="kbd">*43</span> for an echo test and{' '}
        <span className="kbd">*97</span> for voicemail
        {p.voicemail_pin && (
          <>
            {' '}(PIN <span className="kbd">{p.voicemail_pin}</span>)
          </>
        )}
        . Not registering? Check the password first: phones show “401” or “Forbidden” when it is wrong.
      </Notice>

      {changing && <PasswordModal ext={ext} onClose={() => setChanging(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ password
type PasswordChoice = 'keypad' | 'strong' | 'own';

/** New desk-phone password: 10 digits for keypads, 20 characters for pasting, or the admin's own. */
export function PasswordModal({ ext, onClose }: { ext: Extension; onClose: () => void }) {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const [choice, setChoice] = useState<PasswordChoice>('keypad');
  const [own, setOwn] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.put<{ sip_password: string }>(scoped(`/api/extensions/${ext.id}/password`, tenantId), choice === 'own' ? { password: own } : { style: choice }),
    onSuccess: (r) => {
      setResult(r.sip_password);
      void qc.invalidateQueries({ queryKey: ['extension', ext.id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (result) {
    return (
      <Modal open onClose={onClose} size="sm" title="Password changed" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-50 px-4 py-5 text-center ring-1 ring-slate-200">
            <div className="font-mono text-[11px] tracking-[0.06em] text-slate-500 uppercase">New password for {ext.number}</div>
            <div className="mt-2 flex items-center justify-center gap-1">
              <span className="font-mono text-2xl font-semibold tracking-wide text-slate-900">{readable(result)}</span>
              <CopyButton value={result} />
            </div>
            {/^\d+$/.test(result) && <div className="mt-1 text-xs text-slate-500">Type it without the spaces</div>}
          </div>
          <Notice tone="warn">Phones still using the old password stop working until you enter this one. The web phone is not affected.</Notice>
        </div>
      </Modal>
    );
  }

  const options: { value: PasswordChoice; label: string; hint: string }[] = [
    { value: 'keypad', label: 'Easy to type on a keypad', hint: '10 random digits. Best for desk phones.' },
    { value: 'strong', label: 'Long and strong', hint: '20 letters and digits. For apps where you paste it.' },
    { value: 'own', label: 'Choose my own', hint: 'At least 8 characters, not easy to guess.' },
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title={`Change password for ${ext.number}`}
      description="The password desk phones and apps sign in with"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={choice === 'own' && own.length < 8} onClick={() => save.mutate()}>
            Change password
          </Button>
        </>
      }
    >
      <div className="space-y-2" role="radiogroup">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={choice === o.value}
            onClick={() => setChoice(o.value)}
            className={clsx(
              'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition',
              choice === o.value ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300',
            )}
          >
            <span className={clsx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', choice === o.value ? 'border-brand-600 bg-brand-600' : 'border-slate-300')}>
              {choice === o.value && <span className="size-1.5 rounded-full bg-white" />}
            </span>
            <span>
              <span className="block text-sm font-medium text-slate-900">{o.label}</span>
              <span className="block text-xs text-slate-500">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {choice === 'own' && (
        <Field label="New password" className="mt-4" hint="Avoid runs like 12345678, repeated digits or the extension number: SIP scanners try those first.">
          <Input value={own} onChange={(e) => setOwn(e.target.value.replace(/\s/g, ''))} autoComplete="off" autoFocus className="font-mono" />
        </Field>
      )}
    </Modal>
  );
}
