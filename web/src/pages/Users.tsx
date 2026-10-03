import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { api, scoped } from '../lib/api';
import { useList, useRemove, useSave } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import { timeAgo } from '../lib/format';
import type { AppUser, Extension, Role } from '../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBlock, Field, IconButton, Input, LoadingBlock, Modal, PageHeader, Select, Toggle, useConfirm } from '../components/ui';

interface Form {
  email: string;
  name: string;
  role: Role;
  tenant_id: number | null;
  extension_id: number | null;
  enabled: boolean;
  password: string;
}

const ROLE: Record<Role, { label: string; tone: 'violet' | 'brand' | 'gray'; desc: string }> = {
  superadmin: { label: 'Platform admin', tone: 'violet', desc: 'Everything, across all SIP servers' },
  admin: { label: 'Admin', tone: 'brand', desc: 'Manages one SIP server' },
  agent: { label: 'Agent', tone: 'gray', desc: 'Web phone, own calls and voicemail' },
};

export function UsersPage() {
  const list = useList<AppUser>('users', { global: true });
  const remove = useRemove('users', 'User deleted');
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const [editing, setEditing] = useState<AppUser | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="Users"
        icon={<UserRound className="size-5" />}
        description="People who can sign in to Envo"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add user
          </Button>
        }
      />
      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : !list.data?.length ? (
          <EmptyState icon={<UserRound className="size-5" />} title="No users" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  {me?.role === 'superadmin' && <th>SIP server</th>}
                  <th>Web phone ext</th>
                  <th>Last sign-in</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((u) => (
                  <tr key={u.id} className={u.enabled ? '' : 'opacity-55'}>
                    <td>
                      <div className="font-medium text-slate-900">
                        {u.name} {u.id === me?.id && <span className="text-xs font-normal text-slate-400">(you)</span>}
                      </div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td>
                      <Badge tone={ROLE[u.role].tone}>{ROLE[u.role].label}</Badge>
                    </td>
                    {me?.role === 'superadmin' && <td className="text-sm text-slate-600">{u.tenant_name ?? '—'}</td>}
                    <td className="font-mono text-sm text-slate-700">{u.extension_number ?? '—'}</td>
                    <td className="text-sm text-slate-500">{timeAgo(u.last_login_at)}</td>
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
                              if (await confirm({ title: `Delete ${u.name}?`, confirmLabel: 'Delete', danger: true })) remove.mutate(u.id);
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
      {editing && <UserModal user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user: AppUser | null; onClose: () => void }) {
  const { user: me } = useAuth();
  const { tenants, tenantId } = useTenant();
  const [form, setForm] = useState<Form>(() =>
    user
      ? { email: user.email, name: user.name, role: user.role, tenant_id: user.tenant_id, extension_id: user.extension_id, enabled: user.enabled, password: '' }
      : { email: '', name: '', role: 'agent', tenant_id: tenantId, extension_id: null, enabled: true, password: '' },
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useSave('users', { created: 'User added', updated: 'User saved' });
  // Superadmins may link an extension from any SIP server; pick which one to browse.
  const [extTenant, setExtTenant] = useState<number | null>(user?.tenant_id ?? tenantId);
  const browseTenant = form.role === 'superadmin' ? extTenant : form.tenant_id;
  const exts = useQuery({
    queryKey: ['list', 'extensions', browseTenant],
    queryFn: () => api.get<Extension[]>(scoped('/api/extensions', browseTenant)),
    enabled: !!browseTenant,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? `Edit ${user.name}` : 'Add user'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.email || !form.name || (!user && form.password.length < 8)}
            onClick={async () => {
              const data = { ...form, password: form.password || undefined };
              const ok = await save.mutateAsync({ id: user?.id, data }).catch(() => null);
              if (ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Role" className="sm:col-span-2" hint={ROLE[form.role].desc}>
          <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
            {(me?.role === 'superadmin' ? (['agent', 'admin', 'superadmin'] as Role[]) : (['agent', 'admin'] as Role[])).map((r) => (
              <option key={r} value={r}>
                {ROLE[r].label}
              </option>
            ))}
          </Select>
        </Field>
        {me?.role === 'superadmin' && (
          <Field label={form.role === 'superadmin' ? 'Browse extensions of' : 'SIP server'}>
            <Select
              value={(form.role === 'superadmin' ? extTenant : form.tenant_id) ?? ''}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                if (form.role === 'superadmin') setExtTenant(v);
                else setForm((f) => ({ ...f, tenant_id: v, extension_id: null }));
              }}
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Web phone extension" hint="The extension this user calls from in the browser">
          <Select value={form.extension_id ?? ''} onChange={(e) => set('extension_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">None</option>
            {exts.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.number} · {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={user ? 'New password' : 'Password'} className="sm:col-span-2" hint={user ? 'Leave empty to keep the current password' : 'At least 8 characters'}>
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Can sign in" />
        </div>
      </div>
    </Modal>
  );
}
