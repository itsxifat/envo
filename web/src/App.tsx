import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './state/auth';
import { TenantProvider } from './state/tenant';
import { LiveProvider } from './state/live';
import { PhoneProvider } from './phone/PhoneProvider';
import { Layout } from './components/Layout';
import { LoadingBlock } from './components/ui';
import type { Role } from './lib/types';
import { LoginPage } from './pages/Login';
import { LandingPage } from './pages/public/Landing';
import { CheckEmailPage, ForgotPasswordPage, ResetPasswordPage, SetupPage, SignupPage, VerifyPage } from './pages/public/Signup';
import { DashboardPage } from './pages/Dashboard';
import { LiveCallsPage } from './pages/LiveCalls';
import { CallLogsPage } from './pages/CallLogs';
import { VoicemailPage } from './pages/Voicemail';
import { ExtensionsPage } from './pages/Extensions';
import { NumbersPage } from './pages/Numbers';
import { IvrsPage } from './pages/Ivrs';
import { RingGroupsPage } from './pages/RingGroups';
import { QueuesPage } from './pages/Queues';
import { ConferencesPage } from './pages/Conferences';
import { BlockedPage } from './pages/Blocked';
import { TimeConditionsPage } from './pages/TimeConditions';
import { SoundsPage } from './pages/Sounds';
import { TrunksPage } from './pages/Trunks';
import { RoutesPage } from './pages/OutboundRoutes';
import { ServersPage } from './pages/Servers';
import { UsersPage } from './pages/Users';
import { DevelopersPage } from './pages/Developers';
import { SystemPage } from './pages/System';
import { AccountPage } from './pages/Account';
import { CustomersPage } from './pages/admin/Customers';
import { CustomerDetailPage } from './pages/admin/CustomerDetail';
import { PackagesPage } from './pages/admin/Packages';
import { AccountInactive } from './pages/AccountInactive';
import { BillingPage } from './pages/Billing';
import { InvoiceViewPage } from './pages/InvoiceView';
import { SalesPage } from './pages/admin/Sales';
import { BillingSettingsPage } from './pages/admin/BillingSettings';
import { EmailSettingsPage } from './pages/admin/EmailSettings';

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const ADMIN: Role[] = ['superadmin', 'admin'];

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingBlock />;
  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/home" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/check-email" element={<CheckEmailPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        <Route path="/setup" element={<SetupPage />} />
        {/* Any other address: sign in, then the app continues there. */}
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  // Awaiting payment or suspended: only the plan (and soon payment) until the account is active again.
  if (user.role !== 'superadmin' && user.accountStatus !== 'active') return <AccountInactive />;
  return (
    <TenantProvider>
      <LiveProvider>
        <PhoneProvider>
          <Routes>
            {/* Signed in, "/" is the dashboard: the website stays reachable here. */}
            <Route path="home" element={<LandingPage />} />
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="live" element={<RequireRole roles={ADMIN}><LiveCallsPage /></RequireRole>} />
              <Route path="calls" element={<CallLogsPage />} />
              <Route path="voicemail" element={<VoicemailPage />} />
              <Route path="extensions" element={<RequireRole roles={ADMIN}><ExtensionsPage /></RequireRole>} />
              <Route path="numbers" element={<RequireRole roles={ADMIN}><NumbersPage /></RequireRole>} />
              <Route path="ivrs" element={<RequireRole roles={ADMIN}><IvrsPage /></RequireRole>} />
              <Route path="ring-groups" element={<RequireRole roles={ADMIN}><RingGroupsPage /></RequireRole>} />
              <Route path="queues" element={<RequireRole roles={ADMIN}><QueuesPage /></RequireRole>} />
              <Route path="conferences" element={<RequireRole roles={ADMIN}><ConferencesPage /></RequireRole>} />
              <Route path="blocked" element={<RequireRole roles={ADMIN}><BlockedPage /></RequireRole>} />
              <Route path="time-conditions" element={<RequireRole roles={ADMIN}><TimeConditionsPage /></RequireRole>} />
              <Route path="sounds" element={<RequireRole roles={ADMIN}><SoundsPage /></RequireRole>} />
              <Route path="trunks" element={<RequireRole roles={ADMIN}><TrunksPage /></RequireRole>} />
              <Route path="routes" element={<RequireRole roles={ADMIN}><RoutesPage /></RequireRole>} />
              <Route path="servers" element={<RequireRole roles={ADMIN}><ServersPage /></RequireRole>} />
              <Route path="users" element={<RequireRole roles={ADMIN}><UsersPage /></RequireRole>} />
              <Route path="developers" element={<RequireRole roles={ADMIN}><DevelopersPage /></RequireRole>} />
              <Route path="system" element={<RequireRole roles={['superadmin']}><SystemPage /></RequireRole>} />
              <Route path="account" element={<RequireRole roles={['admin']}><AccountPage /></RequireRole>} />
              <Route path="billing" element={<RequireRole roles={['admin']}><BillingPage /></RequireRole>} />
              <Route path="billing/invoices/:id" element={<RequireRole roles={['admin']}><InvoiceViewPage /></RequireRole>} />
              <Route path="admin/sales" element={<RequireRole roles={['superadmin']}><SalesPage /></RequireRole>} />
              <Route path="admin/billing-settings" element={<RequireRole roles={['superadmin']}><BillingSettingsPage /></RequireRole>} />
              <Route path="admin/email" element={<RequireRole roles={['superadmin']}><EmailSettingsPage /></RequireRole>} />
              <Route path="admin/customers" element={<RequireRole roles={['superadmin']}><CustomersPage /></RequireRole>} />
              <Route path="admin/customers/:id" element={<RequireRole roles={['superadmin']}><CustomerDetailPage /></RequireRole>} />
              <Route path="admin/packages" element={<RequireRole roles={['superadmin']}><PackagesPage /></RequireRole>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </PhoneProvider>
      </LiveProvider>
    </TenantProvider>
  );
}
