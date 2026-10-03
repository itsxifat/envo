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
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return (
    <TenantProvider>
      <LiveProvider>
        <PhoneProvider>
          <Routes>
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
              <Route path="servers" element={<RequireRole roles={['superadmin']}><ServersPage /></RequireRole>} />
              <Route path="users" element={<RequireRole roles={ADMIN}><UsersPage /></RequireRole>} />
              <Route path="developers" element={<RequireRole roles={ADMIN}><DevelopersPage /></RequireRole>} />
              <Route path="system" element={<RequireRole roles={['superadmin']}><SystemPage /></RequireRole>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </PhoneProvider>
      </LiveProvider>
    </TenantProvider>
  );
}
