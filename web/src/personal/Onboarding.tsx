import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Camera, FileText, IdCard, MailCheck, PartyPopper, PauseCircle, ScanFace, UserRound } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatBdt } from '../lib/format';
import { toJpeg } from '../lib/images';
import { Button, Field, Input, Notice, Select, Tabs } from '../components/ui';
import { ME_KEY, formatNumber, usePhoneConfig, type PhoneMe } from './api';
import { RechargeHistory, RechargePanel } from './Recharge';
import { LiveSelfie, type CheckedSelfie } from './LiveSelfie';

const STEPS = ['Email', 'Registration', 'Activation'] as const;

/** Where the person is on the way to a working number. */
function StepBar({ step }: { step: number }) {
  return (
    <ol className="mb-8 grid grid-cols-3 gap-2" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s} className="min-w-0">
          <span className={clsx('block h-1 rounded-full', i <= step ? 'bg-brand-600' : 'bg-slate-200')} />
          <span className={clsx('mt-2 block truncate text-[12.5px] font-medium', i === step ? 'text-slate-950' : i < step ? 'text-slate-500' : 'text-slate-400')}>
            {i < step ? '✓ ' : ''}
            {s}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Frame({ step, icon, title, lede, children }: { step: number; icon: ReactNode; title: string; lede: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[560px] pt-2 pb-16">
      <StepBar step={step} />
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">{icon}</span>
      <h1 className="mt-5 text-[28px] leading-tight font-semibold tracking-[-0.025em] text-slate-950 sm:text-[32px]">{title}</h1>
      <div className="mt-2 text-[15px] leading-relaxed text-slate-500">{lede}</div>
      <div className="mt-8">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------- email
export function VerifyEmailStep({ me }: { me: PhoneMe }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [changing, setChanging] = useState(false);
  const [email, setEmail] = useState(me.email);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = useMutation({
    mutationFn: (c: string) => api.post<PhoneMe>('/api/phone/email/verify', { code: c }),
    onSuccess: (next) => qc.setQueryData(ME_KEY, next),
    onError: () => setCode(''),
  });
  const resend = useMutation({
    mutationFn: () => api.post('/api/phone/email/resend'),
    onSuccess: () => {
      setCooldown(30);
      toast.success('A new code is on its way');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const change = useMutation({
    mutationFn: () => api.put<PhoneMe>('/api/phone/email', { email }),
    onSuccess: (next) => {
      qc.setQueryData(ME_KEY, next);
      setChanging(false);
      setCooldown(30);
      toast.success(`Code sent to ${next.email}`);
    },
  });

  return (
    <Frame
      step={0}
      icon={<MailCheck className="size-6" />}
      title="Check your email"
      lede={
        <>
          We sent a 6-digit code to <span className="font-medium text-slate-900">{me.email}</span>. Enter it here to confirm your email.
        </>
      }
    >
      {changing ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <Field label="Your email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          {change.error && <Notice tone="danger">{errorMessage(change.error)}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={change.isPending}>
              Send the code here
            </Button>
            <Button variant="ghost" onClick={() => setChanging(false)}>
              Keep {me.email}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-5">
          <input
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(v);
              if (v.length === 6) verify.mutate(v);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-label="6-digit code"
            placeholder="••••••"
            className="h-16 w-full rounded-2xl bg-slate-100 text-center text-[30px] font-semibold tracking-[0.5em] text-slate-950 tabular-nums outline-none ring-brand-600 placeholder:text-slate-300 focus:bg-white focus:ring-2"
          />
          {verify.error && <Notice tone="danger">{errorMessage(verify.error)}</Notice>}
          <Button variant="primary" size="lg" className="w-full" loading={verify.isPending} disabled={code.length !== 6} onClick={() => verify.mutate(code)}>
            Confirm
          </Button>
          <p className="text-center text-[13.5px] text-slate-500">
            No email? Look in spam, or{' '}
            <button type="button" className="font-medium text-slate-900 underline underline-offset-4 disabled:no-underline disabled:opacity-50" disabled={cooldown > 0 || resend.isPending} onClick={() => resend.mutate()}>
              {cooldown ? `send again in ${cooldown}s` : 'send it again'}
            </button>
            . Wrong address?{' '}
            <button type="button" className="font-medium text-slate-900 underline underline-offset-4" onClick={() => setChanging(true)}>
              Change it
            </button>
          </p>
        </div>
      )}
    </Frame>
  );
}

// --------------------------------------------------------------------------- registration
const OCCUPATIONS = [
  ['business', 'Business'],
  ['private_service', 'Private job'],
  ['government_service', 'Government job'],
  ['student', 'Student'],
  ['other', 'Other'],
] as const;

interface Address {
  street: string;
  city: string;
  postcode: string;
}

const emptyAddress: Address = { street: '', city: '', postcode: '' };
const addressOk = (a: Address) => a.street.trim().length >= 3 && a.city.trim().length >= 2 && /^\d{4}$/.test(a.postcode);

function adult(date: string): boolean {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - 18);
  return d <= limit && d.getFullYear() > 1900;
}

/** The BTRC registration: about you, where you live, two photos, and the consent. */
export function RegistrationStep({ me }: { me: PhoneMe }) {
  const qc = useQueryClient();
  const config = usePhoneConfig();
  const [f, setF] = useState({ nid: '', birth: '', gender: '', occupation: '', father: '', mother: '' });
  const [present, setPresent] = useState<Address>(emptyAddress);
  const [same, setSame] = useState(true);
  const [permanent, setPermanent] = useState<Address>(emptyAddress);
  const [photo, setPhoto] = useState<File | null>(null);
  // Taken live and checked by Envo (like banking apps), unless Enfinito turned the check off.
  const liveMode = config.data?.selfie_check !== false;
  const [live, setLive] = useState<CheckedSelfie | null>(null);
  const [selfieOpen, setSelfieOpen] = useState(false);
  // The NID's two sides (we put them on one page for the operator), or one file that has both.
  const [idMode, setIdMode] = useState<'sides' | 'one'>('sides');
  const [idFront, setIdFront] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);
  const [idOne, setIdOne] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const errors = {
    nid: /^(\d{10}|\d{13}|\d{17})$/.test(f.nid) ? null : 'Your NID has 10, 13 or 17 digits',
    birth: !f.birth ? 'Enter your date of birth' : adult(f.birth) ? null : 'You must be 18 or older',
    gender: f.gender ? null : 'Choose one',
    occupation: f.occupation ? null : 'Choose one',
    present: addressOk(present) ? null : 'Fill in the street, city and 4-digit postcode',
    permanent: same || addressOk(permanent) ? null : 'Fill in the street, city and 4-digit postcode',
    father: f.father.trim().length >= 2 ? null : "Enter your father's name",
    mother: f.mother.trim().length >= 2 ? null : "Enter your mother's name",
    photo: (liveMode ? live : photo) ? null : liveMode ? 'Take your live selfie' : 'Add a photo of yourself',
    idFront: idMode === 'one' || idFront ? null : 'Add the front of your NID',
    idBack: idMode === 'one' || idBack ? null : 'Add the back of your NID',
    idOne: idMode === 'sides' || idOne ? null : 'Add the file with both sides of your NID',
    consent: consent ? null : 'Tick the box to continue',
  };
  const ready = !Object.values(errors).some(Boolean);
  const show = (e: string | null) => (tried ? e : null);

  const send = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.set(
        'details',
        JSON.stringify({
          nid: f.nid,
          birth_date: f.birth,
          gender: f.gender,
          occupation: f.occupation,
          present_address: present,
          permanent_address: same ? present : permanent,
          father_name: f.father.trim(),
          mother_name: f.mother.trim(),
        }),
      );
      body.set('consent', 'true');
      if (liveMode) body.set('selfie_check', live!.id);
      else body.set('photo', photo!);
      if (idMode === 'sides') {
        body.set('id_front', idFront!);
        body.set('id_back', idBack!);
      } else {
        body.set('id_document', idOne!);
      }
      return api.post<PhoneMe>('/api/phone/kyc', body);
    },
    onSuccess: (next) => {
      qc.setQueryData(ME_KEY, next);
      window.scrollTo({ top: 0 });
    },
  });

  return (
    <Frame
      step={1}
      icon={<IdCard className="size-6" />}
      title="Register your number"
      lede="The BTRC asks for these details for every phone number, as on your NID. It takes about three minutes."
    >
      {me.request?.status === 'rejected' && (
        <Notice tone="danger" title="We couldn't register your number" className="mb-6">
          {me.request.reason || 'Some details did not match your NID.'} Please check them and send again.
        </Notice>
      )}
      {/* Closed by Envo (e.g. no first recharge in time): the reason says what to do. */}
      {me.request?.status === 'cancelled' && me.request.reason && (
        <Notice tone="danger" title="Your registration was closed" className="mb-6">
          {me.request.reason}
        </Notice>
      )}
      <form
        className="space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (ready) send.mutate();
          else toast.error('Some details are missing');
        }}
      >
        <Section title="About you">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="NID number" error={show(errors.nid)}>
              <Input inputMode="numeric" value={f.nid} onChange={(e) => set('nid')(e.target.value.replace(/\D/g, '').slice(0, 17))} placeholder="10, 13 or 17 digits" invalid={!!show(errors.nid)} />
            </Field>
            <Field label="Date of birth" error={show(errors.birth)}>
              <Input type="date" value={f.birth} onChange={(e) => set('birth')(e.target.value)} max={new Date().toISOString().slice(0, 10)} invalid={!!show(errors.birth)} />
            </Field>
            <Field label="Gender" error={show(errors.gender)}>
              <div className="grid grid-cols-2 gap-2">
                {(['male', 'female'] as const).map((g) => (
                  <Chip key={g} on={f.gender === g} onClick={() => set('gender')(g)}>
                    {g === 'male' ? 'Male' : 'Female'}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Occupation" error={show(errors.occupation)}>
              <Select value={f.occupation} onChange={(e) => set('occupation')(e.target.value)}>
                <option value="">Choose…</option>
                {OCCUPATIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section title="Where you live">
          <AddressFields value={present} onChange={setPresent} error={show(errors.present)} />
          <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-[14px] text-slate-800 ring-1 ring-slate-200">
            <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="size-4 accent-brand-600" />
            My permanent address is the same
          </label>
          {!same && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-slate-700">Permanent address</p>
              <AddressFields value={permanent} onChange={setPermanent} error={show(errors.permanent)} />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Father's name" error={show(errors.father)}>
              <Input value={f.father} onChange={(e) => set('father')(e.target.value)} maxLength={100} invalid={!!show(errors.father)} />
            </Field>
            <Field label="Mother's name" error={show(errors.mother)}>
              <Input value={f.mother} onChange={(e) => set('mother')(e.target.value)} maxLength={100} invalid={!!show(errors.mother)} />
            </Field>
          </div>
        </Section>

        <Section title="Photos">
          {liveMode ? (
            <button
              type="button"
              onClick={() => setSelfieOpen(true)}
              className={clsx('flex w-full items-center gap-4 rounded-2xl p-4 text-left ring-1 transition hover:bg-slate-50', live ? 'ring-2 ring-emerald-500' : show(errors.photo) ? 'bg-rose-50/50 ring-rose-300' : 'ring-slate-200')}
            >
              {live ? (
                <img src={live.preview} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <ScanFace className="size-6" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold text-slate-950">Live selfie</span>
                <span className={clsx('block text-[12.5px]', live ? 'text-emerald-700' : show(errors.photo) ? 'text-rose-600' : 'text-slate-500')}>
                  {live ? 'Checked · click to take again' : (show(errors.photo) ?? 'Look at the camera, then turn your head when asked')}
                </span>
              </span>
              <Camera className="size-5 shrink-0 text-slate-400" />
            </button>
          ) : (
            <PhotoInput file={photo} onFile={setPhoto} icon={<UserRound className="size-6" />} title="Your photo" hint="Face the camera in good light" accept="image/*" capture="user" error={show(errors.photo)} />
          )}
          {selfieOpen && (
            <LiveSelfie
              onClose={() => setSelfieOpen(false)}
              onDone={(s) => {
                setLive(s);
                setSelfieOpen(false);
              }}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-[13px] font-medium text-slate-700">Your NID</p>
            <Tabs
              value={idMode}
              onChange={setIdMode}
              tabs={[
                { value: 'sides', label: 'Front and back' },
                { value: 'one', label: 'One file with both' },
              ]}
            />
          </div>
          {idMode === 'sides' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <PhotoInput file={idFront} onFile={setIdFront} icon={<IdCard className="size-6" />} title="NID, front" hint="Camera, gallery or a file" accept="image/*,application/pdf" error={show(errors.idFront)} />
              <PhotoInput file={idBack} onFile={setIdBack} icon={<IdCard className="size-6" />} title="NID, back" hint="Camera, gallery or a file" accept="image/*,application/pdf" error={show(errors.idBack)} />
            </div>
          ) : (
            <PhotoInput file={idOne} onFile={setIdOne} icon={<FileText className="size-6" />} title="NID, both sides" hint="A scan or PDF with the front and back" accept="image/*,application/pdf" error={show(errors.idOne)} />
          )}
          <p className="text-[12.5px] text-slate-500">All four corners in each photo, nothing covered. We put both sides on one page for the operator.</p>
        </Section>

        <label className={clsx('flex cursor-pointer gap-3 rounded-xl px-4 py-3.5 text-[13.5px] leading-relaxed ring-1', show(errors.consent) ? 'bg-rose-50 text-rose-900 ring-rose-200' : 'bg-slate-50 text-slate-700 ring-slate-200')}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand-600" />
          <span>
            These details are correct. I allow Enfinito to share them and the photos with {config.data?.operator || 'the operator'} to register my number, as the BTRC requires.
          </span>
        </label>

        {send.error && <Notice tone="danger">{errorMessage(send.error)}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={send.isPending}>
          Get my number
        </Button>
      </form>
    </Frame>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-1 text-[16px] font-semibold text-slate-950">{title}</legend>
      {children}
    </fieldset>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={clsx('h-10 rounded-xl text-[14px] font-medium ring-1 transition sm:h-9', on ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-600' : 'bg-white text-slate-800 ring-slate-200 hover:ring-slate-300')}
    >
      {children}
    </button>
  );
}

function AddressFields({ value, onChange, error }: { value: Address; onChange: (a: Address) => void; error: string | null }) {
  return (
    <div className="space-y-2">
      <Input value={value.street} onChange={(e) => onChange({ ...value, street: e.target.value })} placeholder="House, road, area" aria-label="House, road, area" maxLength={200} invalid={!!error} />
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <Input value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} placeholder="City" aria-label="City" maxLength={60} invalid={!!error} />
        <Input inputMode="numeric" value={value.postcode} onChange={(e) => onChange({ ...value, postcode: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="Postcode" aria-label="Postcode" invalid={!!error} />
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function PhotoInput({
  file,
  onFile,
  icon,
  title,
  hint,
  accept,
  capture,
  error,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  icon: ReactNode;
  title: string;
  hint: string;
  accept: string;
  /** Opens the camera straight away on phones (the selfie); without it phones offer camera, gallery or files. */
  capture?: 'user';
  error: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      className={clsx(
        'flex items-center gap-4 rounded-2xl p-4 text-left ring-1 transition hover:bg-slate-50',
        file ? 'ring-2 ring-emerald-500' : error ? 'bg-rose-50/50 ring-rose-300' : 'ring-slate-200',
      )}
    >
      {preview ? (
        <img src={preview} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
      ) : file ? (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <FileText className="size-6" />
        </span>
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold text-slate-950">{title}</span>
        <span className={clsx('block text-[12.5px]', file ? 'text-emerald-700' : error ? 'text-rose-600' : 'text-slate-500')}>{file ? 'Added · click to change' : (error ?? hint)}</span>
      </span>
      <Camera className="size-5 shrink-0 text-slate-400" />
      <input
        ref={input}
        type="file"
        accept={accept}
        capture={capture}
        className="hidden"
        onChange={async (e) => {
          const picked = e.target.files?.[0];
          if (!picked) return;
          // Photos are made upright and smaller before they are sent; a PDF goes as it is.
          const ready = await toJpeg(picked);
          if (ready.size > 10 * 1024 * 1024) return void toast.error('That file is over 10 MB. Please choose a smaller one.');
          onFile(ready);
        }}
      />
    </button>
  );
}

// ------------------------------------------------------------------------------- activation
/** The number is reserved: the first recharge activates it. */
export function ActivateStep({ me }: { me: PhoneMe }) {
  const config = usePhoneConfig();
  const groups = formatNumber(me.number).split(' ');
  // A payment waits for support's check: say so, and don't ask for another one.
  const checking = me.payment_in_review;
  return (
    <Frame
      step={2}
      icon={<PartyPopper className="size-6" />}
      title={me.number ? 'This is your number' : "We're choosing your number"}
      lede={
        checking
          ? 'Thank you for your first recharge. Your number is activated as soon as we confirm the payment.'
          : me.number
            ? 'One step left: activate it with your first recharge. All of it becomes your calling balance.'
            : 'Your registration is with us and support picks your number shortly. You can already make your first recharge.'
      }
    >
      {me.number && (
        <div className="mb-8 rounded-3xl bg-gradient-to-br from-brand-600 to-brand-950 px-6 py-7 text-white shadow-[0_24px_48px_-24px_rgb(31_87_235/0.7)]">
          <p className="text-[13px] font-medium text-white/60">Your Envo number</p>
          <p className="mt-2 flex flex-wrap gap-x-3 text-[36px] leading-none font-semibold tracking-[0.02em] tabular-nums sm:text-[44px]">
            {groups.map((g, i) => (
              <span key={i} className={i === 0 ? 'text-white/55' : undefined}>
                {g}
              </span>
            ))}
          </p>
          <p className="mt-4 text-[13px] text-white/60">Registered in your name once you activate it.{config.data?.free_onnet ? ' Calls to other Envo numbers are free.' : ''}</p>
        </div>
      )}
      <RechargeHistory inReview={checking} />
      <div className="mt-6">
        <RechargePanel first inReview={checking} />
      </div>
      <p className="mt-6 text-[13px] text-slate-500">
        {checking ? 'Once the payment is confirmed we register the number in your name, usually within a few hours.' : 'After you pay we register the number in your name, usually within a few hours.'} We email you when it's ready.
        {checking ? '' : ` Minimum first recharge: ${formatBdt(me.activation_min)}.`}
      </p>
    </Frame>
  );
}

export function PausedStep() {
  const config = usePhoneConfig();
  const s = config.data?.support;
  return (
    <div className="mx-auto max-w-[520px] py-16 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
        <PauseCircle className="size-7" />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold tracking-tight text-slate-950">Your Envo Phone is paused</h1>
      <p className="mt-2 text-[15px] text-slate-500">Calls are stopped for now. Please contact us and we'll help you get going again.</p>
      {(s?.phone || s?.email) && (
        <p className="mt-6 text-[15px] text-slate-800">
          {s.phone && (
            <a className="font-semibold underline underline-offset-4" href={`tel:${s.phone}`}>
              {s.phone}
            </a>
          )}
          {s.phone && s.email && ' · '}
          {s.email && (
            <a className="font-semibold underline underline-offset-4" href={`mailto:${s.email}`}>
              {s.email}
            </a>
          )}
        </p>
      )}
    </div>
  );
}
