import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Tenant } from '../lib/types';
import { useAuth } from './auth';

interface TenantState {
  tenantId: number | null;
  tenant: Tenant | null;
  tenants: Tenant[];
  setTenantId: (id: number) => void;
  canSwitch: boolean;
}

const TenantContext = createContext<TenantState | null>(null);
const STORAGE_KEY = 'envo.tenant';

function readStored(): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: tenants = [] } = useQuery({
    queryKey: ['list', 'tenants'],
    queryFn: () => api.get<Tenant[]>('/api/tenants'),
    enabled: !!user,
  });
  const [selected, setSelected] = useState<number | null>(readStored);

  const tenantId = useMemo(() => {
    if (!user) return null;
    if (user.role !== 'superadmin') return user.tenantId;
    if (selected && tenants.some((t) => t.id === selected)) return selected;
    return tenants[0]?.id ?? null;
  }, [user, selected, tenants]);

  useEffect(() => {
    if (tenantId) {
      try {
        localStorage.setItem(STORAGE_KEY, String(tenantId));
      } catch {
        /* storage unavailable */
      }
    }
  }, [tenantId]);

  const value: TenantState = {
    tenantId,
    tenant: tenants.find((t) => t.id === tenantId) ?? null,
    tenants,
    setTenantId: setSelected,
    canSwitch: user?.role === 'superadmin',
  };
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantState {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant outside TenantProvider');
  return ctx;
}
