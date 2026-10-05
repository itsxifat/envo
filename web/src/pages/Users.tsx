import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Crown, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import { timeAgo } from '../lib/format';
import type { AppUser, Role } from '../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBlock, Field, IconButton, Input, LoadingBlock, Modal, PageHeader, Select, Toggle, useConfirm } from '../components/ui';
import { AddPersonModal, ExtensionSelect, LinkPhoneModal, MyPhoneSetup, ROLE_INFO, SendInviteButton, useAssignableExtensions } from '../components/people';

interface Form {
  email: string;
  name: string;
  role: Role;
  tenant_id: number | null;
  extension_id: number | null;
  is_owner: boolean;
  enabled: boolean;
  password: string;
}

export function UsersPage() {
  const list = useList<AppUser>('users', { global: true });
  const remove = useRemove('users', 'User deleted');
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const { tenants } = useTenant();
  const [editing, setEditing] = useState<AppUser | null>(null);
  // Other pages link here with ?add=1 to open "Add person" straight away.
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [linking, setLinking] = useState<AppUser | null>(null);
  const manyServers = tenants.length > 1;

  return (
    <div>
      <PageHeader
        title="Team"
        icon={<UserRound className="size-5" />}
        description="People who sign in to Envo, and the extension each one calls from"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add person
          </Button>
        }
      />
      <MyPhoneSetup className="mb-4 sm:mb-6" />
      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState
            icon={<UserRound className="size-5" />}
            title="Nobody here yet"
            description="Add a person: they get a login, an extension and an email to choose their password."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Add person
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  {me?.role === 'superadmin' && <th>Customer</th>}
                  <th>Phone</th>
                  <th>Last sign-in</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((u) => (
                  <tr key={u.id} className={u.enabled ? '' : 'opacity-55'}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white max-md:hidden">
                          {u.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">
                            {u.name} {u.id === me?.id && <span className="text-xs font-normal text-slate-400">(you)</span>}
                          </div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={ROLE_INFO[u.role].tone}>{ROLE_INFO[u.role].label}</Badge>
                        {u.is_owner && (
                          <Badge tone="amber">
                            <Crown className="size-3" /> Owner
                          </Badge>
                        )}
                      </div>
                    </td>
                    {me?.role === 'superadmin' && (
                      <td className="text-sm text-slate-600">
                        {u.account_name ?? '—'}
                        {u.tenant_name && <div className="text-xs text-slate-400">{u.tenant_name}</div>}
                      </td>
                    )}
                    <td>
                      {u.extension_number ? (
                        <button type="button" onClick={() => setLinking(u)} className="group text-left" title="Change extension">
                          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-medium text-slate-800 group-hover:text-brand-700">
                            <Phone className="size-3.5 text-slate-400 group-hover:text-brand-600" />
                            {u.extension_number}
                          </span>
                          {(manyServers || me?.role === 'superadmin') && u.extension_tenant_name && <div className="text-xs text-slate-400">{u.extension_tenant_name}</div>}
                        </button>
                      ) : (
                        <Button size="sm" icon={<Phone className="size-3.5" />} onClick={() => setLinking(u)}>
                          Give a phone
                        </Button>
                      )}
                    </td>
                    <td className="text-sm text-slate-500">{u.last_login_at ? timeAgo(u.last_login_at) : <Badge tone="amber">Invited</Badge>}</td>
                    <td>
                      <div className="flex justify-end gap-0.5">
                        <IconButton label="Edit" onClick={() => setEditing(u)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        {u.id !== me?.id && (
                          <IconButton
                            label="Delete"
                            tone="danger"
                            onClick={async () => {
                              if (await confirm({ title: `Delete ${u.name}?`, message: 'Their login is removed. Their extension stays.', confirmLabel: 'Delete', danger: true })) remove.mutate(u.id);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adding && (
        <AddPersonModal
          onClose={() => {
            setAdding(false);
            if (params.has('add')) setParams({}, { replace: true });
          }}
        />
      )}
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} />}
      {linking && <LinkPhoneModal user={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const { user: me, refresh } = useAuth();
  const qc = useQueryClient();
  const { tenants } = useTenant();
  const [form, setForm] = useState<Form>({
    email: user.email,
    name: user.name,
    role: user.role,
    tenant_id: user.tenant_id,
    extension_id: user.extension_id,
    is_owner: !!user.is_owner,
    enabled: user.enabled,
    password: '',
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useSave('users', { updated: 'User saved' });
  const platform = me?.role === 'superadmin';
  // Every extension of the person's account, across its SIP servers (platform admins: any).
  const accountId = form.role === 'superadmin' ? null : (user.account_id ?? (platform ? null : me?.accountId));
  const exts = useAssignableExtensions(accountId);
  const servers = tenants.filter((t) => !accountId || t.account_id === undefined || t.account_id === accountId);
  const roles: Role[] = platform ? ['agent', 'admin', 'superadmin'] : ['agent', 'admin'];
  // The extension decides an agent's SIP server; without one, pick it.
  const needsServer = form.role === 'agent' && !form.extension_id && servers.length > 1;
  const self = user.id === me?.id;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.name}`}
      footer={
        <>
          {!self && (
            <div className="mr-auto max-sm:hidden">
              <SendInviteButton user={user} />
            </div>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.email || !form.name || (form.password.length > 0 && form.password.length < 8)}
            onClick={async () => {
              const tenant_id = form.role === 'agent' && !form.tenant_id && !form.extension_id ? (servers[0]?.id ?? null) : form.tenant_id;
              const data = { ...form, tenant_id, password: form.password || undefined };
              const ok = await save.mutateAsync({ id: user.id, data }).catch(() => null);
              if (!ok) return;
              // Your own extension drives the web phone: pick up the change right away.
              if (self) {
                await refresh();
                void qc.invalidateQueries({ queryKey: ['webphone'] });
              }
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Role" className="sm:col-span-2" hint={self ? 'You cannot change your own role' : ROLE_INFO[form.role].desc}>
          <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)} disabled={self}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_INFO[r].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phone extension" className="sm:col-span-2" hint="The web phone, voicemail and call history of this login">
          <ExtensionSelect
            value={form.extension_id}
            onChange={(v) => set('extension_id', v)}
            options={exts.data ?? []}
            exceptUserId={user.id}
            showAccount={platform && !accountId}
            noneLabel="None (no web phone)"
          />
        </Field>
        {needsServer && (
          <Field label="SIP server" className="sm:col-span-2">
            <Select value={form.tenant_id ?? servers[0]?.id ?? ''} onChange={(e) => set('tenant_id', Number(e.target.value))}>
              {servers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {platform && t.account_name ? ` · ${t.account_name}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="New password" className="sm:col-span-2" hint={self ? 'Leave empty to keep it' : 'Leave empty to keep it, or send them a sign-in link instead'}>
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="space-y-3 sm:col-span-2">
          {!self && <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Can sign in" />}
          {form.role === 'admin' && (platform || me?.isOwner) && !self && (
            <Toggle checked={form.is_owner} onChange={(v) => set('is_owner', v)} label="Account owner" description="Can manage billing, the team and delete SIP servers" />
          )}
        </div>
        {!self && (
          <div className="sm:hidden">
            <SendInviteButton user={user} />
          </div>
        )}
      </div>
    </Modal>
  );
}
