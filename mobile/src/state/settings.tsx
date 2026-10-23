import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

/** The ringtones that ship with the app (made by scripts/make-sounds.py). */
export const RINGTONES = [
  { id: 'envo', name: 'Envo', note: 'Friendly marimba', source: require('@/assets/sounds/ring-envo.wav') },
  { id: 'calm', name: 'Calm', note: 'Soft bells', source: require('@/assets/sounds/ring-calm.wav') },
  { id: 'bright', name: 'Bright', note: 'Quick and cheerful', source: require('@/assets/sounds/ring-bright.wav') },
  { id: 'classic', name: 'Classic', note: 'A desk phone ring', source: require('@/assets/sounds/ring-classic.wav') },
] as const;

export type RingtoneId = (typeof RINGTONES)[number]['id'];

interface Settings {
  ringtone: RingtoneId;
  setRingtone: (id: RingtoneId) => void;
  /** Buzz with the ringtone. */
  vibrate: boolean;
  setVibrate: (v: boolean) => void;
  /** Click and tone on each keypad press. */
  keypadSounds: boolean;
  setKeypadSounds: (v: boolean) => void;
}

const KEY = 'envo.settings';
const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [ringtone, setRingtoneState] = useState<RingtoneId>('envo');
  const [vibrate, setVibrateState] = useState(true);
  const [keypadSounds, setKeypadState] = useState(true);

  useEffect(() => {
    void SecureStore.getItemAsync(KEY).then((raw) => {
      if (!raw) return;
      try {
        const v = JSON.parse(raw) as Partial<{ ringtone: RingtoneId; vibrate: boolean; keypadSounds: boolean }>;
        if (v.ringtone && RINGTONES.some((r) => r.id === v.ringtone)) setRingtoneState(v.ringtone);
        if (typeof v.vibrate === 'boolean') setVibrateState(v.vibrate);
        if (typeof v.keypadSounds === 'boolean') setKeypadState(v.keypadSounds);
      } catch {
        /* a broken value: keep the defaults */
      }
    });
  }, []);

  const save = useCallback((patch: object) => {
    void SecureStore.getItemAsync(KEY).then((raw) => {
      let current = {};
      try {
        current = raw ? (JSON.parse(raw) as object) : {};
      } catch {
        /* start over */
      }
      return SecureStore.setItemAsync(KEY, JSON.stringify({ ...current, ...patch }));
    });
  }, []);

  const value = useMemo<Settings>(
    () => ({
      ringtone,
      setRingtone: (id) => {
        setRingtoneState(id);
        save({ ringtone: id });
      },
      vibrate,
      setVibrate: (v) => {
        setVibrateState(v);
        save({ vibrate: v });
      },
      keypadSounds,
      setKeypadSounds: (v) => {
        setKeypadState(v);
        save({ keypadSounds: v });
      },
    }),
    [ringtone, vibrate, keypadSounds, save],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(SettingsContext);
  if (!s) throw new Error('useSettings outside SettingsProvider');
  return s;
}
