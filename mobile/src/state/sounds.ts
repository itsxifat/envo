import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/*
 * Every sound the phone makes, loaded once: keypad tones, ringback while calling, the hang-up chime
 * and the ringtone (which can be changed in Settings).
 */

const DTMF: Record<string, number> = {
  '0': require('@/assets/sounds/dtmf-0.wav'),
  '1': require('@/assets/sounds/dtmf-1.wav'),
  '2': require('@/assets/sounds/dtmf-2.wav'),
  '3': require('@/assets/sounds/dtmf-3.wav'),
  '4': require('@/assets/sounds/dtmf-4.wav'),
  '5': require('@/assets/sounds/dtmf-5.wav'),
  '6': require('@/assets/sounds/dtmf-6.wav'),
  '7': require('@/assets/sounds/dtmf-7.wav'),
  '8': require('@/assets/sounds/dtmf-8.wav'),
  '9': require('@/assets/sounds/dtmf-9.wav'),
  '*': require('@/assets/sounds/dtmf-star.wav'),
  '#': require('@/assets/sounds/dtmf-hash.wav'),
};

const players = new Map<string, AudioPlayer>();

function player(key: string, source: number, opts: { loop?: boolean; volume?: number } = {}): AudioPlayer {
  let p = players.get(key);
  if (!p) {
    p = createAudioPlayer(source);
    players.set(key, p);
  }
  p.loop = !!opts.loop;
  p.volume = opts.volume ?? 1;
  return p;
}

function restart(p: AudioPlayer) {
  void p.seekTo(0).then(() => p.play());
}

let modeSet = false;
function ensureMode() {
  if (modeSet) return;
  modeSet = true;
  void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
}

export const Sounds = {
  key(digit: string) {
    const src = DTMF[digit];
    if (!src) return;
    ensureMode();
    restart(player(`dtmf-${digit}`, src, { volume: 0.35 }));
  },
  ringback(on: boolean) {
    const p = player('ringback', require('@/assets/sounds/ringback.wav'), { loop: true, volume: 0.6 });
    if (on) restart(p);
    else p.pause();
  },
  hangup() {
    restart(player('hangup', require('@/assets/sounds/hangup.wav'), { volume: 0.5 }));
  },
  ring(source: number | null) {
    for (const [key, p] of players) if (key.startsWith('ring:')) p.pause();
    if (source === null) return;
    restart(player(`ring:${source}`, source, { loop: true }));
  },
  /** One pass of a ringtone, for choosing in Settings. */
  preview(source: number | null) {
    for (const [key, p] of players) if (key.startsWith('preview:')) p.pause();
    if (source === null) return;
    restart(player(`preview:${source}`, source, { loop: false }));
  },
};
