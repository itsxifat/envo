import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { api, ApiError, setToken } from '@/lib/api';

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
  /** A recharge paid on Enfinito Pay that didn't fit its invoice (or looked risky) waits for support's check. */
  paymentInReview: boolean;
  /** The latest registration, with the reason when it was turned down or closed. */
  request: { id: number; status: string; reason: string } | null;
  closeRequested: boolean;
}

/** Envo stops calls out at a calling balance of BDT 0 or less (calls in still ring). */
export const outOfBalance = (a: Account | null) => a?.stage === 'active' && a.balance <= 0;

export interface PhoneConfig {
  signups: boolean;
  activation_min: number;
  recharge: { min: number; max: number; presets: number[] };
  rate_per_min: number;
  free_onnet: boolean;
  /** The selfie is taken live and checked automatically (else any photo). */
  selfie_check: boolean;
  support: { phone: string; email: string };
  min_app_version: string;
  update_url: string;
  operator: string;
  prefix: string;
  /** Payments go through Enfinito Pay; false while it isn't switched on. */
  payment: { online: boolean };
}

export interface CallLog {
  id: string;
  name: string | null;
  number: string;
  direction: 'in' | 'out' | 'missed';
  /** Seconds talked; 0 for missed or unanswered calls. */
  duration: number;
  at: string;
  /** A call out that costs nothing (charged BDT 0, or to an Envo number when those are free). */
  free: boolean;
  /** What was charged, BDT; null until it is charged, and for calls in and missed calls. */
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

/** A live selfie the server checked: its id goes with the registration, the picture shows in the form. */
export interface LiveSelfie {
  id: string;
  uri: string;
}

/** The screen each stage starts on. */
export const startOf = (stage: Stage) => (stage === 'verify' ? '/verify' : stage === 'kyc' ? '/kyc' : stage === 'suspended' ? '/paused' : '/') as '/verify' | '/kyc' | '/paused' | '/';

export interface SessionValue {
  /** False until the saved sign-in and the settings have been read at start-up. */
  ready: boolean;
  account: Account | null;
  /** Signed in, but Envo couldn't be reached the last time it was asked (tried again every 10 s while no account is loaded). */
  offline: boolean;
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
  /** The selfie: a checked live one (by its id), or a photo when Enfinito turned the check off. */
  submitKyc: (details: KycDetails, selfie: LiveSelfie | string, id: IdFiles) => Promise<void>;
  /** Sends the three live pictures (straight, then the two head turns); the server checks them. */
  checkSelfie: (frames: [string, string, string]) => Promise<string>;
  liveSelfie: LiveSelfie | null;
  setLiveSelfie: (s: LiveSelfie | null) => void;
  /** Starts a recharge; pay it next with payOnline. Returns its id. */
  createRecharge: (amount: number) => Promise<number>;
  /** Opens Enfinito Pay's payment page; resolves when the person comes back to the app. */
  payOnline: (rechargeId: number) => Promise<PaymentResult>;
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
  payment_in_review: boolean;
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
  paymentInReview: m.payment_in_review,
  request: m.request,
  closeRequested: m.close_requested,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [offline, setOffline] = useState(false);
  const [config, setConfig] = useState<PhoneConfig | null>(null);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [local, setLocal] = useState<CallLog[]>([]);
  const [recentsSeenAt, setRecentsSeenAt] = useState(0);
  const [liveSelfie, setLiveSelfie] = useState<LiveSelfie | null>(null);
  const signedIn = useRef(false);
  // Bumped on every sign-in and sign-out: an answer to a request sent before it is dropped, so one
  // that arrives after signing out can't bring the old account back.
  const generation = useRef(0);

  const signOut = useCallback(() => {
    signedIn.current = false;
    generation.current++;
    setToken(null);
    setMe(null);
    setOffline(false);
    setCalls([]);
    setLocal([]);
    setLiveSelfie(null);
    void SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const loadConfig = useCallback(async () => setConfig(await api.get<PhoneConfig>('/public/phone/config')), []);

  const loadCalls = useCallback(async () => {
    const gen = generation.current;
    const list = await api.get<{ id: string; at: string; direction: CallLog['direction']; number: string; duration: number; cost: number | null; free: boolean }[]>('/phone/calls');
    if (gen === generation.current) setCalls(list.map((c) => ({ ...c, name: null })));
  }, []);

  const refresh = useCallback(async () => {
    // The settings come along every time, so a failed first try or a change in the admin (payments
    // switched on or off, prices) reaches the app without restarting it.
    const settings = loadConfig().catch(() => undefined);
    try {
      if (!signedIn.current) return;
      const gen = generation.current;
      const next = await api.get<Me>('/phone/me').catch((err: unknown) => {
        // A 401 has signed out already (api.ts); anything else means Envo can't be reached right now.
        if (gen === generation.current && !(err instanceof ApiError && err.status === 401)) setOffline(true);
        throw err;
      });
      if (gen !== generation.current) return;
      setMe(next);
      setOffline(false);
      if (next.stage === 'active' || next.stage === 'registering') void loadCalls().catch(() => undefined);
    } finally {
      await settings;
    }
  }, [loadCalls, loadConfig]);

  const begin = useCallback(
    async (token: string, next: Me) => {
      signedIn.current = true;
      generation.current++;
      setToken(token, signOut);
      setMe(next);
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    },
    [signOut],
  );

  // Start-up: the saved sign-in if there is one, then the settings and the account (refresh reads both).
  useEffect(() => {
    void (async () => {
      const saved = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      if (saved) {
        signedIn.current = true;
        setToken(saved, signOut);
      }
      // Offline: the sign-in is kept and tried again (see below).
      await refresh().catch(() => undefined);
      setReady(true);
    })();
  }, [refresh, signOut]);

  // Waiting for support (a payment to check, a number to register): look again now and then, and
  // whenever the app comes back to the front (refresh reads the settings again too).
  useEffect(() => {
    const waiting = me?.stage === 'activate' || me?.stage === 'registering' || !!me?.payment_in_review;
    const timer = waiting ? setInterval(() => void refresh().catch(() => undefined), 30_000) : null;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh().catch(() => undefined);
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [me?.stage, me?.payment_in_review, refresh]);

  // Signed in but Envo couldn't be reached, so there is no account to show yet: try again every 10 s.
  const loaded = !!me;
  useEffect(() => {
    if (!offline || loaded) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 10_000);
    return () => clearInterval(timer);
  }, [offline, loaded, refresh]);

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

  const verifyEmail = useCallback(async (code: string) => {
    const gen = generation.current;
    const next = await api.post<Me>('/phone/email/verify', { code });
    if (gen === generation.current) setMe(next);
  }, []);
  const resendCode = useCallback(async () => void (await api.post('/phone/email/resend')), []);
  const changeEmail = useCallback(async (email: string) => {
    const gen = generation.current;
    const next = await api.put<Me>('/phone/email', { email });
    if (gen === generation.current) setMe(next);
  }, []);

  // React Native uploads a file from its uri.
  const part = (f: PickedFile, name: string) => ({ uri: f.uri, name: `${name}.${f.kind === 'pdf' ? 'pdf' : 'jpg'}`, type: f.kind === 'pdf' ? 'application/pdf' : 'image/jpeg' }) as unknown as Blob;

  const checkSelfie = useCallback(async (frames: [string, string, string]) => {
    const body = new FormData();
    ['straight', 'turn_1', 'turn_2'].forEach((name, i) => body.append(name, part({ uri: frames[i]!, kind: 'image' }, name)));
    return (await api.post<{ id: string }>('/phone/selfie', body)).id;
  }, []);

  const submitKyc = useCallback(async (details: KycDetails, selfie: LiveSelfie | string, id: IdFiles) => {
    const body = new FormData();
    body.append('details', JSON.stringify(details));
    body.append('consent', 'true');
    if (typeof selfie === 'string') body.append('photo', part({ uri: selfie, kind: 'image' }, 'photo'));
    else body.append('selfie_check', selfie.id);
    if ('one' in id) body.append('id_document', part(id.one, 'nid'));
    else {
      body.append('id_front', part(id.front, 'nid-front'));
      body.append('id_back', part(id.back, 'nid-back'));
    }
    const gen = generation.current;
    const next = await api.post<Me>('/phone/kyc', body);
    if (gen !== generation.current) return;
    setMe(next);
    setLiveSelfie(null);
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
      offline,
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
      checkSelfie,
      liveSelfie,
      setLiveSelfie,
      createRecharge,
      payOnline,
      refresh,
      changePassword,
      closeAccount,
      signOut,
      addCall,
    }),
    [ready, account, offline, config, me?.activation_min, recents, recentsSeenAt, markRecentsSeen, signIn, signUp, verifyEmail, resendCode, changeEmail, submitKyc, checkSelfie, liveSelfie, createRecharge, payOnline, refresh, changePassword, closeAccount, signOut, addCall],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
