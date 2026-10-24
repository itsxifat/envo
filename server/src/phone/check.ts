import type { IdentityCheck, Liveness } from './identity.js';

/*
 * The automatic face check as the routes use it. The face code itself (identity.ts, faces.ts and
 * TensorFlow) is only loaded when the first check runs.
 */

/** The face code loads on first use (TensorFlow is big), without its start-up chatter in the log. */
let identityCode: Promise<typeof import('./identity.js')> | null = null;
export function identity(): Promise<typeof import('./identity.js')> {
  identityCode ??= (async () => {
    const { warn, log } = console;
    console.warn = console.log = () => undefined;
    try {
      return await import('./identity.js');
    } finally {
      console.warn = warn;
      console.log = log;
    }
  })();
  return identityCode;
}

/**
 * The face check of a registration: the selfie (its descriptor from the live check, or the photo
 * itself) against the face on the ID. Never stops a registration: if it can't run, support looks.
 */
export async function checkIdentity(liveness: Liveness | null, selfie: Buffer | number[], document: Buffer | null): Promise<IdentityCheck> {
  try {
    const id = await identity();
    const match = document ? await id.matchDocument(selfie, document) : ({ verdict: 'unreadable', distance: null } as const);
    return id.identityCheck(liveness, match);
  } catch (err) {
    console.warn('[phone] face check failed:', (err as Error).message);
    return { verdict: 'review', liveness, match: { verdict: 'unreadable', distance: null }, at: new Date().toISOString() };
  }
}
