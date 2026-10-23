import { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Check, IdCard, UserRound } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Input, type InputRef } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';
import { StepDots } from './StepDots';

/*
 * The registration the BTRC requires for every number, in three short steps: about you, where you
 * live, and two photos. The same details Envo's support sends to the operator (ICC).
 */

type Part = 'you' | 'home' | 'photos';

const OCCUPATIONS = [
  { value: 'business', label: 'Business' },
  { value: 'private_service', label: 'Private job' },
  { value: 'government_service', label: 'Government job' },
  { value: 'student', label: 'Student' },
  { value: 'other', label: 'Other' },
] as const;

interface Address {
  street: string;
  city: string;
  postcode: string;
}

/** "17/05/1990" → age in years, or null when it is not a real date. */
function ageFrom(dmy: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}

/** Typing "17051990" shows "17/05/1990". */
function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

const addressOk = (a: Address) => a.street.trim().length >= 3 && a.city.trim().length >= 2 && /^\d{4}$/.test(a.postcode);

export function KycScreen() {
  const { colors } = useTheme();
  const { submitKyc, signOut } = useSession();
  const [part, setPart] = useState<Part>('you');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nid, setNid] = useState('');
  const [birth, setBirth] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [occupation, setOccupation] = useState<string | null>(null);
  const [present, setPresent] = useState<Address>({ street: '', city: '', postcode: '' });
  const [same, setSame] = useState(true);
  const [permanent, setPermanent] = useState<Address>({ street: '', city: '', postcode: '' });
  const [father, setFather] = useState('');
  const [mother, setMother] = useState('');
  const [selfie, setSelfie] = useState<string | null>(null);
  const [idPhoto, setIdPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const birthRef = useRef<InputRef>(null);
  const motherRef = useRef<InputRef>(null);

  const age = ageFrom(birth);
  const youErrors = {
    nid: !/^(\d{10}|\d{13}|\d{17})$/.test(nid) ? 'Your NID has 10, 13 or 17 digits' : null,
    birth: age === null ? 'Enter it like 17/05/1990' : age < 18 ? 'You must be 18 or older' : null,
    gender: !gender ? 'Choose one' : null,
    occupation: !occupation ? 'Choose one' : null,
  };
  const homeErrors = {
    present: !addressOk(present) ? 'Fill in the street, city and 4-digit postcode' : null,
    permanent: !same && !addressOk(permanent) ? 'Fill in the street, city and 4-digit postcode' : null,
    father: father.trim().length < 2 ? "Enter your father's name" : null,
    mother: mother.trim().length < 2 ? "Enter your mother's name" : null,
  };
  const ready = { you: !Object.values(youErrors).some(Boolean), home: !Object.values(homeErrors).some(Boolean), photos: !!selfie && !!idPhoto && consent };

  const next = async () => {
    setTried(true);
    if (!ready[part]) return;
    setTried(false);
    if (part === 'you') return setPart('home');
    if (part === 'home') return setPart('photos');
    setBusy(true);
    try {
      await submitKyc();
      router.replace('/your-number');
    } finally {
      setBusy(false);
    }
  };

  // Back steps through the parts; from the first one it leaves (signing in again picks up here).
  const back = () => (part === 'photos' ? setPart('home') : part === 'home' ? setPart('you') : signOut());
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (part === 'you') return false;
      setPart(part === 'photos' ? 'home' : 'you');
      return true;
    });
    return () => sub.remove();
  }, [part]);

  const take = async (which: 'selfie' | 'id') => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    const pick = perm.granted
      ? await ImagePicker.launchCameraAsync({ cameraType: which === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back, quality: 0.7, allowsEditing: true, aspect: which === 'selfie' ? [1, 1] : [16, 10] })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true });
    if (!pick.canceled && pick.assets[0]) (which === 'selfie' ? setSelfie : setIdPhoto)(pick.assets[0].uri);
  };

  const titles: Record<Part, [string, string]> = {
    you: ['About you', 'As written on your NID.'],
    home: ['Where you live', 'Your address and your parents’ names, as on your NID.'],
    photos: ['Two photos', 'A clear photo of your face, and of the front of your NID.'],
  };

  return (
    <Screen
      key={part}
      back
      onBack={back}
      title=""
      scroll
      footer={<Button title={part === 'photos' ? 'Get my number' : 'Continue'} onPress={next} loading={busy} block />}
    >
      <StepDots step={part === 'photos' ? 2 : 1} />
      <Text variant="title" style={styles.title}>
        {titles[part][0]}
      </Text>
      <Text tone="secondary" style={styles.lead}>
        {titles[part][1]}
      </Text>

      {part === 'you' && (
        <View style={styles.fields}>
          <Input label="NID number" placeholder="10, 13 or 17 digits" value={nid} onChangeText={(v) => setNid(v.replace(/\D/g, '').slice(0, 17))} keyboardType="number-pad" returnKeyType="next" onSubmitEditing={() => birthRef.current?.focus()} error={tried ? youErrors.nid : null} />
          <Input ref={birthRef} label="Date of birth" placeholder="DD/MM/YYYY" value={birth} onChangeText={(v) => setBirth(maskDate(v))} keyboardType="number-pad" maxLength={10} error={tried ? youErrors.birth : null} />
          <View style={styles.group}>
            <Text variant="label" tone="secondary" style={styles.groupLabel}>
              Gender
            </Text>
            <View style={styles.choices}>
              {(['male', 'female'] as const).map((g) => (
                <Choice key={g} label={g === 'male' ? 'Male' : 'Female'} on={gender === g} onPress={() => setGender(g)} grow />
              ))}
            </View>
            {tried && youErrors.gender && (
              <Text variant="caption" tone="danger" style={styles.groupLabel}>
                {youErrors.gender}
              </Text>
            )}
          </View>
          <View style={styles.group}>
            <Text variant="label" tone="secondary" style={styles.groupLabel}>
              Occupation
            </Text>
            <View style={[styles.choices, styles.wrap]}>
              {OCCUPATIONS.map((o) => (
                <Choice key={o.value} label={o.label} on={occupation === o.value} onPress={() => setOccupation(o.value)} />
              ))}
            </View>
            {tried && youErrors.occupation && (
              <Text variant="caption" tone="danger" style={styles.groupLabel}>
                {youErrors.occupation}
              </Text>
            )}
          </View>
        </View>
      )}

      {part === 'home' && (
        <View style={styles.fields}>
          <AddressFields title="Present address" value={present} onChange={setPresent} error={tried ? homeErrors.present : null} />
          <View style={[styles.switchRow, { backgroundColor: colors.surface }]}>
            <Text variant="bodyMedium" style={{ flex: 1 }}>
              Permanent address is the same
            </Text>
            <Switch value={same} onValueChange={setSame} trackColor={{ true: colors.brand, false: colors.elementPressed }} thumbColor="#FFFFFF" />
          </View>
          {!same && <AddressFields title="Permanent address" value={permanent} onChange={setPermanent} error={tried ? homeErrors.permanent : null} />}
          <Input label="Father's name" value={father} onChangeText={setFather} autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => motherRef.current?.focus()} error={tried ? homeErrors.father : null} />
          <Input ref={motherRef} label="Mother's name" value={mother} onChangeText={setMother} autoCapitalize="words" returnKeyType="done" error={tried ? homeErrors.mother : null} />
        </View>
      )}

      {part === 'photos' && (
        <View style={styles.fields}>
          <PhotoSlot icon={<UserRound size={26} color={colors.brand} />} title="Your photo" hint="Face the camera in good light" uri={selfie} onPress={() => void take('selfie')} />
          <PhotoSlot icon={<IdCard size={26} color={colors.brand} />} title="Your NID, front side" hint="All four corners in the photo" uri={idPhoto} onPress={() => void take('id')} />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={[styles.consent, { backgroundColor: colors.surface }]}>
            <View style={[styles.box, { borderColor: consent ? colors.brand : colors.textTertiary, backgroundColor: consent ? colors.brand : 'transparent' }]}>
              {consent && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
            </View>
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              These details are correct. I allow Enfinito to share them and the photos with ICC Communication Ltd. to register my number, as the BTRC requires.
            </Text>
          </Pressable>
          {tried && !ready.photos && (
            <Text variant="caption" tone="danger">
              Add both photos and tick the box to continue.
            </Text>
          )}
        </View>
      )}
    </Screen>
  );
}

function Choice({ label, on, onPress, grow }: { label: string; on: boolean; onPress: () => void; grow?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.choice, grow && { flex: 1 }, { backgroundColor: on ? colors.brandSoft : colors.element, borderColor: on ? colors.brand : 'transparent' }]}
    >
      <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: on ? colors.brand : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function AddressFields({ title, value, onChange, error }: { title: string; value: Address; onChange: (a: Address) => void; error: string | null }) {
  const cityRef = useRef<InputRef>(null);
  const postcodeRef = useRef<InputRef>(null);
  return (
    <View style={styles.group}>
      <Text variant="heading">{title}</Text>
      <Input placeholder="House, road, area" value={value.street} onChangeText={(street) => onChange({ ...value, street })} returnKeyType="next" onSubmitEditing={() => cityRef.current?.focus()} />
      <View style={styles.row}>
        <View style={{ flex: 3 }}>
          <Input ref={cityRef} placeholder="City" value={value.city} onChangeText={(city) => onChange({ ...value, city })} autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => postcodeRef.current?.focus()} />
        </View>
        <View style={{ flex: 2 }}>
          <Input ref={postcodeRef} placeholder="Postcode" value={value.postcode} onChangeText={(postcode) => onChange({ ...value, postcode: postcode.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" />
        </View>
      </View>
      {error && (
        <Text variant="caption" tone="danger" style={styles.groupLabel}>
          {error}
        </Text>
      )}
    </View>
  );
}

function PhotoSlot({ icon, title, hint, uri, onPress }: { icon: React.ReactNode; title: string; hint: string; uri: string | null; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={uri ? `Retake: ${title}` : `Take: ${title}`} onPress={onPress} style={({ pressed }) => [styles.slot, { backgroundColor: pressed ? colors.elementPressed : colors.surface, borderColor: uri ? colors.call : colors.border }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} />
      ) : (
        <View style={[styles.slotIcon, { backgroundColor: colors.brandSoft }]}>{icon}</View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyMedium">{title}</Text>
        <Text variant="caption" tone={uri ? 'call' : 'secondary'}>
          {uri ? 'Added · tap to retake' : hint}
        </Text>
      </View>
      <Camera size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: space.lg },
  lead: { marginTop: space.sm },
  fields: { gap: space.lg, marginTop: space.xl },
  group: { gap: space.sm },
  groupLabel: { marginLeft: 4 },
  choices: { flexDirection: 'row', gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  choice: { height: 48, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  slot: { flexDirection: 'row', alignItems: 'center', gap: space.lg, borderRadius: radius.lg, borderWidth: 1.5, padding: space.lg },
  slotIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 56, height: 56, borderRadius: 16 },
  consent: { flexDirection: 'row', gap: space.md, borderRadius: radius.md, padding: space.lg, alignItems: 'flex-start' },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
