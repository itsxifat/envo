import { distance, facesIn, type Face } from './faces.js';

/*
 * The selfie check, done here like mobile banking apps do it: a live selfie (three pictures, looking
 * straight and turning the head one way and the other) and its face matched with the photo on the NID.
 * A printed photo can't turn its head: when paper is tilted the nose stays put between the eyes.
 */

export type Problem = 'no_face' | 'too_far' | 'many_faces' | 'not_straight' | 'not_turned' | 'not_same';

/** What to tell the person when the selfie has to be taken again. */
export const PROBLEM_TEXT: Record<Problem, string> = {
  no_face: "We couldn't see your face clearly. Find good light and keep your whole face in the circle.",
  too_far: 'Come a little closer, so your face fills the circle.',
  many_faces: 'Only you should be in the picture.',
  not_straight: 'Look straight at the camera for the first picture.',
  not_turned: 'Turn your head slowly to one side and then the other when asked.',
  not_same: 'All three pictures need to be of you.',
};

export interface Liveness {
  ok: boolean;
  problem?: Problem;
  /** Head turn in each picture (straight, then the two turns). */
  yaws: number[];
  /** Distance of each turned picture's face from the straight one. */
  same: number[];
}

/** Face distance under SAME: the same person; up to UNSURE: maybe (support looks); above: not. */
const SAME = 0.5;
const UNSURE = 0.6;
const STRAIGHT = 0.15;
const TURNED = 0.15;

function main(faces: Face[] | null): Face | Problem {
  if (!faces?.length) return 'no_face';
  const [first, second] = faces;
  if (second && second.size > first!.size * 0.5) return 'many_faces';
  if (first!.size < 0.18) return 'too_far';
  return first!;
}

/** The three pictures of a live selfie: looking straight, then turned one way and the other. */
export async function checkLiveness(frames: [Buffer, Buffer, Buffer]): Promise<{ result: Liveness; descriptor: number[] | null }> {
  const faces: Face[] = [];
  const yaws = () => faces.map((f) => round(f.yaw));
  const fail = (problem: Problem, same: number[] = []) => ({ result: { ok: false, problem, yaws: yaws(), same }, descriptor: null });
  for (const frame of frames) {
    const f = main(await facesIn(frame));
    if (typeof f === 'string') return fail(f);
    faces.push(f);
  }
  const [straight, a, b] = faces as [Face, Face, Face];
  if (Math.abs(straight.yaw) > STRAIGHT) return fail('not_straight');
  // Turned clearly, to opposite sides: which side is left depends on whether the camera mirrors.
  const turnedApart = Math.abs(a.yaw - straight.yaw) >= TURNED && Math.abs(b.yaw - straight.yaw) >= TURNED && Math.sign(a.yaw - straight.yaw) !== Math.sign(b.yaw - straight.yaw);
  if (!turnedApart) return fail('not_turned');
  const same = [distance(straight.descriptor, a.descriptor), distance(straight.descriptor, b.descriptor)];
  if (same.some((d) => d > UNSURE)) return fail('not_same', same.map(round));
  return { result: { ok: true, yaws: yaws(), same: same.map(round) }, descriptor: Array.from(straight.descriptor) };
}

export type MatchVerdict = 'match' | 'unsure' | 'no_match' | 'no_face' | 'unreadable';

export interface DocumentMatch {
  verdict: MatchVerdict;
  /** Face distance (lower is closer); null when there was no face to compare. */
  distance: number | null;
}

/** The selfie's face against the largest face on the ID (the portrait on the NID's front). */
export async function matchDocument(selfie: Buffer | number[], document: Buffer): Promise<DocumentMatch> {
  const descriptor = Array.isArray(selfie) ? selfie : await facesIn(selfie).then((f) => (f?.[0] ? Array.from(f[0].descriptor) : null));
  if (!descriptor) return { verdict: 'no_face', distance: null };
  const faces = await facesIn(document);
  if (faces === null) return { verdict: 'unreadable', distance: null };
  if (!faces.length) return { verdict: 'no_face', distance: null };
  const d = round(distance(descriptor, faces[0]!.descriptor));
  return { verdict: d <= SAME ? 'match' : d <= UNSURE ? 'unsure' : 'no_match', distance: d };
}

/** What support sees on the request: the live selfie (if taken) and the face match. */
export interface IdentityCheck {
  /** passed: live and matching; review: support compares by eye. */
  verdict: 'passed' | 'review';
  liveness: Liveness | null;
  match: DocumentMatch;
  at: string;
}

export function identityCheck(liveness: Liveness | null, match: DocumentMatch): IdentityCheck {
  return { verdict: liveness?.ok && match.verdict === 'match' ? 'passed' : 'review', liveness, match, at: new Date().toISOString() };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
