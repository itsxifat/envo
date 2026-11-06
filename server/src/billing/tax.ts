/**
 * What an invoice adds up to, worked out exactly as the CRM's lib/invoiceTotals.js does (same formulas,
 * same rounding). The CRM recalculates every invoice it receives and refuses one that differs, so a change
 * to either side shows up at once instead of drifting.
 */

export type VatTreatment = 'STANDARD' | 'REDUCED' | 'ZERO_RATED' | 'EXEMPT' | 'NONE';

/** Tax settings handed out by the CRM (Configuration > Integrations > Envo). */
export interface TaxPolicy {
  version: string | null;
  vatTreatment: VatTreatment;
  vatRate: number;
  sdRate: number;
  /** true: the package price is what the customer pays, VAT inside it. false: VAT goes on top. */
  pricesIncludeVat: boolean;
  serviceCode: string | null;
  /** Accounts the CRM bills at zero rate (clients marked foreign there). */
  zeroRatedAccounts: number[];
  /** Recharges and top-ups: NONE, or INCLUDED in what the customer pays (never on top: it all goes on their balance). */
  topupVat: 'NONE' | 'INCLUDED';
  seller?: { name: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; bin: string | null; tin: string | null };
}

/** Not connected to a CRM: no VAT, and customers pay the package price. */
export const NO_TAX: TaxPolicy = { version: null, vatTreatment: 'NONE', vatRate: 0, sdRate: 0, pricesIncludeVat: true, serviceCode: null, zeroRatedAccounts: [], topupVat: 'NONE' };

export interface InvoiceTax {
  amount: number;
  subtotal: number;
  vat_treatment: VatTreatment;
  vat_rate: number;
  sd_rate: number;
  vat_amount: number;
  sd_amount: number;
  service_code: string | null;
  tax_policy_version: string | null;
}

const legacyRound = (n: number) => Math.round(n * 100) / 100;
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** subtotal -> SD -> VAT (charged on the SD-inclusive value) -> total. */
export function addTax(subtotal: number, treatment: VatTreatment, vatRate: number, sdRate: number): { subtotal: number; sd: number; vat: number; total: number } {
  const sub = legacyRound(subtotal);
  const taxable = round2(sub);
  const sd = sdRate ? round2((taxable * sdRate) / 100) : 0;
  const vat = vatRate ? round2(((taxable + sd) * vatRate) / 100) : 0;
  const total = treatment === 'NONE' ? legacyRound(sub) : round2(sub + sd + vat);
  return { subtotal: sub, sd, vat, total };
}

/**
 * The most that fits inside a tax-inclusive price. Rounding means some prices have no exact split (no net
 * amount plus its 15% comes to exactly 1000.00), so the customer then pays a paisa or two less, never more.
 */
function netInsideGross(gross: number, treatment: VatTreatment, vatRate: number, sdRate: number): ReturnType<typeof addTax> {
  const guess = Math.round((gross * 100) / ((1 + sdRate / 100) * (1 + vatRate / 100)));
  let best: ReturnType<typeof addTax> | null = null;
  for (let cents = guess + 3; cents >= Math.max(0, guess - 3); cents--) {
    const t = addTax(cents / 100, treatment, vatRate, sdRate);
    if (t.total <= gross && (!best || t.total > best.total)) best = t;
  }
  return best ?? addTax(0, treatment, vatRate, sdRate);
}

/** No tax at all: what is asked for is what is billed, under no tax settings. */
function untaxed(listPrice: number): InvoiceTax {
  const t = addTax(listPrice, 'NONE', 0, 0);
  return { amount: t.total, subtotal: t.subtotal, vat_treatment: 'NONE', vat_rate: 0, sd_rate: 0, vat_amount: 0, sd_amount: 0, service_code: null, tax_policy_version: null };
}

/**
 * Prices an invoice under the CRM's tax settings from the package or manual amount. A recharge or top-up
 * goes on a balance as it stands, so its VAT, if the CRM wants any, is inside the amount and never on top.
 */
export function priceInvoice(listPrice: number, policy: TaxPolicy, accountId: number, kind: string): InvoiceTax {
  const topup = kind === 'topup';
  if (topup && policy.topupVat !== 'INCLUDED') return untaxed(listPrice);
  const zeroRated = policy.zeroRatedAccounts.includes(accountId) && policy.vatTreatment !== 'NONE';
  const treatment: VatTreatment = zeroRated ? 'ZERO_RATED' : policy.vatTreatment;
  const noVatRate = ['ZERO_RATED', 'EXEMPT', 'NONE'].includes(treatment);
  const vatRate = noVatRate ? 0 : policy.vatRate;
  const sdRate = treatment === 'ZERO_RATED' || treatment === 'NONE' ? 0 : policy.sdRate;
  const hasTax = vatRate > 0 || sdRate > 0;
  const t = hasTax && (policy.pricesIncludeVat || topup) ? netInsideGross(round2(listPrice), treatment, vatRate, sdRate) : addTax(listPrice, treatment, vatRate, sdRate);
  return {
    amount: t.total,
    subtotal: t.subtotal,
    vat_treatment: treatment,
    vat_rate: vatRate,
    sd_rate: sdRate,
    vat_amount: t.vat,
    sd_amount: t.sd,
    service_code: treatment === 'NONE' ? null : policy.serviceCode,
    tax_policy_version: policy.version,
  };
}

/** What customers are told next to prices. */
export function vatNote(policy: TaxPolicy): string {
  if (policy.vatTreatment === 'NONE' || policy.vatTreatment === 'EXEMPT' || policy.vatTreatment === 'ZERO_RATED' || !(policy.vatRate > 0)) return '';
  return policy.pricesIncludeVat ? `Prices include ${policy.vatRate}% VAT.` : `${policy.vatRate}% VAT is added to these prices.`;
}
