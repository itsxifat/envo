import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { LogoMark } from '../components/Layout';
import { formatBdt, formatDate, formatDateTime, paymentMethodLabel } from '../lib/format';
import type { Invoice, PaymentRow } from '../lib/types';
import { Badge, Button, Card, ErrorBlock, LoadingBlock } from '../components/ui';
import { PayDialog } from '../components/billing';

interface Detail {
  invoice: Invoice;
  payments: PaymentRow[];
  account: { name: string; email: string; phone: string; address: string };
  seller: { name: string; address: string; email: string; phone: string; website?: string | null; bin?: string | null; tin?: string | null };
}

const PAYMENT_STATUS: Record<string, [string, 'green' | 'amber' | 'red' | 'gray']> = {
  succeeded: ['Paid', 'green'],
  pending_review: ['Being checked', 'amber'],
  initiated: ['Started', 'gray'],
  failed: ['Failed', 'red'],
  cancelled: ['Cancelled', 'gray'],
  refunded: ['Refunded', 'gray'],
};

const INVOICE_STATUS: Record<Invoice['status'], [string, string]> = {
  paid: ['Paid', 'text-emerald-600'],
  unpaid: ['Unpaid', 'text-amber-600'],
  void: ['Cancelled', 'text-slate-400'],
};

function vatLabel(invoice: Invoice): string {
  if (invoice.vat_treatment === 'ZERO_RATED') return 'VAT (zero-rated)';
  if (invoice.vat_treatment === 'EXEMPT') return 'VAT (exempt)';
  return `VAT (${Number(invoice.vat_rate)}%)`;
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between border-b border-slate-200 py-2 font-semibold text-slate-900' : 'flex justify-between border-b border-slate-100 py-1.5 text-slate-600'}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** A printable invoice, laid out like the CRM's so the customer's copy and the books read the same. */
export function InvoiceViewPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['account', 'invoice', id], queryFn: () => api.get<Detail>(`/api/account/billing/invoices/${id}`) });
  const [paying, setPaying] = useState(false);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} />;
  const { invoice, payments, account, seller } = q.data;
  const showVat = invoice.vat_treatment !== 'NONE';
  const sd = Number(invoice.sd_amount);
  const total = Number(invoice.amount);
  const received = payments.filter((p) => p.status === 'succeeded');
  const paidTotal = invoice.status === 'paid' ? received.reduce((sum, p) => sum + Number(p.amount), 0) : 0;
  const due = invoice.status === 'void' ? 0 : Math.max(0, total - paidTotal);
  const [statusLabel, statusColor] = INVOICE_STATUS[invoice.status];
  const snapshot = invoice.crm_snapshot;
  const buyerBin = snapshot?.buyer?.bin;
  const sellerBin = snapshot?.seller?.bin ?? seller.bin;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/billing" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft className="size-4" /> Billing
        </Link>
        <div className="flex gap-2">
          {invoice.status === 'unpaid' && (
            <Button variant="primary" onClick={() => setPaying(true)}>
              Pay {formatBdt(invoice.amount)}
            </Button>
          )}
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Print or save PDF
          </Button>
        </div>
      </div>
      <Card className="mx-auto max-w-3xl p-6 sm:p-10 print:max-w-none print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <LogoMark />
            <div className="mt-2 font-semibold tracking-tight text-slate-900">{seller.name}</div>
            <div className="text-xs whitespace-pre-line text-slate-500">{seller.address}</div>
            {(seller.phone || seller.email) && <div className="text-xs text-slate-500">{[seller.phone, seller.email].filter(Boolean).join(' – ')}</div>}
            {seller.website && <div className="text-xs text-slate-500">{seller.website}</div>}
            {(sellerBin || seller.tin) && <div className="mt-1 text-xs font-semibold text-slate-600">{[sellerBin && `BIN: ${sellerBin}`, seller.tin && `TIN: ${seller.tin}`].filter(Boolean).join('  ·  ')}</div>}
          </div>
          <div className="sm:text-right">
            <div className="text-[26px] font-bold tracking-tight text-slate-900">Invoice</div>
            <div className="text-sm font-bold text-slate-400">
              Invoice No: <span className={statusColor}>{invoice.number}</span>
            </div>
            <div className="mt-2.5 space-y-0.5 text-xs">
              <div>
                <span className="text-slate-400">Issued</span> <strong className="text-slate-600">{formatDate(invoice.created_at)}</strong>
              </div>
              <div>
                <span className="text-slate-400">Due</span> <strong className="text-slate-600">{formatDate(invoice.due_at)}</strong>
              </div>
            </div>
            <div className="mt-2.5 text-sm font-bold text-slate-400">
              Invoice Status: <span className={statusColor}>{statusLabel}</span>
            </div>
          </div>
        </div>

        <div className="my-5 h-px bg-slate-200" />

        <div>
          <div className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Invoiced To</div>
          <div className="mt-2 text-sm font-bold text-slate-900">
            {account.name}
            {snapshot?.clientCode && <span className="ml-1.5 text-[11px] font-normal text-slate-400">(Client ID: #{snapshot.clientCode})</span>}
          </div>
          <div className="text-xs text-slate-500">{account.email}</div>
          {account.phone && <div className="text-xs text-slate-500">Phone: {account.phone}</div>}
          {account.address && <div className="text-xs whitespace-pre-line text-slate-500">{account.address}</div>}
          {buyerBin && <div className="mt-0.5 text-xs font-semibold text-slate-600">BIN: {buyerBin}</div>}
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t-2 border-b border-t-slate-900 border-b-slate-200 text-[10px] tracking-wider text-slate-500 uppercase">
                <th className="py-2 pr-3 text-left font-semibold">Description</th>
                <th className="px-3 py-2 text-center font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Unit Price</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                {sd > 0 && <th className="px-2 py-2 text-right font-semibold">SD</th>}
                {showVat && <th className="px-2 py-2 text-center font-semibold whitespace-nowrap">VAT %</th>}
                {showVat && <th className="py-2 pl-3 text-right font-semibold">VAT</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100 align-top">
                <td className="py-2.5 pr-3">
                  <div className="text-[10px] font-medium tracking-wider text-slate-400 uppercase">Envo</div>
                  <div className="font-semibold text-slate-900">{invoice.description}</div>
                </td>
                <td className="px-3 py-2.5 text-center text-slate-500">1</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap text-slate-500 tabular-nums">{formatBdt(invoice.subtotal)}</td>
                <td className="px-3 py-2.5 text-right font-bold whitespace-nowrap text-slate-900 tabular-nums">{formatBdt(invoice.subtotal)}</td>
                {sd > 0 && <td className="px-2 py-2.5 text-right whitespace-nowrap text-slate-500 tabular-nums">{formatBdt(invoice.sd_amount)}</td>}
                {showVat && <td className="px-2 py-2.5 text-center text-slate-500">{Number(invoice.vat_rate)}%</td>}
                {showVat && <td className="py-2.5 pl-3 text-right whitespace-nowrap text-slate-700 tabular-nums">{formatBdt(invoice.vat_amount)}</td>}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-0 flex justify-end text-[13px]">
          <div className="w-full max-w-72">
            <div className="h-0.5 bg-slate-900" />
            <TotalRow label="Sub Total" value={formatBdt(invoice.subtotal)} />
            {sd > 0 && <TotalRow label="SD" value={formatBdt(invoice.sd_amount)} />}
            {showVat && <TotalRow label={vatLabel(invoice)} value={formatBdt(invoice.vat_amount)} />}
            <TotalRow label="Payable" value={formatBdt(invoice.amount)} strong />
            <div className="flex justify-between border-b border-slate-100 py-1.5 font-medium text-emerald-600">
              <span>Paid</span>
              <span className="tabular-nums">−{formatBdt(paidTotal)}</span>
            </div>
            <div className={`mt-1 flex justify-between rounded-lg px-3 py-2 text-sm font-extrabold ${due > 0.01 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
              <span>Due</span>
              <span className="tabular-nums">{formatBdt(due)}</span>
            </div>
          </div>
        </div>

        {payments.length > 0 && (
          <div className="mt-6">
            <div className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Transaction Details</div>
            <ul className="mt-2 divide-y divide-slate-100 border-t-2 border-t-slate-900 text-[13px]">
              {payments.map((p) => {
                const [label, tone] = PAYMENT_STATUS[p.status] ?? ['—', 'gray'];
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 text-slate-700">
                      {paymentMethodLabel(p)}
                      {p.bank_tran_id && <span className="ml-2 font-mono text-[11px] text-slate-400">{p.bank_tran_id}</span>}
                      <span className="ml-2 text-xs text-slate-400">{formatDateTime(p.updated_at)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatBdt(p.amount)}</span>
                      <Badge tone={tone}>{label}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-500">This is a system generated invoice. No signature is required.</div>
        <p className="mt-2 text-center text-xs text-slate-400">Thank you for choosing {seller.name}.</p>
      </Card>
      {paying && <PayDialog invoice={invoice} onClose={() => setPaying(false)} />}
    </>
  );
}
