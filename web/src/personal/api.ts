import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/** Envo Phone: what the website's personal side reads from /api/phone (the same API as the app). */

export type PhoneStage = 'verify' | 'kyc' | 'activate' | 'registering' | 'active' | 'suspended';

export interface PhoneMe {
  stage: PhoneStage;
  name: string;
  email: string;
  mobile: string;
  /** Reserved from the pool, or connected once it works; null while none is chosen. */
  number: string | null;
  request: { id: number; status: string; reason: string; created_at: string } | null;
  balance: number;
  activation_min: number;
  close_requested: boolean;
  /** A recharge paid on Enfinito Pay that didn't fit its invoice, or a risky one, waits for support's check. */
  payment_in_review: boolean;
}

export interface PhoneConfig {
  signups: boolean;
  activation_min: number;
  recharge: { min: number; max: number; presets: number[] };
  rate_per_min: number;
  free_onnet: boolean;
  /** The selfie is taken live and checked automatically (else any photo). */
  selfie_check: boolean;
  support: { phone: string; email: string };
  min_app_version: string;
  update_url: string;
  /** The Android app on offer from the website, or null before one is uploaded. */
  android: { version: string; size: number; updated_at: string; url: string } | null;
  operator: string;
  prefix: string;
  /** Recharges are paid on Enfinito Pay only; false until it is switched on. */
  payment: { online: boolean };
}

export interface Recharge {
  id: number;
  amount: string;
  status: 'awaiting_payment' | 'paid' | 'applied' | 'cancelled';
  created_at: string;
  invoice_id: number;
  invoice_number: string;
  invoice_status: string;
  /** Its payment waits for support's check (it didn't fit the invoice, or was risky). */
  in_review: boolean;
}

export interface LedgerEntry {
  id: number;
  kind: 'topup' | 'call' | 'adjustment';
  amount: string;
  note: string;
  created_at: string;
}

export interface PhoneCall {
  id: string;
  at: string;
  direction: 'in' | 'out' | 'missed';
  number: string;
  duration: number;
  cost: number | null;
  free: boolean;
}

export const ME_KEY = ['phone', 'me'] as const;

export function usePhoneMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.get<PhoneMe>('/api/phone/me'),
    // Waiting for support (a payment to check, a number to register): look again now and then. With a
    // working number the balance goes down as calls are charged, and calling stops at zero.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.stage === 'activate' || d?.stage === 'registering' || d?.payment_in_review) return 30_000;
      return d?.stage === 'active' ? 60_000 : false;
    },
  });
}

/** Public settings (prices, payment ways, support); the same for everyone. */
export function usePhoneConfig() {
  return useQuery({ queryKey: ['public', 'phone-config'], queryFn: () => api.get<PhoneConfig>('/api/public/phone/config'), staleTime: 5 * 60_000 });
}

export function useRecharges() {
  return useQuery({ queryKey: ['phone', 'recharges'], queryFn: () => api.get<Recharge[]>('/api/phone/recharges') });
}

export function useBalance() {
  return useQuery({ queryKey: ['phone', 'balance'], queryFn: () => api.get<{ balance: number; entries: LedgerEntry[] }>('/api/phone/balance') });
}

export function usePhoneCalls() {
  return useQuery({ queryKey: ['phone', 'calls'], queryFn: () => api.get<PhoneCall[]>('/api/phone/calls'), refetchInterval: 30_000 });
}

/** "09639437015" → "09639 437 015", the way people read numbers here. */
export function formatNumber(n: string | null | undefined): string {
  const d = (n ?? '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return n ?? '';
}
