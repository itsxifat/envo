import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, Send } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Notice, NumberInput, PageHeader, Toggle } from '../../components/ui';

interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  has_pass?: boolean;
  from_name: string;
  from_email: string;
}

interface LogRow {
  id: number;
  to_addr: string;
  subject: string;
  status: 'sent' | 'failed' | 'skipped';
  error: string;
  created_at: string;
}

export function EmailSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'email'], queryFn: () => api.get<EmailSettings>('/api/admin/email-settings') });
  const log = useQuery({ queryKey: ['admin', 'email', 'log'], queryFn: () => api.get<LogRow[]>('/api/admin/email-log') });
  const [form, setForm] = useState<EmailSettings | null>(null);
  const [testTo, setTestTo] = useState('');
  useEffect(() => {
    if (q.data && !form) setForm(q.data);
  }, [q.data, form]);
  const save = useMutation({
    mutationFn: (d: EmailSettings) => api.put<EmailSettings>('/api/admin/email-settings', d),
    onSuccess: (saved) => {
      setForm(saved);
      void qc.invalidateQueries({ queryKey: ['admin', 'email'] });
      toast.success('Email settings saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const test = useMutation({
    mutationFn: () => api.post('/api/admin/email-settings/test', { ...form, to: testTo }),
    onSuccess: () => toast.success(`Test email sent to ${testTo}`),
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isLoading || !form) return q.error ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  const set = <K extends keyof EmailSettings>(k: K, v: EmailSettings[K]) => setForm({ ...form, [k]: v });

  return (
    <>
      <PageHeader
        title="Email"
        description="The address Envo sends sign-up, password and billing emails from"
        icon={<Mail />}
        actions={
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>
            Save settings
          </Button>
        }
      />
      {!form.enabled && (
        <Notice tone="warn" title="Email is off" className="mb-5">
          New customers cannot confirm their email until this is set up. Meanwhile you can confirm a customer by hand, and the messages are written to the server log.
        </Notice>
      )}
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="SMTP server" description="For example your mailcow mailbox, Brevo or Amazon SES" />
          <div className="space-y-4 p-4 sm:p-5">
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Send emails" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Server" className="sm:col-span-2">
                <Input value={form.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="mail.enfinito.cloud" />
              </Field>
              <Field label="Port">
                <NumberInput value={form.port} onChange={(v) => set('port', v)} min={1} max={65535} />
              </Field>
            </div>
            <Toggle checked={form.secure} onChange={(v) => set('secure', v)} label="TLS from the start" description="On for port 465; off for 587 (upgrades with STARTTLS)" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username">
                <Input value={form.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Password" hint={form.has_pass ? 'Saved; leave empty to keep it' : undefined}>
                <Input type="password" value={form.pass} onChange={(e) => set('pass', e.target.value)} placeholder={form.has_pass ? '••••••••' : ''} autoComplete="new-password" />
              </Field>
              <Field label="From name">
                <Input value={form.from_name} onChange={(e) => set('from_name', e.target.value)} placeholder="Envo by Enfinito" />
              </Field>
              <Field label="From address">
                <Input type="email" value={form.from_email} onChange={(e) => set('from_email', e.target.value)} placeholder="no-reply@enfinito.cloud" />
              </Field>
            </div>
            <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3.5 sm:flex-row sm:items-end">
              <Field label="Send a test to" className="flex-1">
                <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@enfinito.cloud" />
              </Field>
              <Button icon={<Send className="size-4" />} loading={test.isPending} disabled={!testTo || !form.host} onClick={() => test.mutate()}>
                Send test
              </Button>
            </div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Recent emails" />
          {!log.data?.length ? (
            <EmptyState icon={<Mail className="size-5" />} title="Nothing sent yet" />
          ) : (
            <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {log.data.map((m) => (
                <li key={m.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-800">{m.subject}</div>
                    <div className="truncate text-xs text-slate-500">
                      {m.to_addr} · {formatDateTime(m.created_at)}
                    </div>
                    {m.error && <div className="mt-0.5 text-xs text-rose-600">{m.error}</div>}
                  </div>
                  <Badge tone={m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : 'gray'}>{m.status === 'skipped' ? 'Not sent' : m.status === 'sent' ? 'Sent' : 'Failed'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
