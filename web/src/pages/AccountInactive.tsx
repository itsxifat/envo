import { LogOut } from 'lucide-react';
import { useAuth } from '../state/auth';
import { TenantProvider } from '../state/tenant';
import { LiveProvider } from '../state/live';
import { LogoMark } from '../components/Layout';
import { Button } from '../components/ui';
import { AccountPage } from './Account';

/** What customers see while their account awaits payment or is suspended: the plan and how to continue. */
export function AccountInactive() {
  const { user, logout } = useAuth();
  return (
    <TenantProvider>
      <LiveProvider>
        <div className="flex min-h-full flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:h-16">
            <div className="flex items-center gap-3">
              <LogoMark className="size-8 rounded-[10px] [&>svg]:size-[18px]" />
              <span className="font-semibold tracking-tight text-slate-900">Envo</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-500 sm:inline">{user?.email}</span>
              <Button size="sm" variant="ghost" icon={<LogOut className="size-4" />} onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </header>
          <main className="app-surface flex-1">
            <div className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8">
              <AccountPage />
            </div>
          </main>
        </div>
      </LiveProvider>
    </TenantProvider>
  );
}
