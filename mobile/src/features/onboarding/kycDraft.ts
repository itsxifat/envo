import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import * as SecureStore from 'expo-secure-store';

import { KEYS } from '@/lib/storageKeys';

/*
 * The KYC form's text fields, kept on the phone while they are filled in, so a second try (after a
 * rejection, or when the number was released) starts filled in. Photos are not kept. The session
 * deletes the draft on sign-out and once the number works.
 */

export interface Address {
  street: string;
  city: string;
  postcode: string;
}

export interface KycDraft {
  nid: string;
  /** As typed: "14/03/1990". */
  birth: string;
  gender: 'male' | 'female' | null;
  occupation: string | null;
  present: Address;
  /** The permanent address is the same as the present one. */
  same: boolean;
  permanent: Address;
  father: string;
  mother: string;
  /** The NID's two sides, or one scan with both. */
  idMode: 'sides' | 'one';
}

/** The longest each field can be: they keep the saved draft well under 2 KB. */
export const MAX = { nid: 17, birth: 10, street: 120, city: 40, postcode: 4, name: 60 } as const;

export const OCCUPATIONS = [
  { value: 'business', label: 'Business' },
  { value: 'private_service', label: 'Private job' },
  { value: 'government_service', label: 'Government job' },
  { value: 'student', label: 'Student' },
  { value: 'other', label: 'Other' },
] as const;

const noAddress: Address = { street: '', city: '', postcode: '' };

export const EMPTY_DRAFT: KycDraft = {
  nid: '',
  birth: '',
  gender: null,
  occupation: null,
  present: noAddress,
  same: true,
  permanent: noAddress,
  father: '',
  mother: '',
  idMode: 'sides',
};

const filled = (a: Address) => !!(a.street.trim() || a.city.trim() || a.postcode);

/** Something has been filled in. */
export function hasContent(d: KycDraft): boolean {
  return !!(d.nid || d.birth || d.gender || d.occupation || d.father.trim() || d.mother.trim() || filled(d.present) || (!d.same && filled(d.permanent)));
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const digits = (v: unknown, max: number) => text(v, 40).replace(/\D/g, '').slice(0, max);

/** What was read back, made safe: a field that isn't what it should be starts empty. */
function clean(raw: unknown): KycDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const address = (v: unknown): Address => {
    const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { street: text(a.street, MAX.street), city: text(a.city, MAX.city), postcode: digits(a.postcode, MAX.postcode) };
  };
  return {
    nid: digits(r.nid, MAX.nid),
    birth: text(r.birth, MAX.birth).replace(/[^\d/]/g, ''),
    gender: r.gender === 'male' || r.gender === 'female' ? r.gender : null,
    occupation: OCCUPATIONS.some((o) => o.value === r.occupation) ? (r.occupation as string) : null,
    present: address(r.present),
    same: r.same !== false,
    permanent: address(r.permanent),
    father: text(r.father, MAX.name),
    mother: text(r.mother, MAX.name),
    idMode: r.idMode === 'one' ? 'one' : 'sides',
  };
}

async function loadDraft(): Promise<KycDraft | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.kycDraft);
    return raw ? clean(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function storeDraft(d: KycDraft): Promise<void> {
  const write = hasContent(d) ? SecureStore.setItemAsync(KEYS.kycDraft, JSON.stringify(d)) : SecureStore.deleteItemAsync(KEYS.kycDraft);
  return write.catch(() => undefined);
}

/**
 * The form's state, kept as a draft: the saved one is read back once when the screen opens (unless
 * typing has already started), and every change is saved half a second after the typing stops.
 * `loaded` is false until the saved draft has been read.
 */
export function useKycDraft(): { form: KycDraft; setForm: Dispatch<SetStateAction<KycDraft>>; loaded: boolean } {
  const [form, setForm] = useState<KycDraft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadDraft().then((saved) => {
      if (!alive) return;
      // What was typed before the draft came back wins.
      if (saved) setForm((f) => (hasContent(f) ? f : saved));
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // Saving before the old draft was read would write the empty form over it.
    if (!loaded) return;
    const t = setTimeout(() => void storeDraft(form), 500);
    return () => clearTimeout(t);
  }, [form, loaded]);

  return { form, setForm, loaded };
}
