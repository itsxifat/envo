import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { Contact, ContactField, ContactsSortOrder, getPermissionsAsync, requestPermissionsAsync } from 'expo-contacts';

import { formatPhone } from '@/lib/format';
import { isEnvoNumber } from '@/lib/numbers';

/*
 * The phone's own contacts, read only when the person allows it, so calls everywhere in the app show
 * a name instead of a number. They stay on the phone.
 */

export interface Person {
  id: string;
  name: string;
  /** Free Envo numbers first. */
  numbers: string[];
  envo: boolean;
}

interface ContactsValue {
  /** null until we know; false when the person has not allowed it (yet). */
  allowed: boolean | null;
  /** False once the phone won't ask again (turned down for good): only its Settings can allow it then. */
  canAskAgain: boolean;
  people: Person[];
  ask: () => Promise<void>;
  nameOf: (number: string) => string | null;
}

/** "+880 1712-345678" → "01712345678", the way numbers are dialled in Bangladesh. */
export function normalizeNumber(raw: string): string {
  let n = raw.replace(/[^\d+]/g, '');
  if (n.startsWith('+880')) n = `0${n.slice(4)}`;
  else if (n.startsWith('880') && n.length === 13) n = `0${n.slice(3)}`;
  return n;
}

const ContactsContext = createContext<ContactsValue | null>(null);

export function ContactsProvider({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);

  const load = useCallback(async () => {
    const rows = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES], { sortOrder: ContactsSortOrder.GivenName });
    setPeople(
      rows
        .map((r, i) => {
          const numbers = [...new Set((r.phones ?? []).map((p) => normalizeNumber(p.number ?? '')).filter((n) => n.length >= 3))].sort((a, b) => Number(isEnvoNumber(b)) - Number(isEnvoNumber(a)));
          return { id: String(i), name: r.fullName?.trim() || (numbers[0] ? formatPhone(numbers[0]) : 'No name'), numbers, envo: numbers.some(isEnvoNumber) };
        })
        .filter((p) => p.numbers.length > 0),
    );
  }, []);

  const check = useCallback(async () => {
    const p = await getPermissionsAsync();
    setAllowed(p.granted);
    setCanAskAgain(p.canAskAgain);
    if (p.granted) await load();
  }, [load]);

  // Contacts change while the app is in the background: read them again when it comes back.
  useEffect(() => {
    void check().catch(() => setAllowed(false));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check().catch(() => undefined);
    });
    return () => sub.remove();
  }, [check]);

  const ask = useCallback(async () => {
    const p = await requestPermissionsAsync();
    setAllowed(p.granted);
    setCanAskAgain(p.canAskAgain);
    if (p.granted) await load();
  }, [load]);

  const byNumber = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people) for (const n of p.numbers) if (!m.has(n)) m.set(n, p.name);
    return m;
  }, [people]);
  const nameOf = useCallback((number: string) => byNumber.get(normalizeNumber(number)) ?? null, [byNumber]);

  const value = useMemo<ContactsValue>(() => ({ allowed, canAskAgain, people, ask, nameOf }), [allowed, canAskAgain, people, ask, nameOf]);
  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
}

export function useContacts(): ContactsValue {
  const c = useContext(ContactsContext);
  if (!c) throw new Error('useContacts outside ContactsProvider');
  return c;
}
