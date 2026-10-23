/** Money the way Envo shows it everywhere: "BDT 1,999", or "BDT 245.50" with paisa. */
export function formatBdt(value: number): string {
  const whole = Number.isInteger(value);
  return `BDT ${value.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/**
 * Phone numbers in readable groups: 09639437015 → "09639 437 015", 01712345678 → "01712 345 678",
 * +8801712345678 → "+880 1712 345 678". Anything else is left as typed.
 */
export function formatPhone(raw: string): string {
  const n = raw.replace(/[^\d+]/g, '');
  if (/^\+880\d{10}$/.test(n)) return `+880 ${n.slice(4, 8)} ${n.slice(8, 11)} ${n.slice(11)}`;
  if (/^0\d{10}$/.test(n)) return `${n.slice(0, 5)} ${n.slice(5, 8)} ${n.slice(8)}`;
  return raw;
}

/** "09639 437 015" while typing: groups appear as the digits arrive. */
export function formatTyping(digits: string): string {
  if (!/^0\d*$/.test(digits) || digits.length <= 5) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length <= 11) return `${digits.slice(0, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return digits;
}

/** Call length: "0:42", "12:05", "1:02:09". */
export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "Just now", "5 min ago", "Yesterday", "Mon", "12 Oct". */
export function formatWhen(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const d = new Date(t);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (t >= startOfToday) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (t >= startOfToday - 86_400_000) return 'Yesterday';
  if (t >= startOfToday - 6 * 86_400_000) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Initials for an avatar: "Ayesha Rahman" → "AR", a number → "#". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[A-Za-zঀ-৿]/.test(w[0] ?? ''));
  if (!words.length) return '#';
  return (words[0]![0]! + (words.length > 1 ? words[words.length - 1]![0]! : '')).toUpperCase();
}
