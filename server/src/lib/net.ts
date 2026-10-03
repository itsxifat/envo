import dns from 'node:dns/promises';
import net from 'node:net';

/** True for addresses that must never be reachable from a user-supplied URL. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / tailscale
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('::ffff:127.');
}

/**
 * Resolves a webhook URL and rejects anything pointing at this machine or a private network,
 * so a tenant cannot use webhooks to probe internal services.
 */
export async function resolvePublicUrl(raw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'must be http or https' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    return isPrivateAddress(host) ? { ok: false, reason: 'points at a private or local address' } : { ok: true };
  }
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length) return { ok: false, reason: 'host does not resolve' };
  if (records.some((r) => isPrivateAddress(r.address))) return { ok: false, reason: 'resolves to a private or local address' };
  return { ok: true };
}
