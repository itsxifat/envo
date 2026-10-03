import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  company: string;
  sipDomain: string;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState('Envo');
  const [sipDomain, setSipDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: User; company: string; sipDomain: string }>('/api/auth/me');
      setUser(me.user);
      setCompany(me.company);
      setSipDomain(me.sipDomain);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setUser(null);
    window.addEventListener('envo:unauthorized', onUnauthorized);
    return () => window.removeEventListener('envo:unauthorized', onUnauthorized);
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post('/api/auth/login', { email, password });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setUser(null);
    qc.clear();
  }, [qc]);

  return <AuthContext.Provider value={{ user, company, sipDomain, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('Not signed in');
  return user;
}

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.role === 'superadmin' || user?.role === 'admin';
}
