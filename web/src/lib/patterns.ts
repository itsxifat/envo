/** Converts an Asterisk dial pattern (without the leading "_") into a RegExp. */
export function patternToRegex(pattern: string): RegExp | null {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!.toUpperCase();
    if (ch === 'X') re += '[0-9]';
    else if (ch === 'Z') re += '[1-9]';
    else if (ch === 'N') re += '[2-9]';
    else if (ch === '.') re += '.+';
    else if (ch === '!') re += '.*';
    else if (ch === '[') {
      const end = pattern.indexOf(']', i);
      if (end === -1) return null;
      re += `[${pattern.slice(i + 1, end).replace(/[\\^]/g, '')}]`;
      i = end;
    } else if (ch === '-') continue;
    else re += ch.replace(/[+*#]/g, (c) => `\\${c}`);
  }
  try {
    return new RegExp(`^${re}$`);
  } catch {
    return null;
  }
}

/** Rough Asterisk specificity: fewer wildcard matches = more specific. */
export function specificity(pattern: string): number {
  let score = 0;
  for (const ch of pattern.toUpperCase()) {
    if (ch === '.' || ch === '!') score += 1000;
    else if (ch === 'X') score += 10;
    else if (ch === 'Z') score += 9;
    else if (ch === 'N') score += 8;
    else if (ch === '[') score += 5;
  }
  return score;
}

export const PATTERN_PRESETS: { label: string; patterns: string[]; strip?: number; prepend?: string }[] = [
  { label: 'Bangladesh mobile', patterns: ['01[3-9]XXXXXXXX'] },
  { label: 'Bangladesh landline / IP numbers', patterns: ['0[2-9]XXXXXXX.'] },
  { label: 'Bangladesh in +880 format', patterns: ['+880XXXXXXXXXX', '880XXXXXXXXXX'] },
  { label: 'International (00…)', patterns: ['00X.'] },
  { label: 'International (+…)', patterns: ['+X.'] },
  { label: 'Emergency 999', patterns: ['999'] },
  { label: 'Anything (catch-all)', patterns: ['X.'] },
];
