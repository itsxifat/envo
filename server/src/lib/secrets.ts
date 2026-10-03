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
