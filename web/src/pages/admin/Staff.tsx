import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, MoreHorizontal, ShieldCheck, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAuth } from '../../state/auth';
import type { AppUser } from '../../lib/types';
import { InviteDone, type InviteResult } from '../../components/people';
import { Badge, Button, Card, EmptyState, ErrorBlock, Field, Input, Menu, Modal, Notice, PageHeader, TableSkeleton, useConfirm } from '../../components/ui';

/** Platform admins: the people who run Envo and look after customers from /admin. */
export function StaffPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<{ name: string; email: string; result: InviteResult } | null>(null);
  const q = useQuery({ queryKey: ['admin', 'staff'], queryFn: () => api.get<AppUser[]>('/api/users?role=superadmin') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'staff'] });

  const setEnabled = async (u: AppUser, enabled: boolean) => {
    try {
      await api.put(`/api/users/${u.id}`, { email: u.email, name: u.name, role: 'superadmin', enabled, extension_id: u.extension_id });
      refresh();
      toast.success(enabled ? `${u.name} can sign in again` : `${u.name} can no longer sign in`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Staff"
        icon={<ShieldCheck />}
        description="Platform admins see every customer, can open their portals and change billing. Add only people you trust."
        actions={
          <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
            Add staff
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <TableSkeleton rows={3} cols={4} />
        ) : q.error ? (
          <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon={<ShieldCheck className="size-5" />} title="No staff" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {q.data.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id}>
                      <td className="text-sm font-medium text-slate-900">
                        {u.name}
                        {self && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
                      </td>
                      <td className="text-sm text-slate-600">{u.email}</td>
                      <td className="text-sm text-slate-600">{timeAgo(u.last_login_at)}</td>
                      <td>{u.enabled ? <Badge tone="green">Can sign in</Badge> : <Badge tone="red">Turned off</Badge>}</td>
                      <td>
                        {!self && (
                          <Menu
                            items={[
                              {
                                label: 'Send a password link',
                                icon: <KeyRound className="size-4" />,
                                onSelect: () =>
                                  void api
                                    .post<{ invite_url?: string; invite_status?: InviteResult['invite_status'] }>(`/api/users/${u.id}/invite`)
                                    .then((r) => setLink({ name: u.name, email: u.email, result: { ...r, id: u.id, extension: null } }))
                                    .catch((err) => toast.error(errorMessage(err))),
                              },
                              u.enabled
                                ? { label: 'Turn off', icon: <UserX className="size-4" />, onSelect: () => void setEnabled(u, false), separatorBefore: true }
                                : { label: 'Turn back on', icon: <UserCheck className="size-4" />, onSelect: () => void setEnabled(u, true), separatorBefore: true },
                              {
                                label: 'Remove',
                                icon: <Trash2 className="size-4" />,
                                danger: true,
                                onSelect: async () => {
                                  if (!(await confirm({ title: `Remove ${u.name}?`, message: 'Their login is deleted. Their past actions stay in the activity log.', confirmLabel: 'Remove', danger: true }))) return;
                                  try {
                                    await api.del(`/api/users/${u.id}`);
                                    refresh();
                                    toast.success(`${u.name} removed`);
                                  } catch (err) {
                                    toast.error(errorMessage(err));
                                  }
                                },
                              },
                            ]}
                            trigger={({ onClick, ref }) => (
                              <button
                                ref={ref as never}
                                type="button"
                                onClick={onClick}
                                aria-label={`Actions for ${u.name}`}
                                className="inline-flex size-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.05] hover:text-slate-800"
                              >
                                <MoreHorizontal className="size-4" />
                              </button>
                            )}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Notice tone="info" className="mt-4">
        Need a SIP server for Enfinito itself? Create a customer account for it on the Customers page and use it like any customer, or open its portal from here.
      </Notice>
      {adding && <AddStaff onClose={() => setAdding(false)} onDone={(r) => (setAdding(false), setLink(r), refresh())} />}
      {link && (
        <Modal open onClose={() => setLink(null)} title="Sign-in link" size="sm" footer={<Button onClick={() => setLink(null)}>Done</Button>}>
          <InviteDone name={link.name} email={link.email} result={link.result} />
        </Modal>
      )}
    </div>
  );
}

function AddStaff({ onClose, onDone }: { onClose: () => void; onDone: (r: { name: string; email: string; result: InviteResult }) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const save = useMutation({
    mutationFn: () => api.post<InviteResult>('/api/users', { name, email, role: 'superadmin', invite: true }),
    onSuccess: (result) => onDone({ name, email, result }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a platform admin"
      description="They get an email with a link to choose their password"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !/^\S+@\S+\.\S+$/.test(email)} onClick={() => save.mutate()}>
            Send invitation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} placeholder="name@enfinito.com" />
        </Field>
      </div>
    </Modal>
  );
}
