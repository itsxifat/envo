import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import { ChevronDown, Globe, KeyRound, LogOut, Menu as MenuIcon, Search, X } from 'lucide-react';
import { useAuth } from '../state/auth';
import { useLive } from '../state/live';
import { ADMIN_NAV } from '../lib/nav';
import { LiveBars, Menu } from './ui';
import { ApplyIndicator, LogoMark, PasswordModal } from './Layout';

function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const live = useLive();
  const up = live.connected && live.asterisk?.connected;
  return (
    <div className="dark-scroll flex h-full flex-col bg-ink-950 text-slate-300">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-5 lg:pt-5">
        <LogoMark className="size-8 ring-1 ring-white/15 [&>svg]:size-[22px]" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-[19px] leading-none font-semibold tracking-[-0.02em] text-white">envo</span>
            <span className="rounded-md bg-brand-600 px-1.5 py-[3px] text-[10px] leading-none font-semibold tracking-[0.08em] text-white uppercase">Admin</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] leading-none text-slate-500">Support console</div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pt-1 pb-4" aria-label="Admin">
        {ADMIN_NAV.map((group) => (
          <div key={group.title}>
            <div className="mb-1.5 px-2.5 font-mono text-[10.5px] font-medium tracking-[0.08em] text-slate-500 uppercase">{group.title}</div>
            <div className="space-y-px">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      'group flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-medium transition duration-150 lg:py-[7px]',
                      isActive ? 'bg-white/[0.09] text-white ring-1 ring-white/10' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={clsx('size-[17px] shrink-0 transition', isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300')} />
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mx-3 mb-3 flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/10">
        <span className="relative flex size-2 shrink-0">
          {up && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span className={clsx('relative inline-flex size-2 rounded-full', up ? 'bg-emerald-500' : 'bg-rose-500')} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] leading-tight font-medium text-slate-200">{up ? 'PBX online' : live.connected ? 'PBX offline' : 'Reconnecting…'}</div>
          {live.asterisk?.version && <div className="mt-0.5 truncate font-mono text-[10.5px] leading-tight text-slate-500">{live.asterisk.version}</div>}
        </div>
      </div>
    </div>
  );
}

/** Jumps to the customer list filtered by what was typed. */
function CustomerSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className="relative hidden md:block"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(`/admin/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
        setQ('');
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a customer by name, email or phone"
        aria-label="Find a customer"
        className="h-9 w-72 rounded-full bg-slate-100/80 pr-4 pl-10 text-sm text-slate-800 transition outline-none placeholder:text-slate-500 hover:bg-slate-200/60 focus:bg-white focus:ring-4 focus:ring-brand-500/10 xl:w-96"
      />
    </form>
  );
}

function LiveCount() {
  const live = useLive();
  const calls = useMemo(() => new Set(live.channels.map((c) => c.linkedid)).size, [live.channels]);
  if (!calls) return null;
  return (
    <NavLink
      to="/admin/live"
      className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
    >
      <LiveBars className="text-emerald-600" />
      <span className="tabular-nums">
        {calls} live <span className="hidden sm:inline">{calls === 1 ? 'call' : 'calls'}</span>
      </span>
    </NavLink>
  );
}

function AdminUserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  if (!user) return null;
  return (
    <>
      <Menu
        items={[
          { label: user.email, disabled: true, icon: <span className="size-4" /> },
          { label: 'Change password', icon: <KeyRound className="size-4" />, onSelect: () => setPwOpen(true), separatorBefore: true },
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
            aria-label="Account menu"
            className={clsx('flex items-center gap-2.5 rounded-full py-1 pr-1 pl-1 transition hover:bg-black/[0.04] md:pr-2.5', open && 'bg-black/[0.04]')}
          >
            <div className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white ring-2 ring-white">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="hidden text-left md:block">
              <div className="text-[13px] leading-tight font-medium text-slate-900">{user.name}</div>
              <div className="text-[11px] leading-tight text-slate-500">Platform admin</div>
            </div>
            <ChevronDown className={clsx('hidden size-4 text-slate-400 transition md:block', open && 'rotate-180')} />
          </button>
        )}
      />
      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

/** The support console at /admin: platform staff look after customers here, never inside a SIP server. */
export function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex h-full bg-ink-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[90] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg"
      >
        Skip to content
      </a>
      <aside className="hidden w-[248px] shrink-0 lg:block print:hidden">
        <AdminSidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="animate-fade-in absolute inset-0 bg-[#0b0d12]/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="animate-drawer absolute inset-y-0 left-0 w-[min(18rem,85vw)] shadow-2xl">
            <button
              type="button"
              className="absolute top-4 right-3 z-10 rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <AdminSidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col bg-canvas lg:bg-ink-950 lg:py-2 lg:pr-2 print:p-0">
        <div className="flex min-h-0 flex-1 flex-col lg:overflow-hidden lg:rounded-2xl lg:bg-white lg:shadow-[var(--shadow-panel)] print:overflow-visible print:shadow-none">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] bg-white/90 px-3 backdrop-blur-xl sm:gap-3 sm:px-6 lg:h-[60px] print:hidden">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" className="rounded-full p-2 text-slate-600 transition hover:bg-slate-100 lg:hidden">
                <MenuIcon className="size-5" />
              </button>
              <span className="text-sm font-semibold text-slate-900 lg:hidden">Envo admin</span>
              <CustomerSearch />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              <LiveCount />
              <ApplyIndicator />
              <AdminUserMenu />
            </div>
          </header>
          <main id="main" ref={main} className="app-surface flex-1 overflow-y-auto print:overflow-visible">
            <div className="mx-auto max-w-[1400px] px-4 pt-5 pb-16 sm:px-6 sm:pt-7 lg:px-10 lg:pt-9">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
