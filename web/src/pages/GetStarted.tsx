import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ListTree, Phone, PhoneCall, Plus, Rocket, Smartphone, Users, Voicemail, X } from 'lucide-react';
import { api, errorMessage, scoped } from '../lib/api';
import { useDestinations, useList } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import { usePhone } from '../phone/PhoneProvider';
import type { DestType, Destinations, Extension, Ivr, IvrOption, NumberRequest, Option, RingGroup, Sound } from '../lib/types';
import { ConnectNumberForm, LineProgress, useSetupStatus, type LineState, type SetupStatus } from '../components/connectNumber';
import { GreetingMaker } from '../components/greeting';
import { MyPhoneSetup } from '../components/people';
import { DestLabel } from '../components/DestinationPicker';
import { GetNumberModal, NumberChoice, REQUEST_STATUS, isOpenRequest, requestLabel, useNumberRequests, useSupplyOptions, type NumberSource } from '../components/numberSupply';
import { Badge, Button, Card, CopyButton, ErrorBlock, Field, IconButton, Input, LoadingBlock, Notice, PageHeader, Select, StatusDot, Stepper } from '../components/ui';

/*
 * The guided setup, one question at a time: the phone number (from Enfinito, the customer's own, or a
 * special one), the team, where calls go, and a test call. Envo does the technical part. Each step has
 * its own anchor (#number #team #calls #test) so the dashboard can link straight to it.
 */

export type SetupStep = 'number' | 'team' | 'calls' | 'test';

export const SETUP_STEPS: { key: SetupStep; title: string; short: string }[] = [
  { key: 'number', title: 'Get your phone number', short: 'Number' },
  { key: 'team', title: 'Add your team', short: 'Team' },
  { key: 'calls', title: 'Choose where calls go', short: 'Calls' },
  { key: 'test', title: 'Make a test call', short: 'Test' },
];

/** Each step asks one question. */
const QUESTIONS: Record<SetupStep, { title: string; desc: string }> = {
  number: { title: 'How will customers call you?', desc: 'Choose the phone number people dial to reach you.' },
  team: { title: 'Who will take calls?', desc: 'Everyone gets an extension: a short number that rings their phone.' },
  calls: { title: 'What happens when someone calls?', desc: 'You can change this any time.' },
  test: { title: 'Make a test call', desc: 'Check that everything works.' },
};

const isStep = (v: string): v is SetupStep => SETUP_STEPS.some((s) => s.key === v);
const stepAt = (step: SetupStep, offset: number): SetupStep | null => SETUP_STEPS[SETUP_STEPS.findIndex((s) => s.key === step) + offset]?.key ?? null;

const TEAM_KEY = 'envo.setup.team';
// Earlier versions remembered "just me for now" under this key.
const SOLO_KEY = 'envo.setup.solo';

/** The team step was saved for this SIP server in this browser. */
function teamConfirmed(tenantId: number | null): boolean {
  try {
    return !!tenantId && (localStorage.getItem(`${TEAM_KEY}.${tenantId}`) === '1' || localStorage.getItem(`${SOLO_KEY}.${tenantId}`) === '1');
  } catch {
    return false;
  }
}

/** How far the current SIP server is through the guide; shared with the dashboard and the menu. */
export function useSetupProgress(opts: { enabled?: boolean; poll?: boolean } = {}) {
  const { tenantId } = useTenant();
  const status = useSetupStatus(opts);
  const requests = useNumberRequests(opts);
  const [, rerender] = useState(0);
  const s = status.data;
  // A number on its way counts: the customer did their part, Enfinito does the rest.
  const waiting = (requests.data ?? []).filter((r) => isOpenRequest(r) && r.tenant_id === tenantId);
  const done: Record<SetupStep, boolean> | null = s
    ? {
        number: s.numbers.length > 0 || waiting.length > 0,
        // New servers start with an extension per person; the step is done once they have names.
        team: s.extensions > 0 && (s.named >= s.extensions || s.people > 1 || teamConfirmed(tenantId)),
        calls: s.default_dest !== null || (s.numbers.length > 0 && s.routed),
        test: s.has_calls,
      }
    : null;
  const count = done ? SETUP_STEPS.filter((st) => done[st.key]).length : 0;
  const next = done ? (SETUP_STEPS.find((st) => !done[st.key])?.key ?? null) : null;
  const confirmTeam = () => {
    try {
      localStorage.setItem(`${TEAM_KEY}.${tenantId}`, '1');
    } catch {
      /* storage unavailable */
    }
    rerender((n) => n + 1);
  };
  return { status, done, count, next, waiting, confirmTeam };
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

function routingText(status: SetupStatus, dest: Destinations | undefined, everyoneId: number | undefined): string {
  const first = status.numbers[0];
  if (!first) return status.default_dest ? destText(status.default_dest.dest_type, status.default_dest.dest_target, dest, everyoneId) : 'Connect a number first';
  if (status.numbers.some((n) => n.dest_type !== first.dest_type || n.dest_target !== first.dest_target)) return 'Your numbers ring different places';
  return destText(first.dest_type, first.dest_target, dest, everyoneId);
}

export function GetStartedPage() {
  const { tenant } = useTenant();
  const { status, done, count, next, waiting, confirmTeam } = useSetupProgress();
  const dest = useDestinations();
  const groups = useList<RingGroup>('ring-groups');
  const location = useLocation();
  const navigate = useNavigate();
  const hash = location.hash.slice(1);
  const hashStep = isStep(hash) ? hash : null;
  // null until we know which step to show.
  const [step, setStep] = useState<SetupStep | null>(hashStep);
  const top = useRef<HTMLDivElement>(null);

  // A link to a step (the dashboard's setup card) opens it.
  useEffect(() => {
    if (hashStep) setStep(hashStep);
  }, [hashStep]);

  // Otherwise the first step that is not done yet.
  useEffect(() => {
    if (step === null && done) setStep(next ?? 'test');
  }, [step, done, next]);

  const go = (target: SetupStep) => {
    setStep(target);
    void navigate({ hash: `#${target}` }, { replace: true });
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const forward = (from: SetupStep) => () => go(stepAt(from, 1) ?? 'test');
  const backFrom = (from: SetupStep) => {
    const prev = stepAt(from, -1);
    return prev ? () => go(prev) : undefined;
  };

  const s = status.data;
  const everyoneId = groups.data?.find((g) => g.name === 'Everyone')?.id;
  const current = step ?? (done ? (next ?? 'test') : 'number');
  const index = SETUP_STEPS.findIndex((st) => st.key === current);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Get started"
        icon={<Rocket className="size-5" />}
        description={`Set up ${tenant?.name ?? 'your phone system'} in a few minutes. Answer a few questions; we do the technical part.`}
      />
      {status.isLoading ? (
        <LoadingBlock />
      ) : status.error ? (
        <ErrorBlock error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        s &&
        done && (
          <div ref={top} className="scroll-mt-4">
            <StepBar current={current} done={done} onGo={go} />
            {count === SETUP_STEPS.length && (
              <Notice tone="success" title="All done. Your phone system is ready." className="mb-4">
                Come back here whenever you want to change your number, your team or where calls go.
              </Notice>
            )}
            <Card className="overflow-hidden">
              <div className="border-b border-black/[0.06] px-4 py-4 sm:px-6">
                <p className="font-mono text-[11px] font-medium tracking-[0.08em] text-slate-400 uppercase">
                  Step {index + 1} of {SETUP_STEPS.length}
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{QUESTIONS[current].title}</h2>
                <p className="mt-0.5 text-sm text-slate-500">{QUESTIONS[current].desc}</p>
              </div>
              <div className="px-4 py-5 sm:px-6">
                {current === 'number' && <NumberStep status={s} waiting={waiting} onContinue={forward('number')} />}
                {current === 'team' && (
                  <TeamStep
                    onBack={backFrom('team')}
                    onDone={() => {
                      confirmTeam();
                      forward('team')();
                    }}
                  />
                )}
                {current === 'calls' && <CallsStep status={s} onBack={backFrom('calls')} onDone={forward('calls')} />}
                {current === 'test' && <TestStep status={s} waiting={waiting.length > 0} routing={routingText(s, dest.data, everyoneId)} onBack={backFrom('test')} />}
              </div>
            </Card>
          </div>
        )
      )}
    </div>
  );
}

/** The four steps across the top: done ones ticked, any one can be opened. */
function StepBar({ current, done, onGo }: { current: SetupStep; done: Record<SetupStep, boolean>; onGo: (step: SetupStep) => void }) {
  return (
    <ol className="mb-4 grid grid-cols-4 gap-2 sm:mb-5 sm:gap-3">
      {SETUP_STEPS.map((st, i) => {
        const active = st.key === current;
        const ok = done[st.key];
        return (
          <li key={st.key}>
            <button type="button" onClick={() => onGo(st.key)} aria-current={active ? 'step' : undefined} className="group flex w-full flex-col gap-2 text-left">
              <span className={clsx('h-1.5 rounded-full transition', active ? 'bg-ink-950' : ok ? 'bg-emerald-500' : 'bg-slate-200 group-hover:bg-slate-300')} />
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                <span
                  className={clsx(
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    ok ? 'bg-emerald-500 text-white' : active ? 'bg-ink-950 text-white' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {ok ? <Check className="size-3" /> : i + 1}
                </span>
                <span className={clsx('truncate', active ? 'text-slate-950' : 'text-slate-500 group-hover:text-slate-800')}>{st.short}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepFooter({
  onBack,
  onContinue,
  label = 'Continue',
  busy,
  disabled,
  extra,
  hint,
}: {
  onBack?: () => void;
  onContinue?: () => void;
  label?: string;
  busy?: boolean;
  disabled?: boolean;
  extra?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 border-t border-black/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
            Back
          </Button>
        )}
        {extra}
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {onContinue && (
        <Button variant="primary" loading={busy} disabled={disabled} onClick={onContinue}>
          {label} <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 1. number
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

/** What happens next with the numbers on their way. */
function waitingText(waiting: NumberRequest[]): string {
  const special = waiting.filter((r) => r.special).length;
  if (special === waiting.length) {
    return `We check that your special number${special > 1 ? 's are' : ' is'} free and tell you the price, if any. Then we register ${special > 1 ? 'them' : 'it'} and connect ${special > 1 ? 'them' : 'it'} for you.`;
  }
  const many = waiting.length > 1;
  return `We register your number${many ? 's' : ''} with the operator and connect ${many ? 'them' : 'it'} for you, usually within one working day.${special ? ' For a special number we first check that it is free and tell you the price, if any.' : ''}`;
}

function NumberStep({ status, waiting, onContinue }: { status: SetupStatus; waiting: NumberRequest[]; onContinue: () => void }) {
  const supply = useSupplyOptions();
  const [source, setSource] = useState<NumberSource | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const offer = !!supply.data?.enabled;
  const numbers = status.numbers;
  const has = numbers.length > 0 || waiting.length > 0;
  const modal = (source === 'pool' || source === 'special') && (
    <GetNumberModal
      special={source === 'special'}
      onClose={() => {
        setSource(null);
        setAdding(false);
      }}
    />
  );
  const another = (
    <Button
      icon={<Plus className="size-4" />}
      onClick={() => {
        setConnected(null);
        setSource(null);
        setAdding(true);
      }}
    >
      Add another number
    </Button>
  );

  // The modal stays in one place in the tree: a request it sends changes what the step shows behind it,
  // and it must not start over then (it still has to say "Request sent").
  let body: ReactNode;
  if (connected) {
    body = (
      <>
        <LineProgress number={connected} />
        <StepFooter onContinue={onContinue} extra={another} />
      </>
    );
  } else if (has && !adding) {
    body = (
      <>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {numbers.map((n) => (
            <li key={`n${n.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="font-mono text-[15px] font-semibold text-slate-900">{n.number}</span>
              {n.label && <span className="text-sm text-slate-500">{n.label}</span>}
              <span className="ml-auto">
                <LineBadge line={n.line} />
              </span>
            </li>
          ))}
          {waiting.map((r) => (
            <li key={`r${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className={clsx('text-[15px] font-semibold text-slate-900', r.requested_number && !r.special && 'font-mono')}>{requestLabel(r)}</span>
              <span className="ml-auto">
                <Badge tone={REQUEST_STATUS[r.status].tone} dot>
                  {REQUEST_STATUS[r.status].label}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
        {waiting.length > 0 && <p className="mt-3 text-sm text-slate-600">{waitingText(waiting)} Carry on with the next steps meanwhile.</p>}
        <div className="mt-3 space-y-3 empty:hidden">
          {numbers
            .filter((n) => n.line && !n.line.shared && n.line.health === 'failing')
            .map((n) => (
              <LineProgress key={n.id} number={n.number} />
            ))}
        </div>
        <StepFooter onContinue={onContinue} extra={another} />
      </>
    );
  } else {
    // Choosing a number: the three ways, or straight to the form when Enfinito offers none.
    const own = !offer || source === 'own';
    body = (
      <>
        {own ? <ConnectNumberForm onDone={setConnected} /> : <NumberChoice onChoose={setSource} />}
        <StepFooter
          onBack={offer && source === 'own' ? () => setSource(null) : has ? () => setAdding(false) : undefined}
          hint={!has && !(offer && source === 'own') ? 'No number yet? Your team can already call each other.' : undefined}
          extra={
            !has && (
              <Button variant="ghost" onClick={onContinue}>
                Skip for now
              </Button>
            )
          }
        />
      </>
    );
  }
  return (
    <>
      {body}
      {modal}
    </>
  );
}

// ------------------------------------------------------------------ 2. team
const PLACEHOLDER_NAME = /^Extension \d+$/;

interface PersonRow {
  key: string;
  extensionId: number | null;
  number: string | null;
  name: string;
  email: string;
  /** The login that already calls from this extension. */
  login: string | null;
  /** Named or signed in to: it stays, so the count cannot go below it. */
  locked: boolean;
}

interface TeamResult {
  people: { extension_id: number; number: string; name: string; email: string; invite_url?: string; invite_status?: 'sent' | 'failed' | 'skipped' }[];
  removed: number;
}

let rowKey = 0;
const newRow = (): PersonRow => ({ key: `new${++rowKey}`, extensionId: null, number: null, name: '', email: '', login: null, locked: false });

/** "N people" or "any number of people", for what a package includes. */
const upTo = (n: number | null, one: string, many: string) => (n === null ? `any number of ${many}` : `up to ${n} ${n === 1 ? one : many}`);

function TeamStep({ onBack, onDone }: { onBack?: () => void; onDone: () => void }) {
  const { tenantId } = useTenant();
  const { user, plan } = useAuth();
  const qc = useQueryClient();
  const list = useList<Extension>('extensions');
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [count, setCount] = useState(1);
  const [result, setResult] = useState<TeamResult | null>(null);

  // One row per extension, as the server has them now (not a cached copy from before a save).
  useEffect(() => {
    if (!list.data || rows || !list.isFetchedAfterMount) return;
    const loaded = list.data.map((e): PersonRow => {
      const placeholder = PLACEHOLDER_NAME.test(e.name);
      const login = e.users?.find((u) => u.email)?.email ?? null;
      return { key: `e${e.id}`, extensionId: e.id, number: e.number, name: placeholder ? '' : e.name, email: '', login, locked: !!e.users?.length || !placeholder };
    });
    setRows(loaded.length ? loaded : [newRow()]);
    setCount(Math.max(1, loaded.length));
  }, [list.data, list.isFetchedAfterMount, rows]);

  const limit = plan?.limits.max_extensions ?? null;
  const max = Math.max(1, Math.min(limit ?? 200, 200));
  const min = Math.max(1, (rows ?? []).reduce((m, r, i) => (r.locked ? i + 1 : m), 0));
  const visible = (rows ?? []).slice(0, count);
  const resize = (n: number) => {
    setCount(n);
    setRows((rs) => {
      const out = [...(rs ?? [])];
      while (out.length < n) out.push(newRow());
      return out;
    });
  };
  const update = (key: string, patch: Partial<PersonRow>) => setRows((rs) => rs && rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const withEmail = visible.filter((r) => !r.login && r.email.trim());
  const badEmail = withEmail.some((r) => !/^\S+@\S+\.\S+$/.test(r.email.trim()));
  const noName = withEmail.some((r) => !r.name.trim());

  const save = useMutation({
    mutationFn: () =>
      api.post<TeamResult>(scoped('/api/setup/team', tenantId), {
        people: visible.map((r) => ({ extension_id: r.extensionId, name: r.name.trim(), email: r.login ? '' : r.email.trim() })),
        // People who are not coming after all: their spare extensions go.
        remove: (rows ?? []).slice(count).flatMap((r) => (r.extensionId !== null && !r.locked ? [r.extensionId] : [])),
      }),
    onSuccess: (r) => {
      for (const key of [['list'], ['setup'], ['dashboard'], ['account'], ['webphone']]) void qc.invalidateQueries({ queryKey: key });
      setRows(null);
      const sent = r.people.filter((p) => p.invite_status === 'sent').length;
      if (sent) toast.success(`We emailed ${sent === 1 ? 'one person' : `${sent} people`} a link to sign in`);
      if (r.people.some((p) => p.invite_url && p.invite_status !== 'sent')) {
        setResult(r);
        return;
      }
      toast.success('Your team is set up');
      onDone();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (result) {
    const unsent = result.people.filter((p) => p.invite_url && p.invite_status !== 'sent');
    return (
      <>
        <Notice tone="warn" title="Send these sign-in links yourself">
          {unsent.some((p) => p.invite_status === 'failed') ? 'The invitation emails could not be sent.' : 'Email is not set up yet, so nothing was sent.'} Share each link with its person
          (WhatsApp, chat…). A link works once, for 7 days.
        </Notice>
        <ul className="mt-4 space-y-3">
          {unsent.map((p) => (
            <li key={p.extension_id}>
              <p className="mb-1.5 truncate text-sm font-medium text-slate-900">
                {p.name} <span className="font-normal text-slate-500">· {p.email}</span>
              </p>
              <div className="flex items-center gap-1 rounded-[10px] border border-slate-200 bg-slate-50/70 py-1 pr-1 pl-3">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{p.invite_url}</span>
                <CopyButton value={p.invite_url!} label={`Copy the link for ${p.name}`} />
              </div>
            </li>
          ))}
        </ul>
        <StepFooter onContinue={onDone} />
      </>
    );
  }

  if (!rows) return list.error ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : <div className="skeleton h-40 rounded-xl" />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-black/[0.04]">
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-sm font-medium text-slate-900">How many people will make and take calls?</p>
          {plan?.package && (
            <p className="mt-0.5 text-[13px] text-slate-500">
              {plan.package.name} includes {upTo(limit, 'person', 'people')} and {upTo(plan.limits.max_channels, 'call', 'calls')} at the same time.
              {user?.isOwner && (
                <Link to="/billing" className="ml-1 font-medium text-brand-700 hover:text-brand-800">
                  Need more?
                </Link>
              )}
            </p>
          )}
        </div>
        <Stepper value={count} onChange={resize} min={min} max={max} label="Number of people" />
      </div>

      <div className="mt-5">
        <div className="mb-2 hidden grid-cols-[4.5rem_1fr_1fr] gap-3 px-0.5 text-xs font-medium text-slate-500 sm:grid">
          <span>Extension</span>
          <span>Name</span>
          <span>Email, to sign in (optional)</span>
        </div>
        <ul className="space-y-2">
          {visible.map((r, i) => (
            <li key={r.key} className="grid items-center gap-2 rounded-xl border border-slate-200 p-2.5 sm:grid-cols-[4.5rem_1fr_1fr] sm:gap-3 sm:border-0 sm:p-0">
              <span className="flex h-9 w-16 items-center justify-center rounded-lg bg-slate-100 font-mono text-[13px] font-semibold text-slate-700 sm:w-auto">
                {r.number ?? <span className="font-sans text-xs font-medium text-slate-500">New</span>}
              </span>
              <Input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder={i === 0 ? 'Your name' : 'Name, e.g. Front desk'} maxLength={60} aria-label={`Name of person ${i + 1}`} />
              {r.login ? (
                <span className="truncate px-0.5 text-[13px] text-slate-500">{r.login === user?.email ? 'You (signed in)' : `Signs in as ${r.login}`}</span>
              ) : (
                <Input
                  type="email"
                  value={r.email}
                  onChange={(e) => update(r.key, { email: e.target.value })}
                  placeholder="name@company.com"
                  aria-label={`Email of person ${i + 1}`}
                  invalid={!!r.email.trim() && !/^\S+@\S+\.\S+$/.test(r.email.trim())}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        With an email, a person gets a login: they make and take calls in the browser and see their own calls. We email them a link to choose a password. Without one, they use a desk
        phone or a phone app. Names can stay empty and be added later.
      </p>
      <StepFooter
        onBack={onBack}
        onContinue={() => save.mutate()}
        label="Save and continue"
        busy={save.isPending}
        disabled={badEmail || noName}
        hint={noName ? 'Add a name for everyone with an email.' : badEmail ? 'One of the emails is not complete.' : undefined}
      />
    </>
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

function CallsStep({ status, onBack, onDone }: { status: SetupStatus; onBack?: () => void; onDone: () => void }) {
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
  // What calls do now: the first number's routing, or the choice saved before any number arrived.
  const now = numbers[0] ? { dest_type: numbers[0].dest_type, dest_target: numbers[0].dest_target } : status.default_dest;

  // What the numbers do now, when it is one of the four simple choices.
  const current: CallPlan | null = !now
    ? null
    : now.dest_type === 'ring_group' && now.dest_target === String(everyoneId)
      ? 'everyone'
      : now.dest_type === 'extension'
        ? 'person'
        : now.dest_type === 'voicemail'
          ? 'voicemail'
          : now.dest_type === 'ivr' && menu && now.dest_target === String(menu.id)
            ? 'menu'
            : null;

  const [plan, setPlan] = useState<CallPlan | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [only, setOnly] = useState<number[] | null>(null);
  const [greetingId, setGreetingId] = useState<number | null | undefined>(undefined);
  const [keys, setKeys] = useState<MenuKey[] | null>(null);

  const chosen = plan ?? current ?? 'everyone';
  const personValue = person ?? (current === 'person' ? now!.dest_target : (people[0]?.value ?? ''));
  const mailboxValue = mailbox ?? (current === 'voicemail' ? now!.dest_target : (mailboxes[0]?.value ?? ''));
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
      // Every number (and numbers that arrive later) unless only some were picked.
      await api.post(scoped('/api/setup/routing', tenantId), { ...target, number_ids: only ?? undefined });
    },
    onSuccess: () => {
      for (const key of [['setup'], ['list'], ['dashboard'], ['account']]) void qc.invalidateQueries({ queryKey: key });
      toast.success(numbers.length ? 'Saved. New calls follow it right away.' : 'Saved. Your number follows it once it is connected.');
      onDone();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggleNumber = (id: number) => {
    const ids = only ?? numbers.map((n) => n.id);
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setOnly(next.length === numbers.length ? null : next);
  };

  return (
    <>
      <div className="space-y-5">
        {!numbers.length && <Notice>Your number is not connected yet. As soon as it is, its calls follow what you choose here.</Notice>}
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
            All {status.extensions} extensions ring together{mailboxes.length ? '. If nobody answers, the caller can leave a voicemail.' : '.'} People you add later ring too.
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
      </div>
      <StepFooter
        onBack={onBack}
        onContinue={() => save.mutate()}
        label="Save and continue"
        busy={save.isPending}
        disabled={!ready}
        hint={chosen === 'menu' && !greeting ? 'Make the greeting first: callers need to hear which key to press.' : undefined}
      />
    </>
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
function TestStep({ status, waiting, routing, onBack }: { status: SetupStatus; waiting: boolean; routing: string; onBack?: () => void }) {
  const { user } = useAuth();
  const phone = usePhone();
  const navigate = useNavigate();
  const disabled = phone.config && !phone.config.enabled ? phone.config.reason : null;
  const regTone = phone.reg === 'registered' ? 'green' : phone.reg === 'failed' ? 'red' : 'amber';
  const regText = phone.reg === 'registered' ? 'Your web phone is ready' : phone.reg === 'failed' ? 'Your web phone could not connect' : 'Your web phone is connecting…';

  return (
    <>
      {status.has_calls && (
        <Notice tone="success" title="Calls are working" className="mb-4">
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
            <p>{waiting ? 'Your number is on its way. Once it is connected, call it from a mobile to try it.' : 'Connect a number in step 1 first.'}</p>
          )}
        </TestItem>
        <TestItem icon={<Phone className="size-4" />} title="Set up desk phones and phone apps">
          <p>Each extension has step-by-step settings for desk phones (Yealink, Grandstream…) and apps like Zoiper.</p>
          <Link to="/extensions" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
            Open Team & phones <ArrowRight className="size-3.5" />
          </Link>
        </TestItem>
      </ol>
      <StepFooter onBack={onBack} onContinue={() => void navigate('/')} label="Go to the dashboard" />
    </>
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
