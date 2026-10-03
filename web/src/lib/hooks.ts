import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage, scoped } from './api';
import { useTenant } from '../state/tenant';
import type { Destinations } from './types';

/** Tenant-scoped list query; key ['list', resource, tenantId, params]. */
export function useList<T>(resource: string, opts: { params?: Record<string, string | number | undefined>; enabled?: boolean; global?: boolean } = {}) {
  const { tenantId } = useTenant();
  const tid = opts.global ? null : tenantId;
  return useQuery({
    queryKey: ['list', resource, tid, opts.params ?? null],
    queryFn: () => api.get<T[]>(scoped(`/api/${resource}`, tid, opts.params)),
    enabled: (opts.global || !!tenantId) && (opts.enabled ?? true),
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, resource: string) {
  void qc.invalidateQueries({ queryKey: ['list', resource] });
  void qc.invalidateQueries({ queryKey: ['list', 'destinations'] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  if (resource === 'extensions' || resource === 'numbers' || resource === 'trunks') void qc.invalidateQueries({ queryKey: ['list', 'tenants'] });
}

export function useSave<T = unknown>(resource: string, messages: { created?: string; updated?: string } = {}) {
  const qc = useQueryClient();
  const { tenantId } = useTenant();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number | null; data: unknown }) =>
      id ? api.put<T>(scoped(`/api/${resource}/${id}`, tenantId), data) : api.post<T>(scoped(`/api/${resource}`, tenantId), data),
    onSuccess: (_d, vars) => {
      invalidateAll(qc, resource);
      toast.success(vars.id ? (messages.updated ?? 'Saved') : (messages.created ?? 'Created'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRemove(resource: string, message = 'Deleted') {
  const qc = useQueryClient();
  const { tenantId } = useTenant();
  return useMutation({
    mutationFn: (id: number) => api.del(scoped(`/api/${resource}/${id}`, tenantId)),
    onSuccess: () => {
      invalidateAll(qc, resource);
      toast.success(message);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDestinations() {
  const { tenantId } = useTenant();
  return useQuery({
    queryKey: ['list', 'destinations', tenantId],
    queryFn: () => api.get<Destinations>(scoped('/api/destinations', tenantId)),
    enabled: !!tenantId,
  });
}
