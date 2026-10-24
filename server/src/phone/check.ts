import { identityCheck, matchDocument, type IdentityCheck, type Liveness } from './identity.js';

/*
 * The automatic face check as a registration uses it. The faces themselves are found in a worker
 * thread (faces.ts), started when the first check runs.
 */

/**
 * The face check of a registration: the selfie (its descriptor from the live check, or the photo
 * itself) against the face on the ID. Never stops a registration: if it can't run, support looks.
 */
export async function checkIdentity(liveness: Liveness | null, selfie: Buffer | number[], document: Buffer | null): Promise<IdentityCheck> {
  try {
    const match = document ? await matchDocument(selfie, document) : ({ verdict: 'unreadable', distance: null } as const);
    return identityCheck(liveness, match);
  } catch (err) {
    console.warn('[phone] face check failed:', (err as Error).message);
    return { verdict: 'review', liveness, match: { verdict: 'unreadable', distance: null }, at: new Date().toISOString() };
  }
}
