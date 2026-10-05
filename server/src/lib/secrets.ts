import crypto from 'node:crypto';
import { config } from '../config.js';

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Random password without look-alike characters; safe to type into a desk phone. */
export function randomPassword(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALNUM[bytes[i]! % ALNUM.length];
  return out;
}

export function randomPin(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i++) out += crypto.randomInt(0, 10).toString();
  return out;
}

/**
 * Password of the companion WebRTC endpoint of an extension. Derived, so it never has to be
 * stored and changes whenever the server secret rotates.
 */
export function webPassword(sipUsername: string): string {
  const digest = crypto.createHmac('sha256', config.jwtSecret).update(`webrtc:${sipUsername}`).digest();
  let out = '';
  for (let i = 0; i < 24; i++) out += ALNUM[digest[i]! % ALNUM.length];
  return out;
}

/** Digits only, for typing on a desk phone's keypad. 10 digits = 10^10 guesses, and fail2ban bans after 8. */
export function keypadPassword(length = 10): string {
  for (;;) {
    const out = randomPin(length);
    if (!sipPasswordProblem(out)) return out;
  }
}

const RUNS = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm'];
const COMMON = ['password', 'passw0rd', 'asterisk', 'freepbx', 'welcome', 'letmein', 'admin', 'secret', 'qwerty', 'changeme'];

/**
 * Why a SIP password is too easy to guess, or null. SIP scanners on the internet try exactly these
 * first (toll fraud), so a phone-friendly password may be short but never predictable.
 */
export function sipPasswordProblem(pw: string, ctx: { username?: string; number?: string } = {}): string | null {
  if (pw.length < 8) return 'use at least 8 characters';
  if (pw.length > 64) return 'use at most 64 characters';
  if (!/^[\x21-\x7E]+$/.test(pw)) return 'use letters, digits and symbols without spaces';
  const lower = pw.toLowerCase();
  if (new Set(lower).size <= 2) return 'too easy to guess: it uses only one or two different characters';
  for (const run of RUNS) {
    const rev = [...run].reverse().join('');
    if (run.includes(lower) || rev.includes(lower)) return 'too easy to guess: it is a straight run of keys';
  }
  // Short repeated blocks: 12121212, abcabcab, 10011001…
  for (let n = 1; n <= 4; n++) {
    if (lower === lower.slice(0, n).repeat(Math.ceil(lower.length / n)).slice(0, lower.length)) return 'too easy to guess: it repeats a short pattern';
  }
  if (COMMON.some((w) => lower.includes(w))) return 'too easy to guess: it contains a common password';
  if (ctx.username && ctx.username.length >= 3 && lower.includes(ctx.username.toLowerCase())) return 'must not contain the username';
  if (ctx.number && ctx.number.length >= 3 && lower.replaceAll(ctx.number, '').length < 5) return 'too easy to guess: it is mostly the extension number';
  return null;
}
