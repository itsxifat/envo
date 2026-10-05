import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Link2, Mail, Phone, Plus, UserPlus, X } from 'lucide-react';
import { api, errorMessage, scoped } from '../lib/api';
import { useList } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import { usePhone } from '../phone/PhoneProvider';
import type { AppUser, AssignableExtension, Extension, Role } from '../lib/types';
import { Badge, Button, CopyField, Field, IconButton, Input, Modal, Notice, Select, Toggle } from './ui';

/*
 * Handing phones to people: which login calls from which extension. Shared by the Users and
 * Extensions pages, the dashboard and the web phone.
 */

type LinkBody = { extension_id: number | null } | { create: true; tenant_id?: number };
interface LinkResult {
  ok: true;
  extension: { id: number; number: string; tenant_id: number } | null;
}
export interface InviteResult {
  id: number;
  extension: { id: number; number: string } | null;
  invite_url?: string;
  invite_status?: 'sent' | 'failed' | 'skipped';
}

export const ROLE_INFO: Record<Role, { label: string; tone: 'violet' | 'brand' | 'gray'; desc: string }> = {
  superadmin: { label: 'Platform admin', tone: 'violet', desc: 'Everything, across all SIP servers' },
  admin: { label: 'Admin', tone: 'brand', desc: 'Manages the phone system and the team' },
  agent: { label: 'Agent', tone: 'gray', desc: 'Web phone, own calls and voicemail' },
};

/** Extensions an admin may hand out, across the account's SIP servers (platform admins: any). */
export function useAssignableExtensions(accountId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['list', 'assignable-extensions', accountId ?? null],
    queryFn: () => api.get<AssignableExtension[]>(`/api/users/extensions${accountId ? `?account_id=${accountId}` : ''}`),
    enabled,
  });
}

export function useNextExtensionNumber(tenantId: number | null | undefined) {
  return useQuery({
    queryKey: ['list', 'extensions', 'next', tenantId ?? null],
    queryFn: () => api.get<{ number: string }>(scoped('/api/extensions/next-number', tenantId)),
    enabled: !!tenantId,
  });
}

/** Links a login to an extension (or makes one for it). Refreshes the web phone when it is you. */
export function useLinkExtension() {
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const { tenantId } = useTenant();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: number; body: LinkBody }) => api.put<LinkResult>(scoped(`/api/users/${userId}/extension`, tenantId), body),
    onSuccess: async (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['list'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (vars.userId === user?.id) {
        await refresh();
        void qc.invalidateQueries({ queryKey: ['webphone'] });
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Native select of extensions grouped by SIP server, noting who already uses each one. */
export function ExtensionSelect({
  value,
  onChange,
  options,
  noneLabel = 'No extension',
  exceptUserId,
  showAccount,
  className,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  options: AssignableExtension[];
  noneLabel?: string;
  exceptUserId?: number;
  showAccount?: boolean;
  className?: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<number, { label: string; items: AssignableExtension[] }>();
    for (const x of options) {
      const g = map.get(x.tenant_id) ?? { label: showAccount ? `${x.tenant_name} · ${x.account_name}` : x.tenant_name, items: [] };
      g.items.push(x);
      map.set(x.tenant_id, g);
    }
    return [...map.values()];
  }, [options, showAccount]);
  const option = (x: AssignableExtension) => {
    const others = x.users.filter((u) => u.id !== exceptUserId);
    return (
      <option key={x.id} value={x.id}>
        {x.number} · {x.name}
        {others.length ? `  (used by ${others.map((u) => u.name).join(', ')})` : ''}
      </option>
    );
  };
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={className}>
      <option value="">{noneLabel}</option>
      {groups.length === 1
        ? groups[0]!.items.map(option)
        : groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map(option)}
            </optgroup>
          ))}
    </Select>
  );
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white', className)}>
      {name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}

/** A row of radio-style option cards. */
function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: ReactNode; disabled?: boolean }[] }) {
  return (
    <div className={clsx('grid gap-2', options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50',
            value === o.value ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 bg-white hover:border-slate-300',
          )}
        >
          <span className="flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-900">
            {o.label}
            <span className={clsx('flex size-4 shrink-0 items-center justify-center rounded-full border', value === o.value ? 'border-brand-600 bg-brand-600' : 'border-slate-300')}>
              {value === o.value && <span className="size-1.5 rounded-full bg-white" />}
            </span>
          </span>
          {o.hint && <span className="text-xs text-slate-500">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ "connect my web phone"
/**
 * Shown to admins whose login has no extension yet: one click makes one (or links an existing one),
 * and the web phone comes up straight away.
 */
export function MyPhoneSetup({ className, compact }: { className?: string; compact?: boolean }) {
  const { user } = useAuth();
  const { tenantId, tenant } = useTenant();
  const phone = usePhone();
  const link = useLinkExtension();
  const needed = !!user && user.role !== 'agent' && !user.extensionId;
  const platform = user?.role === 'superadmin';
  const all = useAssignableExtensions(platform ? null : user?.accountId, needed);
  const next = useNextExtensionNumber(needed ? tenantId : null);
  const [pick, setPick] = useState<number | null>(null);
  if (!needed || !user) return null;
  // Platform admins pick from the SIP server they are looking at.
  const options = (all.data ?? []).filter((x) => !platform || x.tenant_id === tenantId);
  const done = (n: string | undefined) => {
    toast.success(n ? `Your web phone now uses extension ${n}` : 'Web phone connected');
    phone.setPanelOpen(true);
  };
  return (
    <div className={clsx('card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <Phone className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-slate-900">Connect your web phone</p>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {compact
              ? 'Give your login an extension to call from the browser.'
              : `Your login has no extension yet. Give it one and you can make and take calls right here${tenant ? ` on ${tenant.name}` : ''}.`}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {options.length > 0 && (
          <div className="flex gap-2">
            <ExtensionSelect value={pick} onChange={setPick} options={options} noneLabel="Use an existing one…" exceptUserId={user.id} className="sm:w-56" />
            {pick && (
              <Button
                loading={link.isPending}
                icon={<Link2 className="size-4" />}
                onClick={() =>
                  link.mutate({ userId: user.id, body: { extension_id: pick } }, { onSuccess: () => done(options.find((x) => x.id === pick)?.number) })
                }
              >
                Link
              </Button>
            )}
          </div>
        )}
        {!pick && tenantId && (
          <Button
            variant="primary"
            loading={link.isPending}
            icon={<Plus className="size-4" />}
            onClick={() => link.mutate({ userId: user.id, body: { create: true, tenant_id: tenantId } }, { onSuccess: (r) => done(r.extension?.number) })}
          >
            {next.data ? `Create extension ${next.data.number}` : 'Create my extension'}
          </Button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ link one login
/** Pick or create the extension a teammate calls from. */
export function LinkPhoneModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const { user: me } = useAuth();
  const { tenants, tenantId } = useTenant();
  const link = useLinkExtension();
  const platform = me?.role === 'superadmin';
  const accountId = user.role === 'superadmin' ? null : (user.account_id ?? (platform ? null : me?.accountId));
  const options = useAssignableExtensions(accountId);
  const servers = tenants.filter((t) => user.role === 'superadmin' || !user.account_id || t.account_id === undefined || t.account_id === user.account_id);
  const [mode, setMode] = useState<'new' | 'existing'>(user.extension_id ? 'existing' : 'new');
  const [ext, setExt] = useState<number | null>(user.extension_id);
  const [server, setServer] = useState<number | null>(user.role === 'agent' ? user.tenant_id : (servers.find((t) => t.id === tenantId)?.id ?? servers[0]?.id ?? null));
  const next = useNextExtensionNumber(mode === 'new' ? server : null);
  const submit = () =>
    link.mutate(
      { userId: user.id, body: mode === 'new' ? { create: true, tenant_id: server ?? undefined } : { extension_id: ext } },
      {
        onSuccess: (r) => {
          toast.success(r.extension ? `${user.name} now uses extension ${r.extension.number}` : `${user.name} has no extension now`);
          onClose();
        },
      },
    );
  return (
    <Modal
      open
      onClose={onClose}
      title={`Phone for ${user.name}`}
      description="The extension this login calls from: web phone, voicemail and call history"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={link.isPending} onClick={submit} disabled={mode === 'new' && !server}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Choice
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: 'New extension', hint: next.data ? `Gets number ${next.data.number}` : 'Next free number' },
            { value: 'existing', label: 'Existing extension', hint: 'Pick one from the list' },
          ]}
        />
        {mode === 'new' && servers.length > 1 && user.role !== 'agent' && (
          <Field label="SIP server">
            <Select value={server ?? ''} onChange={(e) => setServer(Number(e.target.value))}>
              {servers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {platform && t.account_name ? ` · ${t.account_name}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {mode === 'existing' && (
          <Field label="Extension">
            <ExtensionSelect value={ext} onChange={setExt} options={options.data ?? []} exceptUserId={user.id} showAccount={platform && !accountId} noneLabel="None (no web phone)" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ invite result
export function InviteDone({ name, email, result }: { name: string; email: string; result: InviteResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-500" />
        <div>
          <p className="text-[15px] font-semibold text-slate-900">{name} is set up</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {result.extension ? (
              <>
                Extension <span className="font-mono font-medium text-slate-800">{result.extension.number}</span> was created for them.{' '}
              </>
            ) : null}
            {result.invite_status === 'sent'
              ? `We emailed ${email} a link to choose a password.`
              : result.invite_url
                ? 'Send them this link to choose a password and sign in:'
                : 'They can sign in with the password you set.'}
          </p>
        </div>
      </div>
      {result.invite_status && result.invite_status !== 'sent' && (
        <Notice tone="warn">{result.invite_status === 'failed' ? 'The invitation email could not be sent.' : 'Email is not set up yet, so nothing was sent.'} Share the link below yourself (WhatsApp, chat…).</Notice>
      )}
      {result.invite_url && <CopyField label="Sign-in link (works once, for 7 days)" value={result.invite_url} mono={false} />}
    </div>
  );
}

// ------------------------------------------------------------------ add a person
/**
 * One step from "new teammate" to "their phone works": a login, an extension (new or existing) and an
 * email invitation to choose a password.
 */
export function AddPersonModal({ onClose, extensionId }: { onClose: () => void; extensionId?: number | null }) {
  const { user: me } = useAuth();
  const { tenants, tenantId } = useTenant();
  const qc = useQueryClient();
  const platform = me?.role === 'superadmin';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [phoneMode, setPhoneMode] = useState<'new' | 'existing' | 'none'>(extensionId ? 'existing' : 'new');
  const [ext, setExt] = useState<number | null>(extensionId ?? null);
  const [server, setServer] = useState<number | null>(tenantId);
  const [signin, setSignin] = useState<'invite' | 'password'>('invite');
  const [password, setPassword] = useState('');
  const [owner, setOwner] = useState(false);
  const [done, setDone] = useState<InviteResult | null>(null);
  const serverTenant = tenants.find((t) => t.id === server);
  // A platform admin adding someone to a customer: the SIP server decides the account.
  const options = useAssignableExtensions(platform ? (role === 'superadmin' ? null : (serverTenant?.account_id ?? null)) : me?.accountId);
  const next = useNextExtensionNumber(phoneMode === 'new' ? server : null);
  const showServer = tenants.length > 1 && phoneMode !== 'existing' && !(role === 'superadmin' && phoneMode === 'none');

  const save = useMutation({
    mutationFn: () =>
      api.post<InviteResult>(scoped('/api/users', tenantId), {
        name,
        email,
        role,
        enabled: true,
        is_owner: role === 'admin' && owner,
        tenant_id: role === 'superadmin' || phoneMode === 'existing' ? null : server,
        extension_id: phoneMode === 'existing' ? ext : null,
        create_extension: phoneMode === 'new',
        extension_tenant_id: phoneMode === 'new' ? server : null,
        invite: signin === 'invite',
        password: signin === 'password' ? password : undefined,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['list'] });
      void qc.invalidateQueries({ queryKey: ['account'] });
      toast.success(`${name} added`);
      setDone(r);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const valid = name.trim() && /\S+@\S+\.\S+/.test(email) && (signin === 'invite' || password.length >= 8) && (phoneMode !== 'existing' || ext) && (phoneMode !== 'new' || server);

  if (done) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Person added"
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <InviteDone name={name} email={email} result={done} />
      </Modal>
    );
  }

  const roles: Role[] = platform ? ['agent', 'admin', 'superadmin'] : ['agent', 'admin'];
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Add a person"
      description="Creates their login and their phone in one go"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} icon={signin === 'invite' ? <Mail className="size-4" /> : <UserPlus className="size-4" />}>
            {signin === 'invite' ? 'Add and send invite' : 'Add person'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ayesha Rahman" autoFocus />
          </Field>
          <Field label="Email" hint="Their sign-in">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ayesha@company.com" />
          </Field>
        </div>

        <div>
          <div className="label">Role</div>
          <Choice value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: ROLE_INFO[r].label, hint: ROLE_INFO[r].desc }))} />
          {role === 'admin' && me?.isOwner && !platform && (
            <div className="mt-3">
              <Toggle checked={owner} onChange={setOwner} label="Also an account owner" description="Can manage billing and the team" />
            </div>
          )}
        </div>

        <div>
          <div className="label">Phone</div>
          <Choice
            value={phoneMode}
            onChange={setPhoneMode}
            options={[
              { value: 'new', label: 'New extension', hint: next.data ? `Number ${next.data.number}` : 'Next free number' },
              { value: 'existing', label: 'Existing extension', hint: 'One you already made' },
              { value: 'none', label: 'No phone', hint: role === 'agent' ? 'Sees calls only' : 'Manages, no calling' },
            ]}
          />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {phoneMode === 'existing' && (
              <Field label="Extension" className="sm:col-span-2">
                <ExtensionSelect value={ext} onChange={setExt} options={options.data ?? []} noneLabel="Choose an extension…" showAccount={platform && role === 'superadmin'} />
              </Field>
            )}
            {showServer && (
              <Field label={phoneMode === 'new' ? 'Create it in SIP server' : 'SIP server'} hint={platform && role !== 'superadmin' ? 'Also decides the customer account' : undefined}>
                <Select value={server ?? ''} onChange={(e) => setServer(Number(e.target.value))}>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {platform && t.account_name ? ` · ${t.account_name}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </div>

        <div>
          <div className="label">Signing in</div>
          <Choice
            value={signin}
            onChange={setSignin}
            options={[
              { value: 'invite', label: 'Email an invite link', hint: 'They choose their own password' },
              { value: 'password', label: 'Set a password now', hint: 'You tell them the password' },
            ]}
          />
          {signin === 'password' && (
            <Field label="Password" hint="At least 8 characters" className="mt-3 sm:w-1/2">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ who uses an extension
/** The "People" side of an extension: who calls from it, plus link / invite. */
export function ExtensionPeople({ ext }: { ext: Extension }) {
  const { user: me } = useAuth();
  const { tenant } = useTenant();
  const phone = usePhone();
  const link = useLinkExtension();
  const users = useList<AppUser>('users', { global: true });
  const [pick, setPick] = useState<number | ''>('');
  const [inviting, setInviting] = useState(false);
  const linked = (users.data ?? []).filter((u) => u.extension_id === ext.id);
  const candidates = (users.data ?? []).filter(
    (u) => u.extension_id !== ext.id && (u.role === 'superadmin' ? me?.role === 'superadmin' : !tenant?.account_id || u.account_id === tenant.account_id),
  );
  const mine = me?.extensionId === ext.id;

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-[13px] font-medium text-slate-700">Calls from this extension</div>
        {users.isLoading ? (
          <div className="skeleton h-12 rounded-xl" />
        ) : linked.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {linked.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {u.name} {u.id === me?.id && <span className="font-normal text-slate-400">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{u.email}</div>
                </div>
                <Badge tone={ROLE_INFO[u.role].tone}>{ROLE_INFO[u.role].label}</Badge>
                {!u.last_login_at && u.id !== me?.id && <Badge tone="amber">Invited</Badge>}
                <IconButton label="Remove from this extension" tone="danger" onClick={() => link.mutate({ userId: u.id, body: { extension_id: null } })}>
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center text-sm text-slate-500">
            Nobody calls from this extension yet. A desk phone can still register with it.
          </p>
        )}
      </div>

      {!mine && me?.role !== 'agent' && (
        <button
          type="button"
          disabled={link.isPending}
          onClick={() =>
            link.mutate(
              { userId: me!.id, body: { extension_id: ext.id } },
              {
                onSuccess: () => {
                  toast.success(`Your web phone now uses extension ${ext.number}`);
                  phone.setPanelOpen(true);
                },
              },
            )
          }
          className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-60"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Phone className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-900">Use it for my web phone</span>
            <span className="block text-xs text-slate-500">{me?.extensionId ? 'Replaces the extension your login uses now' : 'Call from the browser as this extension'}</span>
          </span>
        </button>
      )}

      {inviting ? (
        <InlineInvite ext={ext} onDone={() => setInviting(false)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="flex gap-2">
            <Select value={pick} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : '')} aria-label="Someone on the team">
              <option value="">Link someone on the team…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                  {u.extension_number ? ` (now ${u.extension_number})` : ''}
                </option>
              ))}
            </Select>
            {pick !== '' && (
              <Button
                loading={link.isPending}
                onClick={() =>
                  link.mutate(
                    { userId: pick, body: { extension_id: ext.id } },
                    {
                      onSuccess: () => {
                        toast.success(`${candidates.find((u) => u.id === pick)?.name ?? 'The user'} now calls from extension ${ext.number}`);
                        setPick('');
                      },
                    },
                  )
                }
              >
                Link
              </Button>
            )}
          </div>
          <Button icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>
            Invite someone new
          </Button>
        </div>
      )}
    </div>
  );
}

function InlineInvite({ ext, onDone }: { ext: Extension; onDone: () => void }) {
  const { user: me } = useAuth();
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const [name, setName] = useState(/^Extension \d+$/.test(ext.name) ? '' : ext.name);
  const [email, setEmail] = useState(ext.email);
  const [role, setRole] = useState<Role>('agent');
  const [result, setResult] = useState<InviteResult | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.post<InviteResult>(scoped('/api/users', tenantId), { name, email, role, enabled: true, tenant_id: null, extension_id: ext.id, invite: true }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['list'] });
      setResult(r);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (result) {
    return (
      <div className="rounded-xl border border-slate-200 p-4">
        <InviteDone name={name} email={email} result={result} />
        <Button size="sm" className="mt-4" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Invite someone to extension {ext.number}</p>
        <IconButton label="Cancel" onClick={onDone}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="agent">Agent: web phone, own calls</option>
            <option value="admin">Admin: manages the phone system</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button variant="primary" className="w-full" loading={save.isPending} disabled={!name.trim() || !/\S+@\S+\.\S+/.test(email) || me?.role === 'agent'} onClick={() => save.mutate()} icon={<Mail className="size-4" />}>
            Send invite
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Re-sends the "choose your password" link and shows it for sharing by hand. */
export function SendInviteButton({ user }: { user: AppUser }) {
  const [result, setResult] = useState<InviteResult | null>(null);
  const send = useMutation({
    mutationFn: () => api.post<InviteResult>(`/api/users/${user.id}/invite`),
    onSuccess: (r) => {
      setResult(r);
      if (r.invite_status === 'sent') toast.success(`Sign-in link sent to ${user.email}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <>
      <Button variant="ghost" icon={<KeyRound className="size-4" />} loading={send.isPending} onClick={() => send.mutate()}>
        Send sign-in link
      </Button>
      {result && (
        <Modal open onClose={() => setResult(null)} title="Sign-in link" size="sm" footer={<Button variant="primary" onClick={() => setResult(null)}>Done</Button>}>
          <InviteDone name={user.name} email={user.email} result={{ ...result, extension: null }} />
        </Modal>
      )}
    </>
  );
}
