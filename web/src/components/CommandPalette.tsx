import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowRight,
  Bell,
  BellOff,
  Building2,
  CornerDownLeft,
  LogOut,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, scoped } from '../lib/api';
import { NAV } from '../lib/nav';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import { useExtStates } from '../state/live';
import { usePhone } from '../phone/PhoneProvider';
import type { Extension } from '../lib/types';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

const RECENT_KEY = 'envo.palette.recent';

/** Section order in the palette; any other group is listed after these. */
const GROUP_ORDER = ['Call', 'Go to', 'Actions'];

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * Subsequence match with a bias toward word starts, so "rg" finds "Ring groups"
 * and "ext" ranks "Extensions" above "Time conditions".
 */
function score(text: string, query: string): number {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const direct = t.indexOf(q);
  if (direct === 0) return 1000;
  if (direct > 0) return 700 - direct;
  const initials = t
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('');
  if (initials.startsWith(q)) return 650;
  let ti = 0;
  let hits = 0;
  let bonus = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    if (found === 0 || /[^a-z0-9]/.test(t[found - 1] ?? '')) bonus += 12;
    hits++;
    ti = found + 1;
  }
  return 200 + bonus + hits - (ti - q.length);
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, logout } = useAuth();
  const { tenantId, tenants, canSwitch, setTenantId } = useTenant();
  const phone = usePhone();
  const states = useExtStates(tenantId);
  const role = user?.role ?? 'agent';

  const { data: extensions = [] } = useQuery({
    queryKey: ['list', 'extensions', tenantId],
    queryFn: () => api.get<Extension[]>(scoped('/api/extensions', tenantId)),
    enabled: open && !!tenantId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const remember = useCallback((id: string) => {
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 6);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    for (const group of NAV) {
      for (const item of group.items) {
        if (item.roles && !item.roles.includes(role)) continue;
        list.push({
          id: `nav:${item.to}`,
          label: item.label,
          hint: group.title,
          group: 'Go to',
          keywords: item.keywords,
          icon: <item.icon className="size-4" />,
          run: () => navigate(item.to),
        });
      }
    }

    const self = phone.config?.extension;
    for (const e of extensions) {
      if (e.number === self) continue;
      const state = states.get(e.number);
      list.push({
        id: `call:${e.number}`,
        label: `${e.name}`,
        hint: `Call ext ${e.number}${state && state !== 'unavailable' ? ` · ${state === 'idle' ? 'available' : state}` : ''}`,
        group: 'Call',
        keywords: `${e.number} dial extension ${e.name}`,
        icon: <Phone className="size-4" />,
        run: () => phone.dial(e.number),
      });
    }

    list.push(
      {
        id: 'action:phone',
        label: phone.panelOpen ? 'Hide the web phone' : 'Open the web phone',
        group: 'Actions',
        keywords: 'softphone dialer keypad',
        icon: <PhoneCall className="size-4" />,
        run: () => phone.setPanelOpen(!phone.panelOpen),
      },
      {
        id: 'action:echo',
        label: 'Run the audio echo test',
        hint: 'Dials *43',
        group: 'Actions',
        keywords: 'test microphone audio check 43',
        icon: <Sparkles className="size-4" />,
        run: () => phone.dial('*43'),
      },
      {
        id: 'action:voicemail',
        label: 'Listen to my voicemail',
        hint: 'Dials *97',
        group: 'Actions',
        keywords: 'messages 97 vm',
        icon: <Phone className="size-4" />,
        run: () => phone.dial('*97'),
      },
    );

    const me = extensions.find((e) => e.number === self);
    if (me && (role === 'admin' || role === 'superadmin')) {
      list.push({
        id: 'action:dnd',
        label: me.dnd ? 'Turn off do not disturb' : 'Turn on do not disturb',
        hint: `Extension ${me.number}`,
        group: 'Actions',
        keywords: 'dnd silence busy available',
        icon: me.dnd ? <Bell className="size-4" /> : <BellOff className="size-4" />,
        run: async () => {
          try {
            await api.put(scoped(`/api/extensions/${me.id}`, tenantId), { ...me, dnd: !me.dnd });
            await qc.invalidateQueries({ queryKey: ['list', 'extensions'] });
            toast.success(me.dnd ? 'Do not disturb off' : 'Do not disturb on');
          } catch (err) {
            toast.error(errorMessage(err));
          }
        },
      });
    }

    if (role === 'superadmin' || role === 'admin') {
      list.push({
        id: 'action:apply',
        label: 'Re-apply Asterisk configuration',
        group: 'Actions',
        keywords: 'reload sync pjsip dialplan',
        icon: <RefreshCw className="size-4" />,
        run: async () => {
          try {
            await api.post('/api/system/apply');
            toast.success('Configuration re-applied');
          } catch (err) {
            toast.error(errorMessage(err));
          }
        },
      });
    }

    if (canSwitch) {
      for (const t of tenants) {
        if (t.id === tenantId) continue;
        list.push({
          id: `tenant:${t.id}`,
          label: `Switch to ${t.name}`,
          hint: 'SIP server',
          group: 'Actions',
          keywords: `tenant server ${t.slug}`,
          icon: <Building2 className="size-4" />,
          run: () => {
            setTenantId(t.id);
            void qc.invalidateQueries();
            toast.success(`Now viewing ${t.name}`);
          },
        });
      }
    }

    list.push({
      id: 'action:logout',
      label: 'Sign out',
      group: 'Actions',
      keywords: 'log out exit leave',
      icon: <LogOut className="size-4" />,
      run: () => void logout(),
    });

    return list;
  }, [role, extensions, states, phone, tenants, tenantId, canSwitch, setTenantId, navigate, qc, logout]);

  const results = useMemo(() => {
    const dialable = /^[\d+*#][\d*#]*$/.test(query.trim()) ? query.trim() : '';
    const out: Command[] = [];
    if (dialable) {
      out.push({
        id: `dial:${dialable}`,
        label: `Call ${dialable}`,
        hint: 'Dials with the web phone',
        group: 'Call',
        icon: <PhoneCall className="size-4" />,
        run: () => phone.dial(dialable),
      });
    }
    if (!query.trim()) {
      const pinned = recent.map((id) => commands.find((c) => c.id === id)).filter((c): c is Command => !!c);
      const rest = commands.filter((c) => !recent.includes(c.id) && c.group !== 'Call');
      return [...out, ...pinned, ...rest];
    }
    const scored = commands
      .map((c) => ({ c, s: Math.max(score(c.label, query), score(c.keywords ?? '', query) - 60, score(c.hint ?? '', query) - 80) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label))
      .map((x) => x.c);
    return [...out, ...scored].slice(0, 40);
  }, [commands, query, recent, phone]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const choose = useCallback(
    (cmd: Command | undefined) => {
      if (!cmd) return;
      onClose();
      remember(cmd.id);
      cmd.run();
    },
    [onClose, remember],
  );

  if (!open) return null;

  // One section per group, in a stable order, with each group's best match first.
  // Keyboard navigation follows `flat`, the order the rows are actually shown in.
  const groupNames = [...new Set([...GROUP_ORDER, ...results.map((c) => c.group)])];
  const grouped = groupNames
    .map((name) => [name, results.filter((c) => c.group === name)] as const)
    .filter(([, items]) => items.length > 0);
  const flat = grouped.flatMap(([, items]) => items);
  let index = -1;

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/40 px-4 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-slide-up w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-pop)] ring-1 ring-slate-900/10"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % Math.max(flat.length, 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + flat.length) % Math.max(flat.length, 1));
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            choose(flat[active]);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search className="size-4.5 shrink-0 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, call someone, or type a number…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="kbd">esc</kbd>
        </div>

        <div ref={listRef} id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <div className="px-3 py-10 text-center">
              <p className="text-sm font-medium text-slate-700">Nothing matches “{query}”</p>
              <p className="mt-1 text-xs text-slate-500">Try an extension number, a page name, or a phone number to dial.</p>
            </div>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-1">
              <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
                {group === 'Go to' && !query.trim() && recent.length ? 'Suggestions' : group}
              </div>
              {items.map((cmd) => {
                index++;
                const isActive = index === active;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onMouseMove={() => setActive(flat.indexOf(cmd))}
                    onClick={() => choose(cmd)}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
                      isActive ? 'bg-brand-50 text-brand-950' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', isActive ? 'bg-white text-brand-600 shadow-xs' : 'bg-slate-100 text-slate-500')}>
                      {cmd.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{cmd.label}</span>
                      {cmd.hint && <span className="block truncate text-xs text-slate-500">{cmd.hint}</span>}
                    </span>
                    {isActive && <CornerDownLeft className="size-3.5 shrink-0 text-brand-500" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="kbd">↑</kbd>
              <kbd className="kbd">↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="kbd">↵</kbd> select
            </span>
          </span>
          <span className="flex items-center gap-1">
            Jump anywhere <ArrowRight className="size-3" />
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Registers the global shortcut and owns the palette's open state. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // "/" opens the palette, but only when the user is not typing somewhere.
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (k === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}
