import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ChevronDown, CircleUserRound, Clock3, Globe, Grid3x3, LogOut, ShieldCheck, Wallet } from 'lucide-react';
import { useAuth } from '../state/auth';
import { errorMessage } from '../lib/api';
import { ErrorBlock, LoadingBlock, Menu } from '../components/ui';
import { LogoMark, SupportBanner } from '../components/Layout';
import { PhoneProvider } from '../phone/PhoneProvider';
import { LandingPage } from '../pages/public/Landing';
import { PersonalLandingPage } from '../pages/public/Personal';
import { usePhoneMe, type PhoneMe } from './api';
import { ActivateStep, PausedStep, RegistrationStep, VerifyEmailStep } from './Onboarding';
import { AccountPage, BalancePage, CallsPage, PhonePage } from './Pages';
import { CallOverlay } from './CallOverlay';

const TABS = [
  { to: '/phone', label: 'Phone', icon: Grid3x3 },
  { to: '/phone/calls', label: 'Calls', icon: Clock3 },
  { to: '/phone/balance', label: 'Balance', icon: Wallet },
  { to: '/phone/account', label: 'Account', icon: CircleUserRound },
];

/**
 * Envo Phone on the website, for personal accounts: the steps to a working number (email code,
 * registration, first recharge), then the phone itself with calls, balance and account.
 */
export function PersonalApp() {
  const me = usePhoneMe();
  if (me.isLoading) return <LoadingBlock />;
  if (!me.data) return <ErrorBlock error={me.error} onRetry={() => void me.refetch()} />;
  const m = me.data;
  const step = m.stage === 'verify' ? <VerifyEmailStep me={m} /> : m.stage === 'kyc' ? <RegistrationStep me={m} /> : m.stage === 'activate' ? <ActivateStep me={m} /> : m.stage === 'suspended' ? <PausedStep /> : null;

  if (step) {
    return (
      <Routes>
        <Route path="home" element={<LandingPage />} />
        <Route path="home/phone" element={<PersonalLandingPage />} />
        <Route element={<Shell me={m} tabs={false} />}>
          <Route path="*" element={step} />
        </Route>
      </Routes>
    );
  }
  return (
    <PhoneProvider>
      <Routes>
        <Route path="home" element={<LandingPage />} />
        <Route path="home/phone" element={<PersonalLandingPage />} />
        <Route element={<Shell me={m} tabs />}>
          <Route path="phone" element={<PhonePage me={m} />} />
          <Route path="phone/calls" element={<CallsPage me={m} />} />
          <Route path="phone/balance" element={<BalancePage me={m} />} />
          <Route path="phone/account" element={<AccountPage me={m} />} />
          <Route path="*" element={<Navigate to="/phone" replace />} />
        </Route>
      </Routes>
      <CallOverlay />
    </PhoneProvider>
  );
}

const PAYMENT: Record<string, [string, 'success' | 'info' | 'error']> = {
  paid: ['Payment received. Thank you!', 'success'],
  review: ["We're checking your payment and will update your balance shortly.", 'info'],
  failed: ["The payment didn't go through. Please try again.", 'error'],
  cancelled: ['The payment was cancelled.', 'info'],
};

function Shell({ me, tabs }: { me: PhoneMe; tabs: boolean }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  // Back from the payment page: say how it went, once.
  const payment = params.get('payment');
  useEffect(() => {
    if (!payment) return;
    const [text, kind] = PAYMENT[payment] ?? ["We couldn't confirm the payment yet. If money was taken, it shows here shortly.", 'info'];
    toast[kind](text);
    void qc.invalidateQueries({ queryKey: ['phone'] });
    setParams({}, { replace: true });
  }, [payment, qc, setParams]);

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <SupportBanner />
      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-8 px-4 sm:px-6">
          <Link to="/phone" className="flex items-center gap-2.5" aria-label="Envo Phone">
            <LogoMark className="size-8 [&>svg]:size-[22px]" />
            <span className="font-display text-[19px] leading-none font-semibold tracking-[-0.02em] text-slate-950">envo</span>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px] font-semibold text-brand-700">Phone</span>
          </Link>
          {tabs && (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Envo Phone">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end
                  className={({ isActive }) => clsx('rounded-full px-3.5 py-1.5 text-[14px] font-medium transition', isActive ? 'bg-ink-950 text-white' : 'text-slate-600 hover:bg-black/[0.05] hover:text-slate-950')}
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="ml-auto">
            <UserMenu me={me} />
          </div>
        </div>
      </header>
      <main className={clsx('mx-auto w-full max-w-[1120px] flex-1 px-4 pt-6 sm:px-6 sm:pt-8', tabs ? 'pb-tabbar md:pb-16' : 'pb-16')}>
        <Outlet />
      </main>
      {tabs && <BottomTabs />}
    </div>
  );
}

function BottomTabs() {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-white/90 backdrop-blur-xl md:hidden" aria-label="Envo Phone">
      <div className="mx-auto flex max-w-md px-2">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end className={({ isActive }) => clsx('flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-[10.5px] font-medium transition', isActive ? 'text-brand-600' : 'text-slate-500')}>
            <t.icon className="size-[22px]" />
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function UserMenu({ me }: { me: PhoneMe }) {
  const { user, logout, leaveCustomerPortal } = useAuth();
  const navigate = useNavigate();
  const support = !!user?.impersonator;
  const items: { label: string; icon: ReactNode; onSelect?: () => void; disabled?: boolean; danger?: boolean; separatorBefore?: boolean }[] = [
    { label: me.email, disabled: true, icon: <span className="size-4" /> },
    ...(me.stage === 'active' || me.stage === 'registering' ? [{ label: 'Account', icon: <CircleUserRound className="size-4" />, onSelect: () => navigate('/phone/account'), separatorBefore: true }] : []),
    { label: 'View website', icon: <Globe className="size-4" />, onSelect: () => navigate('/home') },
    support
      ? { label: 'Back to admin portal', icon: <ShieldCheck className="size-4" />, onSelect: () => void leaveCustomerPortal().catch((err) => toast.error(errorMessage(err))), separatorBefore: true }
      : { label: 'Sign out', icon: <LogOut className="size-4" />, danger: true, onSelect: () => void logout(), separatorBefore: true },
  ];
  return (
    <Menu
      items={items}
      trigger={({ open, onClick, ref }) => (
        <button
          ref={ref as never}
          type="button"
          onClick={onClick}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
          className={clsx('flex items-center gap-2.5 rounded-full p-1 transition hover:bg-black/[0.04] md:pr-2.5', open && 'bg-black/[0.04]')}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-ink-950 text-xs font-semibold text-white">{me.name.slice(0, 1).toUpperCase()}</span>
          <span className="hidden text-[13.5px] font-medium text-slate-900 md:block">{me.name.split(' ')[0]}</span>
          <ChevronDown className={clsx('hidden size-4 text-slate-400 transition md:block', open && 'rotate-180')} />
        </button>
      )}
    />
  );
}
