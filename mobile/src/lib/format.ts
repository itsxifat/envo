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

/** Talk time in words: "13 sec", "1 min 35 sec", "5 min", "1 hr 2 min"; '' for none. */
export function formatTalk(totalSec: number): string {
  const sec = Math.round(totalSec);
  if (!(sec > 0)) return '';
  if (sec < 60) return `${sec} sec`;
  if (sec < 3600) {
    const s = sec % 60;
    return `${Math.floor(sec / 60)} min${s ? ` ${s} sec` : ''}`;
  }
  const m = Math.floor((sec % 3600) / 60);
  return `${Math.floor(sec / 3600)} hr${m ? ` ${m} min` : ''}`;
}

/** An amount without the currency, for when "BDT" is set apart: "1,999", "245.50". */
export function formatAmount(value: number): string {
  return formatBdt(value).replace(/^BDT /, '');
}

/** "+BDT 200" for money in, "−BDT 0.80" for money out. */
export function formatSigned(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatBdt(Math.abs(value))}`;
}

// Spelled out rather than toLocale…String, whose wording differs between Android versions.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Oct", or "Fri 31 Oct" with the weekday. */
export function formatDate(when: string | number | Date, opts: { weekday?: boolean } = {}): string {
  const d = new Date(when);
  return `${opts.weekday ? `${WEEKDAYS[d.getDay()]} ` : ''}${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A day heading: "Today", "Yesterday" or "Mon 21 Oct". */
export function formatDay(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (t === start) return 'Today';
  if (t === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime()) return 'Yesterday';
  return formatDate(d, { weekday: true });
}

/** The time of day: "8:45 AM". */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The name to greet someone by: "Md. Karim Hossain" → "Karim" (the honorific prefixes are skipped). */
export function firstName(name: string): string {
  const rest = name.trim().replace(/^(?:md|mohd|mohammad|mohammed|muhammad|mst)(?:\.\s*|\s+)(?=\S)/i, '');
  return rest.split(/\s+/)[0] ?? '';
}

/** "Good morning" until noon, "Good afternoon" until 5 pm, then "Good evening". */
export function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
