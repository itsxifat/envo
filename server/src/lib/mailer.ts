import nodemailer, { type Transporter } from 'nodemailer';
import { exec, one } from '../db.js';

/** SMTP account Envo sends from (platform admins only; the password is never sent back). */
export interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  /** true = TLS from the start (port 465); false = STARTTLS when the server offers it (587). */
  secure: boolean;
  user: string;
  pass: string;
  from_name: string;
  from_email: string;
}

export const DEFAULT_EMAIL: EmailSettings = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  from_name: 'Envo',
  from_email: '',
};

let cache: EmailSettings | null = null;
let transport: { key: string; t: Transporter } | null = null;

/** SMTP account from the server's environment (ENVO_SMTP_*); the admin panel can override it. */
function fromEnv(): EmailSettings {
  const host = process.env.ENVO_SMTP_HOST ?? '';
  const user = process.env.ENVO_SMTP_USER ?? '';
  return {
    enabled: !!host,
    host,
    port: Number(process.env.ENVO_SMTP_PORT ?? DEFAULT_EMAIL.port),
    secure: process.env.ENVO_SMTP_SECURE === 'true',
    user,
    pass: process.env.ENVO_SMTP_PASS ?? '',
    from_name: process.env.ENVO_SMTP_FROM_NAME ?? DEFAULT_EMAIL.from_name,
    from_email: process.env.ENVO_SMTP_FROM ?? user,
  };
}

export async function getEmailSettings(): Promise<EmailSettings> {
  if (cache) return cache;
  const row = await one<{ value: Partial<EmailSettings> }>("SELECT value FROM settings WHERE key = 'email'");
  cache = { ...fromEnv(), ...(row?.value ?? {}) };
  return cache;
}

/** Logs at startup whether the SMTP account works, so a broken mailbox shows up before customers notice. */
export async function checkEmailOnStart(): Promise<void> {
  const s = await getEmailSettings();
  if (!emailReady(s)) {
    console.warn('[mail] email is not set up: sign-up confirmations and billing emails only go to this log');
    return;
  }
  try {
    await transporter(s).verify();
    console.log(`[mail] SMTP ${s.host}:${s.port} works (sending as ${s.from_email})`);
  } catch (err) {
    console.warn(`[mail] SMTP ${s.host}:${s.port} does not work: ${(err as Error).message}`);
  }
}

export async function updateEmailSettings(next: EmailSettings): Promise<EmailSettings> {
  await exec(
    `INSERT INTO settings (key, value, updated_at) VALUES ('email', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  cache = null;
  transport = null;
  return getEmailSettings();
}

export function emailReady(s: EmailSettings): boolean {
  return s.enabled && !!s.host && !!s.from_email;
}

function transporter(s: EmailSettings): Transporter {
  const key = JSON.stringify([s.host, s.port, s.secure, s.user, s.pass]);
  if (!transport || transport.key !== key) {
    transport = {
      key,
      t: nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        auth: s.user ? { user: s.user, pass: s.pass } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      }),
    };
  }
  return transport.t;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends one email and logs the outcome. Never throws: sign-up, billing and password resets keep
 * working while email is not set up (the message then goes to the server log instead).
 */
export async function sendMail(mail: Mail): Promise<'sent' | 'failed' | 'skipped'> {
  const s = await getEmailSettings();
  let status: 'sent' | 'failed' | 'skipped' = 'skipped';
  let error = '';
  if (emailReady(s)) {
    try {
      await transporter(s).sendMail({ from: { name: s.from_name, address: s.from_email }, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = (err as Error).message.slice(0, 500);
      console.warn(`[mail] to ${mail.to} failed: ${error}`);
    }
  } else {
    console.log(`[mail] email is not set up; would send to ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
  await exec('INSERT INTO email_log (to_addr, subject, status, error) VALUES ($1, $2, $3, $4)', [mail.to, mail.subject, status, error]).catch(() => undefined);
  return status;
}

/** Tries the SMTP settings without saving them (admin "send test email"). */
export async function testEmail(s: EmailSettings, to: string): Promise<void> {
  const t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined, connectionTimeout: 15_000 });
  await t.sendMail({
    from: { name: s.from_name, address: s.from_email },
    to,
    subject: 'Envo test email',
    text: 'Email from Envo works. Customers will receive sign-up, password and billing emails from this address.',
  });
}
