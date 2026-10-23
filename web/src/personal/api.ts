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
}

export interface PhoneConfig {
  signups: boolean;
  activation_min: number;
  recharge: { min: number; max: number; presets: number[] };
  rate_per_min: number;
  free_onnet: boolean;
  support: { phone: string; email: string };
  min_app_version: string;
  update_url: string;
  operator: string;
  prefix: string;
  payment: { online: boolean; manual: boolean; manual_instructions: string };
}

export interface Recharge {
  id: number;
  amount: string;
  status: 'awaiting_payment' | 'paid' | 'applied' | 'cancelled';
  created_at: string;
  invoice_id: number;
  invoice_number: string;
  invoice_status: string;
  /** A bKash / Nagad payment the person reported, waiting for support to check it. */
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
    // Waiting for support (a payment to check, a number to register): look again now and then.
    refetchInterval: (q) => (q.state.data?.stage === 'activate' || q.state.data?.stage === 'registering' ? 30_000 : false),
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
