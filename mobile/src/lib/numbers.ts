import { api } from './api';

/**
 * Envo's own numbers (Enfinito's 09639 437 block): calls between them are free. The server decides
 * what is charged; this only marks them in the app.
 */
export const isEnvoNumber = (n: string) => /^09639437\d{3}$/.test(n.replace(/\D/g, ''));

const answers = new Map<string, boolean>();
/** One spelling per number (0…, as Envo stores them). */
const keyOf = (n: string) => n.replace(/\D/g, '').replace(/^880/, '0');

/**
 * Whether Envo has this number, so calls to it are free and go out even with no balance left. The
 * server decides; each number is asked about once.
 */
export async function isEnvoOnServer(n: string): Promise<boolean> {
  const key = keyOf(n);
  const known = answers.get(key);
  if (known !== undefined) return known;
  const { envo } = await api.get<{ envo: boolean }>(`/phone/envo-number?number=${encodeURIComponent(n)}`);
  answers.set(key, envo);
  return envo;
}

/** What Envo said about a number before, without asking: undefined when not asked yet. */
export const knownEnvo = (n: string): boolean | undefined => answers.get(keyOf(n));
