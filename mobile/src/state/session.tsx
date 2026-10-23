import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { api, setToken } from '@/lib/api';

/*
 * The signed-in person and their phone service, from Envo's API (/api/phone, the same as the
 * website's personal side). The sign-in token is kept on the phone, so the app opens signed in.
 */

export type Stage =
  /** Signed up; the email code is next. */
  | 'verify'
  /** The registration (KYC) is next, or has to be sent again. */
  | 'kyc'
  /** KYC sent and a number reserved: the first recharge activates it. */
  | 'activate'
  /** Paid: Enfinito registers the number with the operator. */
  | 'registering'
  /** Ready to call. */
  | 'active'
  /** Enfinito paused the account. */
  | 'suspended';

export interface Account {
  name: string;
  email: string;
  mobile: string;
  stage: Stage;
  /** Reserved from KYC on, connected once it works; null while none is chosen. */
  number: string | null;
  balance: number;
  /** The latest registration, with support's reason when it was turned down. */
  request: { id: number; status: string; reason: string } | null;
  closeRequested: boolean;
}

export interface PhoneConfig {
  signups: boolean;
  activation_min: number;
  recharge: { min: number; max: number; presets: number[] };
  rate_per_min: number;
  free_onnet: boolean;
  support: { phone: string; email: string };
  min_app_version: string;
  update_url: string;
  operator: string;
  prefix: string;
  payment: { online: boolean; manual: boolean; manual_instructions: string };
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
  /** What it cost, BDT (calls out to other networks). */
  cost?: number | null;
}

/** What the app sends for the BTRC registration (name, mobile and email come from the account). */
export interface KycDetails {
  nid: string;
  birth_date: string;
  gender: 'male' | 'female';
  occupation: string;
  present_address: { street: string; city: string; postcode: string };
  permanent_address: { street: string; city: string; postcode: string };
  father_name: string;
  mother_name: string;
}

export type PaymentResult = 'paid' | 'review' | 'failed' | 'cancelled' | 'unknown';

/** A photo (made a JPEG in the app) or a PDF the person picked from their files. */
export interface PickedFile {
  uri: string;
  kind: 'image' | 'pdf';
}

/** The NID: its two sides (Envo puts them on one page for the operator), or one file with both. */
export type IdFiles = { front: PickedFile; back: PickedFile } | { one: PickedFile };

/** The screen each stage starts on. */
export const startOf = (stage: Stage) => (stage === 'verify' ? '/verify' : stage === 'kyc' ? '/kyc' : stage === 'suspended' ? '/paused' : '/') as '/verify' | '/kyc' | '/paused' | '/';

export interface SessionValue {
  /** False until the saved sign-in and the settings have been read at start-up. */
  ready: boolean;
  account: Account | null;
  config: PhoneConfig | null;
  /** The least first recharge that activates a number (set by Enfinito in the admin). */
  minActivation: number;
  recents: CallLog[];
  /** When Recents was last opened: missed calls after it put a dot on its tab. */
  recentsSeenAt: number;
  markRecentsSeen: () => void;
  /** Both return the stage the account is at, to know where to go next. */
  signIn: (email: string, password: string) => Promise<Stage>;
  signUp: (d: { name: string; email: string; mobile: string; password: string }) => Promise<Stage>;
  verifyEmail: (code: string) => Promise<void>;
  resendCode: () => Promise<void>;
  changeEmail: (email: string) => Promise<void>;
  submitKyc: (details: KycDetails, photo: string, id: IdFiles) => Promise<void>;
  /** Starts a recharge; pay it next with payOnline or payManual. Returns its id. */
  createRecharge: (amount: number) => Promise<number>;
  /** Opens the payment page; resolves when the person comes back to the app. */
  payOnline: (rechargeId: number) => Promise<PaymentResult>;
  /** A bKash / Nagad payment the person sent themselves, for support to check. */
  payManual: (rechargeId: number, channel: string, reference: string) => Promise<void>;
  refresh: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  /** Deletes an account that never started, or asks support to close it. True when deleted. */
  closeAccount: () => Promise<boolean>;
  signOut: () => void;
  /** A call made or taken in the app (shown until the server's list has it). */
  addCall: (c: Omit<CallLog, 'id' | 'at'>) => void;
}

interface Me {
  stage: Stage;
  name: string;
  email: string;
  mobile: string;
  number: string | null;
  request: { id: number; status: string; reason: string } | null;
  balance: number;
  activation_min: number;
  close_requested: boolean;
}

const TOKEN_KEY = 'envo.token';
const SessionContext = createContext<SessionValue | null>(null);

const toAccount = (m: Me): Account => ({
  name: m.name,
  email: m.email,
  mobile: m.mobile,
  stage: m.stage,
  number: m.number,
  balance: m.balance,
  request: m.request,
  closeRequested: m.close_requested,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<PhoneConfig | null>(null);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [local, setLocal] = useState<CallLog[]>([]);
  const [recentsSeenAt, setRecentsSeenAt] = useState(0);
  const signedIn = useRef(false);

  const signOut = useCallback(() => {
    signedIn.current = false;
    setToken(null);
    setMe(null);
    setCalls([]);
    setLocal([]);
    void SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const loadCalls = useCallback(async () => {
    const list = await api.get<{ id: string; at: string; direction: CallLog['direction']; number: string; duration: number; cost: number | null; free: boolean }[]>('/phone/calls');
    setCalls(list.map((c) => ({ ...c, name: null })));
  }, []);

  const refresh = useCallback(async () => {
    if (!signedIn.current) return;
    const next = await api.get<Me>('/phone/me');
    setMe(next);
    if (next.stage === 'active' || next.stage === 'registering') void loadCalls().catch(() => undefined);
  }, [loadCalls]);

  const begin = useCallback(
    async (token: string, next: Me) => {
      signedIn.current = true;
      setToken(token, signOut);
      setMe(next);
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    },
    [signOut],
  );

  // Start-up: the settings, and the saved sign-in if there is one.
  useEffect(() => {
    void (async () => {
      const [cfg, saved] = await Promise.all([api.get<PhoneConfig>('/public/phone/config').catch(() => null), SecureStore.getItemAsync(TOKEN_KEY).catch(() => null)]);
      setConfig(cfg);
      if (saved) {
        signedIn.current = true;
        setToken(saved, signOut);
        try {
          await refresh();
        } catch {
          // Offline: keep the sign-in and try again when the app comes back to the front.
        }
      }
      setReady(true);
    })();
  }, [refresh, signOut]);

  // Waiting for support (a payment to check, a number to register): look again now and then, and
  // whenever the app comes back to the front.
  useEffect(() => {
    const waiting = me?.stage === 'activate' || me?.stage === 'registering';
    const timer = waiting ? setInterval(() => void refresh().catch(() => undefined), 30_000) : null;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh().catch(() => undefined);
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [me?.stage, refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const r = await api.post<{ token: string; me: Me }>('/public/phone/login', { email, password, client: 'app' });
      await begin(r.token, r.me);
      void refresh().catch(() => undefined);
      return r.me.stage;
    },
    [begin, refresh],
  );

  const signUp = useCallback(
    async (d: { name: string; email: string; mobile: string; password: string }) => {
      const r = await api.post<{ token: string; me: Me }>('/public/phone/signup', { ...d, client: 'app' });
      await begin(r.token, r.me);
      return r.me.stage;
    },
    [begin],
  );

  const verifyEmail = useCallback(async (code: string) => setMe(await api.post<Me>('/phone/email/verify', { code })), []);
  const resendCode = useCallback(async () => void (await api.post('/phone/email/resend')), []);
  const changeEmail = useCallback(async (email: string) => setMe(await api.put<Me>('/phone/email', { email })), []);

  const submitKyc = useCallback(async (details: KycDetails, photo: string, id: IdFiles) => {
    // React Native uploads a file from its uri.
    const part = (f: PickedFile, name: string) => ({ uri: f.uri, name: `${name}.${f.kind === 'pdf' ? 'pdf' : 'jpg'}`, type: f.kind === 'pdf' ? 'application/pdf' : 'image/jpeg' }) as unknown as Blob;
    const body = new FormData();
    body.append('details', JSON.stringify(details));
    body.append('consent', 'true');
    body.append('photo', part({ uri: photo, kind: 'image' }, 'photo'));
    if ('one' in id) body.append('id_document', part(id.one, 'nid'));
    else {
      body.append('id_front', part(id.front, 'nid-front'));
      body.append('id_back', part(id.back, 'nid-back'));
    }
    setMe(await api.post<Me>('/phone/kyc', body));
  }, []);

  const createRecharge = useCallback(async (amount: number) => (await api.post<{ id: number }>('/phone/recharges', { amount })).id, []);

  const payOnline = useCallback(
    async (rechargeId: number): Promise<PaymentResult> => {
      const { url } = await api.post<{ url: string }>(`/phone/recharges/${rechargeId}/pay-online`, { from: 'app' });
      const r = await WebBrowser.openAuthSessionAsync(url, 'envophone://payment');
      await refresh().catch(() => undefined);
      if (r.type !== 'success') return 'cancelled';
      const status = /[?&]payment=([a-z]+)/.exec(r.url)?.[1];
      return status === 'paid' || status === 'review' || status === 'failed' || status === 'cancelled' ? status : 'unknown';
    },
    [refresh],
  );

  const payManual = useCallback(
    async (rechargeId: number, channel: string, reference: string) => {
      await api.post(`/phone/recharges/${rechargeId}/pay-manual`, { channel, reference });
      await refresh().catch(() => undefined);
    },
    [refresh],
  );

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const r = await api.post<{ token: string }>('/phone/password', { current, next, client: 'app' });
      // A password change signs out every other phone; this one gets a fresh sign-in.
      setToken(r.token, signOut);
      await SecureStore.setItemAsync(TOKEN_KEY, r.token);
    },
    [signOut],
  );

  const closeAccount = useCallback(async () => {
    const r = await api.post<{ closed: boolean }>('/phone/close');
    if (r.closed) signOut();
    else await refresh().catch(() => undefined);
    return r.closed;
  }, [refresh, signOut]);

  const markRecentsSeen = useCallback(() => setRecentsSeenAt(Date.now()), []);
  const addCall = useCallback(
    (c: Omit<CallLog, 'id' | 'at'>) => {
      setLocal((r) => [{ ...c, id: `local-${Date.now()}`, at: new Date().toISOString() }, ...r].slice(0, 20));
      // The server's list has it once the call is written down.
      setTimeout(() => void loadCalls().catch(() => undefined), 4000);
    },
    [loadCalls],
  );

  // Calls from the app show at once; the server's copy replaces them when it arrives.
  const recents = useMemo(() => {
    const newest = calls[0] ? new Date(calls[0].at).getTime() : 0;
    return [...local.filter((c) => new Date(c.at).getTime() > newest + 5000), ...calls];
  }, [calls, local]);

  const account = useMemo(() => (me ? toAccount(me) : null), [me]);
  const value = useMemo<SessionValue>(
    () => ({
      ready,
      account,
      config,
      minActivation: me?.activation_min ?? config?.activation_min ?? 100,
      recents,
      recentsSeenAt,
      markRecentsSeen,
      signIn,
      signUp,
      verifyEmail,
      resendCode,
      changeEmail,
      submitKyc,
      createRecharge,
      payOnline,
      payManual,
      refresh,
      changePassword,
      closeAccount,
      signOut,
      addCall,
    }),
    [ready, account, config, me?.activation_min, recents, recentsSeenAt, markRecentsSeen, signIn, signUp, verifyEmail, resendCode, changeEmail, submitKyc, createRecharge, payOnline, payManual, refresh, changePassword, closeAccount, signOut, addCall],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
