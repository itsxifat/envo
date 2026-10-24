import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, BackHandler, Image, Keyboard, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Animated, { SlideInLeft, SlideInRight } from 'react-native-reanimated';
import { Check, ChevronRight, CircleAlert, CircleCheck, Clock3, FileText, Plus, ScanFace, UserRound } from 'lucide-react-native';

import { useSupportSheet } from '@/components/SupportSheet';
import { Button } from '@/components/ui/Button';
import { ChoiceTile } from '@/components/ui/ChoiceTile';
import { IconTile } from '@/components/ui/IconTile';
import { Input, type InputRef } from '@/components/ui/Input';
import { ListGroup } from '@/components/ui/ListRow';
import { Notice } from '@/components/ui/Notice';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { errorText } from '@/lib/api';
import { formatBdt } from '@/lib/format';
import { useSession, type Account, type PickedFile } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, iconStroke, radius, space } from '@/theme/tokens';
import { hasContent, MAX, OCCUPATIONS, useKycDraft, type Address, type KycDraft } from './kycDraft';
import { NidArt } from './NidArt';
import { confirmSignOut, focusField, OnboardingHeader, TextLink } from './OnboardingHeader';
import { pickFile } from './pickers';
import { useSourceSheet } from './SourceSheet';

/*
 * The registration the BTRC requires for every number: what's on the NID, the address and work, then
 * a live selfie and both sides of the NID. The same details Envo's support sends to the operator (ICC).
 * A list of the three parts comes first; straight after the email code it opens on the first part.
 */

type Part = 'start' | 'nid' | 'home' | 'photos';
const ORDER: Part[] = ['start', 'nid', 'home', 'photos'];
/** The header's step (the account and the email code were the first two). */
const STEP: Record<Part, number> = { start: 2, nid: 2, home: 3, photos: 4 };

type AddressErrors = Record<keyof Address, string | null>;
type FieldRef = RefObject<InputRef | null>;

/** Typing "14031990" shows "14/03/1990". */
function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

/** What's wrong with a date of birth typed as "14/03/1990", or null when it's fine. */
function birthProblem(dmy: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy);
  if (!m) return 'Enter your date of birth, like 14/03/1990';
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getDate() !== day || d.getMonth() !== month - 1) return "This date doesn't exist";
  if (year < 1900) return 'Check the year';
  const now = new Date();
  let age = now.getFullYear() - year;
  if (now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day)) age--;
  return age < 18 ? 'You must be 18 or older' : null;
}

function addressErrors(a: Address): AddressErrors {
  return {
    street: a.street.trim().length < 3 ? 'Enter your house and road' : null,
    city: a.city.trim().length < 2 ? 'Enter your city or district' : null,
    postcode: !/^\d{4}$/.test(a.postcode) ? 'Postcode has 4 digits' : null,
  };
}

const NO_ERRORS: AddressErrors = { street: null, city: null, postcode: null };
const none = (errors: Record<string, string | null>) => !Object.values(errors).some(Boolean);
const trimmed = (a: Address): Address => ({ street: a.street.trim(), city: a.city.trim(), postcode: a.postcode });

function inPairs<T>(list: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
  return rows;
}

export function KycScreen() {
  const { colors } = useTheme();
  const { account, config, submitKyc, refresh, signOut, liveSelfie } = useSession();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const support = useSupportSheet();
  const sources = useSourceSheet();
  // Taken live and checked by Envo (like banking apps), unless Enfinito turned the check off.
  const live = config?.selfie_check !== false;
  const { form, setForm } = useKycDraft();
  const [part, setPart] = useState<Part>(from === 'verify' ? 'nid' : 'start');
  // Parts slide in from the right going on, from the left going back; the first one just shows.
  const [forward, setForward] = useState<boolean | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [front, setFront] = useState<PickedFile | null>(null);
  const [backSide, setBackSide] = useState<PickedFile | null>(null);
  const [oneFile, setOneFile] = useState<PickedFile | null>(null);
  const [consent, setConsent] = useState(false);
  const nidRef = useRef<InputRef>(null);
  const birthRef = useRef<InputRef>(null);
  const fatherRef = useRef<InputRef>(null);
  const motherRef = useRef<InputRef>(null);
  const presentStreetRef = useRef<InputRef>(null);
  const presentCityRef = useRef<InputRef>(null);
  const presentPostcodeRef = useRef<InputRef>(null);
  const permanentStreetRef = useRef<InputRef>(null);
  const permanentCityRef = useRef<InputRef>(null);
  const permanentPostcodeRef = useRef<InputRef>(null);
  const inFlight = useRef(false);

  // The email code was just confirmed: straight into the first part (also when the route only
  // gets the word a moment after it opened).
  useEffect(() => {
    if (from === 'verify') setPart((p) => (p === 'start' ? 'nid' : p));
  }, [from]);

  const patch = (p: Partial<KycDraft>) => setForm((f) => ({ ...f, ...p }));

  const nidOk = /^(\d{10}|\d{13}|\d{17})$/.test(form.nid);
  const nidErrors = {
    nid: nidOk ? null : 'Enter your NID number: 10, 13 or 17 digits',
    birth: birthProblem(form.birth),
    father: form.father.trim().length < 2 ? "Enter your father's name" : null,
    mother: form.mother.trim().length < 2 ? "Enter your mother's name" : null,
    gender: form.gender ? null : 'Choose your gender',
  };
  const presentErrors = addressErrors(form.present);
  const permanentErrors = form.same ? NO_ERRORS : addressErrors(form.permanent);
  const occupationError = form.occupation ? null : 'Choose your occupation';
  const selfieFile: PickedFile | null = live ? (liveSelfie ? { uri: liveSelfie.uri, kind: 'image' } : null) : selfie ? { uri: selfie, kind: 'image' } : null;
  const sides = form.idMode === 'sides';
  const photoErrors = {
    selfie: selfieFile ? null : 'Take your selfie',
    front: sides && !front ? 'Add the front of your NID' : null,
    back: sides && !backSide ? 'Add the back of your NID' : null,
    one: !sides && !oneFile ? 'Add the scan of your NID' : null,
    consent: consent ? null : 'Tick the box to continue',
  };
  const ready = {
    nid: none(nidErrors),
    home: none(presentErrors) && none(permanentErrors) && !occupationError,
    photos: none(photoErrors),
  };
  const started = hasContent(form) || !!selfieFile || !!front || !!backSide || !!oneFile || consent;

  const go = (to: Part, showErrors = false) => {
    Keyboard.dismiss();
    setForward(ORDER.indexOf(to) >= ORDER.indexOf(part));
    setTried(showErrors);
    setFailed(null);
    setPart(to);
  };
  const back = () => go(part === 'photos' ? 'home' : part === 'home' ? 'nid' : 'start');

  // Only while the form shows: the live selfie opens on top of it, and back closes that as usual.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // From the list of parts, back leaves the app (signing in again picks up here).
        if (part === 'start') return false;
        // While the photos are on their way, the screen stays to show how it went.
        if (!busy) back();
        return true;
      });
      return () => sub.remove();
    }, [part, busy]),
  );

  /** The cursor goes to the first field to fix; with only a choice left, the keyboard steps aside for it. */
  const fix = (field: InputRef | null) => (field ? focusField(field) : Keyboard.dismiss());

  const next = () => {
    if (busy) return;
    // "Start" begins at the first part, "Continue" at the first one not finished.
    if (part === 'start') return go(!ready.nid ? 'nid' : !ready.home ? 'home' : 'photos');
    if (part === 'nid') {
      if (ready.nid) return go('home');
      setTried(true);
      const e = nidErrors;
      return fix(e.nid ? nidRef.current : e.birth ? birthRef.current : e.father ? fatherRef.current : e.mother ? motherRef.current : null);
    }
    if (part === 'home') {
      if (ready.home) return go('photos');
      setTried(true);
      const [p, q] = [presentErrors, permanentErrors];
      return fix(
        p.street
          ? presentStreetRef.current
          : p.city
            ? presentCityRef.current
            : p.postcode
              ? presentPostcodeRef.current
              : q.street
                ? permanentStreetRef.current
                : q.city
                  ? permanentCityRef.current
                  : q.postcode
                    ? permanentPostcodeRef.current
                    : null,
      );
    }
    setTried(true);
    if (!ready.photos) return;
    // A part skipped from the list: back to it, with what's missing marked.
    if (!ready.nid) return go('nid', true);
    if (!ready.home) return go('home', true);
    void send();
  };

  const send = async () => {
    // A second tap before the screen shows it's sending doesn't send it all again.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(null);
    setProgress(null);
    const [d, m, y] = form.birth.split('/');
    try {
      await submitKyc(
        {
          nid: form.nid,
          birth_date: `${y}-${m}-${d}`,
          gender: form.gender!,
          occupation: form.occupation!,
          present_address: trimmed(form.present),
          permanent_address: trimmed(form.same ? form.present : form.permanent),
          father_name: form.father.trim(),
          mother_name: form.mother.trim(),
        },
        live ? liveSelfie! : selfie!,
        sides ? { front: front!, back: backSide! } : { one: oneFile! },
        setProgress,
      );
      // The draft stays: if the registration comes back, the form is filled in again.
      router.replace('/your-number');
    } catch (err) {
      setFailed(errorText(err));
      // The answer may have been lost on the way although Envo took the registration: then this moves on.
      void refresh().catch(() => undefined);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // The selfie is taken live; documents can also come from the gallery or the phone's files.
  const takeSelfie = async () => {
    if (live) return router.push('/selfie');
    const f = await pickFile('camera', { selfie: true }).catch(() => null);
    if (f) setSelfie(f.uri);
  };
  const pickSide = async (title: string, set: (f: PickedFile) => void) => {
    const source = await sources.choose(title);
    const f = source ? await pickFile(source).catch(() => null) : null;
    if (f) set(f);
  };

  const titles: Record<Part, [string, string]> = {
    start: ['A few details for your number', "The BTRC requires every number to be registered in its owner's name. Keep your NID card nearby. About 4 minutes."],
    nid: ['From your NID', 'Copy these from your NID card.'],
    home: ['Address and work', 'As on the back of your NID.'],
    photos: ['Selfie and NID photos', live ? 'A live selfie and both sides of your NID.' : 'A selfie and both sides of your NID.'],
  };

  const sending = progress === null ? 'Sending your photos…' : progress < 1 ? `Sending your photos… ${Math.round(progress * 100)}%` : 'Checking…';
  const footer =
    part === 'start' ? (
      <>
        <Button title={started ? 'Continue' : 'Start'} onPress={next} block />
        <Button title="Sign out" variant="ghost" onPress={() => confirmSignOut(signOut)} block />
      </>
    ) : part === 'photos' ? (
      <>
        {failed && <Notice tone="danger" icon={CircleAlert} title={failed} />}
        <Button title={busy ? sending : 'Get my number'} icon={busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : undefined} onPress={next} block />
        {busy && (
          <Text variant="caption" tone="secondary" align="center">
            This can take a minute on a slow connection.
          </Text>
        )}
      </>
    ) : (
      <Button title="Continue" onPress={next} block />
    );

  return (
    // A new part starts at the top of the page (the old one's scroll position goes with it).
    <Screen key={part} header={<OnboardingHeader step={STEP[part]} onBack={part === 'start' || busy ? undefined : back} />} scroll keyboardFooter="hide" footer={footer}>
      <Animated.View entering={forward === null ? undefined : forward ? SlideInRight.duration(220) : SlideInLeft.duration(220)}>
        <Text variant="title" accessibilityRole="header" style={styles.title}>
          {titles[part][0]}
        </Text>
        <Text tone="secondary" style={styles.lead}>
          {titles[part][1]}
        </Text>

        {part === 'start' && (
          <View style={styles.fields}>
            <RequestNotice account={account} support={support} />
            <ListGroup>
              <ChecklistRow number={1} title="From your NID" text="NID number, date of birth, parents' names · 1 min" done={ready.nid} onPress={() => go('nid')} />
              <ChecklistRow number={2} title="Address and work" text="Where you live, your occupation · 1 min" done={ready.home} onPress={() => go('home')} />
              <ChecklistRow
                number={3}
                title="Selfie and NID photos"
                text={`${live ? 'A live selfie' : 'A selfie'} and both sides of your NID · 2 min`}
                done={ready.photos}
                onPress={() => go('photos')}
              />
            </ListGroup>
          </View>
        )}

        {part === 'nid' && (
          <View style={styles.fields}>
            <View>
              <Input
                ref={nidRef}
                label="NID number"
                value={form.nid}
                onChangeText={(v) => {
                  const nid = v.replace(/\D/g, '').slice(0, MAX.nid);
                  patch({ nid });
                  // 17 is the longest: nothing more to type here.
                  if (nid.length === MAX.nid && form.nid.length < MAX.nid) focusField(birthRef.current);
                }}
                keyboardType="number-pad"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => focusField(birthRef.current)}
                hint={form.nid.length === 0 ? '10, 13 or 17 digits' : nidOk ? undefined : `${form.nid.length} ${form.nid.length === 1 ? 'digit' : 'digits'}`}
                accessibilityHint={nidOk ? `Looks right, ${form.nid.length} digits` : undefined}
                error={tried ? nidErrors.nid : null}
              />
              {nidOk && <GoodNote text={`Looks right · ${form.nid.length} digits`} />}
            </View>
            <Input
              ref={birthRef}
              label="Date of birth"
              placeholder="DD/MM/YYYY"
              value={form.birth}
              onChangeText={(v) => {
                const birth = maskDate(v);
                patch({ birth });
                if (birth.length === MAX.birth && form.birth.length < MAX.birth && !birthProblem(birth)) focusField(fatherRef.current);
              }}
              keyboardType="number-pad"
              maxLength={MAX.birth}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusField(fatherRef.current)}
              hint="Day/month/year, like 14/03/1990"
              // A whole date is checked at once; a part of one only on Continue.
              error={tried || form.birth.length === MAX.birth ? nidErrors.birth : null}
            />
            <Input
              ref={fatherRef}
              label="Father's name"
              value={form.father}
              onChangeText={(father) => patch({ father })}
              autoCapitalize="words"
              maxLength={MAX.name}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focusField(motherRef.current)}
              error={tried ? nidErrors.father : null}
            />
            <Input
              ref={motherRef}
              label="Mother's name"
              value={form.mother}
              onChangeText={(mother) => patch({ mother })}
              autoCapitalize="words"
              maxLength={MAX.name}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              error={tried ? nidErrors.mother : null}
            />
            <ChoiceGroup label="Gender" error={tried ? nidErrors.gender : null}>
              <View style={styles.pair}>
                <ChoiceTile label="Male" selected={form.gender === 'male'} onPress={() => patch({ gender: 'male' })} style={styles.flex} />
                <ChoiceTile label="Female" selected={form.gender === 'female'} onPress={() => patch({ gender: 'female' })} style={styles.flex} />
              </View>
            </ChoiceGroup>
          </View>
        )}

        {part === 'home' && (
          <View style={styles.fields}>
            <Text variant="heading" accessibilityRole="header" style={styles.section}>
              Present address
            </Text>
            <AddressFields
              value={form.present}
              onChange={(present) => patch({ present })}
              errors={tried ? presentErrors : NO_ERRORS}
              streetRef={presentStreetRef}
              cityRef={presentCityRef}
              postcodeRef={presentPostcodeRef}
              last={form.same}
              onDone={() => (form.same ? Keyboard.dismiss() : focusField(permanentStreetRef.current))}
            />
            <SameRow value={form.same} onChange={(same) => patch({ same })} />
            {!form.same && (
              <>
                <Text variant="heading" accessibilityRole="header" style={styles.section}>
                  Permanent address
                </Text>
                <AddressFields
                  value={form.permanent}
                  onChange={(permanent) => patch({ permanent })}
                  errors={tried ? permanentErrors : NO_ERRORS}
                  streetRef={permanentStreetRef}
                  cityRef={permanentCityRef}
                  postcodeRef={permanentPostcodeRef}
                  last
                  onDone={() => Keyboard.dismiss()}
                />
              </>
            )}
            <ChoiceGroup label="Occupation" error={tried ? occupationError : null}>
              {inPairs(OCCUPATIONS).map((row) => (
                <View key={row[0]!.value} style={styles.pair}>
                  {row.map((o) => (
                    <ChoiceTile key={o.value} label={o.label} selected={form.occupation === o.value} onPress={() => patch({ occupation: o.value })} style={styles.flex} />
                  ))}
                  {row.length === 1 && <View style={styles.flex} />}
                </View>
              ))}
            </ChoiceGroup>
          </View>
        )}

        {part === 'photos' && (
          <View style={styles.fields}>
            <PhotoSlot
              art={<IconTile icon={live ? ScanFace : UserRound} tone="brand" />}
              title={live ? 'Live selfie' : 'Your photo'}
              hint={live ? 'Look at the camera, then turn your head when asked' : 'Face the camera in good light'}
              file={selfieFile}
              done={live ? 'Checked · tap to take again' : undefined}
              error={tried ? photoErrors.selfie : null}
              onPress={() => void takeSelfie()}
            />
            {sides ? (
              <>
                <PhotoSlot art={<NidArt side="front" />} title="NID, front" hint="Camera, gallery or a file" file={front} error={tried ? photoErrors.front : null} onPress={() => void pickSide('NID, front', setFront)} />
                <PhotoSlot art={<NidArt side="back" />} title="NID, back" hint="Camera, gallery or a file" file={backSide} error={tried ? photoErrors.back : null} onPress={() => void pickSide('NID, back', setBackSide)} />
              </>
            ) : (
              <PhotoSlot
                art={<IconTile icon={FileText} tone="brand" />}
                title="NID, both sides"
                hint="A scan or PDF with the front and back"
                file={oneFile}
                error={tried ? photoErrors.one : null}
                onPress={() => void pickSide('NID, both sides', setOneFile)}
              />
            )}
            <TextLink title={sides ? 'I have one scan with both sides' : 'Use two photos instead'} onPress={() => patch({ idMode: sides ? 'one' : 'sides' })} style={styles.modeLink} />
            <Consent checked={consent} onToggle={() => setConsent(!consent)} operator={config?.operator || 'the operator'} error={tried ? photoErrors.consent : null} />
          </View>
        )}
      </Animated.View>
      {sources.sheet}
      {support.sheet}
    </Screen>
  );
}

/** Why the last registration came back, when it did. */
function RequestNotice({ account, support }: { account: Account | null; support: { available: boolean; open: () => void } }) {
  const request = account?.request;
  if (!account || !request) return null;
  if (request.status === 'rejected') {
    const reason = (request.reason || 'Some details did not match your NID.').trim();
    const paid = account.balance > 0 ? ` Your ${formatBdt(account.balance)} is safe. Send your details again; there's nothing more to pay.` : '';
    return (
      <Notice
        tone="danger"
        icon={CircleAlert}
        title="We couldn't register your number"
        body={`${reason}${/[.!?]$/.test(reason) ? '' : '.'} Please check your details and send them again.${paid}`}
      />
    );
  }
  if (request.status !== 'cancelled') return null;
  // Closed because they asked to close the account, not because time ran out.
  if (account.closeRequested) {
    return <Notice tone="neutral" icon={Clock3} title="You asked to close your account. We'll be in touch." action={support.available ? { label: 'Changed your mind?', onPress: support.open } : undefined} />;
  }
  // The number was let go (no first recharge in time): nothing went wrong, a new one comes with this.
  return request.reason ? <Notice tone="neutral" icon={Clock3} title="Let's get you a new number" body={request.reason} /> : null;
}

function ChecklistRow({ number, title, text, done, onPress }: { number: number; title: string; text: string; done: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${done ? ', done' : ''}. ${text}`}
      onPress={onPress}
      style={({ pressed }) => [styles.checkRow, pressed && { backgroundColor: colors.elementPressed }]}
    >
      {/* On the grey group the number sits on white, like the icon tiles. */}
      <View style={[styles.checkNumber, { backgroundColor: done ? colors.call : colors.background }]}>
        {done ? (
          <Check size={16} color="#FFFFFF" strokeWidth={3} />
        ) : (
          <Text variant="label" maxFontSizeMultiplier={1.3} style={styles.tabular}>
            {number}
          </Text>
        )}
      </View>
      <View style={styles.flex}>
        <Text variant="bodyMedium">{title}</Text>
        <Text variant="caption" tone="secondary">
          {text}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.textTertiary} strokeWidth={iconStroke} />
    </Pressable>
  );
}

/** "Looks right": the hint of a field that is complete. */
function GoodNote({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.note} importantForAccessibility="no-hide-descendants">
      <Check size={14} color={colors.callText} strokeWidth={2.5} />
      <Text variant="caption" tone="call">
        {text}
      </Text>
    </View>
  );
}

/** The error under a choice or a photo, read out as it appears. */
function FieldError({ text }: { text: string | null | undefined }) {
  const { colors } = useTheme();
  return (
    <View accessibilityLiveRegion="polite">
      {text ? (
        <View style={styles.note}>
          <CircleAlert size={14} color={colors.danger} strokeWidth={2} style={styles.errorIcon} />
          <Text variant="caption" tone="danger" style={styles.flex}>
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ChoiceGroup({ label, error, children }: { label: string; error: string | null; children: ReactNode }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="label" importantForAccessibility="no" style={styles.groupLabel}>
        {label}
      </Text>
      <View style={styles.choices}>{children}</View>
      <FieldError text={error} />
    </View>
  );
}

interface AddressFieldsProps {
  value: Address;
  onChange: (a: Address) => void;
  errors: AddressErrors;
  streetRef: FieldRef;
  cityRef: FieldRef;
  postcodeRef: FieldRef;
  /** The postcode is the form's last field (the keyboard says "done"). */
  last: boolean;
  onDone: () => void;
}

function AddressFields({ value, onChange, errors, streetRef, cityRef, postcodeRef, last, onDone }: AddressFieldsProps) {
  return (
    <>
      <Input
        ref={streetRef}
        label="House, road and area"
        value={value.street}
        onChangeText={(street) => onChange({ ...value, street })}
        maxLength={MAX.street}
        autoCapitalize="words"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => focusField(cityRef.current)}
        error={errors.street}
      />
      <View style={styles.row}>
        <View style={styles.city}>
          <Input
            ref={cityRef}
            label="City or district"
            value={value.city}
            onChangeText={(city) => onChange({ ...value, city })}
            maxLength={MAX.city}
            autoCapitalize="words"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focusField(postcodeRef.current)}
            error={errors.city}
          />
        </View>
        <View style={styles.postcode}>
          <Input
            ref={postcodeRef}
            label="Postcode"
            value={value.postcode}
            onChangeText={(v) => {
              const postcode = v.replace(/\D/g, '').slice(0, MAX.postcode);
              onChange({ ...value, postcode });
              // All four digits: on to the next field (or the keyboard goes).
              if (postcode.length === MAX.postcode && value.postcode.length < MAX.postcode) onDone();
            }}
            keyboardType="number-pad"
            returnKeyType={last ? 'done' : 'next'}
            // Going on to the permanent address keeps the keyboard up.
            submitBehavior={last ? 'blurAndSubmit' : 'submit'}
            onSubmitEditing={onDone}
            error={errors.postcode}
          />
        </View>
      </View>
    </>
  );
}

/** "Permanent address is the same": a plain row between hairlines, so it doesn't look like a field. */
function SameRow({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Permanent address is the same"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={[styles.sameRow, { borderColor: colors.border }]}
    >
      <Text variant="bodyMedium" style={styles.flex}>
        Permanent address is the same
      </Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.brand, false: colors.track }} thumbColor="#FFFFFF" importantForAccessibility="no" />
    </Pressable>
  );
}

function PhotoSlot({ art, title, hint, file, done, error, onPress }: { art: ReactNode; title: string; hint: string; file: PickedFile | null; done?: string; error: string | null; onPress: () => void }) {
  const { colors } = useTheme();
  const missing = !file && !!error;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={file ? `Change: ${title}` : `Add: ${title}`}
        accessibilityHint={missing ? error : undefined}
        onPress={onPress}
        style={({ pressed }) => [
          styles.slot,
          file ? styles.slotFilled : styles.slotEmpty,
          { backgroundColor: pressed ? colors.element : colors.field, borderColor: file ? colors.call : missing ? colors.danger : colors.borderStrong },
        ]}
      >
        <View style={styles.slotArt}>{file?.kind === 'image' ? <Image source={{ uri: file.uri }} style={styles.thumb} /> : file ? <IconTile icon={FileText} tone="call" /> : art}</View>
        <View style={styles.slotText}>
          <Text variant="bodyMedium">{title}</Text>
          <Text variant="caption" tone={file ? 'call' : 'secondary'}>
            {file ? (done ?? `Added${file.kind === 'pdf' ? ' (PDF)' : ''} · tap to change`) : hint}
          </Text>
        </View>
        {file ? <CircleCheck size={22} color={colors.call} strokeWidth={iconStroke} /> : <Plus size={20} color={colors.textSecondary} strokeWidth={iconStroke} />}
      </Pressable>
      <FieldError text={missing ? error : null} />
    </View>
  );
}

/** The consent is the legal statement, so it reads in full-strength text. */
function Consent({ checked, onToggle, operator, error }: { checked: boolean; onToggle: () => void; operator: string; error: string | null }) {
  const { colors } = useTheme();
  const missing = !checked && !!error;
  return (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityHint={missing ? error : undefined}
        onPress={onToggle}
        style={({ pressed }) => [styles.consent, { borderColor: missing ? colors.danger : colors.borderStrong, backgroundColor: pressed ? colors.element : 'transparent' }]}
      >
        <View style={[styles.box, { borderColor: checked ? colors.brandFill : missing ? colors.danger : colors.textTertiary, backgroundColor: checked ? colors.brandFill : 'transparent' }]}>
          {checked && <Check size={14} color={colors.onBrand} strokeWidth={3} />}
        </View>
        <Text style={[styles.consentText, { color: colors.text }]}>
          These details are correct. I allow Enfinito to share them and the photos with {operator} to register my number, as the BTRC requires.
        </Text>
      </Pressable>
      <FieldError text={missing ? error : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  title: { marginTop: space.sm },
  lead: { marginTop: space.sm },
  fields: { gap: space.lg, marginTop: space.xl },
  section: { marginTop: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  city: { flex: 3 },
  postcode: { flex: 2 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  errorIcon: { marginTop: 2 },
  groupLabel: { marginBottom: space.sm },
  choices: { gap: space.sm },
  pair: { flexDirection: 'row', gap: space.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 64 },
  checkNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sameRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  slot: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: 16, borderWidth: 1.5, padding: 14 },
  slotEmpty: { borderStyle: 'dashed' },
  slotFilled: { borderStyle: 'solid' },
  slotArt: { width: 56, alignItems: 'center', justifyContent: 'center' },
  slotText: { flex: 1, gap: 2 },
  thumb: { width: 44, height: 44, borderRadius: 12 },
  modeLink: { marginTop: -space.sm },
  consent: { flexDirection: 'row', gap: space.md, borderRadius: radius.md, borderWidth: 1, padding: space.lg, alignItems: 'flex-start' },
  box: { width: 22, height: 22, borderRadius: radius.xs, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  consentText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
});
