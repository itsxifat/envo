import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Braces, Check, Code2, KeyRound, Pencil, Plus, Send, Trash2, TriangleAlert, Webhook } from 'lucide-react';
import { api, errorMessage, scoped } from '../lib/api';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useTenant } from '../state/tenant';
import { formatDateTime, timeAgo } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  CopyField,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  SectionTitle,
  Tabs,
  Toggle,
  useConfirm,
} from '../components/ui';

interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  allowed_origins: string;
  last_used_at: string | null;
  requests: number;
  enabled: boolean;
  created_at: string;
}

interface WebhookRow {
  id: number;
  name: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  deliveries: number;
  last_delivery_at: string | null;
  last_status: number | null;
}

interface Delivery {
  id: number;
  event: string;
  status: number | null;
  error: string;
  attempts: number;
  duration_ms: number;
  created_at: string;
}

const SCOPES: { id: string; label: string; description: string }[] = [
  { id: 'read', label: 'Read call data', description: 'Call history, live calls, extensions, numbers, recordings' },
  { id: 'calls', label: 'Place & control calls', description: 'Start click-to-call and hang up calls' },
  { id: 'webphone', label: 'Embedded web phone', description: 'Mint short-lived tokens for the phone widget' },
];

const EVENTS = ['call.started', 'call.answered', 'call.ended'];

export function DevelopersPage() {
  const [tab, setTab] = useState<'keys' | 'webhooks' | 'guide'>('keys');
  return (
    <div>
      <PageHeader
        title="Developers"
        icon={<Code2 className="size-5" />}
        description="Connect your shop, CRM or any app: place calls, receive call events and embed the phone"
      />
      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'keys', label: 'API keys' },
            { value: 'webhooks', label: 'Webhooks' },
            { value: 'guide', label: 'Integration guide' },
          ]}
        />
      </div>
      {tab === 'keys' && <Keys />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'guide' && <Guide />}
    </div>
  );
}

// ------------------------------------------------------------------ API keys
function Keys() {
  const list = useList<ApiKey>('integrations/keys');
  const remove = useRemove('integrations/keys', 'API key deleted');
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ApiKey | 'new' | null>(null);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="API keys"
          description="One key per application. Keep it on your server — never in browser code."
          actions={
            <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              New key
            </Button>
          }
        />
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState
            icon={<KeyRound className="size-5" />}
            title="No API keys yet"
            description="Create a key to let another website place calls, read call history or embed the phone."
            action={<Button variant="primary" onClick={() => setEditing('new')}>New key</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Permissions</th>
                  <th>Allowed origins</th>
                  <th>Usage</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((k) => (
                  <tr key={k.id} className={clsx(!k.enabled && 'opacity-55')}>
                    <td>
                      <div className="font-medium text-slate-900">{k.name}</div>
                      <div className="font-mono text-xs text-slate-500">{k.prefix}…</div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} tone={s === 'calls' ? 'brand' : s === 'webphone' ? 'violet' : 'gray'}>
                            {s}
                          </Badge>
                        ))}
                        {!k.enabled && <Badge tone="red">disabled</Badge>}
                      </div>
                    </td>
                    <td className="max-w-56 truncate text-xs text-slate-600">{k.allowed_origins || <span className="text-slate-400">server-side only</span>}</td>
                    <td className="text-sm text-slate-600">
                      {Number(k.requests).toLocaleString()} calls
                      <div className="text-xs text-slate-400">{k.last_used_at ? `used ${timeAgo(k.last_used_at)}` : 'never used'}</div>
                    </td>
                    <td>
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Edit" onClick={() => setEditing(k)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Delete"
                          tone="danger"
                          onClick={async () => {
                            if (await confirm({ title: `Delete key "${k.name}"?`, message: 'Applications using it stop working immediately.', confirmLabel: 'Delete', danger: true })) {
                              remove.mutate(k.id);
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <KeyModal apiKey={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onCreated={setCreated} />}
      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title="Copy your API key now"
        description="This is the only time the full key is shown."
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <CopyField label={created?.name ?? 'API key'} value={created?.key ?? ''} />
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Store it as a secret on your server (for example in <span className="font-mono">ENVO_API_KEY</span>). If it leaks, delete the key here and create a new one.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function KeyModal({ apiKey, onClose, onCreated }: { apiKey: ApiKey | null; onClose: () => void; onCreated: (v: { key: string; name: string }) => void }) {
  const [form, setForm] = useState({
    name: apiKey?.name ?? '',
    scopes: apiKey?.scopes ?? ['read', 'calls', 'webphone'],
    allowed_origins: apiKey?.allowed_origins ?? '',
    enabled: apiKey?.enabled ?? true,
  });
  const save = useSave<ApiKey & { key?: string }>('integrations/keys', { created: 'API key created', updated: 'API key saved' });
  const toggleScope = (id: string) =>
    setForm((f) => ({ ...f, scopes: f.scopes.includes(id) ? f.scopes.filter((s) => s !== id) : [...f.scopes, id] }));

  return (
    <Modal
      open
      onClose={onClose}
      title={apiKey ? `Edit key · ${apiKey.name}` : 'New API key'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.name || !form.scopes.length}
            onClick={async () => {
              const saved = await save.mutateAsync({ id: apiKey?.id, data: form }).catch(() => null);
              if (!saved) return;
              onClose();
              if (!apiKey && saved.key) onCreated({ key: saved.key, name: saved.name });
            }}
          >
            {apiKey ? 'Save' : 'Create key'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name" hint="Which application uses this key">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Commerce site" autoFocus />
        </Field>
        <div>
          <SectionTitle>Permissions</SectionTitle>
          <div className="space-y-2">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleScope(s.id)}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition',
                  form.scopes.includes(s.id) ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <span
                  className={clsx(
                    'mt-0.5 flex size-4.5 items-center justify-center rounded border',
                    form.scopes.includes(s.id) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300',
                  )}
                >
                  {form.scopes.includes(s.id) && <Check className="size-3" />}
                </span>
                <span>
                  <span className="block text-sm font-medium text-slate-900">{s.label}</span>
                  <span className="block text-xs text-slate-500">{s.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <Field
          label="Allowed browser origins"
          hint="Only needed if the key or the embedded phone is used from a web page. One per line or comma separated."
        >
          <Input
            value={form.allowed_origins}
            onChange={(e) => setForm({ ...form, allowed_origins: e.target.value })}
            placeholder="https://shop.enfinito.com"
          />
        </Field>
        <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Enabled" />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ webhooks
function Webhooks() {
  const list = useList<WebhookRow>('integrations/webhooks');
  const remove = useRemove('integrations/webhooks', 'Webhook deleted');
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { tenantId } = useTenant();
  const [editing, setEditing] = useState<WebhookRow | 'new' | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const test = useMutation({
    mutationFn: (id: number) => api.post<{ delivery: Delivery }>(scoped(`/api/integrations/webhooks/${id}/test`, tenantId)),
    onSuccess: (r, id) => {
      const status = r.delivery?.status;
      status && status < 300 ? toast.success(`Test delivered (HTTP ${status})`) : toast.error(`Test failed: ${r.delivery?.error || 'no response'}`);
      void qc.invalidateQueries({ queryKey: ['list', 'integrations/webhooks'] });
      void qc.invalidateQueries({ queryKey: ['deliveries', id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Webhooks"
          description="Envo POSTs call events to your app — signed, with retries."
          actions={
            <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add webhook
            </Button>
          }
        />
        {list.isLoading ? (
          <LoadingBlock />
        ) : !list.data?.length ? (
          <EmptyState
            icon={<Webhook className="size-5" />}
            title="No webhooks yet"
            description="Add an endpoint to log calls in your CRM, pop up the customer's order on an incoming call, or store recordings."
            action={<Button variant="primary" onClick={() => setEditing('new')}>Add webhook</Button>}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data.map((w) => (
              <li key={w.id} className={clsx('px-5 py-4', !w.enabled && 'opacity-55')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900">{w.name || w.url}</span>
                      {w.last_status !== null && (
                        <Badge tone={w.last_status < 300 ? 'green' : 'red'}>
                          last {w.last_status}
                        </Badge>
                      )}
                      {!w.enabled && <Badge>disabled</Badge>}
                    </div>
                    <div className="truncate font-mono text-xs text-slate-500">{w.url}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {w.events.map((e) => (
                        <span key={e} className="kbd">
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" icon={<Send className="size-3.5" />} loading={test.isPending && test.variables === w.id} onClick={() => test.mutate(w.id)}>
                      Send test
                    </Button>
                    <IconButton label="Deliveries" onClick={() => setOpen(open === w.id ? null : w.id)}>
                      <Braces className="size-4" />
                    </IconButton>
                    <IconButton label="Edit" onClick={() => setEditing(w)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      tone="danger"
                      onClick={async () => {
                        if (await confirm({ title: 'Delete this webhook?', confirmLabel: 'Delete', danger: true })) remove.mutate(w.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <CopyField label="Signing secret" value={w.secret} secret />
                  <div className="text-xs text-slate-500">
                    <div className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Deliveries</div>
                    {w.deliveries} sent{w.last_delivery_at ? ` · last ${timeAgo(w.last_delivery_at)}` : ''}
                  </div>
                </div>
                {open === w.id && <Deliveries id={w.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <WebhookModal hook={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Deliveries({ id }: { id: number }) {
  const { tenantId } = useTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', id, tenantId],
    queryFn: () => api.get<Delivery[]>(scoped(`/api/integrations/webhooks/${id}/deliveries`, tenantId)),
  });
  if (isLoading) return <LoadingBlock />;
  if (!data?.length) return <p className="mt-3 text-sm text-slate-400">No deliveries yet.</p>;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-100">
      <table className="table-base">
        <thead>
          <tr>
            <th>When</th>
            <th>Event</th>
            <th>Result</th>
            <th>Attempts</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id}>
              <td className="text-xs text-slate-500">{formatDateTime(d.created_at)}</td>
              <td className="font-mono text-xs">{d.event}</td>
              <td>
                {d.status ? (
                  <Badge tone={d.status < 300 ? 'green' : 'red'}>HTTP {d.status}</Badge>
                ) : (
                  <Badge tone="red">{d.error || 'failed'}</Badge>
                )}
              </td>
              <td className="text-xs text-slate-600">{d.attempts}</td>
              <td className="text-xs text-slate-600 tabular-nums">{d.duration_ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebhookModal({ hook, onClose }: { hook: WebhookRow | null; onClose: () => void }) {
  const [form, setForm] = useState({
    name: hook?.name ?? '',
    url: hook?.url ?? '',
    events: hook?.events ?? EVENTS,
    enabled: hook?.enabled ?? true,
  });
  const save = useSave('integrations/webhooks', { created: 'Webhook added', updated: 'Webhook saved' });
  const toggle = (e: string) => setForm((f) => ({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] }));
  return (
    <Modal
      open
      onClose={onClose}
      title={hook ? 'Edit webhook' : 'Add webhook'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.url || !form.events.length}
            onClick={async () => {
              const ok = await save.mutateAsync({ id: hook?.id, data: form }).catch(() => null);
              if (ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name (optional)">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CRM call logger" />
        </Field>
        <Field label="Endpoint URL" hint="Envo POSTs JSON here; reply 2xx within 10 seconds">
          <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value.trim() })} placeholder="https://shop.enfinito.com/envo-webhook" />
        </Field>
        <div>
          <SectionTitle>Events</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => toggle(e)}
                className={clsx(
                  'rounded-full border px-3 py-1 font-mono text-xs transition',
                  form.events.includes(e) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:border-slate-300',
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Enabled" />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ guide
function Guide() {
  const { tenantId } = useTenant();
  const { data } = useQuery({
    queryKey: ['integration-examples', tenantId],
    queryFn: () => api.get<{ baseUrl: string; sampleExtension: string; embedScript: string }>(scoped('/api/integrations/examples', tenantId)),
    enabled: !!tenantId,
  });
  const base = data?.baseUrl ?? 'https://envo.enfinito.cloud';
  const ext = data?.sampleExtension ?? '1000';
  const [lang, setLang] = useState<'curl' | 'php' | 'node'>('curl');

  const clickToCall = {
    curl: `curl -X POST ${base}/api/v1/calls \\
  -H "Authorization: Bearer $ENVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"from": "${ext}", "to": "01712345678"}'`,
    php: `<?php // Call a customer from your order page (server side)
$ch = curl_init('${base}/api/v1/calls');
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER     => [
    'Authorization: Bearer ' . getenv('ENVO_API_KEY'),
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode([
    'from' => '${ext}',                 // the agent's extension - their phone rings first
    'to'   => $order->get_billing_phone(),
  ]),
]);
$call = json_decode(curl_exec($ch), true);   // { ok: true, extension, to, startedAt }`,
    node: `// Call a customer from your app (server side)
const res = await fetch('${base}/api/v1/calls', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.ENVO_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ from: '${ext}', to: order.phone }),
});
const call = await res.json();`,
  };

  const tokenEndpoint = {
    curl: `curl -X POST ${base}/api/v1/webphone/token \\
  -H "Authorization: Bearer $ENVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"extension": "${ext}", "ttlSeconds": 600}'`,
    php: `<?php // /envo-token.php - only for signed-in staff!
if (!current_user_can('edit_shop_orders')) { http_response_code(403); exit; }

$ch = curl_init('${base}/api/v1/webphone/token');
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER     => [
    'Authorization: Bearer ' . getenv('ENVO_API_KEY'),
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode(['extension' => '${ext}']),
]);
$data = json_decode(curl_exec($ch), true);

header('Content-Type: application/json');
echo json_encode(['token' => $data['token']]);`,
    node: `// Express: hand the signed-in agent a short-lived phone token
app.get('/envo-token', requireStaff, async (req, res) => {
  const r = await fetch('${base}/api/v1/webphone/token', {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${process.env.ENVO_API_KEY}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ extension: req.user.envoExtension }),
  });
  const { token } = await r.json();
  res.json({ token });
});`,
  };

  const webhookReceiver = {
    curl: `# Envo sends:
POST /envo-webhook
X-Envo-Event: call.ended
X-Envo-Signature: t=1789455634,v1=9f2b…

{
  "event": "call.ended",
  "id": "1789455634.59",
  "sipServer": { "id": 1, "name": "Main", "slug": "main" },
  "direction": "inbound",
  "from": "01712345678",
  "to": "09644342036",
  "answered": true,
  "talkSec": 38,
  "recordingUrl": "${base}/api/v1/recordings/42"
}`,
    php: `<?php // /envo-webhook.php
$payload = file_get_contents('php://input');
$header  = $_SERVER['HTTP_X_ENVO_SIGNATURE'] ?? '';
parse_str(str_replace(',', '&', $header), $parts);          // t=…&v1=…

$expected = hash_hmac('sha256', $parts['t'] . '.' . $payload, getenv('ENVO_WEBHOOK_SECRET'));
if (!hash_equals($expected, $parts['v1'] ?? '')) { http_response_code(401); exit; }

$event = json_decode($payload, true);
if ($event['event'] === 'call.ended') {
    // log the call against the customer, store $event['recordingUrl'], …
}
http_response_code(200);`,
    node: `// Express: verify the signature over the RAW body
app.post('/envo-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const [t, v1] = (req.get('X-Envo-Signature') ?? '').split(',').map((p) => p.split('=')[1]);
  const expected = crypto
    .createHmac('sha256', process.env.ENVO_WEBHOOK_SECRET)
    .update(\`\${t}.\${req.body}\`)
    .digest('hex');
  if (expected !== v1) return res.sendStatus(401);

  const event = JSON.parse(req.body);
  if (event.event === 'call.started' && event.direction === 'inbound') {
    // pop the customer's orders onto the agent's screen
  }
  res.sendStatus(200);
});`,
  };

  const embedHtml = `<!-- 1. load the phone (once per page) -->
<script src="${data?.embedScript ?? `${base}/embed/phone.js`}"></script>

<!-- 2. start it with your token endpoint -->
<script>
  const phone = Envo.phone({ tokenUrl: '/envo-token' });

  // 3. call a customer from any button on your page
  document.querySelectorAll('[data-call]').forEach((btn) =>
    btn.addEventListener('click', () => phone.call(btn.dataset.call))
  );

  // 4. react to calls (e.g. open the customer's order on an incoming call)
  phone.onEvent = null; // or pass onEvent in the options above
</script>

<button data-call="01712345678">Call customer</button>`;

  const embedOneLiner = `<script src="${data?.embedScript ?? `${base}/embed/phone.js`}" data-token-url="/envo-token"></script>`;

  const LangTabs = (
    <Tabs
      value={lang}
      onChange={setLang}
      tabs={[
        { value: 'curl', label: 'cURL' },
        { value: 'php', label: 'PHP' },
        { value: 'node', label: 'Node' },
      ]}
    />
  );

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <CopyField label="Base URL" value={base} />
          <CopyField label="Auth header" value="Authorization: Bearer <your API key>" mono={false} />
          <CopyField label="Embed script" value={data?.embedScript ?? `${base}/embed/phone.js`} />
        </div>
        <p className="mt-4 text-sm text-slate-600">
          Every request is scoped to this SIP server, so your app only ever sees its own extensions, numbers and calls.
          Create a key under <b>API keys</b>, keep it on your server, and use the endpoints below.
        </p>
      </Card>

      <Card>
        <CardHeader title="1 · Call a customer from your app" description="Rings the agent's phone first, then dials the customer — no dialling by hand." actions={LangTabs} />
        <div className="p-5">
          <CodeBlock code={clickToCall[lang]} title={lang === 'curl' ? 'POST /api/v1/calls' : lang === 'php' ? 'call-customer.php' : 'call-customer.js'} />
        </div>
      </Card>

      <Card>
        <CardHeader title="2 · Give your staff a phone inside your website" description="Your backend mints a short-lived token; the widget exchanges it for SIP credentials." actions={LangTabs} />
        <div className="space-y-4 p-5">
          <CodeBlock code={tokenEndpoint[lang]} title={lang === 'curl' ? 'POST /api/v1/webphone/token' : lang === 'php' ? 'envo-token.php' : 'envo-token.js'} />
          <div>
            <SectionTitle>Then embed the phone</SectionTitle>
            <CodeBlock code={embedHtml} title="your page" />
            <p className="mt-2 text-xs text-slate-500">
              Shortcut — auto-start with one line: <span className="font-mono">{embedOneLiner}</span>
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
            <p className="font-medium text-slate-800">The widget gives you</p>
            <p className="mt-1">
              a floating phone with keypad, incoming-call screen, mute, hold, DTMF and transfer — plus{' '}
              <span className="font-mono">phone.call(number)</span>, <span className="font-mono">phone.answer()</span>,{' '}
              <span className="font-mono">phone.hangup()</span>, <span className="font-mono">phone.open()</span> and an{' '}
              <span className="font-mono">onEvent</span> callback (<span className="font-mono">ready, registered, incoming, accepted, ended</span>).
              Pass <span className="font-mono">headless: true</span> to hide the button and use only your own UI.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="3 · Receive call events" description="Add the endpoint under Webhooks, then verify the signature." actions={LangTabs} />
        <div className="p-5">
          <CodeBlock code={webhookReceiver[lang]} title={lang === 'curl' ? 'example payload' : lang === 'php' ? 'envo-webhook.php' : 'envo-webhook.js'} />
        </div>
      </Card>

      <Card>
        <CardHeader title="4 · Read call history and recordings" />
        <div className="p-5">
          <CodeBlock
            title="GET /api/v1/…"
            code={`# recent calls (one row per call, newest first)
curl "${base}/api/v1/calls?limit=20&direction=inbound" -H "Authorization: Bearer $ENVO_API_KEY"

# calls happening right now
curl "${base}/api/v1/calls/live" -H "Authorization: Bearer $ENVO_API_KEY"

# extensions with live presence (idle / ringing / on a call)
curl "${base}/api/v1/extensions" -H "Authorization: Bearer $ENVO_API_KEY"

# your numbers and where they ring
curl "${base}/api/v1/numbers" -H "Authorization: Bearer $ENVO_API_KEY"

# download a recording
curl "${base}/api/v1/recordings/42?download=1" -H "Authorization: Bearer $ENVO_API_KEY" -o call.wav

# hang up a live call
curl -X POST "${base}/api/v1/calls/hangup" -H "Authorization: Bearer $ENVO_API_KEY" \\
  -H "Content-Type: application/json" -d '{"call": "1789455634.59"}'`}
          />
        </div>
      </Card>
    </div>
  );
}
