import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApplyStatus, AsteriskInfo, LiveChannel, LiveContact, LiveExtState, LiveRegistration } from '../lib/types';
import { useAuth } from './auth';

interface LiveState {
  connected: boolean;
  asterisk: AsteriskInfo | null;
  contacts: LiveContact[];
  registrations: LiveRegistration[];
  channels: LiveChannel[];
  extstates: LiveExtState[];
  /** Channel-limit usage: "envo_trunk/trunk5", "envo_did/did3", "envo_tenant/t1" -> calls in use. */
  groups: Record<string, number>;
  apply: ApplyStatus | null;
}

const initial: LiveState = {
  connected: false,
  asterisk: null,
  contacts: [],
  registrations: [],
  channels: [],
  extstates: [],
  groups: {},
  apply: null,
};

const LiveContext = createContext<LiveState>(initial);

/** Real-time PBX state pushed by the server over /api/live. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>(initial);
  const retry = useRef(1000);

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: number | undefined;
    let ping: number | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/live`);
      ws.onopen = () => {
        retry.current = 1000;
        setState((s) => ({ ...s, connected: true }));
        ping = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
      };
      ws.onmessage = (ev) => {
        let msg: { type: string; data?: unknown; entity?: string };
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        switch (msg.type) {
          case 'asterisk':
          case 'contacts':
          case 'registrations':
          case 'channels':
          case 'extstates':
          case 'groups':
          case 'apply':
            setState((s) => ({ ...s, [msg.type]: msg.data }));
            if (msg.type === 'registrations') void qc.invalidateQueries({ queryKey: ['list', 'trunks'] });
            if (msg.type === 'contacts' || msg.type === 'registrations') {
              void qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
              void qc.invalidateQueries({ queryKey: ['setup'] });
            }
            break;
          case 'changed':
            if (msg.entity) void qc.invalidateQueries({ queryKey: ['list', msg.entity] });
            break;
        }
      };
      ws.onclose = () => {
        window.clearInterval(ping);
        setState((s) => ({ ...s, connected: false }));
        if (!closed) {
          timer = window.setTimeout(connect, retry.current);
          retry.current = Math.min(retry.current * 2, 15_000);
        }
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      ws?.close();
    };
  }, [user, qc]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

const ONLINE = new Set(['Reachable', 'NonQualified', 'Created', 'Updated', 'Unknown']);

/** Registration info for extensions: endpoint name -> contacts. */
export function useContactsByEndpoint(): Map<string, LiveContact[]> {
  const { contacts } = useLive();
  return useMemo(() => {
    const map = new Map<string, LiveContact[]>();
    for (const c of contacts) {
      if (!ONLINE.has(c.status)) continue;
      const list = map.get(c.endpoint) ?? [];
      list.push(c);
      map.set(c.endpoint, list);
    }
    return map;
  }, [contacts]);
}

/** Call state of an internal number from its hint: idle / ringing / inuse / busy / onhold / unavailable. */
export function useExtStates(tenantId: number | null): Map<string, string> {
  const { extstates } = useLive();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const s of extstates) if (s.context === `t${tenantId}-internal`) map.set(s.exten, s.status);
    return map;
  }, [extstates, tenantId]);
}
