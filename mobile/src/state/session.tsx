import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

/*
 * The signed-in person and their phone service. For now it runs on sample data so the whole flow can
 * be designed and tried in the emulator; the same shape will come from Envo's API later. The account is
 * kept on the phone, so the app opens signed in.
 */

export type Stage =
  /** Signed up, the KYC form is next. */
  | 'kyc'
  /** KYC sent: a number is reserved and the first recharge activates it. */
  | 'activate'
  /** Paid: Enfinito registers the number with the operator. */
  | 'registering'
  /** Ready to call. */
  | 'active';

export interface Account {
  name: string;
  email: string;
  mobile: string;
  stage: Stage;
  /** The Envo number given to them, e.g. 09639437015 (reserved from KYC on). */
  number: string | null;
  balance: number;
}

export interface CallLog {
  id: string;
  name: string | null;
  number: string;
  direction: 'in' | 'out' | 'missed';
  /** Seconds talked; 0 for missed or unanswered calls. */
  duration: number;
  at: string;
  /** Between two Envo numbers: free. */
  free: boolean;
}

export interface SessionValue {
  /** False until the saved account has been read at start-up. */
  ready: boolean;
  account: Account | null;
  /** The least first recharge that activates a number (set by Enfinito in the admin). */
  minActivation: number;
  recents: CallLog[];
  /** When Recents was last opened: missed calls after it put a dot on its tab. */
  recentsSeenAt: number;
  markRecentsSeen: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (d: { name: string; email: string; mobile: string; password: string }) => Promise<void>;
  submitKyc: () => Promise<string>;
  recharge: (amount: number) => Promise<void>;
  signOut: () => void;
  addCall: (c: Omit<CallLog, 'id' | 'at'>) => void;
  /** Development only: the operator has registered the number. */
  devActivate: () => void;
}

const KEY = 'envo.session';
const SessionContext = createContext<SessionValue | null>(null);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const SAMPLE_RECENTS: CallLog[] = [
  { id: '1', name: 'Ayesha Rahman', number: '01712345678', direction: 'in', duration: 245, at: ago(12), free: false },
  { id: '2', name: 'Karim (Envo)', number: '09639437022', direction: 'out', duration: 1260, at: ago(95), free: true },
  { id: '3', name: null, number: '01987654321', direction: 'missed', duration: 0, at: ago(240), free: false },
  { id: '4', name: 'Office', number: '09612345678', direction: 'out', duration: 62, at: ago(60 * 26), free: false },
  { id: '5', name: 'Nusrat Jahan', number: '09639437041', direction: 'in', duration: 412, at: ago(60 * 50), free: true },
  { id: '6', name: 'Bright Dental', number: '01811223344', direction: 'out', duration: 0, at: ago(60 * 80), free: false },
];

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [recents, setRecents] = useState<CallLog[]>(SAMPLE_RECENTS);
  const [recentsSeenAt, setRecentsSeenAt] = useState(0);

  useEffect(() => {
    void SecureStore.getItemAsync(KEY)
      .then((raw) => {
        if (raw) setAccount(JSON.parse(raw) as Account);
      })
      .catch(() => {
        /* nothing saved, or a broken value: start signed out */
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    void (account ? SecureStore.setItemAsync(KEY, JSON.stringify(account)) : SecureStore.deleteItemAsync(KEY));
  }, [account, ready]);

  const signIn = useCallback(async (email: string, _password: string) => {
    await wait(700);
    setAccount({ name: 'Rafi Ahmed', email, mobile: '01712000111', stage: 'active', number: '09639437015', balance: 245.5 });
  }, []);

  const signUp = useCallback(async (d: { name: string; email: string; mobile: string; password: string }) => {
    await wait(800);
    setAccount({ name: d.name, email: d.email, mobile: d.mobile, stage: 'kyc', number: null, balance: 0 });
  }, []);

  const submitKyc = useCallback(async () => {
    await wait(1200);
    // A random free number from Enfinito's list.
    const number = `09639437${String(Math.floor(Math.random() * 900) + 100)}`;
    setAccount((a) => (a ? { ...a, stage: 'activate', number } : a));
    return number;
  }, []);

  const recharge = useCallback(async (amount: number) => {
    await wait(1400);
    setAccount((a) => (a ? { ...a, balance: a.balance + amount, stage: a.stage === 'activate' ? 'registering' : a.stage } : a));
  }, []);

  const signOut = useCallback(() => setAccount(null), []);
  const markRecentsSeen = useCallback(() => setRecentsSeenAt(Date.now()), []);
  const devActivate = useCallback(() => setAccount((a) => (a ? { ...a, stage: 'active' } : a)), []);

  const addCall = useCallback((c: Omit<CallLog, 'id' | 'at'>) => {
    setRecents((r) => [{ ...c, id: String(Date.now()), at: new Date().toISOString() }, ...r]);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ ready, account, minActivation: 100, recents, recentsSeenAt, markRecentsSeen, signIn, signUp, submitKyc, recharge, signOut, addCall, devActivate }),
    [ready, account, recents, recentsSeenAt, markRecentsSeen, signIn, signUp, submitKyc, recharge, signOut, addCall, devActivate],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
