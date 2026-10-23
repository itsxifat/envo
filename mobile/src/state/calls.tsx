import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Vibration } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { isEnvoNumber } from '@/lib/numbers';
import { RINGTONES, useSettings } from './settings';
import { useSession } from './session';
import { Sounds } from './sounds';

/*
 * The phone's calls: one call at a time, plus an incoming one ringing. Until Envo's SIP connection is
 * wired in, calls are simulated (they ring, connect and count) so every screen can be used now.
 */

export type CallState = 'calling' | 'ringing' | 'connected' | 'held' | 'ended';

export interface Call {
  id: string;
  number: string;
  name: string | null;
  direction: 'in' | 'out';
  state: CallState;
  /** When it was answered, for the timer. */
  connectedAt: number | null;
  muted: boolean;
  speaker: boolean;
  /** Between two Envo numbers: free. */
  free: boolean;
}

interface CallsValue {
  call: Call | null;
  incoming: Call | null;
  dial: (number: string, name?: string | null) => void;
  answer: () => void;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleHold: () => void;
  sendDigit: (digit: string) => void;
  /** Development: pretend someone is calling. */
  simulateIncoming: (from?: { number: string; name: string | null }) => void;
}

const CallsContext = createContext<CallsValue | null>(null);

export { isEnvoNumber } from '@/lib/numbers';

export function CallsProvider({ children }: { children: ReactNode }) {
  const { addCall } = useSession();
  const { ringtone, vibrate } = useSettings();
  const [call, setCall] = useState<Call | null>(null);
  const [incoming, setIncoming] = useState<Call | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callRef = useRef<Call | null>(null);
  callRef.current = call;

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const finish = useCallback(
    (c: Call) => {
      clearTimers();
      Sounds.ringback(false);
      Sounds.hangup();
      const duration = c.connectedAt ? Math.round((Date.now() - c.connectedAt) / 1000) : 0;
      addCall({ name: c.name, number: c.number, direction: c.direction === 'in' ? 'in' : 'out', duration, free: c.free });
      setCall({ ...c, state: 'ended' });
      later(900, () => {
        setCall(null);
        if (router.canGoBack()) router.back();
      });
    },
    [addCall],
  );

  const dial = useCallback((number: string, name: string | null = null) => {
    if (callRef.current) return;
    const c: Call = { id: String(Date.now()), number, name, direction: 'out', state: 'calling', connectedAt: null, muted: false, speaker: false, free: isEnvoNumber(number) };
    setCall(c);
    router.push('/call');
    later(1100, () => {
      setCall((x) => (x && x.state === 'calling' ? { ...x, state: 'ringing' } : x));
      Sounds.ringback(true);
    });
    later(4600, () => {
      Sounds.ringback(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCall((x) => (x && x.state === 'ringing' ? { ...x, state: 'connected', connectedAt: Date.now() } : x));
    });
  }, []);

  // The incoming call rings (and buzzes) until it is answered or declined.
  useEffect(() => {
    if (!incoming) return;
    const tone = RINGTONES.find((r) => r.id === ringtone)?.source ?? RINGTONES[0].source;
    Sounds.ring(tone);
    if (vibrate) Vibration.vibrate([0, 600, 900], true);
    return () => {
      Sounds.ring(null);
      Vibration.cancel();
    };
  }, [incoming, ringtone, vibrate]);

  const answer = useCallback(() => {
    if (!incoming) return;
    setIncoming(null);
    setCall({ ...incoming, state: 'connected', connectedAt: Date.now() });
    router.replace('/call');
  }, [incoming]);

  const decline = useCallback(() => {
    if (!incoming) return;
    addCall({ name: incoming.name, number: incoming.number, direction: 'missed', duration: 0, free: incoming.free });
    setIncoming(null);
    if (router.canGoBack()) router.back();
  }, [incoming, addCall]);

  const hangup = useCallback(() => {
    if (callRef.current && callRef.current.state !== 'ended') finish(callRef.current);
  }, [finish]);

  const value = useMemo<CallsValue>(
    () => ({
      call,
      incoming,
      dial,
      answer,
      decline,
      hangup,
      toggleMute: () => setCall((c) => (c ? { ...c, muted: !c.muted } : c)),
      toggleSpeaker: () => setCall((c) => (c ? { ...c, speaker: !c.speaker } : c)),
      toggleHold: () => setCall((c) => (c && (c.state === 'connected' || c.state === 'held') ? { ...c, state: c.state === 'held' ? 'connected' : 'held' } : c)),
      sendDigit: (d) => Sounds.key(d),
      simulateIncoming: (from = { number: '09639437022', name: 'Karim Hossain' }) => {
        if (callRef.current) return;
        setIncoming({ id: String(Date.now()), number: from.number, name: from.name, direction: 'in', state: 'ringing', connectedAt: null, muted: false, speaker: false, free: isEnvoNumber(from.number) });
        router.push('/incoming');
      },
    }),
    [call, incoming, dial, answer, decline, hangup],
  );
  return <CallsContext.Provider value={value}>{children}</CallsContext.Provider>;
}

export function useCalls(): CallsValue {
  const c = useContext(CallsContext);
  if (!c) throw new Error('useCalls outside CallsProvider');
  return c;
}
