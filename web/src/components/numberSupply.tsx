import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, CheckCircle2, Gem, Hash, Sparkles, Upload, Wallet } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatBdt, timeAgo } from '../lib/format';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import type { CustomerSupplyOptions, Invoice, NumberRequest, NumberRequestStatus, SubscriberDetails, Topup, TopupStatus } from '../lib/types';
import { PayDialog } from './billing';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Notice, SearchInput, Select, Spinner, useConfirm } from './ui';

/*
 * Numbers from Enfinito: the customer picks a free number and sends the details the operator needs
 * to register it (BTRC); Enfinito registers and connects it. Also balance top-ups for those numbers.
 */

export function useSupplyOptions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['number-supply', 'options'],
    queryFn: () => api.get<CustomerSupplyOptions>('/api/number-requests/options'),
    enabled: user?.role === 'admin',
    staleTime: 60_000,
  });
}

export function useNumberRequests(opts: { enabled?: boolean; poll?: boolean } = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['list', 'number-requests'],
    queryFn: () => api.get<NumberRequest[]>('/api/number-requests'),
    enabled: user?.role === 'admin' && (opts.enabled ?? true),
    refetchInterval: opts.poll === false ? false : 30_000,
  });
}

/** The account's numbers from Enfinito, whose calling balance the owner can top up. */
export function useTopupNumbers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['list', 'topup-numbers'],
    queryFn: () => api.get<{ id: number; number: string; tenant_name: string }[]>('/api/number-requests/topup-numbers'),
    enabled: user?.role === 'admin' && user.isOwner,
  });
}

/** How a request names its number: the special one asked for, the chosen one, or "any free number". */
export function requestLabel(r: NumberRequest): string {
  return r.connected_number || (r.special ? `Special: ${r.special}` : r.requested_number) || 'Any free number';
}

export type NumberSource = 'pool' | 'own' | 'special';

/**
 * The ways to get a phone number, as three big choices: one from Enfinito, your own, or a special one.
 * Without number supply only "your own" exists, so callers show the connect form directly instead.
 */
export function NumberChoice({ onChoose }: { onChoose: (source: NumberSource) => void }) {
  const supply = useSupplyOptions();
  const { plan, user } = useAuth();
  // The package has no room for another number: say so now, not after a long registration form.
  if (supply.data?.room === 0) {
    const limit = plan?.limits.max_dids ?? 0;
    return (
      <Notice tone="warn" title={`${plan?.package?.name ?? 'Your package'} includes ${limit === 1 ? 'one number' : `${limit} numbers`}`}>
        <p>
          {limit === 1 ? 'It is' : 'They are all'} already in use or on the way. For another number, move to a package with more numbers
          {user?.isOwner ? '' : ' (the account owner can do that)'}, or contact us.
        </p>
        {user?.isOwner && (
          <Link to="/billing" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-amber-900 underline-offset-2 hover:underline">
            See packages <ArrowRight className="size-3.5" />
          </Link>
        )}
      </Notice>
    );
  }
  const options: { value: NumberSource; icon: ReactNode; title: string; desc: string; primary?: boolean }[] = [
    { value: 'pool', icon: <Sparkles className="size-5" />, title: 'Get a number from us', desc: 'Choose one from our list. We register it in your name and connect it for you.', primary: true },
    { value: 'own', icon: <Hash className="size-5" />, title: 'Use my own number', desc: 'Already bought one from an IP phone provider? Connect it in a minute.' },
    { value: 'special', icon: <Gem className="size-5" />, title: 'Apply for a special number', desc: 'An easy number to remember, like one ending in 7777. We check if it is free.' },
  ];
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChoose(o.value)}
          className={clsx(
            'group flex flex-col gap-3 rounded-2xl border p-4 text-left transition',
            o.primary ? 'border-brand-500 bg-brand-50/50 ring-3 ring-brand-500/10 hover:bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60',
          )}
        >
          <span className={clsx('flex size-10 items-center justify-center rounded-xl', o.primary ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}>{o.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-tight text-slate-950">{o.title}</span>
            <span className="mt-1 block text-[13px] text-slate-500">{o.desc}</span>
          </span>
          <span className={clsx('inline-flex items-center gap-1 text-[13px] font-medium', o.primary ? 'text-brand-700' : 'text-slate-600 group-hover:text-slate-900')}>
            {o.value === 'own' ? 'Connect it' : o.value === 'special' ? 'Apply' : 'Choose a number'} <ArrowRight className="size-3.5" />
          </span>
        </button>
      ))}
    </div>
  );
}

export const REQUEST_STATUS: Record<NumberRequestStatus, { tone: 'blue' | 'amber' | 'green' | 'red' | 'gray'; label: string }> = {
  submitted: { tone: 'blue', label: 'Sent' },
  in_review: { tone: 'amber', label: 'Being registered' },
  connected: { tone: 'green', label: 'Connected' },
  rejected: { tone: 'red', label: 'Not approved' },
  cancelled: { tone: 'gray', label: 'Cancelled' },
};

export const isOpenRequest = (r: NumberRequest) => r.status === 'submitted' || r.status === 'in_review';

const MAX_FILE = 5 * 1024 * 1024;

type Address = SubscriberDetails['present_address'];
type FormState = Omit<SubscriberDetails, 'gender' | 'occupation'> & { gender: SubscriberDetails['gender'] | ''; occupation: SubscriberDetails['occupation'] | '' };

const emptyAddress = (): Address => ({ street: '', city: '', postcode: '', country: 'Bangladesh' });

const OCCUPATIONS: { value: SubscriberDetails['occupation']; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'private_service', label: 'Private service' },
  { value: 'government_service', label: 'Government service' },
  { value: 'student', label: 'Student' },
  { value: 'other', label: 'Other' },
];

/** What is still missing before the form can be sent (plain labels). */
function missingFields(f: FormState, same: boolean, photo: File | null, idDoc: File | null, consent: boolean): string[] {
  const out: string[] = [];
  const addressDone = (a: Address) => a.street.trim().length >= 3 && a.city.trim().length >= 2 && a.postcode.trim().length >= 3;
  if (f.name.trim().length < 2) out.push(f.subscriber_type === 'organization' ? 'organization name' : 'full name');
  if (f.subscriber_type === 'organization' && f.authorized_person.trim().length < 2) out.push('authorized person');
  if (!/^(\d{10}|\d{13}|\d{17})$/.test(f.nid.trim())) out.push('NID number');
  if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(f.phone.replace(/[\s-]/g, ''))) out.push('mobile number');
  if (!/\S+@\S+\.\S+/.test(f.email)) out.push('email');
  if (!f.birth_date) out.push('date of birth');
  if (!f.gender) out.push('gender');
  if (!f.occupation) out.push('occupation');
  if (!addressDone(f.present_address)) out.push('present address');
  if (!same && !addressDone(f.permanent_address)) out.push('permanent address');
  if (f.father_name.trim().length < 2) out.push("father's name");
  if (f.mother_name.trim().length < 2) out.push("mother's name");
  if (!photo) out.push('photo');
  if (!idDoc) out.push('NID or passport scan');
  if (!consent) out.push('your agreement');
  return out;
}

function FilePick({ label, hint, accept, file, onFile }: { label: string; hint: string; accept: string; file: File | null; onFile: (f: File | null) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 px-4 py-3 transition hover:border-brand-400 hover:bg-brand-50/40">
      {file ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : <Upload className="size-5 shrink-0 text-slate-400" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-700">{file ? file.name : label}</span>
        <span className="block text-xs text-slate-500">
          {file ? `${file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`} · tap to change` : hint}
        </span>
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f && f.size > MAX_FILE) {
            toast.error('That file is larger than 5 MB. Take a smaller photo or scan.');
            return;
          }
          onFile(f);
        }}
      />
    </label>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <Field label="Street address" className="sm:col-span-6">
        <Input value={value.street} onChange={(e) => onChange({ ...value, street: e.target.value })} placeholder="House 12, Road 5, Dhanmondi" maxLength={200} />
      </Field>
      <Field label="City" className="sm:col-span-3">
        <Input value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} placeholder="Dhaka" maxLength={60} />
      </Field>
      <Field label="Postcode" className="sm:col-span-3">
        <Input value={value.postcode} onChange={(e) => onChange({ ...value, postcode: e.target.value })} placeholder="1209" maxLength={10} inputMode="numeric" />
      </Field>
    </div>
  );
}

/**
 * "Get a new number": choose a number (or, for a special one, say which), fill in the registration,
 * send.
 */
export function GetNumberModal({ onClose, special = false }: { onClose: () => void; special?: boolean }) {
  const { user } = useAuth();
  const { tenants, tenantId } = useTenant();
  const qc = useQueryClient();
  const options = useSupplyOptions();
  const operator = options.data?.operator_name ?? 'the operator';
  const [step, setStep] = useState<'choose' | 'details' | 'done'>('choose');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: number; number: string } | 'any' | null>(null);
  const [wish, setWish] = useState('');
  const [server, setServer] = useState<number | null>(tenantId);
  const [form, setForm] = useState<FormState>(() => ({
    subscriber_type: 'individual',
    name: '',
    authorized_person: '',
    nid: '',
    passport: '',
    phone: '',
    email: user?.email ?? '',
    birth_date: '',
    gender: '',
    occupation: '',
    present_address: emptyAddress(),
    permanent_address: emptyAddress(),
    billing_address: 'present',
    father_name: '',
    mother_name: '',
    spouse_name: '',
  }));
  const [same, setSame] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pool = useQuery({
    queryKey: ['number-supply', 'pool', q],
    queryFn: () => api.get<{ id: number; number: string }[]>(`/api/number-requests/pool?q=${encodeURIComponent(q)}`),
    enabled: step === 'choose' && !special,
  });

  const missing = missingFields(form, same, photo, idDoc, consent);
  const send = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('tenant_id', String(server ?? ''));
      body.append('pool_id', !special && picked && picked !== 'any' ? String(picked.id) : '');
      body.append('special', special ? wish.trim() : '');
      body.append('details', JSON.stringify({ ...form, permanent_address: same ? form.present_address : form.permanent_address }));
      body.append('consent', String(consent));
      body.append('photo', photo!);
      body.append('id_document', idDoc!);
      return api.post<{ id: number; number: string }>('/api/number-requests', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['list', 'number-requests'] });
      void qc.invalidateQueries({ queryKey: ['number-supply'] });
      setStep('done');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const chosen = special ? wish.trim() : picked === 'any' ? 'any free number' : (picked?.number ?? '');
  const serverName = tenants.find((t) => t.id === server)?.name ?? 'your phone system';

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={step === 'done' ? (special ? 'Application sent' : 'Request sent') : step === 'choose' ? (special ? 'Apply for a special number' : 'Choose your number') : 'Register the number'}
      description={
        step === 'details' ? `${operator} needs these details to register ${special ? 'the number' : chosen} in your name, as the BTRC requires.` : undefined
      }
      footer={
        step === 'choose' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={special ? wish.trim().length < 3 : !picked} onClick={() => setStep('details')}>
              Next
            </Button>
          </>
        ) : step === 'details' ? (
          <>
            <Button onClick={() => setStep('choose')}>Back</Button>
            <Button variant="primary" loading={send.isPending} disabled={missing.length > 0 || !server} onClick={() => send.mutate()}>
              Send request
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      {step === 'choose' && special && (
        <div className="space-y-4">
          <Field label="Which number would you like?" hint="The whole number, or the digits it should end with">
            <Input value={wish} onChange={(e) => setWish(e.target.value)} placeholder="e.g. 09639437777, or ending in 7777" maxLength={80} autoFocus />
          </Field>
          <Notice>Special numbers can cost extra. We check with {operator} that it is free, and tell you the price (if any) before we register it.</Notice>
        </div>
      )}

      {step === 'choose' && !special && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setPicked('any')}
            className={clsx(
              'flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition',
              picked === 'any' ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300',
            )}
          >
            <span>
              <span className="block text-sm font-medium text-slate-900">Any free number is fine</span>
              <span className="block text-xs text-slate-500">We pick one for you</span>
            </span>
            {picked === 'any' && <Check className="size-4 text-brand-600" />}
          </button>
          <Field label="Or choose one" hint="Type digits you like, for example 786">
            <SearchInput value={q} onChange={(v) => setQ(v.replace(/\D/g, ''))} placeholder="Search digits" className="sm:max-w-none" />
          </Field>
          {pool.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : pool.data?.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {pool.data.map((n) => {
                const on = picked !== 'any' && picked?.id === n.id;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setPicked(n)}
                    className={clsx(
                      'rounded-xl border px-3 py-2.5 font-mono text-[15px] font-semibold transition',
                      on ? 'border-brand-500 bg-brand-50 text-brand-800 ring-3 ring-brand-500/10' : 'border-slate-200 text-slate-800 hover:border-slate-300',
                    )}
                  >
                    {n.number}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
              {q ? 'No free number has those digits. Try others.' : 'No numbers to choose from right now. Pick "Any free number" and we find one for you.'}
            </p>
          )}
        </div>
      )}

      {step === 'details' && (
        <div className="space-y-6">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Who the number is for">
            {[
              { value: 'individual' as const, title: 'A person', desc: 'Registered in your own name' },
              { value: 'organization' as const, title: 'An organization', desc: 'A company, signed for by one person' },
            ].map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={form.subscriber_type === o.value}
                onClick={() => set('subscriber_type', o.value)}
                className={clsx(
                  'rounded-xl border p-3 text-left transition',
                  form.subscriber_type === o.value ? 'border-brand-500 bg-brand-50/60 ring-3 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <span className="block text-sm font-medium text-slate-900">{o.title}</span>
                <span className="block text-xs text-slate-500">{o.desc}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={form.subscriber_type === 'organization' ? 'Organization name' : 'Full name (as on the NID)'} className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} />
            </Field>
            {form.subscriber_type === 'organization' && (
              <Field label="Authorized person" hint="Who signs for the organization; the NID below is theirs" className="sm:col-span-2">
                <Input value={form.authorized_person} onChange={(e) => set('authorized_person', e.target.value)} maxLength={100} />
              </Field>
            )}
            <Field label="NID number" hint="10, 13 or 17 digits">
              <Input value={form.nid} onChange={(e) => set('nid', e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={17} />
            </Field>
            <Field label="Passport number (optional)">
              <Input value={form.passport} onChange={(e) => set('passport', e.target.value.replace(/[^A-Za-z0-9]/g, ''))} maxLength={20} />
            </Field>
            <Field label="Date of birth">
              <Input type="date" value={form.birth_date} onChange={(e) => set('birth_date', e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gender">
                <Select value={form.gender} onChange={(e) => set('gender', e.target.value as FormState['gender'])}>
                  <option value="">Choose…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </Select>
              </Field>
              <Field label="Occupation">
                <Select value={form.occupation} onChange={(e) => set('occupation', e.target.value as FormState['occupation'])}>
                  <option value="">Choose…</option>
                  {OCCUPATIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Mobile number">
              <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="01712345678" inputMode="tel" maxLength={16} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={120} />
            </Field>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">Present address</p>
            <AddressFields value={form.present_address} onChange={(a) => set('present_address', a)} />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="size-4 rounded border-slate-300" />
              The permanent address is the same
            </label>
            {!same && (
              <>
                <p className="pt-1 text-sm font-semibold text-slate-900">Permanent address</p>
                <AddressFields value={form.permanent_address} onChange={(a) => set('permanent_address', a)} />
              </>
            )}
            {!same && (
              <Field label="Send bills to" className="sm:w-1/2">
                <Select value={form.billing_address} onChange={(e) => set('billing_address', e.target.value as FormState['billing_address'])}>
                  <option value="present">Present address</option>
                  <option value="permanent">Permanent address</option>
                </Select>
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Father's name">
              <Input value={form.father_name} onChange={(e) => set('father_name', e.target.value)} maxLength={100} />
            </Field>
            <Field label="Mother's name">
              <Input value={form.mother_name} onChange={(e) => set('mother_name', e.target.value)} maxLength={100} />
            </Field>
            <Field label="Spouse's name (optional)">
              <Input value={form.spouse_name} onChange={(e) => set('spouse_name', e.target.value)} maxLength={100} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FilePick label="Photo of the person" hint="A clear face photo · JPG or PNG, up to 5 MB" accept="image/jpeg,image/png,image/webp" file={photo} onFile={setPhoto} />
            <FilePick label="NID or passport" hint="Both sides in one photo, or a PDF · up to 5 MB" accept="image/jpeg,image/png,image/webp,application/pdf" file={idDoc} onFile={setIdDoc} />
          </div>

          {tenants.length > 1 && (
            <Field label="Connect it to" className="sm:w-1/2">
              <Select value={server ?? ''} onChange={(e) => setServer(Number(e.target.value))}>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3.5 text-sm text-slate-700">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded border-slate-300" />
            <span>
              I confirm these details are correct, and I allow Enfinito to share them, the photo and the ID document with {operator} to register this number.
            </span>
          </label>
          {missing.length > 0 && <p className="text-xs text-slate-500">Still needed: {missing.join(', ')}.</p>}
        </div>
      )}

      {step === 'done' && (
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-500" />
          <div className="text-sm text-slate-600">
            <p className="text-[15px] font-semibold text-slate-900">
              We have your {special ? 'application' : 'request'} for {chosen}
            </p>
            <p className="mt-1">
              {special
                ? `We check with ${operator} that it is free and tell you the price, if any. Then we register it and connect it to ${serverName}.`
                : `We register it with ${operator} and connect it to ${serverName}. This usually takes one working day.`}{' '}
              You can follow it on the Phone numbers page.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The customer's requests that are open, or closed in the last 30 days. */
export function NumberRequestsCard({ requests }: { requests: NumberRequest[] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const cancel = useMutation({
    mutationFn: (id: number) => api.post(`/api/number-requests/${id}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['list', 'number-requests'] });
      toast.success('Request cancelled');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const recent = requests.filter((r) => isOpenRequest(r) || Date.now() - new Date(r.updated_at).getTime() < 30 * 86_400_000);
  if (!recent.length) return null;
  return (
    <Card className="mb-4 overflow-hidden sm:mb-6">
      <CardHeader title="Your number requests" description="Numbers you asked Enfinito for" />
      <ul className="divide-y divide-slate-100">
        {recent.map((r) => {
          const st = REQUEST_STATUS[r.status];
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
              {r.connected_number || (r.requested_number && !r.special) ? (
                <span className="font-mono text-[15px] font-semibold text-slate-900">{r.connected_number || r.requested_number}</span>
              ) : (
                <span className="text-sm font-semibold text-slate-900">{requestLabel(r)}</span>
              )}
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
              <span className="text-xs text-slate-500">
                {[r.subscriber_name, r.tenant_name, timeAgo(r.created_at)].filter(Boolean).join(' · ')}
              </span>
              {isOpenRequest(r) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  loading={cancel.isPending && cancel.variables === r.id}
                  onClick={async () => {
                    if (await confirm({ title: 'Cancel this request?', message: 'We stop registering the number, and your ID details are deleted.', confirmLabel: 'Cancel request', danger: true })) cancel.mutate(r.id);
                  }}
                >
                  Cancel
                </Button>
              )}
              {r.status === 'rejected' && r.reason && <p className="w-full text-xs text-rose-700">{r.reason}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const TOPUP_STATUS: Record<TopupStatus, { tone: 'amber' | 'blue' | 'green' | 'gray'; label: string }> = {
  awaiting_payment: { tone: 'amber', label: 'Waiting for payment' },
  paid: { tone: 'blue', label: 'Paid, being added' },
  applied: { tone: 'green', label: 'Added' },
  cancelled: { tone: 'gray', label: 'Cancelled' },
};

/**
 * Billing → calling balance (#balance): top up any number from Enfinito, and see what happened to
 * recent top-ups. Owners only, like the rest of Billing.
 */
export function BalanceCard() {
  const supply = useSupplyOptions();
  const numbers = useTopupNumbers();
  const history = useQuery({ queryKey: ['account', 'topups'], queryFn: () => api.get<Topup[]>('/api/number-requests/topups') });
  const [topup, setTopup] = useState<{ id: number; number: string } | null>(null);
  const { hash } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const ready = !!supply.data && !!numbers.data;

  // Linked as /billing#balance (the dashboard's "Top up"): scroll here once it has loaded.
  useEffect(() => {
    if (ready && hash === '#balance') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [ready, hash]);

  if (!supply.data?.topup.enabled) return null;
  const list = numbers.data ?? [];
  const recent = (history.data ?? []).slice(0, 5);
  return (
    <div ref={ref} id="balance" className="mb-5 scroll-mt-4">
      <Card className="overflow-hidden">
        <CardHeader title="Calling balance" description="Top up the numbers you got from us. We add the balance as soon as the payment is confirmed." />
        {list.length ? (
          <ul className="divide-y divide-slate-100">
            {list.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                <span className="font-mono text-[15px] font-semibold text-slate-900">{n.number}</span>
                <span className="text-xs text-slate-500">{n.tenant_name}</span>
                <Button size="sm" variant="primary" className="ml-auto" icon={<Wallet className="size-3.5" />} onClick={() => setTopup(n)}>
                  Top up
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
            <p className="text-sm text-slate-600">You can top up numbers you get from us. You have none yet.</p>
            {supply.data.enabled && (
              <Link to="/numbers?add=1">
                <Button size="sm" icon={<Sparkles className="size-3.5" />}>
                  Get a number
                </Button>
              </Link>
            )}
          </div>
        )}
        {recent.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
            <p className="mb-2 text-xs font-medium text-slate-500">Recent top-ups</p>
            <ul className="space-y-1.5">
              {recent.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono text-slate-800">{t.number}</span>
                  <span className="font-medium text-slate-900 tabular-nums">{formatBdt(t.amount)}</span>
                  <Badge tone={TOPUP_STATUS[t.status].tone} dot>
                    {TOPUP_STATUS[t.status].label}
                  </Badge>
                  <span className="text-xs text-slate-500">{timeAgo(t.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      {topup && <TopupDialog numberId={topup.id} number={topup.number} onClose={() => setTopup(null)} />}
    </div>
  );
}

/** Add calling balance to a number from Enfinito: choose an amount, then pay it like any invoice. */
export function TopupDialog({ numberId, number, onClose }: { numberId: number; number: string; onClose: () => void }) {
  const qc = useQueryClient();
  const options = useSupplyOptions();
  const t = options.data?.topup;
  const [preset, setPreset] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const value = custom ? Number(custom) : (preset ?? t?.presets[1] ?? t?.presets[0] ?? 0);
  const create = useMutation({
    mutationFn: () => api.post<Invoice>('/api/number-requests/topups', { number_id: numberId, amount: value }),
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: ['account'] });
      setInvoice(inv);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (invoice) return <PayDialog invoice={invoice} onClose={onClose} />;
  const valid = !!t && value >= t.min && value <= t.max;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Top up ${number}`}
      description="Add calling balance to this number"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
            Continue to payment
          </Button>
        </>
      }
    >
      {!t ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {t.presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPreset(p);
                  setCustom('');
                }}
                className={clsx(
                  'rounded-xl border px-3 py-2.5 text-sm font-semibold transition',
                  !custom && value === p ? 'border-brand-500 bg-brand-50 text-brand-800 ring-3 ring-brand-500/10' : 'border-slate-200 text-slate-800 hover:border-slate-300',
                )}
              >
                {formatBdt(p)}
              </button>
            ))}
          </div>
          <Field label="Or another amount (BDT)" hint={`From ${formatBdt(t.min)} to ${formatBdt(t.max)}`}>
            <Input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 7))} inputMode="numeric" placeholder="e.g. 300" />
          </Field>
          <Notice>Once the payment is confirmed, we add the balance to the number, usually within a few hours.</Notice>
        </div>
      )}
    </Modal>
  );
}
