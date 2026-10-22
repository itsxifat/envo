import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronDown, Hash, ListTree, Mail, Pencil, Phone, PhoneCall, Plus, Rocket, Smartphone, Sparkles, UserPlus, Users, Voicemail, X } from 'lucide-react';
import { api, errorMessage, scoped } from '../lib/api';
import { useDestinations, useList, useSave } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import { useContactsByEndpoint } from '../state/live';
import { usePhone } from '../phone/PhoneProvider';
import type { DestType, Destinations, Extension, Ivr, IvrOption, Option, RingGroup, Sound } from '../lib/types';
import { ConnectNumberForm, LineProgress, useSetupStatus, type LineState, type SetupStatus } from '../components/connectNumber';
import { GreetingMaker } from '../components/greeting';
import { AddPersonModal, InviteDone, MyPhoneSetup, type InviteResult } from '../components/people';
import { DestLabel } from '../components/DestinationPicker';
import { GetNumberModal, isOpenRequest, useNumberRequests, useSupplyOptions } from '../components/numberSupply';
import { Badge, Button, Card, CopyButton, ErrorBlock, Field, IconButton, Input, LoadingBlock, Notice, PageHeader, Select, StatusDot } from '../components/ui';

/*
 * The guided setup: four steps from a fresh SIP server to a working phone system, in plain words.
 * Each step has its own anchor (#team #number #calls #test) so the dashboard can link straight to it.
 */

export type SetupStep = 'team' | 'number' | 'calls' | 'test';

export const SETUP_STEPS: { key: SetupStep; title: string }[] = [
  { key: 'team', title: 'Add your team' },
  { key: 'number', title: 'Connect your phone number' },
  { key: 'calls', title: 'Choose where calls go' },
  { key: 'test', title: 'Make a test call' },
];

const isStep = (v: string): v is SetupStep => SETUP_STEPS.some((s) => s.key === v);
const stepAfter = (step: SetupStep): SetupStep | null => SETUP_STEPS[SETUP_STEPS.findIndex((s) => s.key === step) + 1]?.key ?? null;

const SOLO_KEY = 'envo.setup.solo';

/** "Just me for now": the team step counts as done for this SIP server in this browser. */
function soloChosen(tenantId: number | null): boolean {
  try {
    return !!tenantId && localStorage.getItem(`${SOLO_KEY}.${tenantId}`) === '1';
  } catch {
    return false;
  }
}

/** How far the current SIP server is through the guide; shared with the dashboard's setup card. */
export function useSetupProgress(opts: { enabled?: boolean } = {}) {
  const { tenantId } = useTenant();
  const status = useSetupStatus(opts);
  const [, rerender] = useState(0);
  const s = status.data;
  const done: Record<SetupStep, boolean> | null = s
    ? {
        // New servers start with the owner on the first extension, so the team step wants one more.
        team: s.people > 1 || s.named > 1 || soloChosen(tenantId),
        number: s.numbers.length > 0,
        calls: s.numbers.length > 0 && s.routed,
        test: s.has_calls,
      }
    : null;
  const count = done ? SETUP_STEPS.filter((st) => done[st.key]).length : 0;
  const next = done ? (SETUP_STEPS.find((st) => !done[st.key])?.key ?? null) : null;
  const skipTeam = () => {
    try {
      localStorage.setItem(`${SOLO_KEY}.${tenantId}`, '1');
    } catch {
      /* storage unavailable */
    }
    rerender((n) => n + 1);
  };
  return { status, done, count, next, skipTeam };
}

/** One line on what happens to a call, e.g. "Calls ring everyone at once". */
function destText(type: DestType, target: string, dest: Destinations | undefined, everyoneId: number | undefined): string {
  const name = type === 'external' || type === 'hangup' ? target : (dest?.[type].find((o) => o.value === target)?.label ?? target);
  switch (type) {
    case 'hangup':
      return 'Calls are not answered yet';
    case 'extension':
      return `Calls ring ${name}`;
    case 'ring_group':
      return target === String(everyoneId) ? 'Calls ring everyone at once' : `Calls ring the group ${name}`;
    case 'voicemail':
      return `Callers leave a voicemail for ${name}`;
    case 'ivr':
      return `Callers hear the menu ${name}`;
    case 'queue':
      return `Callers wait in the queue ${name}`;
    case 'time_condition':
      return `Calls follow your business hours (${name})`;
    case 'conference':
      return `Callers join the conference room ${name}`;
    case 'external':
      return `Calls are forwarded to ${target}`;
  }
}

function routingText(numbers: SetupStatus['numbers'], dest: Destinations | undefined, everyoneId: number | undefined): string {
  const first = numbers[0];
  if (!first) return 'Connect a number first';
  if (numbers.some((n) => n.dest_type !== first.dest_type || n.dest_target !== first.dest_target)) return 'Your numbers ring different places';
  return destText(first.dest_type, first.dest_target, dest, everyoneId);
}

export function GetStartedPage() {
  const { tenant } = useTenant();
  const { status, done, count, skipTeam, next } = useSetupProgress();
  const dest = useDestinations();
  const groups = useList<RingGroup>('ring-groups');
  const location = useLocation();
  const navigate = useNavigate();
  const hash = location.hash.slice(1);
  const hashStep = isStep(hash) ? hash : null;
  // undefined until we know which step to open; null once the user closed them all.
  const [open, setOpen] = useState<SetupStep | null | undefined>(hashStep ?? undefined);
  const loaded = !!status.data;

  // A link to a step (the dashboard's setup card, Continue) opens and shows it.
  useEffect(() => {
    if (!hashStep || !loaded) return;
    setOpen(hashStep);
    requestAnimationFrame(() => document.getElementById(hashStep)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [hashStep, loaded]);

  // Otherwise the first step that is not done yet.
  useEffect(() => {
    if (open === undefined && done) setOpen(next ?? 'test');
  }, [open, done, next]);

  const show = (step: SetupStep | null) => {
    setOpen(step);
    void navigate({ hash: step ? `#${step}` : '' }, { replace: true });
  };
  const toggle = (step: SetupStep) => () => show(open === step ? null : step);
  const advance = (step: SetupStep) => () => show(stepAfter(step));

  const s = status.data;
  const everyoneId = groups.data?.find((g) => g.name === 'Everyone')?.id;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Get started" icon={<Rocket className="size-5" />} description={`Set up ${tenant?.name ?? 'your phone system'} in four steps. No technical knowledge needed.`} />
      {status.isLoading ? (
        <LoadingBlock />
      ) : status.error ? (
        <ErrorBlock error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        s &&
        done && (
          <>
            <Progress count={count} />
            <div className="space-y-3">
              <StepCard
                step="team"
                index={0}
                done={done.team}
                open={open === 'team'}
                onToggle={toggle('team')}
                summary={`${s.extensions} extension${s.extensions === 1 ? '' : 's'} · ${s.online} online now`}
              >
                <TeamStep
                  done={done.team}
                  onContinue={() => {
                    if (!done.team) skipTeam();
                    advance('team')();
                  }}
                />
              </StepCard>
              <StepCard
                step="number"
                index={1}
                done={done.number}
                open={open === 'number'}
                onToggle={toggle('number')}
                summary={s.numbers.length ? s.numbers.map((n) => n.number).join(', ') : 'The number your customers dial'}
              >
                <NumberStep status={s} onContinue={advance('number')} />
              </StepCard>
              <StepCard step="calls" index={2} done={done.calls} open={open === 'calls'} onToggle={toggle('calls')} summary={routingText(s.numbers, dest.data, everyoneId)}>
                <CallsStep status={s} onDone={advance('calls')} onConnect={() => show('number')} />
              </StepCard>
              <StepCard step="test" index={3} done={done.test} open={open === 'test'} onToggle={toggle('test')} summary={s.has_calls ? 'Calls are working' : 'Check that everything works'}>
                <TestStep status={s} routing={routingText(s.numbers, dest.data, everyoneId)} />
              </StepCard>
            </div>
          </>
        )
      )}
    </div>
  );
}

function Progress({ count }: { count: number }) {
  const pct = Math.round((count / SETUP_STEPS.length) * 100);
  return (
    <Card className="mb-4 p-4 sm:mb-5 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">{count === SETUP_STEPS.length ? 'All done. Your phone system is ready.' : `${count} of ${SETUP_STEPS.length} steps done`}</p>
        <span className="text-sm font-semibold text-slate-900 tabular-nums">{pct}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

function StepCard({
  step,
  index,
  done,
  open,
  onToggle,
  summary,
  children,
}: {
  step: SetupStep;
  index: number;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  summary: string;
  children: ReactNode;
}) {
  return (
    <section id={step} className="card scroll-mt-4 overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3.5 px-4 py-4 text-left transition hover:bg-slate-50/60 sm:px-5">
        <span
          className={clsx(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            done ? 'bg-emerald-500 text-white' : open ? 'bg-ink-950 text-white' : 'bg-slate-100 text-slate-500',
          )}
        >
          {done ? <Check className="size-4" /> : index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight text-slate-950">{SETUP_STEPS[index]!.title}</span>
          <span className="block text-[13px] text-slate-500">{summary}</span>
        </span>
        <ChevronDown className={clsx('size-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-black/[0.06] px-4 py-5 sm:px-5">{children}</div>}
    </section>
  );
}

function StepFooter({ onContinue, hint, extra }: { onContinue: () => void; hint?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-black/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <Button variant="primary" onClick={onContinue}>
        Continue <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ 1. team
const PLACEHOLDER_NAME = /^Extension \d+$/;

function TeamStep({ done, onContinue }: { done: boolean; onContinue: () => void }) {
  const list = useList<Extension>('extensions');
  const contacts = useContactsByEndpoint();
  const [inviting, setInviting] = useState<number | null>(null);
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">Everyone who takes calls gets an extension: a short number that rings their phone. Name each one after the person who uses it.</p>
      {list.isLoading ? (
        <div className="skeleton h-32 rounded-xl" />
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : (
        !!list.data?.length && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {list.data.map((e) => (
              <TeamRow key={e.id} ext={e} online={contacts.has(e.sip_username) || contacts.has(`${e.sip_username}_web`)} onInvite={() => setInviting(e.id)} />
            ))}
          </ul>
        )
      )}
      <AddPerson />
      <StepFooter onContinue={onContinue} hint={done ? undefined : 'Just you for now? That is fine, you can add people later.'} />
      {inviting !== null && <AddPersonModal extensionId={inviting} onClose={() => setInviting(null)} />}
    </div>
  );
}

function TeamRow({ ext, online, onInvite }: { ext: Extension; online: boolean; onInvite: () => void }) {
  const save = useSave<Extension>('extensions', { updated: 'Name saved' });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const unnamed = PLACEHOLDER_NAME.test(ext.name);
  const users = ext.users ?? [];

  const start = () => {
    setName(unnamed ? '' : ext.name);
    setEditing(true);
  };
  const submit = async () => {
    const value = name.trim();
    if (!value || value === ext.name) return setEditing(false);
    // The whole extension goes back unchanged apart from the name; the server keeps the voicemail PIN.
    const ok = await save.mutateAsync({ id: ext.id, data: { ...ext, name: value } }).catch(() => null);
    if (ok) setEditing(false);
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
      <span className="flex h-7 min-w-11 items-center justify-center rounded-lg bg-slate-100 px-2 font-mono text-[13px] font-semibold text-slate-700">{ext.number}</span>
      {editing ? (
        <form
          className="flex min-w-0 flex-1 basis-56 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            placeholder="e.g. Ayesha or Front desk"
            maxLength={60}
            aria-label={`Name for extension ${ext.number}`}
            autoFocus
          />
          <Button type="submit" size="sm" variant="primary" loading={save.isPending} disabled={!name.trim()}>
            Save
          </Button>
          <IconButton label="Cancel" onClick={() => setEditing(false)}>
            <X className="size-4" />
          </IconButton>
        </form>
      ) : (
        <button type="button" onClick={start} className="group flex min-w-0 flex-1 basis-40 items-center gap-1.5 text-left">
          <span className={clsx('truncate text-sm', unnamed ? 'text-slate-400' : 'font-medium text-slate-900')}>{unnamed ? 'Add a name' : ext.name}</span>
          <Pencil className="size-3.5 shrink-0 text-slate-300 transition group-hover:text-slate-500" />
        </button>
      )}
      {!editing && (
        <div className="flex items-center gap-2">
          <Badge tone={online ? 'green' : 'gray'} dot>
            {online ? 'Online' : 'Offline'}
          </Badge>
          {users.length ? (
            <span className="max-w-40 truncate text-xs text-slate-500">Used by {users.map((u) => u.name).join(', ')}</span>
          ) : (
            <Button size="sm" variant="ghost" icon={<Mail className="size-3.5" />} onClick={onInvite}>
              Invite
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** A name, and optionally an email: with one they get a login and an invite, without one just an extension. */
function AddPerson() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [invited, setInvited] = useState<{ name: string; email: string; result: InviteResult } | null>(null);
  const withEmail = email.trim() !== '';

  const add = useMutation({
    mutationFn: async (): Promise<{ invite: InviteResult } | { ext: Extension }> => {
      if (withEmail) {
        const body = { name: name.trim(), email: email.trim(), role: 'agent', tenant_id: tenantId, create_extension: true, invite: true };
        return { invite: await api.post<InviteResult>(scoped('/api/users', tenantId), body) };
      }
      const { number } = await api.get<{ number: string }>(scoped('/api/extensions/next-number', tenantId));
      return { ext: await api.post<Extension>(scoped('/api/extensions', tenantId), { number, name: name.trim() }) };
    },
    onSuccess: (r) => {
      for (const key of [['list'], ['setup'], ['dashboard'], ['account']]) void qc.invalidateQueries({ queryKey: key });
      if ('invite' in r) setInvited({ name: name.trim(), email: email.trim(), result: r.invite });
      else toast.success(`${r.ext.name} has extension ${r.ext.number}`);
      setName('');
      setEmail('');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (invited) {
    return (
      <div className="rounded-xl border border-slate-200 p-4">
        <InviteDone {...invited} />
        <Button size="sm" className="mt-4" icon={<UserPlus className="size-4" />} onClick={() => setInvited(null)}>
          Add someone else
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-black/[0.05]">
      <p className="mb-3 text-sm font-semibold text-slate-900">Add a person</p>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ayesha Rahman" maxLength={60} />
        </Field>
        <Field label="Email (optional)">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ayesha@company.com" />
        </Field>
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!name.trim() || (withEmail && !/\S+@\S+\.\S+/.test(email))} icon={<Plus className="size-4" />}>
          Add
        </Button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        {withEmail
          ? 'They get an email to choose a password. Then they can make and take calls in their browser.'
          : 'Without an email they get an extension for a desk phone or a phone app. Add an email so they can sign in too.'}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ 2. number
const HEALTH: Record<LineState['health'], { tone: 'green' | 'red' | 'amber' | 'gray'; label: string }> = {
  ok: { tone: 'green', label: 'Connected' },
  failing: { tone: 'red', label: 'Not accepted' },
  waiting: { tone: 'amber', label: 'Connecting' },
  off: { tone: 'gray', label: 'Turned off' },
};

function LineBadge({ line }: { line: LineState | null }) {
  if (!line) return <Badge>No line</Badge>;
  const h = line.shared ? HEALTH.ok : HEALTH[line.health];
  return (
    <Badge tone={h.tone} dot>
      {h.label}
    </Badge>
  );
}

function NumberStep({ status, onContinue }: { status: SetupStatus; onContinue: () => void }) {
  const supply = useSupplyOptions();
  const requests = useNumberRequests();
  const [connected, setConnected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [own, setOwn] = useState(false);
  const [getting, setGetting] = useState(false);
  const numbers = status.numbers;
  const offer = !!supply.data?.enabled;
  const waiting = (requests.data ?? []).filter(isOpenRequest);
  const pending = waiting.length > 0 && (
    <Notice title={waiting.length === 1 ? 'Your number is on its way' : `${waiting.length} numbers are on their way`}>
      We are registering {waiting.map((r) => r.requested_number || 'a free number').join(', ')} with the operator and connect {waiting.length === 1 ? 'it' : 'them'} for you. You
      can follow this on the Phone numbers page.
    </Notice>
  );
  const getModal = getting && <GetNumberModal onClose={() => setGetting(false)} />;

  if (connected) {
    return (
      <div className="space-y-4">
        {pending}
        <LineProgress number={connected} />
        <StepFooter
          onContinue={onContinue}
          extra={
            <Button
              icon={<Plus className="size-4" />}
              onClick={() => {
                setConnected(null);
                setAdding(true);
              }}
            >
              Connect another number
            </Button>
          }
        />
        {getModal}
      </div>
    );
  }
  if (numbers.length && !adding) {
    return (
      <div className="space-y-4">
        {pending}
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {numbers.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="font-mono text-[15px] font-semibold text-slate-900">{n.number}</span>
              {n.label && <span className="text-sm text-slate-500">{n.label}</span>}
              <span className="ml-auto">
                <LineBadge line={n.line} />
              </span>
            </li>
          ))}
        </ul>
        {numbers
          .filter((n) => n.line && !n.line.shared && n.line.health === 'failing')
          .map((n) => (
            <LineProgress key={n.id} number={n.number} />
          ))}
        <StepFooter
          onContinue={onContinue}
          extra={
            <>
              {offer && (
                <Button icon={<Sparkles className="size-4" />} onClick={() => setGetting(true)}>
                  Get a new number
                </Button>
              )}
              <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Connect another number
              </Button>
            </>
          }
        />
        {getModal}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {pending}
      <p className="text-sm text-slate-600">
        {offer
          ? 'This is the number your customers dial. Get a new one from Enfinito, or connect one you bought from an IP phone provider (IPTSP).'
          : 'This is the number your customers dial. You buy it from an IP phone provider (IPTSP), and they give you a few details to type in here.'}
      </p>
      {offer && !own ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setGetting(true)}
            className="flex items-start gap-3 rounded-xl border border-brand-500 bg-brand-50/60 p-3.5 text-left ring-3 ring-brand-500/10 transition hover:bg-brand-50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Sparkles className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-medium text-slate-900">Get a new number from Enfinito</span>
              <span className="mt-0.5 block text-xs text-slate-500">Choose a number and send your details. We register and connect it for you.</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setOwn(true)}
            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-slate-300"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Hash className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-medium text-slate-900">I already have a number</span>
              <span className="mt-0.5 block text-xs text-slate-500">Bought from an IP phone provider? Type in the details they gave you.</span>
            </span>
          </button>
        </div>
      ) : (
        <ConnectNumberForm onDone={setConnected} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-4">
        {adding || (offer && own) ? (
          <Button
            variant="ghost"
            onClick={() => {
              setAdding(false);
              setOwn(false);
            }}
          >
            {offer && own && !adding ? 'Back' : 'Cancel'}
          </Button>
        ) : (
          <>
            <p className="text-xs text-slate-500">No number yet? Your team can still call each other.</p>
            <Button variant="ghost" onClick={onContinue}>
              Skip for now
            </Button>
          </>
        )}
      </div>
      {getModal}
    </div>
  );
}

// ------------------------------------------------------------------ 3. calls
type CallPlan = 'everyone' | 'person' | 'voicemail' | 'menu';
type KeyKind = 'everyone' | 'person' | 'voicemail';
/** A menu key the guide can edit, or one set up on the IVR menus page that it leaves alone. */
type MenuKey = { digit: string; kind: KeyKind; target: string } | { digit: string; kind: 'other'; option: IvrOption };

const MENU_NAME = 'Main menu';
const KEY_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const PLANS: { value: CallPlan; icon: ReactNode; title: string; desc: string }[] = [
  { value: 'everyone', icon: <Users className="size-4" />, title: 'Ring everyone', desc: 'All phones ring at once. Whoever picks up first gets the call.' },
  { value: 'person', icon: <Phone className="size-4" />, title: 'One person', desc: 'Calls ring one extension, for example your receptionist.' },
  { value: 'voicemail', icon: <Voicemail className="size-4" />, title: 'Voicemail', desc: 'Callers leave a message you can listen to later.' },
  { value: 'menu', icon: <ListTree className="size-4" />, title: 'A menu', desc: '"Press 1 for sales, press 2 for support."' },
];

/** "101 · Ayesha" → "Ayesha". */
const nameOf = (options: Option[], value: string) => options.find((o) => o.value === value)?.label.split(' · ').pop() ?? value;

function CallsStep({ status, onDone, onConnect }: { status: SetupStatus; onDone: () => void; onConnect: () => void }) {
  const { tenantId, tenant } = useTenant();
  const { plan: pkg } = useAuth();
  const qc = useQueryClient();
  const dest = useDestinations();
  const groups = useList<RingGroup>('ring-groups');
  const ivrs = useList<Ivr>('ivrs');
  const people = dest.data?.extension ?? [];
  const mailboxes = dest.data?.voicemail ?? [];
  const everyoneId = groups.data?.find((g) => g.name === 'Everyone')?.id;
  const menu = ivrs.data?.find((i) => i.name === MENU_NAME) ?? null;
  const numbers = status.numbers;
  const first = numbers[0];

  // What the numbers do now, when it is one of the four simple choices.
  const current: CallPlan | null = !first
    ? null
    : first.dest_type === 'ring_group' && first.dest_target === String(everyoneId)
      ? 'everyone'
      : first.dest_type === 'extension'
        ? 'person'
        : first.dest_type === 'voicemail'
          ? 'voicemail'
          : first.dest_type === 'ivr' && menu && first.dest_target === String(menu.id)
            ? 'menu'
            : null;

  const [plan, setPlan] = useState<CallPlan | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [only, setOnly] = useState<number[] | null>(null);
  const [greetingId, setGreetingId] = useState<number | null | undefined>(undefined);
  const [keys, setKeys] = useState<MenuKey[] | null>(null);

  const chosen = plan ?? current ?? 'everyone';
  const personValue = person ?? (current === 'person' ? first!.dest_target : (people[0]?.value ?? ''));
  const mailboxValue = mailbox ?? (current === 'voicemail' ? first!.dest_target : (mailboxes[0]?.value ?? ''));
  const greeting = greetingId === undefined ? (menu?.greeting_sound_id ?? null) : greetingId;
  const menuKeys: MenuKey[] =
    keys ??
    (menu
      ? menu.options.map((o): MenuKey => {
          if (o.dest_type === 'ring_group' && o.dest_target === String(everyoneId)) return { digit: o.digit, kind: 'everyone', target: '' };
          if (o.dest_type === 'extension' || o.dest_type === 'voicemail') return { digit: o.digit, kind: o.dest_type === 'extension' ? 'person' : 'voicemail', target: o.dest_target };
          return { digit: o.digit, kind: 'other', option: o };
        })
      : [{ digit: '1', kind: 'everyone', target: '' }, ...(people[0] ? [{ digit: '2', kind: 'person' as const, target: people[0].value }] : [])]);
  const menuIncluded = !!menu || pkg?.limits.max_ivrs !== 0;

  const ready =
    numbers.length > 0 &&
    only?.length !== 0 &&
    (chosen === 'everyone' ||
      (chosen === 'person' && !!personValue) ||
      (chosen === 'voicemail' && !!mailboxValue) ||
      (chosen === 'menu' && !!greeting && menuKeys.length > 0 && menuKeys.every((k) => k.kind === 'other' || k.kind === 'everyone' || !!k.target)));

  const save = useMutation({
    mutationFn: async () => {
      let everyone: number | null = null;
      const ringEveryone = async () => {
        if (everyone === null) everyone = (await api.post<{ id: number }>(scoped('/api/setup/ring-everyone', tenantId))).id;
        return String(everyone);
      };
      let target: { dest_type: DestType; dest_target: string };
      if (chosen === 'everyone') target = { dest_type: 'ring_group', dest_target: await ringEveryone() };
      else if (chosen === 'person') target = { dest_type: 'extension', dest_target: personValue };
      else if (chosen === 'voicemail') target = { dest_type: 'voicemail', dest_target: mailboxValue };
      else {
        const options: IvrOption[] = [];
        for (const k of menuKeys) {
          if (k.kind === 'other') options.push(k.option);
          else if (k.kind === 'everyone') options.push({ digit: k.digit, dest_type: 'ring_group', dest_target: await ringEveryone() });
          else options.push({ digit: k.digit, dest_type: k.kind === 'person' ? 'extension' : 'voicemail', dest_target: k.target });
        }
        // Callers who press nothing, or a wrong key, go to the first choice instead of being cut off.
        const fallback: { dest_type: DestType; dest_target: string } = options[0] ?? { dest_type: 'hangup', dest_target: '' };
        const body = {
          ...(menu ?? { name: MENU_NAME, number: '', timeout: 5, max_retries: 3, direct_dial: true }),
          greeting_sound_id: greeting,
          options,
          ...(menu && menu.timeout_dest_type !== 'hangup'
            ? { timeout_dest_type: menu.timeout_dest_type, timeout_dest_target: menu.timeout_dest_target }
            : { timeout_dest_type: fallback.dest_type, timeout_dest_target: fallback.dest_target }),
          ...(menu && menu.invalid_dest_type !== 'hangup'
            ? { invalid_dest_type: menu.invalid_dest_type, invalid_dest_target: menu.invalid_dest_target }
            : { invalid_dest_type: fallback.dest_type, invalid_dest_target: fallback.dest_target }),
        };
        const saved = menu ? await api.put<Ivr>(scoped(`/api/ivrs/${menu.id}`, tenantId), body) : await api.post<Ivr>(scoped('/api/ivrs', tenantId), body);
        target = { dest_type: 'ivr', dest_target: String(saved.id) };
      }
      await api.post(scoped('/api/setup/routing', tenantId), { ...target, number_ids: only ?? undefined });
    },
    onSuccess: () => {
      for (const key of [['setup'], ['list'], ['dashboard'], ['account']]) void qc.invalidateQueries({ queryKey: key });
      toast.success('Saved. New calls follow it right away.');
      onDone();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!numbers.length) {
    return (
      <Notice title="Connect a number first">
        <p>Once your phone number is connected, you choose here what happens when someone calls it.</p>
        <Button size="sm" className="mt-3" onClick={onConnect}>
          Connect a number
        </Button>
      </Notice>
    );
  }

  const toggleNumber = (id: number) => {
    const ids = only ?? numbers.map((n) => n.id);
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setOnly(next.length === numbers.length ? null : next);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="When someone calls">
        {PLANS.map((p) => {
          const unavailable = p.value === 'voicemail' ? (mailboxes.length ? null : 'No extension has voicemail on') : p.value === 'menu' && !menuIncluded ? 'Not in your package' : null;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={chosen === p.value}
              disabled={!!unavailable}
              onClick={() => setPlan(p.value)}
              className={clsx(
                'flex items-start gap-3 rounded-xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50',
                chosen === p.value ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 bg-white hover:border-slate-300',
              )}
            >
              <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', chosen === p.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>{p.icon}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  {p.title}
                  {current === p.value && <Badge tone="green">Now</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{unavailable ?? p.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {chosen === 'everyone' && (
        <p className="text-sm text-slate-600">
          All {status.extensions} extensions ring together{mailboxes.length ? '. If nobody answers, the caller can leave a voicemail.' : '.'} People you add later are included when you save this again.
        </p>
      )}
      {chosen === 'person' && (
        <Field label="Who answers" className="sm:w-1/2">
          <Select value={personValue} onChange={(e) => setPerson(e.target.value)}>
            {people.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {chosen === 'voicemail' && (
        <Field label="Whose voicemail" hint="Listen on the Voicemail page, or dial *97 from that phone" className="sm:w-1/2">
          <Select value={mailboxValue} onChange={(e) => setMailbox(e.target.value)}>
            {mailboxes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {chosen === 'menu' && (
        <MenuEditor
          keys={menuKeys}
          onKeys={setKeys}
          greeting={greeting}
          onGreeting={setGreetingId}
          people={people}
          mailboxes={mailboxes}
          company={pkg?.accountName ?? tenant?.name ?? 'us'}
        />
      )}

      {numbers.length > 1 && (
        <div>
          <div className="label">For these numbers</div>
          <div className="flex flex-wrap gap-2">
            {numbers.map((n) => {
              const on = !only || only.includes(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleNumber(n.id)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[13px] transition',
                    on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-500 hover:border-slate-300',
                  )}
                >
                  {on && <Check className="size-3.5" />}
                  {n.number}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-black/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">{chosen === 'menu' && !greeting ? 'Make the greeting first: callers need to hear which key to press.' : 'You can change this any time.'}</p>
        <Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>
          Save and continue <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function MenuEditor({
  keys,
  onKeys,
  greeting,
  onGreeting,
  people,
  mailboxes,
  company,
}: {
  keys: MenuKey[];
  onKeys: (keys: MenuKey[]) => void;
  greeting: number | null;
  onGreeting: (id: number) => void;
  people: Option[];
  mailboxes: Option[];
  company: string;
}) {
  const { tenantId } = useTenant();
  const sounds = useList<Sound>('sounds');
  const [remake, setRemake] = useState(false);
  const unused = KEY_DIGITS.filter((d) => !keys.some((k) => k.digit === d));
  const setKey = (i: number, key: MenuKey) => onKeys(keys.map((k, j) => (j === i ? key : k)));
  const firstTarget = (kind: KeyKind) => (kind === 'person' ? (people[0]?.value ?? '') : kind === 'voicemail' ? (mailboxes[0]?.value ?? '') : '');

  // A greeting that matches the keys, ready to read out.
  const phrase = (k: MenuKey) =>
    k.kind === 'everyone' ? 'To talk to us' : k.kind === 'person' ? `For ${nameOf(people, k.target)}` : k.kind === 'voicemail' ? 'To leave a message' : 'For more options';
  const suggestion = `Thank you for calling ${company}. ${keys.map((k) => `${phrase(k)}, press ${k.digit}.`).join(' ')}`;

  return (
    <div className="space-y-5 rounded-xl border border-slate-200 p-4">
      <div>
        <div className="label">1. The greeting callers hear</div>
        {greeting && !remake ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-full text-sm font-medium text-slate-900">{sounds.data?.find((s) => s.id === greeting)?.name ?? 'Your greeting'}</span>
            <audio controls preload="none" src={scoped(`/api/sounds/${greeting}/audio`, tenantId)} className="h-9 min-w-0 flex-1 basis-56" />
            <Button size="sm" variant="ghost" onClick={() => setRemake(true)}>
              Change
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <GreetingMaker
              name="Main menu greeting"
              placeholder={suggestion}
              onCreated={(sound) => {
                onGreeting(sound.id);
                setRemake(false);
              }}
            />
            {!!sounds.data?.length && (
              <Field label="Or use a greeting you already have">
                <Select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    onGreeting(Number(e.target.value));
                    setRemake(false);
                  }}
                >
                  <option value="">Choose a saved greeting…</option>
                  {sounds.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="label">2. What each key does</div>
        <div className="space-y-2">
          {keys.map((k, i) => (
            <div key={k.digit} className="flex items-start gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-black/[0.04]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink-950 font-mono text-sm font-semibold text-white sm:size-9">{k.digit}</span>
              {k.kind === 'other' ? (
                <div className="min-w-0 flex-1 py-2 text-sm">
                  <DestLabel type={k.option.dest_type} target={k.option.dest_target} />
                  <p className="mt-0.5 text-xs text-slate-500">Set up on the IVR menus page</p>
                </div>
              ) : (
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <Select
                    value={k.kind}
                    aria-label={`Key ${k.digit}`}
                    onChange={(e) => {
                      const kind = e.target.value as KeyKind;
                      setKey(i, { digit: k.digit, kind, target: firstTarget(kind) });
                    }}
                  >
                    <option value="everyone">Ring everyone</option>
                    <option value="person">Ring one person</option>
                    {(mailboxes.length > 0 || k.kind === 'voicemail') && <option value="voicemail">Leave a voicemail</option>}
                  </Select>
                  {k.kind !== 'everyone' && (
                    <Select value={k.target} aria-label={`Key ${k.digit}: who`} onChange={(e) => setKey(i, { ...k, target: e.target.value })}>
                      {(k.kind === 'person' ? people : mailboxes).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              )}
              <IconButton label={`Remove key ${k.digit}`} tone="danger" onClick={() => onKeys(keys.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
          {unused.length > 0 && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => onKeys([...keys, { digit: unused[0]!, kind: 'person', target: firstTarget('person') }])}>
              Add a key
            </Button>
          )}
        </div>
        {keys[0] && <p className="mt-2 text-xs text-slate-500">Callers who press nothing go to key {keys[0].digit}.</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 4. test
function TestStep({ status, routing }: { status: SetupStatus; routing: string }) {
  const { user } = useAuth();
  const phone = usePhone();
  const disabled = phone.config && !phone.config.enabled ? phone.config.reason : null;
  const regTone = phone.reg === 'registered' ? 'green' : phone.reg === 'failed' ? 'red' : 'amber';
  const regText = phone.reg === 'registered' ? 'Your web phone is ready' : phone.reg === 'failed' ? 'Your web phone could not connect' : 'Your web phone is connecting…';

  return (
    <div className="space-y-4">
      {status.has_calls && (
        <Notice tone="success" title="Calls are working">
          Your phone system has made its first call. You are all set.
        </Notice>
      )}
      <ol className="space-y-3">
        <TestItem icon={<PhoneCall className="size-4" />} title="Call the echo test from your browser">
          <p>Dial *43 and say something: you should hear yourself back. This checks your microphone and speaker.</p>
          <div className="mt-3">
            {disabled ? (
              <Notice>{disabled}</Notice>
            ) : !user?.extensionId ? (
              <MyPhoneSetup compact />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" icon={<PhoneCall className="size-4" />} onClick={() => phone.dial('*43')}>
                  Call *43
                </Button>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <StatusDot tone={regTone} pulse={phone.reg === 'registered'} /> {regText}
                </span>
              </div>
            )}
          </div>
        </TestItem>
        <TestItem icon={<Smartphone className="size-4" />} title="Call your number from a mobile">
          {status.numbers.length ? (
            <>
              <p>{routing}.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {status.numbers.map((n) => (
                  <span key={n.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-0.5 pl-3 font-mono text-sm font-semibold text-slate-900">
                    {n.number}
                    <CopyButton value={n.number} label="Copy number" />
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p>Connect a number in step 2 first.</p>
          )}
        </TestItem>
        <TestItem icon={<Phone className="size-4" />} title="Set up desk phones and phone apps">
          <p>Each extension has step-by-step settings for desk phones (Yealink, Grandstream…) and apps like Zoiper.</p>
          <Link to="/extensions" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
            Open Extensions & phones <ArrowRight className="size-3.5" />
          </Link>
        </TestItem>
      </ol>
      {status.has_calls && (
        <div className="flex justify-end border-t border-black/[0.06] pt-4">
          <Link to="/">
            <Button variant="primary">
              Go to the dashboard <ArrowRight className="size-4" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function TestItem({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl border border-slate-200 p-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm text-slate-600">
        <p className="font-medium text-slate-900">{title}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </li>
  );
}
