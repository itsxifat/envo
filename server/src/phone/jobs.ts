import { many } from '../db.js';
import { deleteCheckFrames } from '../supply/files.js';
import { chargeCalls } from './balance.js';

/** Envo Phone's clocks: calls are charged every minute; selfies nobody sent on are deleted after a day. */
export function startPhoneJobs(): void {
  const charge = () => void chargeCalls().catch((err) => console.warn('[phone] charging calls failed:', (err as Error).message));
  setTimeout(charge, 20_000).unref();
  setInterval(charge, 60_000).unref();

  const tidy = async () => {
    const old = await many<{ id: string }>("DELETE FROM selfie_checks WHERE used_at IS NULL AND created_at < now() - interval '1 day' RETURNING id");
    for (const c of old) await deleteCheckFrames(c.id);
  };
  setInterval(() => void tidy().catch((err) => console.warn('[phone] removing old selfies failed:', (err as Error).message)), 3600_000).unref();
}
