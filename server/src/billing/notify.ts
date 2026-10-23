import { one } from '../db.js';
import { config } from '../config.js';
import { sendMail } from '../lib/mailer.js';
import { emails } from '../lib/emails.js';

/** Billing emails go to the account's billing address. Fire and forget: never blocks billing. */

const bdt = (v: string | number) => `BDT ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function quietly(job: () => Promise<unknown>): void {
  void job().catch((err) => console.warn('[notify]', (err as Error).message));
}

export function notifyInvoiceIssued(invoiceId: number): void {
  quietly(async () => {
    const r = await one<{ email: string; name: string; number: string; description: string; amount: string; due_at: Date }>(
      'SELECT a.email, a.name, i.number, i.description, i.amount, i.due_at FROM invoices i JOIN accounts a ON a.id = i.account_id WHERE i.id = $1',
      [invoiceId],
    );
    if (r) await sendMail(emails.invoiceIssued(r.email, r.name, r.number, r.description, bdt(r.amount), day(r.due_at)));
  });
}

export function notifyPaymentReceived(invoiceId: number): void {
  quietly(async () => {
    const r = await one<{ email: string; name: string; number: string; amount: string; kind: string; account_kind: string }>(
      'SELECT a.email, a.name, i.number, i.amount, i.kind, a.kind AS account_kind FROM invoices i JOIN accounts a ON a.id = i.account_id WHERE i.id = $1',
      [invoiceId],
    );
    if (!r || Number(r.amount) <= 0) return;
    const personal = r.account_kind === 'personal';
    const what =
      r.kind === 'topup' ? (personal ? 'It is on your calling balance.' : "We add it to your number's balance shortly.") : r.kind === 'manual' ? '' : 'Your package is active.';
    await sendMail(emails.paymentReceived(r.email, r.name, r.number, bdt(r.amount), what, `${config.publicUrl}/${personal ? 'phone' : 'billing'}`));
  });
}

export function notifySuspended(accountId: number): void {
  quietly(async () => {
    const r = await one<{ email: string; name: string }>('SELECT email, name FROM accounts WHERE id = $1', [accountId]);
    if (r) await sendMail(emails.suspended(r.email, r.name));
  });
}
