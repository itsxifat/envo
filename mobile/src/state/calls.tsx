import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Vibration } from 'react-native';
import { router, usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { isEnvoNumber, knownEnvo } from '@/lib/numbers';
import { RINGTONES, useSettings } from './settings';
import { outOfBalance, useSession } from './session';
import { Sounds } from './sounds';

/*
 * The phone's calls: one call at a time, plus an incoming one ringing. Until Envo's SIP connection is
 * wired in, calls are simulated (they ring, connect and count) so every screen can be used now.
 */

/** 'failed': the call didn't go through (Call.reason says why); its screen stays until it is closed. */
export type CallState = 'calling' | 'ringing' | 'connected' | 'held' | 'ended' | 'failed';

/** Why a call out failed. Real SIP will report these; the simulation never fails a call by itself. */
export type CallFailReason = 'no-answer' | 'busy' | 'offline' | 'balance';

export interface Call {
  id: string;
  number: string;
  name: string | null;
  direction: 'in' | 'out';
  state: CallState;
  /** When it was answered, for the timer. */
  connectedAt: number | null;
  /** When it ended or failed, for the talk time it shows then. */
  endedAt?: number;
  /** Why it failed, while the state is 'failed'. */
  reason?: CallFailReason;
  muted: boolean;
  speaker: boolean;
  /** Between two Envo numbers, when Enfinito makes those free. */
  free: boolean;
}

interface CallsValue {
  call: Call | null;
  incoming: Call | null;
  dial: (number: string, name?: string | null) => void;
  answer: () => void;
  decline: () => void;
  /** Stops the incoming call's ringtone and buzz; it stays on screen until it is answered or declined. */
  silence: () => void;
  hangup: () => void;
  /** A failed call: tries the same number again, on the same screen. */
  retry: () => void;
  /** A failed (or just ended) call: closes its screen now. */
  close: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleHold: () => void;
  sendDigit: (digit: string) => void;
  /** Development: pretend someone is calling. */
  simulateIncoming: (from?: { number: string; name: string | null }) => void;
  /** Development: a call out that doesn't go through, to see how that looks. */
  simulateFailure: (reason?: CallFailReason) => void;
}

const CallsContext = createContext<CallsValue | null>(null);

export { isEnvoNumber } from '@/lib/numbers';

/** The calling balance has run out, so Envo doesn't put the call through: offer a recharge instead. */
export function askToRecharge(freeOnnet = false) {
  const body = freeOnnet
    ? 'Your calling balance has run out. Calls to Envo numbers are still free, and you can still get calls.'
    : 'Your calling balance has run out. You can still get calls.';
  Alert.alert('Recharge to call', body, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Recharge', onPress: () => router.push('/recharge') },
  ]);
}

export function CallsProvider({ children }: { children: ReactNode }) {
  const { account, config, addCall } = useSession();
  const blocked = outOfBalance(account);
  const active = account?.stage === 'active';
  const freeOnnet = !!config?.free_onnet;
  const { ringtone, vibrate } = useSettings();
  const [call, setCall] = useState<Call | null>(null);
  const [incoming, setIncoming] = useState<Call | null>(null);
  // The incoming call whose ringing was silenced (it still shows until answered or declined).
  const [silenced, setSilenced] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callRef = useRef<Call | null>(null);
  callRef.current = call;
  // Where the app is: a call that ends closes its own screen, never the one under it (the call may
  // go on while the person looks at another screen).
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  /** Off the call screen, if it is showing: back to where the call started. */
  const leave = useCallback(() => {
    if (path.current !== '/call') return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const finish = useCallback(
    (c: Call) => {
      clearTimers();
      Sounds.ringback(false);
      Sounds.hangup();
      const endedAt = Date.now();
      const duration = c.connectedAt ? Math.round((endedAt - c.connectedAt) / 1000) : 0;
      // Only a call out can be free; calls in never show a price.
      addCall({ name: c.name, number: c.number, direction: c.direction === 'in' ? 'in' : 'out', duration, free: c.direction === 'out' && c.free });
      setCall({ ...c, state: 'ended', endedAt });
      // "Call ended" and what it cost stay a moment, then the screen closes.
      later(1600, () => {
        setCall(null);
        leave();
      });
    },
    [addCall, leave],
  );

  const fail = useCallback(
    (c: Call, reason: CallFailReason) => {
      clearTimers();
      Sounds.ringback(false);
      Sounds.hangup();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const endedAt = Date.now();
      const duration = c.connectedAt ? Math.round((endedAt - c.connectedAt) / 1000) : 0;
      addCall({ name: c.name, number: c.number, direction: 'out', duration, free: c.free });
      // It stays on screen with Close and Call again: it doesn't close by itself.
      setCall({ ...c, state: 'failed', reason, endedAt });
    },
    [addCall],
  );

  /** A call out on the call screen: it rings, then connects (or, simulating a failure, doesn't). */
  const place = useCallback(
    (number: string, name: string | null, failWith?: CallFailReason) => {
      clearTimers();
      const c: Call = { id: String(Date.now()), number, name, direction: 'out', state: 'calling', connectedAt: null, muted: false, speaker: false, free: freeOnnet && isEnvoNumber(number) };
      setCall(c);
      const ring = () => {
        setCall((x) => (x && x.id === c.id && x.state === 'calling' ? { ...x, state: 'ringing' } : x));
        Sounds.ringback(true);
      };
      const connect = () => {
        Sounds.ringback(false);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCall((x) => (x && x.id === c.id && x.state === 'ringing' ? { ...x, state: 'connected', connectedAt: Date.now() } : x));
      };
      const failNow = (reason: CallFailReason) => {
        const x = callRef.current;
        if (x && x.id === c.id && x.state !== 'ended' && x.state !== 'failed') fail(x, reason);
      };
      if (!failWith) {
        later(1100, ring);
        later(4600, connect);
      } else if (failWith === 'busy' || failWith === 'offline') {
        later(failWith === 'busy' ? 2000 : 2600, () => failNow(failWith));
      } else {
        later(1100, ring);
        if (failWith === 'balance') {
          later(4600, connect);
          later(9600, () => failNow('balance'));
        } else later(8000, () => failNow(failWith));
      }
    },
    [freeOnnet, fail],
  );

  const dial = useCallback(
    (number: string, name: string | null = null) => {
      // One call at a time; a failed one waiting on its screen is replaced.
      if (callRef.current && callRef.current.state !== 'failed') return;
      // Every place that starts a call asks useCallGate first; these are the backstops.
      if (!active) return;
      // With no balance left only free calls to Envo numbers go out (useCallGate asked Envo first).
      if (blocked && !(freeOnnet && knownEnvo(number))) return askToRecharge(freeOnnet);
      place(number, name);
      router.push('/call');
    },
    [active, blocked, freeOnnet, place],
  );

  const retry = useCallback(() => {
    const c = callRef.current;
    if (!c || c.state !== 'failed' || !active) return;
    if (blocked && !(freeOnnet && knownEnvo(c.number))) return askToRecharge(freeOnnet);
    place(c.number, c.name);
  }, [active, blocked, freeOnnet, place]);

  const close = useCallback(() => {
    const c = callRef.current;
    if (!c || (c.state !== 'failed' && c.state !== 'ended')) return;
    clearTimers();
    setCall(null);
    leave();
  }, [leave]);

  // The incoming call rings (and buzzes) until it is answered, declined or silenced.
  useEffect(() => {
    if (!incoming || silenced === incoming.id) return;
    const tone = RINGTONES.find((r) => r.id === ringtone)?.source ?? RINGTONES[0].source;
    Sounds.ring(tone);
    if (vibrate) Vibration.vibrate([0, 600, 900], true);
    return () => {
      Sounds.ring(null);
      Vibration.cancel();
    };
  }, [incoming, silenced, ringtone, vibrate]);

  const answer = useCallback(() => {
    if (!incoming) return;
    clearTimers();
    setIncoming(null);
    setCall({ ...incoming, state: 'connected', connectedAt: Date.now() });
    router.replace('/call');
  }, [incoming]);

  const decline = useCallback(() => {
    if (!incoming) return;
    addCall({ name: incoming.name, number: incoming.number, direction: 'missed', duration: 0, free: false });
    setIncoming(null);
    if (router.canGoBack()) router.back();
  }, [incoming, addCall]);

  const hangup = useCallback(() => {
    const c = callRef.current;
    if (c && c.state !== 'ended' && c.state !== 'failed') finish(c);
  }, [finish]);

  const value = useMemo<CallsValue>(
    () => ({
      call,
      incoming,
      dial,
      answer,
      decline,
      silence: () => setSilenced(incoming?.id ?? null),
      hangup,
      retry,
      close,
      toggleMute: () => setCall((c) => (c ? { ...c, muted: !c.muted } : c)),
      toggleSpeaker: () => setCall((c) => (c ? { ...c, speaker: !c.speaker } : c)),
      toggleHold: () => setCall((c) => (c && (c.state === 'connected' || c.state === 'held') ? { ...c, state: c.state === 'held' ? 'connected' : 'held' } : c)),
      sendDigit: (d) => Sounds.key(d),
      simulateIncoming: (from = { number: '09639437022', name: 'Karim Hossain' }) => {
        if (callRef.current && callRef.current.state !== 'failed') return;
        // A failed call still on screen gives way, so answering doesn't leave its screen behind.
        if (callRef.current) {
          clearTimers();
          setCall(null);
          leave();
        }
        setIncoming({ id: String(Date.now()), number: from.number, name: from.name, direction: 'in', state: 'ringing', connectedAt: null, muted: false, speaker: false, free: freeOnnet && isEnvoNumber(from.number) });
        router.push('/incoming');
      },
      simulateFailure: (reason = 'no-answer') => {
        if (callRef.current && callRef.current.state !== 'failed') return;
        place('01712345678', null, reason);
        router.push('/call');
      },
    }),
    [call, incoming, dial, answer, decline, hangup, retry, close, place, leave, freeOnnet],
  );
  return <CallsContext.Provider value={value}>{children}</CallsContext.Provider>;
}

export function useCalls(): CallsValue {
  const c = useContext(CallsContext);
  if (!c) throw new Error('useCalls outside CallsProvider');
  return c;
}
