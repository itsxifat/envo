import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import clsx from 'clsx';
import {
  AudioLines,
  Building2,
  Check,
  ChevronDown,
  Command,
  KeyRound,
  LogOut,
  Menu as MenuIcon,
  PhoneCall,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import { useLive } from '../state/live';
import { api, errorMessage } from '../lib/api';
import { timeAgo } from '../lib/format';
import { NAV } from '../lib/nav';
import { Softphone } from '../phone/Softphone';
import { Button, Field, Input, LiveBars, Menu, Modal, Tooltip } from './ui';
import { CommandPalette, useCommandPalette } from './CommandPalette';

function Logo({ company }: { company: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-cyan-600 shadow-lg shadow-brand-900/40">
        <AudioLines className="size-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold tracking-tight text-white">Envo</div>
        <div className="truncate text-[11px] text-slate-400">{company === 'Envo' ? 'Cloud PBX' : company}</div>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, company } = useAuth();
  const live = useLive();
  const role = user?.role ?? 'agent';
  const connected = live.connected && live.asterisk?.connected;
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-ink-900 to-ink-950">
      <Logo company={company} />
      <nav className="dark-scroll flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.roles || i.roles.includes(role));
          if (!items.length) return null;
          return (
            <div key={group.title}>
              <div className="mb-1.5 px-3 text-[10.5px] font-semibold tracking-[0.12em] text-slate-500 uppercase">{group.title}</div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      clsx(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition duration-150',
                        isActive ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-100',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute top-1.5 bottom-1.5 -left-1 w-[3px] rounded-full bg-brand-400" />}
                        <item.icon className={clsx('size-4.5 shrink-0 transition', isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300')} />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="relative flex size-2">
            {connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className={clsx('relative inline-flex size-2 rounded-full', connected ? 'bg-emerald-400' : 'bg-rose-500')} />
          </span>
          <span className="text-slate-300">{connected ? 'PBX online' : live.connected ? 'PBX offline' : 'Reconnecting…'}</span>
        </div>
        {live.asterisk?.version && <div className="mt-1 truncate text-[11px] text-slate-500">{live.asterisk.version}</div>}
      </div>
    </div>
  );
}

function ApplyIndicator() {
  const { apply } = useLive();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  if (!apply || user?.role === 'agent') return null;
  const warn = apply.warnings.length > 0;
  const tone =
    apply.state === 'applying'
      ? 'text-amber-700 bg-amber-50 ring-amber-200'
      : apply.state === 'error'
        ? 'text-rose-700 bg-rose-50 ring-rose-200'
        : warn
          ? 'text-amber-700 bg-amber-50 ring-amber-200'
          : 'text-emerald-700 bg-emerald-50 ring-emerald-200';
  const label = apply.state === 'applying' ? 'Applying…' : apply.state === 'error' ? 'Sync error' : warn ? `${apply.warnings.length} warning${apply.warnings.length > 1 ? 's' : ''}` : 'In sync';
  return (
    <div className="relative" ref={ref}>
      <Tooltip label="Asterisk configuration status">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={clsx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition hover:brightness-[0.98]', tone)}
        >
          <RefreshCw className={clsx('size-3.5', apply.state === 'applying' && 'animate-spin')} />
          <span className="hidden sm:inline">{label}</span>
        </button>
      </Tooltip>
      {open && (
        <div className="animate-pop-in absolute right-0 z-30 mt-2 w-80 rounded-xl bg-white p-4 text-sm shadow-[var(--shadow-pop)] ring-1 ring-slate-200">
          <div className="font-semibold text-slate-900">Asterisk configuration</div>
          <p className="mt-1 text-xs text-slate-500">
            Every change you save is written to Asterisk and hot-reloaded automatically. Last applied {timeAgo(apply.lastAppliedAt)}.
          </p>
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Endpoints loaded</dt>
              <dd className="font-medium tabular-nums">
                {apply.endpointsLoaded ?? '—'} / {apply.endpointsExpected}
              </dd>
            </div>
          </dl>
          {apply.error && <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{apply.error}</p>}
          {apply.warnings.map((w) => (
            <p key={w} className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              {w}
            </p>
          ))}
          <Button
            size="sm"
            className="mt-3 w-full"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/api/system/apply');
                toast.success('Configuration re-applied');
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Re-apply now
          </Button>
        </div>
      )}
    </div>
  );
}

function TenantSwitcher() {
  const { tenants, tenantId, setTenantId, canSwitch, tenant } = useTenant();
  const qc = useQueryClient();
  if (!canSwitch) {
    return tenant ? (
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
        <Building2 className="size-4 shrink-0 text-slate-400" />
        <span className="truncate">{tenant.name}</span>
      </div>
    ) : null;
  }
  return (
    <Menu
      align="left"
      items={tenants.map((t) => ({
        label: (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">
              {t.name}
              {!t.enabled && <span className="ml-1 text-xs text-slate-400">(disabled)</span>}
            </span>
            {t.id === tenantId && <Check className="size-3.5 shrink-0 text-brand-600" />}
          </span>
        ),
        icon: <Building2 className="size-4" />,
        onSelect: () => {
          if (t.id === tenantId) return;
          setTenantId(t.id);
          void qc.invalidateQueries();
        },
      }))}
      trigger={({ open, onClick, ref }) => (
        <button
          ref={ref as never}
          type="button"
          onClick={onClick}
          aria-haspopup="menu"
          aria-expanded={open}
          className={clsx(
            'flex h-9 max-w-[200px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800 shadow-xs transition hover:border-slate-400 sm:max-w-none',
            open && 'border-brand-500 ring-3 ring-brand-500/15',
          )}
        >
          <Building2 className="size-4 shrink-0 text-slate-400" />
          <span className="truncate">{tenant?.name ?? 'SIP server'}</span>
          <ChevronDown className={clsx('size-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
        </button>
      )}
    />
  );
}

/** Shows how many calls are up right now; click to open the live view. */
function LiveCallsPill() {
  const live = useLive();
  const { tenantId } = useTenant();
  const { user } = useAuth();
  const count = useMemo(() => new Set(live.channels.filter((c) => c.tenantId === tenantId).map((c) => c.linkedid)).size, [live.channels, tenantId]);
  if (!count || user?.role === 'agent') return null;
  return (
    <NavLink
      to="/live"
      className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
    >
      <LiveBars className="text-emerald-600" />
      <span className="tabular-nums">
        {count} live <span className="hidden sm:inline">{count === 1 ? 'call' : 'calls'}</span>
      </span>
    </NavLink>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  if (!user) return null;
  const roleLabel = user.role === 'superadmin' ? 'Platform admin' : user.role === 'admin' ? 'Admin' : 'Agent';
  return (
    <>
      <Menu
        items={[
          { label: user.email, disabled: true, icon: <span className="size-4" /> },
          { label: 'Change password', icon: <KeyRound className="size-4" />, onSelect: () => setPwOpen(true), separatorBefore: true },
          { label: 'Sign out', icon: <LogOut className="size-4" />, danger: true, onSelect: () => void logout(), separatorBefore: true },
        ]}
        trigger={({ open, onClick, ref }) => (
          <button
            ref={ref as never}
            type="button"
            onClick={onClick}
            aria-haspopup="menu"
            aria-expanded={open}
            className={clsx('flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 transition hover:bg-slate-100', open && 'bg-slate-100')}
          >
            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-xs font-semibold text-white">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden text-left md:block">
              <div className="text-[13px] leading-tight font-medium text-slate-800">{user.name}</div>
              <div className="text-[11px] leading-tight text-slate-500">{roleLabel}</div>
            </div>
            <ChevronDown className={clsx('size-4 text-slate-400 transition', open && 'rotate-180')} />
          </button>
        )}
      />
      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!current || next.length < 8}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/api/auth/password', { current, next });
                toast.success('Password changed');
                setCurrent('');
                setNext('');
                onClose();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Update password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Current password">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}

/** Header button that opens the command palette. */
function PaletteTrigger({ onOpen }: { onOpen: () => void }) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm text-slate-400 shadow-xs transition hover:border-slate-400 hover:text-slate-500 md:flex xl:w-80"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate">Search or jump to…</span>
        <span className="flex items-center gap-0.5">
          <kbd className="kbd">{mac ? '⌘' : 'Ctrl'}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>
      <button type="button" onClick={onOpen} aria-label="Search" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 md:hidden">
        <Search className="size-5" />
      </button>
    </>
  );
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const palette = useCommandPalette();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  // Return focus to the top of the page on navigation so keyboard users don't lose their place.
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex h-full">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[90] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg"
      >
        Skip to content
      </a>
      <aside className="hidden w-64 shrink-0 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <aside className="animate-slide-up absolute inset-y-0 left-0 w-[17rem] shadow-2xl">
            <button
              type="button"
              className="absolute top-5 right-3 z-10 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/85 px-3 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button type="button" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <MenuIcon className="size-5" />
            </button>
            <TenantSwitcher />
            <PaletteTrigger onOpen={() => palette.setOpen(true)} />
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <LiveCallsPill />
            <ApplyIndicator />
            <UserMenu />
          </div>
        </header>
        <main id="main" ref={main} className="app-surface flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 pt-6 pb-28 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
      <Softphone />
      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
      <PaletteHint onOpen={() => palette.setOpen(true)} />
    </div>
  );
}

/** One-time nudge that the app has a command palette. */
function PaletteHint({ onOpen }: { onOpen: () => void }) {
  const KEY = 'envo.palette.hinted';
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== '1';
    } catch {
      return false;
    }
  });
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };
  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(dismiss, 14_000);
    return () => window.clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return (
    <div className="animate-slide-up fixed bottom-5 left-5 z-30 hidden max-w-xs items-start gap-3 rounded-xl bg-ink-950 px-4 py-3 text-white shadow-[var(--shadow-pop)] lg:flex">
      <Command className="mt-0.5 size-4 shrink-0 text-brand-300" />
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-medium">Everything is a keystroke away</p>
        <p className="mt-0.5 text-slate-400">
          Press <kbd className="kbd-dark">Ctrl</kbd> <kbd className="kbd-dark">K</kbd> to jump to a page, call a colleague, or dial a number.
        </p>
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-300 hover:text-brand-200"
            onClick={() => {
              dismiss();
              onOpen();
            }}
          >
            <PhoneCall className="size-3.5" /> Try it
          </button>
          <button type="button" className="text-[12px] text-slate-500 hover:text-slate-300" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
