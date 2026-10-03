import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { LogoMark } from '../components/Layout';
import { formatBdt, formatDate, formatDateTime } from '../lib/format';
import type { Invoice, PaymentRow } from '../lib/types';
import { Badge, Button, Card, ErrorBlock, LoadingBlock } from '../components/ui';
import { PayDialog } from '../components/billing';

interface Detail {
  invoice: Invoice;
  payments: PaymentRow[];
  account: { name: string; email: string; phone: string; address: string };
  seller: { name: string; address: string; email: string; phone: string };
}

const PAYMENT_STATUS: Record<string, [string, 'green' | 'amber' | 'red' | 'gray']> = {
  succeeded: ['Paid', 'green'],
  pending_review: ['Being checked', 'amber'],
  initiated: ['Started', 'gray'],
  failed: ['Failed', 'red'],
  cancelled: ['Cancelled', 'gray'],
  refunded: ['Refunded', 'gray'],
};

/** A printable invoice. */
export function InvoiceViewPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['account', 'invoice', id], queryFn: () => api.get<Detail>(`/api/account/billing/invoices/${id}`) });
  const [paying, setPaying] = useState(false);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} />;
  const { invoice, payments, account, seller } = q.data;
  const paid = invoice.status === 'paid';

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
          <div className="flex items-center gap-3">
            <LogoMark />
            <div>
              <div className="font-semibold tracking-tight text-slate-900">{seller.name}</div>
              <div className="text-xs whitespace-pre-line text-slate-500">{seller.address}</div>
              {(seller.email || seller.phone) && <div className="text-xs text-slate-500">{[seller.email, seller.phone].filter(Boolean).join(' · ')}</div>}
            </div>
          </div>
          <div className="sm:text-right">
            <div className="text-2xl font-semibold tracking-tight text-slate-900">Invoice</div>
            <div className="font-mono text-sm text-slate-600">{invoice.number}</div>
            <div className="mt-2">{paid ? <Badge tone="green">Paid {formatDate(invoice.paid_at)}</Badge> : invoice.status === 'void' ? <Badge>Cancelled</Badge> : <Badge tone="amber">Due {formatDate(invoice.due_at)}</Badge>}</div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Billed to</div>
            <div className="mt-1 font-medium text-slate-900">{account.name}</div>
            <div className="text-sm text-slate-600">{account.email}</div>
            {account.phone && <div className="text-sm text-slate-600">{account.phone}</div>}
            {account.address && <div className="text-sm whitespace-pre-line text-slate-600">{account.address}</div>}
          </div>
          <div className="sm:text-right">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Issued</div>
            <div className="mt-1 text-sm text-slate-700">{formatDate(invoice.created_at)}</div>
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11.5px] text-slate-500">
              <th className="pb-2 font-medium">Description</th>
              <th className="pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-3 text-slate-800">{invoice.description}</td>
              <td className="py-3 text-right text-slate-800 tabular-nums">{formatBdt(invoice.amount)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 text-right font-medium text-slate-600">Total</td>
              <td className="pt-4 text-right text-lg font-semibold text-slate-900 tabular-nums">{formatBdt(invoice.amount)}</td>
            </tr>
          </tfoot>
        </table>

        {payments.length > 0 && (
          <div className="mt-8">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Payments</div>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {payments.map((p) => {
                const [label, tone] = PAYMENT_STATUS[p.status] ?? ['—', 'gray'];
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-slate-700">
                      {p.method === 'sslcommerz' ? `Online${p.card_type ? ` · ${p.card_type}` : ''}` : `${p.channel || 'Manual'}${p.reference ? ` · ${p.reference}` : ''}`}
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
        <p className="mt-10 text-center text-xs text-slate-400">Thank you for choosing {seller.name}.</p>
      </Card>
      {paying && <PayDialog invoice={invoice} onClose={() => setPaying(false)} />}
    </>
  );
}
