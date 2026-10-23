import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import {
  Building2,
  Check,
  ChevronDown,
  Command,
  Globe,
  Hash,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Phone,
  PhoneCall,
  PhoneIncoming,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  Voicemail as VoicemailIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../state/auth';
import { useTenant } from '../state/tenant';
import { useLive } from '../state/live';
import { api, errorMessage } from '../lib/api';
import { timeAgo } from '../lib/format';
import { visibleNav } from '../lib/nav';
import { Softphone } from '../phone/Softphone';
import { usePhone } from '../phone/PhoneProvider';
import { Button, Field, Input, LiveBars, Menu, Modal, Tooltip } from './ui';
import { CommandPalette, useCommandPalette } from './CommandPalette';
import { SETUP_STEPS, useSetupProgress } from '../pages/GetStarted';

/** The website's mark: an ink tile with blue signal bars. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={clsx('flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-ink-950 shadow-[0_1px_2px_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.08)]', className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <path d="M7 9.5v5M10.3 7v10M13.7 9v6M17 11v2" strokeWidth="2" strokeLinecap="round" fill="none" className="stroke-brand-500" />
      </svg>
    </div>
  );
}

function Logo({ company }: { company: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 pt-4 pb-4 lg:pt-5">
      <LogoMark className="size-8 [&>svg]:size-[22px]" />
      <div className="min-w-0">
        <div className="font-display text-[19px] leading-none font-semibold tracking-[-0.02em] text-slate-950">envo</div>
        <div className="mt-1 truncate text-[11.5px] leading-none text-slate-500">{company === 'Envo' ? 'Cloud PBX' : company}</div>
      </div>
    </div>
  );
}

function PbxStatus() {
  const live = useLive();
  const connected = live.connected && live.asterisk?.connected;
  return (
    <div className="mx-3 mb-3 flex items-center gap-2.5 rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-black/[0.05]">
      <span className="relative flex size-2 shrink-0">
        {connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={clsx('relative inline-flex size-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-rose-500')} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] leading-tight font-medium text-slate-800">{connected ? 'PBX online' : live.connected ? 'PBX offline' : 'Reconnecting…'}</div>
        {live.asterisk?.version && <div className="mt-0.5 truncate font-mono text-[10.5px] leading-tight text-slate-400">{live.asterisk.version}</div>}
      </div>
    </div>
  );
}

const NAV_OPEN_KEY = 'envo.nav.open';

/** Which folded groups this browser keeps open. */
function readOpenGroups(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(NAV_OPEN_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const onPage = (to: string, pathname: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

/** The everyday pages at the top; the rest folded into groups at the bottom, open on one of their pages. */
function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, plan, company } = useAuth();
  const { pathname } = useLocation();
  const setup = useSetupProgress({ enabled: !!user && user.role !== 'agent', poll: false });
  const setupDone = setup.count === SETUP_STEPS.length;
  const [open, setOpen] = useState(readOpenGroups);
  const toggle = (title: string) =>
    setOpen((o) => {
      const next = { ...o, [title]: !o[title] };
      try {
        localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });

  return (
    <div className="flex h-full flex-col bg-canvas">
      <Logo company={company} />
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pt-1 pb-4" aria-label="Main">
        {(user ? visibleNav(user, plan, setupDone) : []).map((group) => {
          const here = group.items.some((i) => onPage(i.to, pathname));
          const expanded = !group.collapsible || here || !!open[group.title];
          const heading = 'font-mono text-[10.5px] font-medium tracking-[0.08em] text-slate-400 uppercase';
          return (
            <div key={group.title || 'main'}>
              {group.collapsible ? (
                <button
                  type="button"
                  onClick={() => !here && toggle(group.title)}
                  aria-expanded={expanded}
                  className={clsx(heading, 'mb-1.5 flex w-full items-center justify-between rounded-md px-2.5 py-0.5 text-left transition', here ? 'cursor-default' : 'hover:text-slate-700')}
                >
                  {group.title}
                  {!here && <ChevronDown className={clsx('size-3.5 transition', expanded && 'rotate-180')} />}
                </button>
              ) : (
                group.title && <div className={clsx(heading, 'mb-1.5 px-2.5')}>{group.title}</div>
              )}
              {expanded && (
                <div className="space-y-px">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        clsx(
                          'group flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-medium transition duration-150 lg:py-[7px]',
                          isActive
                            ? 'bg-white text-slate-950 shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.05]'
                            : 'text-slate-600 hover:bg-black/[0.04] hover:text-slate-950',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon className={clsx('size-[17px] shrink-0 transition', isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-700')} />
                          <span className="truncate">{item.label}</span>
                          {item.to === '/get-started' && setup.done && !setupDone && (
                            <span className="ml-auto rounded-full bg-brand-50 px-1.5 py-px text-[11px] font-semibold text-brand-700 tabular-nums ring-1 ring-brand-100">
                              {setup.count}/{SETUP_STEPS.length}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <PbxStatus />
    </div>
  );
}

/** Phone navigation: the four most used places plus the web phone in the middle. */
function TabBar({ onMore }: { onMore: () => void }) {
  const { user } = useAuth();
  const phone = usePhone();
  const role = user?.role ?? 'agent';
  const admin = role !== 'agent';
  const ringing = phone.call?.state === 'ringing';
  const inCall = !!phone.call && !ringing;
  const tabs = [
    { to: '/', label: 'Home', icon: LayoutDashboard },
    { to: '/calls', label: 'Calls', icon: History },
    admin ? { to: '/extensions', label: 'Team', icon: Users } : { to: '/voicemail', label: 'Voicemail', icon: VoicemailIcon },
  ];
  // Recordings live next to the call logs, under the same tab.
  const { pathname } = useLocation();
  const tab = (t: (typeof tabs)[number]) => (
    <NavLink
      key={t.to}
      to={t.to}
      end={t.to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-[10.5px] font-medium transition',
          isActive || (t.to === '/calls' && pathname.startsWith('/recordings')) ? 'text-brand-600' : 'text-slate-500 active:text-slate-900',
        )
      }
    >
      <t.icon className="size-[22px]" />
      {t.label}
    </NavLink>
  );
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-white/90 backdrop-blur-xl lg:hidden print:hidden" aria-label="Quick navigation">
      <div className="mx-auto flex max-w-md items-stretch px-2">
        {tab(tabs[0]!)}
        {tab(tabs[1]!)}
        <div className="flex flex-1 justify-center">
          {phone.config ? (
            <button
              type="button"
              onClick={() => phone.setPanelOpen(!phone.panelOpen)}
              aria-label={phone.panelOpen ? 'Hide web phone' : 'Open web phone'}
              aria-expanded={phone.panelOpen}
              className={clsx(
                'relative -mt-5 flex size-14 items-center justify-center rounded-full text-white shadow-[0_8px_20px_-6px_rgb(11_13_18/0.55)] ring-4 ring-white transition active:scale-95',
                ringing ? 'ring-pulse bg-emerald-500' : inCall ? 'bg-rose-500' : 'bg-ink-950',
              )}
            >
              {ringing ? <PhoneIncoming className="size-6 animate-bounce" /> : <Phone className="size-6" />}
            </button>
          ) : (
            tab(admin ? { to: '/numbers', label: 'Numbers', icon: Hash } : { to: '/voicemail', label: 'Voicemail', icon: VoicemailIcon })
          )}
        </div>
        {tab(tabs[2]!)}
        <button type="button" onClick={onMore} className="flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-[10.5px] font-medium text-slate-500 transition active:text-slate-900">
          <MenuIcon className="size-[22px]" />
          More
        </button>
      </div>
    </nav>
  );
}

export function ApplyIndicator() {
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
        <div className="animate-pop-in absolute right-0 z-30 mt-2 w-80 rounded-2xl bg-white p-4 text-sm shadow-[var(--shadow-pop)] ring-1 ring-black/[0.07]">
          <div className="font-semibold text-slate-950">Asterisk configuration</div>
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
          {apply.error && <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">{apply.error}</p>}
          {apply.warnings.map((w) => (
            <p key={w} className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
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
            'flex h-9 max-w-[170px] items-center gap-2 rounded-full border border-slate-200 bg-white pr-2.5 pl-3 text-sm font-medium text-slate-900 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:border-slate-300 hover:bg-slate-50 sm:max-w-none',
            open && 'border-brand-500 ring-4 ring-brand-500/10',
          )}
        >
          <Building2 className="size-4 shrink-0 text-slate-400 max-sm:hidden" />
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
  const { user, logout, leaveCustomerPortal } = useAuth();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  if (!user) return null;
  const support = !!user.impersonator;
  const roleLabel = support ? 'Support access' : user.role === 'superadmin' ? 'Platform admin' : user.isOwner ? 'Owner' : user.role === 'admin' ? 'Admin' : 'Agent';
  return (
    <>
      <Menu
        items={[
          { label: user.email, disabled: true, icon: <span className="size-4" /> },
          support
            ? { label: 'Back to admin portal', icon: <ShieldCheck className="size-4" />, onSelect: () => void leaveCustomerPortal().catch((err) => toast.error(errorMessage(err))), separatorBefore: true }
            : { label: 'Change password', icon: <KeyRound className="size-4" />, onSelect: () => setPwOpen(true), separatorBefore: true },
          { label: 'View website', icon: <Globe className="size-4" />, onSelect: () => navigate('/home') },
          { label: 'Sign out', icon: <LogOut className="size-4" />, danger: true, onSelect: () => void logout(), separatorBefore: true },
        ]}
        trigger={({ open, onClick, ref }) => (
          <button
            ref={ref as never}
            type="button"
            onClick={onClick}
            aria-haspopup="menu"
            aria-expanded={open}
            className={clsx('flex items-center gap-2.5 rounded-full py-1 pr-1 pl-1 transition hover:bg-black/[0.04] md:pr-2.5', open && 'bg-black/[0.04]')}
            aria-label="Account menu"
          >
            <div className="flex size-8 items-center justify-center rounded-full bg-ink-950 text-xs font-semibold text-white ring-2 ring-white">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden text-left md:block">
              <div className="text-[13px] leading-tight font-medium text-slate-900">{user.name}</div>
              <div className="text-[11px] leading-tight text-slate-500">{roleLabel}</div>
            </div>
            <ChevronDown className={clsx('hidden size-4 text-slate-400 transition md:block', open && 'rotate-180')} />
          </button>
        )}
      />
      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

export function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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

/**
 * Shown on every page while a platform admin works in this customer's portal from /admin, with the way
 * back. Everything done here is real and is logged under the admin's own name.
 */
export function SupportBanner() {
  const { user, plan, leaveCustomerPortal } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user?.impersonator) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-amber-300 px-4 py-2 text-center text-[13px] text-amber-950 print:hidden">
      <span className="inline-flex min-w-0 items-center gap-2">
        <ShieldCheck className="size-4 shrink-0" />
        <span>
          <strong className="font-semibold">Support access</strong> · {plan?.accountName ?? 'Customer'} portal, signed in as {user.name}. Changes are real and logged under your name.
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await leaveCustomerPortal();
          } catch (err) {
            toast.error(errorMessage(err));
            setBusy(false);
          }
        }}
        className="rounded-full bg-amber-950 px-3.5 py-1 text-xs font-semibold text-amber-50 transition hover:bg-black focus-visible:ring-4 focus-visible:ring-amber-950/25 focus-visible:outline-none disabled:opacity-60"
      >
        {busy ? 'Returning…' : 'Back to admin'}
      </button>
    </div>
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
        className="hidden h-9 w-64 items-center gap-2 rounded-full bg-slate-100/80 pr-1.5 pl-3.5 text-left text-sm text-slate-500 transition hover:bg-slate-200/60 hover:text-slate-700 md:flex xl:w-80"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate">Search or jump to…</span>
        <span className="flex items-center gap-0.5">
          <kbd className="kbd">{mac ? '⌘' : 'Ctrl'}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>
      <button type="button" onClick={onOpen} aria-label="Search" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 md:hidden">
        <Search className="size-[21px]" />
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
    <div className="flex h-full flex-col bg-canvas">
      <SupportBanner />
      <div className="flex min-h-0 flex-1">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[90] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg"
        >
          Skip to content
        </a>
        <aside className="hidden w-[248px] shrink-0 lg:block print:hidden">
          <Sidebar />
        </aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="animate-fade-in absolute inset-0 bg-[#0b0d12]/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <aside className="animate-drawer absolute inset-y-0 left-0 w-[min(18rem,85vw)] shadow-2xl">
              <button
                type="button"
                className="absolute top-4 right-3 z-10 rounded-full p-1.5 text-slate-400 transition hover:bg-black/[0.05] hover:text-slate-700"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2 print:p-0">
          <div className="flex min-h-0 flex-1 flex-col lg:overflow-hidden lg:rounded-2xl lg:border lg:border-black/[0.07] lg:bg-white lg:shadow-[var(--shadow-panel)] print:overflow-visible print:border-0 print:shadow-none">
            <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] bg-white/90 px-3 backdrop-blur-xl sm:gap-3 sm:px-6 lg:h-[60px] print:hidden">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <NavLink to="/" className="lg:hidden" aria-label="Dashboard">
                  <LogoMark className="size-8 [&>svg]:size-[22px]" />
                </NavLink>
                <TenantSwitcher />
                <PaletteTrigger onOpen={() => palette.setOpen(true)} />
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
                <LiveCallsPill />
                <UserMenu />
              </div>
            </header>
            <main id="main" ref={main} className="app-surface flex-1 overflow-y-auto print:overflow-visible">
              <div className="pb-tabbar mx-auto max-w-[1400px] px-4 pt-5 sm:px-6 sm:pt-7 lg:px-10 lg:pt-9 lg:pb-16">
                <ServerGate>
                  <Outlet />
                </ServerGate>
              </div>
            </main>
          </div>
        </div>
      </div>
      <TabBar onMore={() => setMobileOpen(true)} />
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

/** Pages that work without a SIP server (account, billing, platform administration). */
const SERVERLESS = ['/servers', '/account', '/billing', '/users'];

/**
 * Nothing to manage yet (a fresh platform, or a customer whose package has no server): instead of
 * empty or erroring PBX pages, explain the first step.
 */
function ServerGate({ children }: { children: React.ReactNode }) {
  const { tenants, loaded } = useTenant();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const exempt = SERVERLESS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!loaded || tenants.length > 0 || exempt || user?.role === 'agent') return <>{children}</>;
  return (
    <div className="mx-auto max-w-xl pt-6 sm:pt-12">
      <div className="card px-6 py-10 text-center sm:px-10">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-[var(--shadow-card)] ring-1 ring-black/[0.07]">
          <Building2 className="size-7" />
        </div>
        <h1 className="font-display mt-5 text-[26px] leading-tight font-semibold tracking-[-0.03em] text-slate-950">Create your first SIP server</h1>
        <p className="mt-2 text-[15px] text-slate-500">A SIP server is your phone system: extensions, numbers, IVRs and call routing. Create it to get started.</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <NavLink to="/servers">
            <Button variant="primary" size="lg" className="w-full sm:w-auto">
              Create a SIP server
            </Button>
          </NavLink>
        </div>
      </div>
    </div>
  );
}
