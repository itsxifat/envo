// Everything user-supplied that ends up in an Asterisk config file goes through one of these.
// They are deliberately strict: config/dialplan injection is the main way a PBX gets owned.

/** Free text for comments / names: no line breaks, no comment or section characters. */
export function cfgText(value: string, max = 60): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[;\[\]\\"<>,|(){}$=&^`]/g, '')
    .replace(/[^\x20-\x7E -￿]/g, '')
    .trim()
    .slice(0, max);
}

/** Value placed after "key=" in a pjsip/voicemail style config (e.g. passwords). */
export function cfgValue(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Config values cannot contain line breaks');
  return value.trim().replace(/;/g, '\\;');
}

/** Caller ID name safe for pjsip.conf callerid="..." and dialplan Set(CALLERID(name)=...). */
export function cidName(value: string): string {
  return cfgText(value, 40).replace(/[:?!'*#%]/g, '').trim();
}

export function isDigits(value: string, min = 1, max = 32): boolean {
  return new RegExp(`^[0-9]{${min},${max}}$`).test(value);
}

/** Dialable number: optional leading +, digits, * and #. */
export function isDialable(value: string): boolean {
  return /^\+?[0-9*#]{1,32}$/.test(value);
}

export function isPhoneNumber(value: string): boolean {
  return /^\+?[0-9]{3,20}$/.test(value);
}

/** Hostname or IPv4 address. */
export function isHost(value: string): boolean {
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value);
}

/** IPv4 address or CIDR. */
export function isIpOrCidr(value: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/.exec(value);
  if (!m) return false;
  if ([m[1], m[2], m[3], m[4]].some((o) => Number(o) > 255)) return false;
  return m[6] === undefined || Number(m[6]) <= 32;
}

/** SIP user part we are willing to put in a config (usernames, from_user, contact_user). */
export function isSipUser(value: string): boolean {
  return /^[a-zA-Z0-9_.+\-]{1,64}$/.test(value);
}

/**
 * Outbound dial pattern in Asterisk syntax without the leading underscore,
 * e.g. "01XXXXXXXXX", "+880.", "0[1-9]XXXXXXXX", "999".
 */
export function isDialPattern(value: string): boolean {
  if (!/^[0-9XZNxzn\[\]\-.!+*#]{1,40}$/.test(value)) return false;
  // Bracket groups must be balanced and non-nested.
  let depth = 0;
  for (const ch of value) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (depth < 0 || depth > 1) return false;
  }
  return depth === 0;
}

export function toDialplanPattern(value: string): string {
  const upper = value.replace(/[xzn]/g, (c) => c.toUpperCase());
  return /[XZN\[.!]/.test(upper) ? `_${upper}` : upper;
}

export const CODECS = ['opus', 'g722', 'ulaw', 'alaw', 'gsm', 'g726', 'ilbc', 'speex', 'slin16'] as const;

export function codecList(value: string, fallback: string): string {
  const list = value
    .split(/[\s,]+/)
    .map((c) => c.trim().toLowerCase())
    .filter((c): c is (typeof CODECS)[number] => (CODECS as readonly string[]).includes(c));
  return (list.length ? [...new Set(list)] : fallback.split(',')).join(',');
}
