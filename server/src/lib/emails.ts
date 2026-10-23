import { config } from '../config.js';
import type { Mail } from './mailer.js';

/** Transactional emails: one simple, table-based layout that renders in every mail client. */

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }, footnote?: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${p}</p>`).join('');
  const button = action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 8px"><tr><td style="border-radius:10px;background:#1f57eb"><a href="${esc(action.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${esc(action.label)}</a></td></tr></table>
       <p style="margin:12px 0 0;font-size:12px;color:#94a3b8">Or open this link: <a href="${esc(action.url)}" style="color:#1f57eb;word-break:break-all">${esc(action.url)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f6f8;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px">
<tr><td style="padding:28px 32px 8px"><div style="font-size:17px;font-weight:700;color:#0f172a;letter-spacing:-0.01em">Envo</div></td></tr>
<tr><td style="padding:12px 32px 28px"><h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0f172a">${esc(title)}</h1>${body}${button}</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">${footnote ? esc(footnote) : 'Envo Cloud PBX by Enfinito'}</p>
</td></tr></table></body></html>`;
}

function text(title: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '');
  return [title, '', ...paragraphs.map(strip), ...(action ? ['', `${action.label}: ${action.url}`] : [])].join('\n');
}

function mail(to: string, subject: string, title: string, paragraphs: string[], action?: { label: string; url: string }, footnote?: string): Mail {
  return { to, subject, html: layout(title, paragraphs, action, footnote), text: text(title, paragraphs, action) };
}

export const emails = {
  verify: (to: string, name: string, token: string) =>
    mail(
      to,
      'Confirm your email for Envo',
      `Welcome to Envo, ${name}`,
      ['Confirm your email address to finish setting up your account. Then choose your package and your phone system is ready in minutes.'],
      { label: 'Confirm my email', url: `${config.publicUrl}/verify?token=${token}` },
      'This link works for 48 hours. If you did not sign up, you can ignore this email.',
    ),

  reset: (to: string, name: string, token: string) =>
    mail(
      to,
      'Reset your Envo password',
      'Reset your password',
      [`Hi ${esc(name)}, someone (hopefully you) asked to reset the password for your Envo account.`],
      { label: 'Choose a new password', url: `${config.publicUrl}/reset?token=${token}` },
      'This link works for 1 hour. If you did not ask for it, your password stays as it is.',
    ),

  invite: (to: string, name: string, inviter: string, company: string, url: string, extension: string | null) =>
    mail(
      to,
      `${inviter} invited you to ${company} on Envo`,
      `Hi ${name}, your phone is ready`,
      [
        `${esc(inviter)} added you to <strong>${esc(company)}</strong> on Envo, the company phone system.`,
        extension
          ? `Your extension is <strong>${esc(extension)}</strong>. Choose a password and you can make and take calls straight from your browser.`
          : 'Choose a password to sign in.',
      ],
      { label: 'Choose my password', url },
      'This link works for 7 days and only once. Ask your administrator for a new one if it expires.',
    ),

  phoneSetup: (
    to: string,
    p: { name: string; number: string; domain: string; username: string; password: string; udp: number; tls: number; voicemailPin: string },
  ) =>
    mail(
      to,
      `Phone setup for extension ${p.number}`,
      `Set up extension ${p.number}`,
      [
        `Hi ${esc(p.name)}, enter these settings in your IP phone or softphone app (Zoiper, MicroSIP, Linphone, Grandstream, Yealink…):`,
        [
          `SIP server / domain: <strong>${esc(p.domain)}</strong>`,
          `Username / auth ID: <strong>${esc(p.username)}</strong>`,
          `Password: <strong style="font-family:monospace">${esc(p.password)}</strong>`,
          `Port: <strong>${p.udp}</strong> (UDP or TCP), or <strong>${p.tls}</strong> for TLS`,
        ].join('<br>'),
        `When the phone shows <em>Registered</em>, dial <strong>*43</strong> for an audio test and <strong>*97</strong> for voicemail${p.voicemailPin ? ` (PIN ${esc(p.voicemailPin)})` : ''}.`,
        'Keep this email private: anyone with these details can make calls as you.',
      ],
      { label: 'Open Envo', url: config.publicUrl },
    ),

  invoiceIssued: (to: string, account: string, number: string, description: string, amount: string, due: string) =>
    mail(
      to,
      `Invoice ${number} from Envo`,
      'Your renewal invoice is ready',
      [`Hi ${esc(account)},`, `Invoice <strong>${esc(number)}</strong> for ${esc(description)} is due on ${esc(due)}.`, `Amount: <strong>${esc(amount)}</strong>`],
      { label: 'Pay now', url: `${config.publicUrl}/billing` },
    ),

  /** `what` says what the payment did ("Your package is active."); `url` is where to see it. */
  paymentReceived: (to: string, account: string, number: string, amount: string, what: string, url: string) =>
    mail(to, `Payment received for ${number}`, 'Thank you for your payment', [`Hi ${esc(account)},`, `We received <strong>${esc(amount)}</strong> for invoice ${esc(number)}. ${esc(what)}`], {
      label: 'View it in Envo',
      url,
    }),

  phoneCode: (to: string, name: string, code: string) =>
    mail(
      to,
      `${code} is your Envo Phone code`,
      `Your code is ${code}`,
      [`Hi ${esc(name)}, enter this code in Envo Phone to confirm your email address.`],
      undefined,
      'The code works for 30 minutes. If you did not sign up for Envo Phone, you can ignore this email.',
    ),

  phoneReady: (to: string, name: string, number: string) =>
    mail(
      to,
      `Your number ${number} is ready`,
      'Your number is ready',
      [`Hi ${esc(name)},`, `<strong>${esc(number)}</strong> is registered in your name and ready for calls. Open Envo Phone to call anyone in Bangladesh; calls to other Envo numbers are free.`],
      { label: 'Open Envo Phone', url: `${config.publicUrl}/phone` },
      'Envo Phone by Enfinito',
    ),

  suspended: (to: string, account: string) =>
    mail(
      to,
      'Your Envo phone system is paused',
      'Your phone system is paused',
      [`Hi ${esc(account)},`, 'Your package was not renewed, so calls and phone registrations are stopped. Your settings, numbers and recordings are kept.', 'Pay the open invoice to switch everything back on right away.'],
      { label: 'Renew now', url: `${config.publicUrl}/billing` },
    ),
};
